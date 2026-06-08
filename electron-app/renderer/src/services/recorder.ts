/**
 * 语音会话对外 facade
 *
 * 需要理解录音启动、停止、取消、状态订阅和 UI 对接时看这里。
 */
import { ipcClient } from './ipc'
import { playInteractionSound } from './interactionSounds'
import { normalizeMeetingStructuredResult } from './meetingStructuredResult'
import { loadSettings } from './settingsStore'
import { muteBackgroundAudio, resetBackgroundAudioRestoreState, restoreBackgroundAudio } from './voice/backgroundAudio'
import { cleanupPreparedStart, prepareRecordingStart } from './voice/recordingStartup'
import { deliverVoiceResult, hideFloatingPanel } from './voice/voiceResultDelivery'
import type { ShortcutIntent } from './shortcutGuard'
import { countTextLength, normalizeVoiceError } from './voice/voiceSessionUtils'
import { createVoiceSocketManager } from './voice/voiceSocket'
import { createRecordingTransportRuntime } from './voice/recordingTransportRuntime'
import { createVoiceDiagnosticsRuntime } from './voice/voiceDiagnosticsRuntime'
import { createVoiceSessionLifecycle } from './voice/voiceSessionLifecycle'
import { createVoiceSessionStore, type VoiceSessionListener } from './voice/voiceSessionStore'
import {
  createMeetingNotesVoiceTask,
  resolveShortcutCommandVoiceTask,
  resolveVoiceTask,
  type VoiceTask,
} from './voice/voiceTaskResolver'
import type { MeetingAudioSource, MeetingTranslationTarget } from './meetingNotesStore'
import type { ShortcutCommand } from './shortcutCommandStore'
import {
  createVoiceError,
  initialVoiceSession,
  toFloatingBarState,
  toVoiceFlowMode,
  type VoiceError,
  type MeetingLiveSegment,
  type VoiceMode,
  type VoiceSession,
  type VoiceStatus,
} from './voice/voiceTypes'

const TRANSCRIBE_TIMEOUT_MS = 60000
const RECORDING_LIMIT_WARNING_MS = 50000
const RECORDING_LIMIT_MS = 60000
const RECORDING_LIMIT_WARNING_TEXT = '录音将在 10 秒后自动结束'
// 只有这些状态代表本轮语音还没有产出最终结果，Escape 才允许取消。
const CANCELABLE_STATUSES = new Set<VoiceStatus>(['connecting', 'recording', 'stopping', 'transcribing'])

async function buildActiveMicrophoneNotice(stream: MediaStream, mode: VoiceMode) {
  if (mode === 'Ask') return ''
  const settings = await loadSettings()
  if (!settings.showActiveMicrophoneHint) return ''
  const label = stream.getAudioTracks()[0]?.label?.trim()
  return label ? `正在使用麦克风：${label}` : ''
}

// recorder 是渲染进程里的语音状态机，模块级变量用于保存当前唯一一轮录音会话。
// 这里不放进 React state，是因为快捷键、悬浮窗、WebSocket 和页面组件都要共享同一份录音事实。
let activeTask: VoiceTask | null = null
const sessionStore = createVoiceSessionStore({
  sendVoiceState: (nextSession) => {
    // 悬浮胶囊只消费 voice-state，录音状态源必须集中在 recorder。
    ipcClient.send('voice-state', toFloatingBarState(nextSession))
  },
})
const transportRuntime = createRecordingTransportRuntime()
const diagnosticsRuntime = createVoiceDiagnosticsRuntime()
const lifecycle = createVoiceSessionLifecycle({
  timeoutMs: TRANSCRIBE_TIMEOUT_MS,
  setTimer: (callback, timeoutMs) => window.setTimeout(callback, timeoutMs),
  clearTimer: (timerId) => window.clearTimeout(timerId),
  onTimeout: () => failSession(createVoiceError('websocket_timeout')),
  recordingLimitWarningMs: RECORDING_LIMIT_WARNING_MS,
  recordingLimitMs: RECORDING_LIMIT_MS,
  onRecordingLimitWarning: () => showRecordingLimitWarning(),
  onRecordingLimitReached: () => stopRecording(),
})
const voiceSocket = createVoiceSocketManager({
  getCurrentAudioId: () => getVoiceSession().audioId || '',
  getCurrentRawText: () => getVoiceSession().rawText,
  isIgnoredAudioId: (audioId: string) => lifecycle.isIgnoredAudioId(audioId),
  isCancelledSession: () => getVoiceSession().status === 'cancelled',
  isTerminalSession: () => {
    const status = getVoiceSession().status
    return status === 'completed' || status === 'error'
  },
  shouldFailOnClose: () => {
    const status = getVoiceSession().status
    return status === 'recording' || status === 'transcribing'
  },
  onRawText: handleRawText,
  onMeetingTranslationPending: handleMeetingTranslationPending,
  onMeetingTranslation: handleMeetingTranslation,
  onMeetingTranslationError: handleMeetingTranslationError,
  onFinalText: (text, payload) => void completeSession(text, payload),
  onError: failSession,
  onInterrupt: (detail) => failSession(createVoiceError('backend_unavailable', detail || '会话已被中断')),
})

