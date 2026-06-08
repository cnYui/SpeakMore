/**
 * 录音启动准备编排
 *
 * 需要理解后端 ready、WebSocket、麦克风、词典和 start_audio 参数时看这里。
 */
import { getAudioStream, getMeetingAudioStream, stopStreamTracks, type RecordingTransport } from './audioCapture'
import { loadPromptDictionaryTerms, type PromptDictionaryTerm } from '../dictionaryStore'
import { ipcClient } from '../ipc'
import {
  getCurrentLlmConfig,
  loadSettings,
  getTranslationTargetLanguage,
  type LlmRequestConfig,
  type LocalSettings,
  type TranslationTargetLanguage,
} from '../settingsStore'
import { getTranslationModelStatus, type TranslationModelStatus } from '../translationModelStore'
import type { VoiceTask } from './voiceTaskResolver'
import { createVoiceError, type VoiceMode } from './voiceTypes'

export type RecordingStartSocketControls = {
  ensureOpenWebSocket: () => Promise<WebSocket>
  closeWebSocketSilently: () => void
}

export type PreparedRecordingStart = {
  parameters: Record<string, unknown>
  socket: WebSocket
  stream: MediaStream
  transport: RecordingTransport
  diagnosticTimings?: {
    readyMs?: number
    socketMs?: number
    microphoneMs?: number
    parametersMs?: number
  }
}

type StartAudioParameterInputs = {
  dictionaryTerms: PromptDictionaryTerm[]
  llm: LlmRequestConfig
  translationTargetLanguage: TranslationTargetLanguage | null
  settings: LocalSettings
  translationModelStatus: TranslationModelStatus | null
}

type StartAudioGateInputs = Omit<StartAudioParameterInputs, 'dictionaryTerms'>

type StartAudioCustomCommand = {
  id: string
  name: string
  prompt: string
}

function assertLlmConfigReady(llm: LlmRequestConfig) {
  if (!llm.api_key.trim()) {
    throw createVoiceError('llm_api_key_missing')
  }
}

function canUseLocalTranslationForTask(task: VoiceTask, inputs: StartAudioParameterInputs) {
  if (inputs.settings.localTranslationModelEnabled === false) return false
  if (inputs.settings.translationEnginePreference === 'llm') return false
  if (!inputs.translationModelStatus?.ready) return false

  if (task.mode === 'Translate') {
    return Boolean(inputs.translationTargetLanguage)
  }

  if (task.mode === 'MeetingNotes') {
    return task.meetingOptions?.module === 'live_translation'
      && Boolean(task.meetingOptions?.targetLanguage)
      && task.meetingOptions.targetLanguage !== 'off'
  }

  return false
}

function assertVoiceTaskCanStart(task: VoiceTask, inputs: StartAudioParameterInputs) {
  if (canUseLocalTranslationForTask(task, inputs)) return
  assertLlmConfigReady(inputs.llm)
}

