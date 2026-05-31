/**
 * 录音启动准备编排
 *
 * 需要理解后端 ready、WebSocket、麦克风、词典和 start_audio 参数时看这里。
 */
import { getAudioStream, stopStreamTracks, type RecordingTransport } from './audioCapture'
import { loadPromptDictionaryTerms, type PromptDictionaryTerm } from '../dictionaryStore'
import { ipcClient } from '../ipc'
import {
  getCurrentLlmConfig,
  getTranslationTargetLanguage,
  type LlmRequestConfig,
  type TranslationTargetLanguage,
} from '../settingsStore'
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
}

type StartAudioParameterInputs = {
  dictionaryTerms: PromptDictionaryTerm[]
  llm: LlmRequestConfig
  translationTargetLanguage: TranslationTargetLanguage | null
}

function assertLlmConfigReady(llm: LlmRequestConfig) {
  if (!llm.api_key.trim()) {
    throw createVoiceError('llm_api_key_missing')
  }
}

function summarizeSelectedText(text: string) {
  const normalized = text.trim()
  return {
    hasSelectedText: Boolean(normalized),
    selectedTextLength: normalized.length,
    selectedTextPreview: normalized ? normalized.replace(/\s+/g, ' ').slice(0, 80) : '',
  }
}

export async function prepareRecordingStart(
  task: VoiceTask,
  socketControls: RecordingStartSocketControls,
): Promise<PreparedRecordingStart> {
  // pendingStream 用来处理“麦克风已打开但其它准备失败”的中间态，防止资源泄漏。
  let pendingStream: MediaStream | null = null
  let shouldStopPendingStream = false

  try {
    const llm = await getCurrentLlmConfig()
    assertLlmConfigReady(llm)

    // 启动前资源可以并行准备，但失败时必须把已经打开的麦克风和连接收掉。
    const readyPromise = ensureVoiceServerReady()
    const transportPromise = Promise.resolve<RecordingTransport>('pcm16')
    const socketPromise = socketControls.ensureOpenWebSocket()
    const parameterInputsPromise = prepareStartAudioParameterInputs(task.mode, llm)
    const streamPromise = getAudioStream().then((stream) => {
      pendingStream = stream
      if (shouldStopPendingStream) {
        stopStreamTracks(stream)
      }
      return stream
    })

    const [transport, socket, stream, , parameterInputs] = await Promise.all([
      transportPromise,
      socketPromise,
      streamPromise,
      readyPromise,
      parameterInputsPromise,
    ])
    const parameters = getStartAudioParameters(task.mode, task.selectedText, transport, parameterInputs)
    console.info('[voice][startup] start_audio 参数已准备', {
      mode: task.mode,
      hasSelectedTextParameter: typeof parameters.selected_text === 'string' && Boolean(String(parameters.selected_text).trim()),
      parameterKeys: Object.keys(parameters),
      ...summarizeSelectedText(task.selectedText),
    })

    return { parameters, socket, stream, transport }
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
  const translationTargetLanguagePromise = mode === 'Translate'
    ? getTranslationTargetLanguage()
    : Promise.resolve(null)
  const [dictionaryTerms, llm, translationTargetLanguage] = await Promise.all([
    loadPromptDictionaryTerms(),
    currentLlm ? Promise.resolve(currentLlm) : getCurrentLlmConfig(),
    translationTargetLanguagePromise,
  ])
  assertLlmConfigReady(llm)

  return { dictionaryTerms, llm, translationTargetLanguage }
}

export function getStartAudioParameters(
  mode: VoiceMode,
  selectedText = '',
  _transport: RecordingTransport = 'pcm16',
  inputs: StartAudioParameterInputs,
): Record<string, unknown> {
  // 词典和 LLM 配置是本轮请求参数，必须在 start_audio 前固定下来，避免录音中途变化。
  const { dictionaryTerms, llm, translationTargetLanguage } = inputs
  const dictionaryParameters = dictionaryTerms.length ? { dictionary_terms: dictionaryTerms } : {}
  const baseParameters = {
    llm,
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