// 外部页面读取当前语音状态时只拿快照，真正状态修改必须走 recorder 内部函数。
export function getVoiceSession() {
  return sessionStore.getSession()
}

// AppShell、页面和悬浮 UI 都通过订阅拿状态；返回清理函数避免组件卸载后继续收通知。
export function subscribeVoiceSession(listener: VoiceSessionListener) {
  return sessionStore.subscribe(listener)
}

// 页面按钮入口按显式模式启动；如果当前正在录音，同一个入口就变成停止。
export async function toggleRecording(mode: VoiceMode) {
  const session = getVoiceSession()
  if (session.status === 'recording') {
    stopRecording()
    return
  }

  if (session.status === 'connecting' || session.status === 'stopping' || session.status === 'transcribing') {
    return
  }

  await startRecording(mode)
}

// 快捷键入口先保留“意图”，后续再结合选区快照解析成最终任务。
export async function toggleRecordingByShortcut(intent: ShortcutIntent) {
  const session = getVoiceSession()
  if (session.status === 'recording') {
    stopRecording()
    return
  }

  if (session.status === 'connecting' || session.status === 'stopping' || session.status === 'transcribing') {
    return
  }

  await startRecordingFromIntent(intent)
}

export async function toggleRecordingByShortcutCommand(command: ShortcutCommand) {
  if (!command.enabled) return

  const session = getVoiceSession()
  if (session.status === 'recording') {
    stopRecording()
    return
  }

  if (session.status === 'connecting' || session.status === 'stopping' || session.status === 'transcribing') {
    return
  }

  await startRecordingFromShortcutCommand(command)
}

export type MeetingRecordingOptions = {
  audioSource: MeetingAudioSource
  targetLanguage: MeetingTranslationTarget
  showOriginal: boolean
  showTranslation: boolean
  module?: 'new_note' | 'live_translation'
}