function summarizeSelectedText(text: string) {
  const normalized = text.trim()
  return {
    hasSelectedText: Boolean(normalized),
    selectedTextLength: normalized.length,
    selectedTextPreview: normalized ? normalized.replace(/\s+/g, ' ').slice(0, 80) : '',
  }
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

async function measurePromise<T>(
  timings: Record<string, number>,
  key: string,
  promise: Promise<T>,
): Promise<T> {
  const startedAt = nowMs()
  try {
    return await promise
  } finally {
    timings[key] = Math.max(0, Math.round(nowMs() - startedAt))
  }
}

function createMeetingModuleStartParameters(meetingOptions: VoiceTask['meetingOptions'] | undefined) {
  const module = meetingOptions?.module || 'new_note'
  return {
    meeting_audio_source: meetingOptions?.audioSource || 'microphone',
    meeting_translation_target_language: meetingOptions?.targetLanguage || 'off',
    show_original: meetingOptions?.showOriginal !== false,
    show_translation: meetingOptions?.showTranslation !== false,
    meeting_module: module,
    meeting_realtime_commit_policy: 'sentence_or_phrase_group',
    meeting_realtime_profile: module === 'live_translation' ? 'frontier_simulst' : 'frontier_live_note',
    meeting_notes_quality_profile: 'frontier_minutes',
    meeting_notes_pipeline: 'extractive_then_synthesize',
    meeting_capture_profile: module === 'live_translation' ? 'live_translation' : 'live_note',
    meeting_scenario_coverage: 'meeting,class,interview,customer_call,project_sync,training,retrospective,brainstorm,task_plan,field_notes',
    meeting_output_depth: module === 'live_translation' ? 'bilingual_realtime_plus_final_minutes' : 'comprehensive_minutes',
  }
}

export async function prepareRecordingStart(
  task: VoiceTask,
  socketControls: RecordingStartSocketControls,
): Promise<PreparedRecordingStart> {
  // pendingStream 用来处理“麦克风已打开但其它准备失败”的中间态，防止资源泄漏。
  let pendingStream: MediaStream | null = null
  let shouldStopPendingStream = false
  const diagnosticTimings: Record<string, number> = {}
  const parametersStartedAt = nowMs()

  try {
    const llm = await getCurrentLlmConfig()
    const gateInputs = await prepareStartAudioGateInputs(task.mode, llm)
    assertVoiceTaskCanStart(task, { ...gateInputs, dictionaryTerms: [] })

    // 启动前资源可以并行准备，但失败时必须把已经打开的麦克风和连接收掉。
    const readyPromise = measurePromise(diagnosticTimings, 'readyMs', ensureVoiceServerReady())
    const transportPromise = Promise.resolve<RecordingTransport>('pcm16')
    const socketPromise = measurePromise(diagnosticTimings, 'socketMs', socketControls.ensureOpenWebSocket())
    const parameterInputsPromise = loadPromptDictionaryTerms()
      .then((dictionaryTerms) => ({ ...gateInputs, dictionaryTerms }))
      .finally(() => {
        diagnosticTimings.parametersMs = Math.max(0, Math.round(nowMs() - parametersStartedAt))
      })
    const streamPromise = measurePromise(diagnosticTimings, 'microphoneMs', (task.mode === 'MeetingNotes'
      ? getMeetingAudioStream(task.meetingOptions?.audioSource || 'microphone')
      : getAudioStream()
    ).then((stream) => {
      pendingStream = stream
      if (shouldStopPendingStream) {
        stopStreamTracks(stream)
      }
      return stream
    }))

    const [transport, socket, stream, , parameterInputs] = await Promise.all([
      transportPromise,
      socketPromise,
      streamPromise,
      readyPromise,
      parameterInputsPromise,
    ])
    const parameters = getStartAudioParameters(task.mode, task.selectedText, transport, parameterInputs, task.customCommand, task.meetingOptions)
    console.info('[voice][startup] start_audio 参数已准备', {
      mode: task.mode,
      hasSelectedTextParameter: typeof parameters.selected_text === 'string' && Boolean(String(parameters.selected_text).trim()),
      parameterKeys: Object.keys(parameters),
      ...summarizeSelectedText(task.selectedText),
    })

    return { parameters, socket, stream, transport, diagnosticTimings }
  } catch (error) {
    shouldStopPendingStream = true
    stopStreamTracks(pendingStream)
    socketControls.closeWebSocketSilently()
    throw error
  }
}

export function cleanupPreparedStart(
  prepared: PreparedRecordingStart,
  socketControls: RecordingStartSocketControls,
) {
  // 会话在准备完成后被取消时，还没正式进入 active 状态，也要清理刚拿到的资源。
  stopStreamTracks(prepared.stream)
  socketControls.closeWebSocketSilently()
}

export async function prepareStartAudioParameterInputs(
  mode: VoiceMode,
  currentLlm?: LlmRequestConfig,
): Promise<StartAudioParameterInputs> {
  const [gateInputs, dictionaryTerms] = await Promise.all([
    prepareStartAudioGateInputs(mode, currentLlm),
    loadPromptDictionaryTerms(),
  ])

  return { ...gateInputs, dictionaryTerms }
}

async function prepareStartAudioGateInputs(
  mode: VoiceMode,
  currentLlm?: LlmRequestConfig,
): Promise<StartAudioGateInputs> {
  const translationTargetLanguagePromise = mode === 'Translate'
    ? getTranslationTargetLanguage()
    : Promise.resolve(null)
  const [llm, translationTargetLanguage, settings] = await Promise.all([
    currentLlm ? Promise.resolve(currentLlm) : getCurrentLlmConfig(),
    translationTargetLanguagePromise,
    loadSettings(),
  ])
  const translationModelStatus = mode === 'Translate' || mode === 'MeetingNotes'
    ? await getTranslationModelStatus(settings.translationModelCacheDir)
    : null

  return { llm, translationTargetLanguage, settings, translationModelStatus }
}

export function getStartAudioParameters(
  mode: VoiceMode,
  selectedText = '',
  _transport: RecordingTransport = 'pcm16',
  inputs: StartAudioParameterInputs,
  customCommand?: StartAudioCustomCommand,
  meetingOptions?: VoiceTask['meetingOptions'],
): Record<string, unknown> {
  // 词典和 LLM 配置是本轮请求参数，必须在 start_audio 前固定下来，避免录音中途变化。
  const { dictionaryTerms, llm, translationTargetLanguage } = inputs
  const dictionaryParameters = dictionaryTerms.length ? { dictionary_terms: dictionaryTerms } : {}
  const baseParameters = {
    llm,
    translation_engine_preference: inputs.settings.translationEnginePreference,
    local_translation_model_enabled: inputs.settings.localTranslationModelEnabled,
    meeting_realtime_asr_preference: inputs.settings.meetingRealtimeAsrPreference,
    meeting_realtime_asr_model_enabled: inputs.settings.meetingRealtimeAsrModelEnabled,
    ...dictionaryParameters,
    audio_format: { type: 'pcm_s16le', sample_rate: 16000, channels: 1 },
  }

  // 自由提问只在有可信选区时把选区文本作为上下文发给后端。
  if (mode === 'Ask') {
    const parameters: Record<string, unknown> = selectedText
      ? { ...baseParameters, selected_text: selectedText }
      : baseParameters
    console.info('[voice][startup] Ask 参数构造结果', {
      hasSelectedTextParameter: typeof parameters.selected_text === 'string' && Boolean(String(parameters.selected_text).trim()),
      parameterKeys: Object.keys(parameters),
      ...summarizeSelectedText(selectedText),
    })
    return parameters
  }

  if (mode === 'CustomCommand') {
    return {
      ...baseParameters,
      custom_prompt: customCommand?.prompt || '',
      command_id: customCommand?.id || '',
      command_name: customCommand?.name || '',
    }
  }

  if (mode === 'MeetingNotes') {
    return {
      ...baseParameters,
      ...createMeetingModuleStartParameters(meetingOptions),
    }
  }

  if (mode !== 'Translate') return baseParameters

  // 翻译目标语言是用户设置，必须随本轮 start_audio 参数一起发送。
  return {
    ...baseParameters,
    output_language: translationTargetLanguage,
  }
}

export async function ensureVoiceServerReady() {
  let result: { success?: boolean; detail?: string; status?: string; code?: string } | null = null

  try {
    // /ready 才代表当前 ASR 模型可接收请求，/health 只说明后端进程存在。
    result = await ipcClient.invoke('audio:ensure-voice-server') as { success?: boolean; detail?: string; status?: string; code?: string }
  } catch {
    result = await ipcClient.invoke('audio:check-voice-server-ready') as { success?: boolean; detail?: string; status?: string; code?: string }
  }

  if (!result?.success) {
    if (result?.code === 'voice_model_missing') {
      throw createVoiceError('voice_model_missing', result.detail || result.status || '')
    }
    throw createVoiceError('backend_unavailable', result?.detail || result?.status || '')
  }
}
