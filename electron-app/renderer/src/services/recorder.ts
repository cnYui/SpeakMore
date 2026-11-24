/**
 * 语音会话对外 facade
 *
 * 需要理解录音启动、停止、取消、状态订阅和 UI 对接时看这里。
 */
import { ipcClient } from './ipc'
import { muteBackgroundAudio, resetBackgroundAudioRestoreState, restoreBackgroundAudio } from './voice/backgroundAudio'
import { cleanupPreparedStart, prepareRecordingStart } from './voice/recordingStartup'
import { deliverVoiceResult, hideFloatingPanel } from './voice/voiceResultDelivery'
import type { ShortcutIntent } from './shortcutGuard'
import { countTextLength, normalizeVoiceError } from './voice/voiceSessionUtils'
import { createVoiceSocketManager } from './voice/voiceSocket'
import { createRecordingTransportRuntime } from './voice/recordingTransportRuntime'
import { createVoiceSessionLifecycle } from './voice/voiceSessionLifecycle'
import { createVoiceSessionStore, type VoiceSessionListener } from './voice/voiceSessionStore'
import { resolveVoiceTask, type VoiceTask } from './voice/voiceTaskResolver'
import {
  createVoiceError,
  initialVoiceSession,
  toFloatingBarState,
  toVoiceFlowMode,
  type VoiceError,
  type VoiceMode,
  type VoiceSession,
  type VoiceStatus,
} from './voice/voiceTypes'

// 说完（end_audio）以后只剩最后一段（最长 30 秒）要识别和润色，前面的段后端已经边说边处理好了，所以等结果的超时不用跟着录音长度走。
const TRANSCRIBE_TIMEOUT_MS = 60000
// 后端按 30 秒一段识别并润色，录音长度不再受单次识别能力限制，上限放宽到 30 分钟（到点前 1 分钟提醒）。
const RECORDING_LIMIT_MS = 30 * 60 * 1000
const RECORDING_LIMIT_WARNING_MS = RECORDING_LIMIT_MS - 60 * 1000
const RECORDING_LIMIT_WARNING_TEXT = '录音将在 1 分钟后自动结束'
// 只有这些状态代表本轮语音还没有产出最终结果，Escape 才允许取消。
const CANCELABLE_STATUSES = new Set<VoiceStatus>(['connecting', 'recording', 'stopping', 'transcribing'])

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
  onFinalText: (text) => void completeSession(text),
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
  // audioId 是本轮录音的唯一边界，后续 WebSocket 消息必须匹配它才会被接受。
  // 新录音开始前先隐藏旧结果，避免用户看到上一轮悬浮面板误以为是当前结果。
  hideFloatingPanel()
  resetBackgroundAudioRestoreState()
  const audioId = crypto.randomUUID()
  lifecycle.startSession(audioId)
  setSession({
    ...initialVoiceSession,
    status: 'connecting',
    mode: getInitialModeForIntent(intent),
    audioId,
  })

  try {
    // 快捷键只表达意图，真正的语音模式、选区上下文和结果交付方式在这里解析。
    const task = await resolveVoiceTask(intent)
    if (!isSessionActive(audioId)) return
    activeTask = task
    const currentSession = getVoiceSession()
    if (currentSession.mode !== task.mode) {
      setSession({ ...currentSession, mode: task.mode })
    }

    const prepared = await prepareRecordingStart(task, voiceSocket)
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

    transportRuntime.start()
    lifecycle.markRecordingStarted()
    lifecycle.startRecordingLimitTimers()
    setSessionStatus('recording')
    void muteBackgroundAudio()
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
    cleanupRecording()

    const socket = voiceSocket.getSocket()
    if (socket?.readyState === WebSocket.OPEN && session.audioId) {
      socket.send(JSON.stringify({ type: 'end_audio', audio_id: session.audioId }))
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
  })
}

export function disposeRecorder() {
  // 应用退出或热重载时做完整释放，避免后台静音、麦克风和监听器残留。
  activeTask = null
  lifecycle.dispose()
  cleanupRecording()
  void restoreBackgroundAudio()
  voiceSocket.closeWebSocketSilently()
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
  cleanupRecording()
  void restoreBackgroundAudio()
  setSession({ ...getVoiceSession(), status: 'error', durationMs, error, noticeText: '' })
  lifecycle.resetRecordingStarted()
}

async function completeSession(refinedText: string) {
  // 完成路径必须先冻结本轮结果，再恢复后台音频和决定展示/粘贴方式。
  lifecycle.clearActive()
  lifecycle.clearTranscribeTimeout()
  const currentSession = getVoiceSession()
  const durationMs = lifecycle.getDurationMs()
  const resultText = refinedText || currentSession.rawText
  const textLength = countTextLength(resultText)
  const completedSession = {
    ...currentSession,
    status: 'completed' as const,
    refinedText: resultText,
    durationMs,
    textLength,
    error: null,
    noticeText: '',
  }

  setSession(completedSession)
  lifecycle.resetRecordingStarted()
  await restoreBackgroundAudio()
  const task = activeTask
  activeTask = null
  if (!resultText) return

  await deliverVoiceResult(resultText, task, completedSession.mode)
}

function handleRawText(text: string) {
  // 流式转写会多次更新 rawText，最终结果仍以后端完成消息为准。
  setSession({ ...getVoiceSession(), rawText: text, textLength: countTextLength(text) })
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
