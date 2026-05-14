export const voiceModes = ['Dictate', 'Ask', 'Translate'] as const

export type VoiceMode = typeof voiceModes[number]

export type VoiceFlowMode = 'transcript' | 'ask_anything' | 'translation'

export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'recording'
  | 'stopping'
  | 'transcribing'
  | 'cancelled'
  | 'completed'
  | 'error'

export type VoiceErrorCode =
  | 'backend_unavailable'
  | 'websocket_timeout'
  | 'websocket_closed'
  | 'microphone_permission_denied'
  | 'microphone_unavailable'
  | 'recording_start_failed'
  | 'recording_stop_failed'
  | 'audio_empty'
  | 'asr_failed'
  | 'refine_failed'
  | 'paste_failed'
  | 'protocol_invalid'
  | 'unknown'

export type VoiceError = {
  code: VoiceErrorCode
  message: string
  recoverable: boolean
  detail?: string
}

export type VoiceSession = {
  status: VoiceStatus
  mode: VoiceMode
  audioId: string | null
  rawText: string
  refinedText: string
  durationMs: number
  textLength: number
  error: VoiceError | null
  inputLevel: number
}

export type FloatingBarState = {
  visible: boolean
  status: VoiceStatus
  mode: VoiceMode
  inputLevel: number
  displayText?: string
  errorMessage?: string
}

export const initialVoiceSession: VoiceSession = {
  status: 'idle',
  mode: 'Dictate',
  audioId: null,
  rawText: '',
  refinedText: '',
  durationMs: 0,
  textLength: 0,
  error: null,
  inputLevel: 0,
}

export function toVoiceFlowMode(mode: VoiceMode): VoiceFlowMode {
  if (mode === 'Ask') return 'ask_anything'
  if (mode === 'Translate') return 'translation'
  return 'transcript'
}

export function createVoiceError(code: VoiceErrorCode, detail?: string): VoiceError {
  const messageByCode: Record<VoiceErrorCode, string> = {
    backend_unavailable: '语音后端未启动，请稍后重试',
    websocket_timeout: '连接语音后端超时，请稍后重试',
    websocket_closed: '语音连接已断开，请重试',
    microphone_permission_denied: '无法访问麦克风，请检查系统权限',
    microphone_unavailable: '没有找到可用麦克风',
    recording_start_failed: '录音启动失败，请重试',
    recording_stop_failed: '录音停止失败，请重试',
    audio_empty: '没有识别到声音',
    asr_failed: '语音转写失败，请重试',
    refine_failed: '润色失败，已保留原始转写',
    paste_failed: '已生成文本，但无法自动粘贴',
    protocol_invalid: '语音服务返回了无法识别的数据',
    unknown: '语音输入出现未知错误',
  }

  return {
    code,
    message: messageByCode[code],
    recoverable: code !== 'unknown',
    detail,
  }
}

export function getVoiceStatusLabel(session: VoiceSession): string {
  if (session.error) return session.error.message
  if (session.status === 'connecting') return '正在连接语音后端...'
  if (session.status === 'recording') return '正在监听...'
  if (session.status === 'stopping') return '正在停止录音...'
  if (session.status === 'transcribing') return '正在转写...'
  if (session.status === 'cancelled') return '当前转录已取消'
  if (session.status === 'completed') return '已完成'
  return '准备就绪'
}

export function toFloatingBarState(session: VoiceSession): FloatingBarState {
  if (session.error?.code === 'audio_empty') {
    return {
      visible: true,
      status: 'cancelled',
      mode: session.mode,
      inputLevel: 0,
      displayText: session.error.message,
      errorMessage: session.error.message,
    }
  }

  const visible = ['connecting', 'recording', 'stopping', 'transcribing', 'cancelled', 'completed', 'error'].includes(session.status)

  return {
    visible,
    status: session.status,
    mode: session.mode,
    inputLevel: session.inputLevel,
    errorMessage: session.error?.message,
  }
}
