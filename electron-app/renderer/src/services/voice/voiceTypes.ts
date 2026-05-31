/**
 * 语音链路共享类型
 *
 * 需要理解 VoiceSession、错误码、模式映射或悬浮胶囊状态时看这里。
 */
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
  | 'voice_model_missing'
  | 'llm_api_key_missing'
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
    backend_unavailable: '语音后端未就绪，首次运行可能正在下载模型，请稍后重试',
    voice_model_missing: '还没有下载语音模型，请先下载模型。',
    llm_api_key_missing: '还没有填写 DeepSeek API Key，请先到设置页填写后再使用。',
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
    ...(session.status === 'recording' && session.mode === 'Ask' ? { displayText: '请随意提出问题' } : {}),
    ...(session.status === 'cancelled' ? { displayText: '当前转录已取消' } : {}),
    errorMessage: session.error?.message,
  }
}