function createMeetingModuleParameters(options: MeetingRecordingOptions) {
  const module = options.module || 'new_note'
  return {
    meeting_audio_source: options.audioSource,
    meeting_translation_target_language: options.targetLanguage,
    show_original: options.showOriginal !== false,
    show_translation: options.showTranslation !== false,
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

export async function toggleMeetingNotesRecording(options?: MeetingRecordingOptions) {
  const session = getVoiceSession()
  if (session.status === 'recording') {
    stopRecording()
    return
  }

  if (session.status === 'connecting' || session.status === 'stopping' || session.status === 'transcribing') {
    return
  }

  await startRecordingWithTask('MeetingNotes', async () => createMeetingNotesVoiceTask(options))
}

export function updateMeetingNotesRecordingOptions(options: MeetingRecordingOptions) {
  const session = getVoiceSession()
  if (session.mode !== 'MeetingNotes' || !['connecting', 'recording'].includes(session.status)) return false

  const socket = voiceSocket.getSocket()
  if (!socket || socket.readyState !== WebSocket.OPEN) return false

  if (activeTask) {
    activeTask = {
      ...activeTask,
      meetingOptions: options,
    }
  }

  socket.send(JSON.stringify({
    type: 'set_mode_config',
    mode: 'meeting_notes',
    parameters: createMeetingModuleParameters(options),
  }))
  return true
}

function toShortcutIntent(mode: VoiceMode): ShortcutIntent {
  if (mode === 'Ask') return 'AskShortcut'
  if (mode === 'Translate') return 'TranslateShortcut'
  return 'DictateShortcut'
}

// 兼容旧调用方：外部如果只知道 VoiceMode，这里转换成统一的快捷键意图入口。
export async function startRecording(mode: VoiceMode) {
  await startRecordingFromIntent(toShortcutIntent(mode))
}

function getInitialModeForIntent(intent: ShortcutIntent): VoiceMode {
  if (intent === 'AskShortcut') return 'Ask'
  if (intent === 'TranslateShortcut') return 'Translate'
  return 'Dictate'
}

async function startRecordingFromIntent(intent: ShortcutIntent) {
  await startRecordingWithTask(getInitialModeForIntent(intent), () => resolveVoiceTask(intent))
}

async function startRecordingFromShortcutCommand(command: ShortcutCommand) {
  const initialMode: VoiceMode = command.action === 'ask'
    ? 'Ask'
    : command.action === 'custom-command'
      ? 'CustomCommand'
      : 'Dictate'
  await startRecordingWithTask(initialMode, () => resolveShortcutCommandVoiceTask(command))
}

async function startRecordingWithTask(initialMode: VoiceMode, resolveTask: () => Promise<VoiceTask>) {
  // audioId 是本轮录音的唯一边界，后续 WebSocket 消息必须匹配它才会被接受。
  // 新录音开始前先隐藏旧结果，避免用户看到上一轮悬浮面板误以为是当前结果。
  hideFloatingPanel()
  resetBackgroundAudioRestoreState()
  const audioId = crypto.randomUUID()
  diagnosticsRuntime.start(audioId, initialMode)
  lifecycle.startSession(audioId)
  setSession({
    ...initialVoiceSession,
    status: 'connecting',
    mode: initialMode,
    audioId,
  })

  try {
    // 快捷键只表达意图，真正的语音模式、选区上下文和结果交付方式在这里解析。
    const task = await resolveTask()
    diagnosticsRuntime.recordEvent('task_resolved', { status: task.mode })
    if (!isSessionActive(audioId)) return
    activeTask = task
    const currentSession = getVoiceSession()
    if (currentSession.mode !== task.mode) {
      setSession({ ...currentSession, mode: task.mode })
      diagnosticsRuntime.recordEvent('mode_updated', { status: task.mode })
    }

    const prepared = await prepareRecordingStart(task, voiceSocket)
    diagnosticsRuntime.mergeMetrics({
      startupMs: prepared.diagnosticTimings
        ? Math.max(0, ...Object.values(prepared.diagnosticTimings).map((value) => Number(value) || 0))
        : undefined,
      ...(prepared.diagnosticTimings || {}),
    })
    diagnosticsRuntime.recordEvent('startup_prepared')
    if (!isSessionActive(audioId)) {
      cleanupPreparedStart(prepared, voiceSocket)
      return
    }

    transportRuntime.attach(prepared, updateSessionInputLevel, () => {
      if (!isSessionActive(audioId)) return
      failSession(createVoiceError('recording_start_failed'))
    })

    // start_audio 必须在后端 ready、WebSocket、麦克风和参数都准备好之后再发送。
    prepared.socket.send(JSON.stringify({
      type: 'start_audio',
      audio_id: audioId,
      mode: toVoiceFlowMode(task.mode),
      audio_context: {},
      parameters: prepared.parameters,
    }))
    diagnosticsRuntime.recordEvent('start_audio_sent')

    transportRuntime.start()
    lifecycle.markRecordingStarted()
    diagnosticsRuntime.recordEvent('recording_started')
    if (task.mode !== 'MeetingNotes') {
      lifecycle.startRecordingLimitTimers()
    }
    const microphoneNotice = await buildActiveMicrophoneNotice(prepared.stream, task.mode)
    if (!isSessionActive(audioId)) return
    if (microphoneNotice) {
      setSession({ ...getVoiceSession(), noticeText: microphoneNotice })
    }
    setSessionStatus('recording')
    void playInteractionSound('start')
    await muteBackgroundAudio()
  } catch (error) {
    if (!isSessionActive(audioId) || lifecycle.isIgnoredAudioId(audioId)) return
    cleanupRecording()
    activeTask = null
    failSession(normalizeVoiceError(error, 'recording_start_failed'))
  }
}

export function stopRecording() {
  const session = getVoiceSession()
  if (session.status !== 'recording') return

  try {
    // 正常停止需要发送 end_audio，让后端 flush 音频并进入转写/润色阶段。
    lifecycle.clearRecordingLimitTimers()
    setSessionStatus('stopping')
    void playInteractionSound('stop')
    const audioQuality = transportRuntime.getAudioQuality()
    diagnosticsRuntime.markEndAudio(audioQuality)
    cleanupRecording()

    const socket = voiceSocket.getSocket()
    if (socket?.readyState === WebSocket.OPEN && session.audioId) {
      socket.send(JSON.stringify({
        type: 'end_audio',
        audio_id: session.audioId,
        ...(audioQuality ? { parameters: { audio_quality: audioQuality } } : {}),
      }))
      setSessionStatus('transcribing')
      lifecycle.startTranscribeTimeout()
      return
    }

    failSession(createVoiceError('websocket_closed'))
  } catch (error) {
    failSession(normalizeVoiceError(error, 'recording_stop_failed'))
  }
}

export function cancelRecording() {
  const session = getVoiceSession()
  if (!CANCELABLE_STATUSES.has(session.status)) return

  // 取消不是正常结束，不能发 end_audio，否则后端可能继续返回结果并触发粘贴。
  const durationMs = lifecycle.getDurationMs()
  lifecycle.clearActive()
  activeTask = null
  if (session.audioId) {
    // 取消后可能还有迟到的后端消息，按 audioId 忽略能避免旧结果污染新会话。
    lifecycle.ignoreAudioId(session.audioId)
  }

  lifecycle.clearTranscribeTimeout()
  cleanupRecording()
  transportRuntime.discardRetryAudio()
  voiceSocket.closeWebSocketSilently()
  void restoreBackgroundAudio()
  lifecycle.resetRecordingStarted()

  setSession({
    ...session,
    status: 'cancelled',
    refinedText: '',
    durationMs,
    error: null,
    inputLevel: 0,
    noticeText: '',
    retryAudioWavBase64: '',
    translationText: '',
    meetingLiveSegments: [],
    paused: false,
  })
  diagnosticsRuntime.finalize('cancelled', { durationMs })
}

export function setRecordingPaused(paused: boolean) {
  const session = getVoiceSession()
  if (session.status !== 'recording') return
  transportRuntime.setPaused(paused)
  setSession({
    ...session,
    paused,
    inputLevel: paused ? 0 : session.inputLevel,
    noticeText: paused ? '已暂停' : '',
  })
}

export function disposeRecorder() {
  // 应用退出或热重载时做完整释放，避免后台静音、麦克风和监听器残留。
  activeTask = null
  lifecycle.dispose()
  cleanupRecording()
  transportRuntime.discardRetryAudio()
  void restoreBackgroundAudio()
  voiceSocket.closeWebSocketSilently()
  diagnosticsRuntime.reset()
  sessionStore.clearListeners()
}

function setSession(next: VoiceSession) {
  sessionStore.setSession(next)
}

function setSessionStatus(status: VoiceStatus) {
  sessionStore.setSessionStatus(status)
}

function updateSessionInputLevel(inputLevel: number) {
  sessionStore.updateInputLevel(inputLevel)
}

function failSession(error: VoiceError) {
  // 失败路径统一回收资源，避免麦克风、WebSocket 或后台静音状态泄漏。
  lifecycle.clearActive()
  activeTask = null
  lifecycle.clearTranscribeTimeout()
  const durationMs = lifecycle.getDurationMs()
  const retryAudioWavBase64 = transportRuntime.getRetryAudioWavBase64()
  cleanupRecording()
  void restoreBackgroundAudio()
  setSession({ ...getVoiceSession(), status: 'error', durationMs, error, noticeText: '', retryAudioWavBase64, paused: false })
  transportRuntime.discardRetryAudio()
  lifecycle.resetRecordingStarted()
  diagnosticsRuntime.finalize('error', { durationMs, error })
}

async function completeSession(refinedText: string, payload: Record<string, unknown> = {}) {
  // 完成路径必须先冻结本轮结果，再恢复后台音频和决定展示/粘贴方式。
  lifecycle.clearActive()
  lifecycle.clearTranscribeTimeout()
  const currentSession = getVoiceSession()
  const durationMs = lifecycle.getDurationMs()
  const finalRawText = readOptionalString(payload.user_prompt) || currentSession.rawText
  const resultText = refinedText || finalRawText
  const translationText = typeof payload.translation_text === 'string' ? payload.translation_text : currentSession.translationText
  const meetingStructuredResult = normalizeMeetingStructuredResult(payload.meeting_structured) || currentSession.meetingStructuredResult
  const textLength = countTextLength(resultText)
  const completedSession = {
    ...currentSession,
    status: 'completed' as const,
    rawText: finalRawText,
    stableTranscriptText: finalRawText,
    partialTranscriptText: '',
    transcriptRevisionId: readOptionalString(payload.revision_id) || currentSession.transcriptRevisionId,
    transcriptUtteranceId: readOptionalString(payload.utterance_id) || currentSession.transcriptUtteranceId,
    transcriptAsrEngine: readOptionalString(payload.asr_engine) || currentSession.transcriptAsrEngine,
    refinedText: resultText,
    translationText,
    meetingStructuredResult,
    meetingLiveSegments: [],
    durationMs,
    textLength,
    error: null,
    noticeText: '',
    paused: false,
  }

  setSession(completedSession)
  transportRuntime.discardRetryAudio()
  lifecycle.resetRecordingStarted()
  diagnosticsRuntime.finalize('completed', { durationMs })
  await restoreBackgroundAudio()
  const task = activeTask
  activeTask = null
  if (!resultText) return

  await deliverVoiceResult(resultText, task, completedSession.mode)
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalNonNegativeNumber(value: unknown) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : undefined
}

function shouldInsertTranscriptSeparator(left: string, right: string) {
  if (!left || !right) return false
  const leftChar = left[left.length - 1] || ''
  const rightChar = right[0] || ''
  if (!leftChar || !rightChar || /\s/.test(leftChar) || /\s/.test(rightChar)) return false
  if (/[\u4E00-\u9FFF]/.test(leftChar) || /[\u4E00-\u9FFF]/.test(rightChar)) return false
  return /[\p{L}\p{N}.!?]/u.test(leftChar) && /[\p{L}\p{N}]/u.test(rightChar)
}

function joinTranscriptParts(stableText: string, partialText: string) {
  const stable = stableText.trim()
  const partial = partialText.trim()
  if (!stable) return partial
  if (!partial) return stable
  if (partial.startsWith(stable)) return partial
  return `${stable}${shouldInsertTranscriptSeparator(stable, partial) ? ' ' : ''}${partial}`
}

function resolveLiveTranscriptUpdate(
  session: VoiceSession,
  text: string,
  payload: Record<string, unknown> = {},
) {
  const incomingStable = readOptionalString(payload.stable_text)
  let incomingPartial = readOptionalString(payload.partial_text)
  const incomingText = text.trim()
  const isStable = payload.stable === true
  const isPartial = payload.stable === false || payload.is_partial === true || Boolean(incomingPartial)
  let stableTranscriptText = session.stableTranscriptText || ''

  if (incomingStable) {
    if (!stableTranscriptText || incomingStable.length >= stableTranscriptText.length) {
      stableTranscriptText = incomingStable
    }
  } else if (isStable && incomingText) {
    if (!stableTranscriptText || incomingText.length >= stableTranscriptText.length) {
      stableTranscriptText = incomingText
    }
  } else if (!stableTranscriptText && !isPartial && incomingText) {
    stableTranscriptText = incomingText
  }

  if (incomingPartial && stableTranscriptText && incomingPartial.startsWith(stableTranscriptText)) {
    incomingPartial = incomingPartial.slice(stableTranscriptText.length).trim()
  }

  const partialTranscriptText = isStable ? '' : incomingPartial
  const rawText = joinTranscriptParts(stableTranscriptText, partialTranscriptText) || incomingText
  return {
    rawText,
    stableTranscriptText,
    partialTranscriptText,
    transcriptRevisionId: readOptionalString(payload.revision_id) || session.transcriptRevisionId,
    transcriptUtteranceId: readOptionalString(payload.utterance_id) || session.transcriptUtteranceId,
    transcriptAsrEngine: readOptionalString(payload.asr_engine) || session.transcriptAsrEngine,
  }
}

function handleRawText(text: string, payload?: Record<string, unknown>) {
  // 流式转写会多次更新 rawText，最终结果仍以后端完成消息为准。
  if (text.trim()) diagnosticsRuntime.markFirstMetric('firstTranscriptionMs', 'first_transcription')
  if (text.trim() && payload?.is_partial === true) {
    diagnosticsRuntime.markFirstMetric('firstPartialTranscriptionMs', 'first_partial_transcription')
  }
  if (text.trim() && payload?.stable === true) {
    diagnosticsRuntime.markFirstMetric('firstStableTranscriptionMs', 'first_stable_transcription')
  }
  diagnosticsRuntime.mergeMetrics({
    lastAsrLatencyMs: readOptionalNonNegativeNumber(payload?.asr_latency_ms),
    asrBacklogMs: readOptionalNonNegativeNumber(payload?.asr_backlog_ms),
    asrRtf: readOptionalNonNegativeNumber(payload?.asr_rtf),
  })
  const session = getVoiceSession()
  const transcriptUpdate = session.mode === 'MeetingNotes'
    ? resolveLiveTranscriptUpdate(session, text, payload || {})
    : {
      rawText: text,
      stableTranscriptText: payload?.stable === true ? text.trim() : '',
      partialTranscriptText: payload?.stable === true ? '' : text.trim(),
      transcriptRevisionId: readOptionalString(payload?.revision_id) || session.transcriptRevisionId,
      transcriptUtteranceId: readOptionalString(payload?.utterance_id) || session.transcriptUtteranceId,
      transcriptAsrEngine: readOptionalString(payload?.asr_engine) || session.transcriptAsrEngine,
    }
  setSession({ ...session, ...transcriptUpdate, textLength: countTextLength(transcriptUpdate.rawText) })
}

const MEETING_LIVE_EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\uFE0E\uFE0F]/gu
const MEETING_LIVE_ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g

function normalizeMeetingLiveSourceText(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .replace(MEETING_LIVE_EMOJI_RE, '')
    .replace(MEETING_LIVE_ZERO_WIDTH_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeMeetingLiveCompare(value: unknown) {
  return normalizeMeetingLiveSourceText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function readMeetingLiveChunkIndex(payload: Record<string, unknown> | undefined, fallback: number) {
  const sentenceIndex = Number(payload?.sentence_index)
  if (Number.isFinite(sentenceIndex) && sentenceIndex > 0) return sentenceIndex
  const value = Number(payload?.chunk_index)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readMeetingLiveReplaceChunkIndex(payload: Record<string, unknown> | undefined) {
  const value = Number(payload?.replaces_chunk_index)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function readMeetingLiveSentenceId(payload: Record<string, unknown> | undefined) {
  const value = typeof payload?.sentence_id === 'string' ? payload.sentence_id.trim() : ''
  return value || ''
}

function readMeetingLiveSourceFingerprint(payload: Record<string, unknown> | undefined, sourceText: string) {
  const value = typeof payload?.source_fingerprint === 'string' ? payload.source_fingerprint.trim() : ''
  return value || normalizeMeetingLiveCompare(sourceText)
}

function readMeetingLiveTargetLanguage(payload: Record<string, unknown> | undefined) {
  const payloadTarget = typeof payload?.target_language === 'string' ? payload.target_language.trim() : ''
  if (payloadTarget && payloadTarget !== 'off') return payloadTarget
  const taskTarget = activeTask?.meetingOptions?.targetLanguage
  return taskTarget && taskTarget !== 'off' ? taskTarget : 'en'
}

function readMeetingLivePhase(payload: Record<string, unknown> | undefined) {
  return payload?.phase === 'preview' ? 'preview' : payload?.phase === 'commit' ? 'commit' : undefined
}

function readMeetingLiveLatency(payload: Record<string, unknown> | undefined) {
  const value = Number(payload?.translation_latency_ms)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function updateMeetingTranslationText(segments: MeetingLiveSegment[]) {
  return segments
    .filter((item) => item.status === 'translated' && !item.isDuplicate)
    .map((item) => item.translationText)
    .filter(Boolean)
    .join('\n')
}

function upsertMeetingLiveSegment(
  previousSegments: MeetingLiveSegment[],
  segment: MeetingLiveSegment,
  replaceChunkIndex = 0,
) {
  const targetChunkIndex = replaceChunkIndex || segment.chunkIndex
  const existingBySentenceId = segment.sentenceId
    ? previousSegments.findIndex((item) => item.sentenceId === segment.sentenceId)
    : -1
  const existingIndex = existingBySentenceId >= 0
    ? existingBySentenceId
    : previousSegments.findIndex((item) => item.chunkIndex === targetChunkIndex && item.targetLanguage === segment.targetLanguage)
  const nextCompare = normalizeMeetingLiveCompare(segment.normalizedSourceText || segment.sourceText)
  const nextFingerprint = segment.sourceFingerprint || nextCompare
  const duplicateSourceIndex = previousSegments.findIndex((item) => {
    if (segment.sentenceId && item.sentenceId === segment.sentenceId) return true
    if (item.targetLanguage !== segment.targetLanguage) return false
    if (nextFingerprint && item.sourceFingerprint && item.sourceFingerprint === nextFingerprint) return true
    const existingCompare = normalizeMeetingLiveCompare(item.normalizedSourceText || item.sourceText)
    return Boolean(existingCompare && nextCompare && existingCompare === nextCompare)
  })
  const targetIndex = existingIndex >= 0 ? existingIndex : duplicateSourceIndex
  if (targetIndex < 0) {
    if (segment.status === 'skipped' || segment.isDuplicate) return previousSegments
    return [...previousSegments, { ...segment, chunkIndex: targetChunkIndex }]
  }

  const existing = previousSegments[targetIndex]
  if (segment.isPreview && existing.status === 'translated' && !existing.isPreview) {
    return previousSegments
  }
  if (segment.status === 'pending' && existing.translationText) {
    return previousSegments.map((item, index) => index === targetIndex
      ? {
        ...item,
        ...segment,
        id: item.id,
        chunkIndex: item.chunkIndex,
        sentenceIndex: item.sentenceIndex || item.chunkIndex,
        sentenceId: item.sentenceId || segment.sentenceId,
        createdAt: item.createdAt,
        translationText: item.translationText,
        status: item.status,
        isPreview: item.isPreview,
        stable: item.stable,
      }
      : item)
  }
  const existingCompare = normalizeMeetingLiveCompare(existing.normalizedSourceText || existing.sourceText)
  if (
    segment.status === 'translated'
    && existing.status === 'pending'
    && existingCompare
    && nextCompare
    && existingCompare !== nextCompare
    && existingCompare.startsWith(nextCompare)
  ) {
    return previousSegments
  }

  return previousSegments.map((item, index) => index === targetIndex
    ? {
      ...item,
      ...segment,
      id: item.id,
      chunkIndex: item.chunkIndex,
      sentenceIndex: item.sentenceIndex || item.chunkIndex,
      sentenceId: item.sentenceId || segment.sentenceId,
      createdAt: item.createdAt,
    }
    : item)
}

function handleMeetingTranslationPending(payload?: Record<string, unknown>) {
  const session = getVoiceSession()
  if (session.mode !== 'MeetingNotes' || !['connecting', 'recording'].includes(session.status)) return

  const sourceText = normalizeMeetingLiveSourceText(payload?.source_text)
  if (!sourceText) return
  diagnosticsRuntime.markFirstMetric('firstTranslationPendingMs', 'first_translation_pending')
  if (payload?.phase === 'preview' || payload?.provisional === true) {
    diagnosticsRuntime.markFirstMetric('firstPreviewTranslationMs', 'first_translation_preview_pending')
  }
  const previousSegments = session.meetingLiveSegments || []
  const targetLanguage = readMeetingLiveTargetLanguage(payload)
  const chunkIndex = readMeetingLiveChunkIndex(payload, previousSegments.length + 1)
  const replaceChunkIndex = readMeetingLiveReplaceChunkIndex(payload)
  const sentenceId = readMeetingLiveSentenceId(payload)
  const sourceFingerprint = readMeetingLiveSourceFingerprint(payload, sourceText)
  const createdAt = new Date().toISOString()
  const segment: MeetingLiveSegment = {
    id: sentenceId || `${replaceChunkIndex || chunkIndex}-${targetLanguage}-${createdAt}`,
    sentenceId,
    sourceText,
    translationText: '',
    targetLanguage,
    chunkIndex,
    sentenceIndex: chunkIndex,
    createdAt,
    status: payload?.status === 'skipped' ? 'skipped' : 'pending',
    normalizedSourceText: normalizeMeetingLiveSourceText(sourceText),
    sourceFingerprint,
    isDuplicate: Boolean(payload?.is_duplicate),
    isPreview: payload?.provisional === true,
    stable: payload?.stable === true,
    phase: readMeetingLivePhase(payload),
    sourceStable: payload?.source_stable === true,
    translationEngine: readOptionalString(payload?.translation_engine),
    translationLatencyMs: readMeetingLiveLatency(payload),
    localModelStatus: readOptionalString(payload?.local_model_status),
  }
  const nextSegments = upsertMeetingLiveSegment(previousSegments, segment, replaceChunkIndex)
  setSession({
    ...session,
    meetingLiveSegments: nextSegments,
    translationText: updateMeetingTranslationText(nextSegments),
    noticeText: '',
  })
}

function handleMeetingTranslation(text: string, payload?: Record<string, unknown>) {
  const value = normalizeMeetingLiveSourceText(text)
  if (!value) return
  diagnosticsRuntime.markFirstMetric('firstTranslationMs', 'first_translation')
  if (payload?.phase === 'preview' || payload?.provisional === true) {
    diagnosticsRuntime.markFirstMetric('firstPreviewTranslationMs', 'first_translation_preview')
  }
  if (payload?.phase === 'commit' || payload?.committed === true || payload?.stable === true) {
    diagnosticsRuntime.markFirstMetric('firstCommitTranslationMs', 'first_translation_commit')
  }
  diagnosticsRuntime.mergeMetrics({
    lastTranslationLatencyMs: readMeetingLiveLatency(payload),
  })
  const session = getVoiceSession()
  if (session.mode !== 'MeetingNotes' || !['connecting', 'recording', 'stopping', 'transcribing'].includes(session.status)) return
  const previousSegments = session.meetingLiveSegments || []
  const sourceText = normalizeMeetingLiveSourceText(payload?.source_text)
  const targetLanguage = readMeetingLiveTargetLanguage(payload)
  const chunkIndex = readMeetingLiveChunkIndex(payload, previousSegments.length + 1)
  const replaceChunkIndex = readMeetingLiveReplaceChunkIndex(payload)
  const sentenceId = readMeetingLiveSentenceId(payload)
  const sourceFingerprint = readMeetingLiveSourceFingerprint(payload, sourceText)
  const createdAt = new Date().toISOString()
  const segment: MeetingLiveSegment = {
    id: sentenceId || `${replaceChunkIndex || chunkIndex}-${targetLanguage}-${createdAt}`,
    sentenceId,
    sourceText,
    translationText: value,
    targetLanguage,
    chunkIndex,
    sentenceIndex: chunkIndex,
    createdAt,
    status: payload?.status === 'skipped' ? 'skipped' : 'translated',
    normalizedSourceText: normalizeMeetingLiveSourceText(sourceText),
    sourceFingerprint,
    isDuplicate: Boolean(payload?.is_duplicate),
    isPreview: payload?.provisional === true,
    stable: payload?.stable === true,
    phase: readMeetingLivePhase(payload),
    sourceStable: payload?.source_stable === true,
    translationEngine: readOptionalString(payload?.translation_engine),
    translationLatencyMs: readMeetingLiveLatency(payload),
    localModelStatus: readOptionalString(payload?.local_model_status),
  }
  const nextSegments = upsertMeetingLiveSegment(previousSegments, segment, replaceChunkIndex)
  setSession({
    ...session,
    meetingLiveSegments: nextSegments,
    translationText: updateMeetingTranslationText(nextSegments),
    noticeText: '',
  })
}

function handleMeetingTranslationError(detail: string) {
  const session = getVoiceSession()
  if (session.mode !== 'MeetingNotes' || !['connecting', 'recording'].includes(session.status)) return
  diagnosticsRuntime.recordEvent('meeting_translation_error', { detailCode: detail ? 'translation_error' : 'translation_error_empty' })
  setSession({
    ...session,
    noticeText: detail ? `实时翻译暂时失败：${detail}` : '实时翻译暂时失败，已继续转写',
  })
}

function showRecordingLimitWarning() {
  const session = getVoiceSession()
  if (session.status !== 'recording') return
  setSession({ ...session, noticeText: RECORDING_LIMIT_WARNING_TEXT })
}

function isSessionActive(audioId: string) {
  // 同时检查生命周期边界和当前 session，避免旧异步任务误操作新会话。
  return lifecycle.isSessionActive(audioId, getVoiceSession().audioId || '')
}

function cleanupRecording() {
  // 录音清理只处理音频相关资源，WebSocket 是否关闭由调用路径决定。
  transportRuntime.cleanup()
}
