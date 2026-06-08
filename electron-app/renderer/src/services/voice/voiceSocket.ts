/**
 * 语音 WebSocket 生命周期
 *
 * 需要处理后端流式消息、完成、错误或迟到消息过滤时看这里。
 */
import { VOICE_SERVER_WS_URL } from './voiceServer'
import { createVoiceError, type VoiceError } from './voiceTypes'

const CONNECT_TIMEOUT_MS = 2500

export type VoiceSocketHandlers = {
  getCurrentAudioId: () => string
  getCurrentRawText: () => string
  isIgnoredAudioId: (audioId: string) => boolean
  isCancelledSession: () => boolean
  isTerminalSession: () => boolean
  shouldFailOnClose: () => boolean
  onRawText: (text: string, payload?: Record<string, unknown>) => void
  onMeetingTranslationPending: (payload?: Record<string, unknown>) => void
  onMeetingTranslation: (text: string, payload?: Record<string, unknown>) => void
  onMeetingTranslationError: (detail: string) => void
  onFinalText: (text: string, payload?: Record<string, unknown>) => void
  onError: (error: VoiceError) => void
  onInterrupt: (detail: string) => void
}

export type VoiceSocketManager = {
  getSocket: () => WebSocket | null
  ensureOpenWebSocket: () => Promise<WebSocket>
  closeWebSocketSilently: () => void
}

export function isVoiceFinalMessageType(messageType: string) {
  // 后端存在多种历史完成消息名，前端在这里统一归类成最终结果。
  return ['audio_processing_completed', 'refine_completed', 'refine_selected_text'].includes(messageType)
}

export function isVoiceErrorMessageType(messageType: string) {
  // ASR、音频处理和润色错误都属于本轮语音失败，但映射成不同前端错误码。
  return ['error', 'transcription_error', 'audio_processing_error', 'refine_error', 'refine_selected_text_error'].includes(messageType)
}

export function normalizeSocketError(messageType: string, payload: Record<string, unknown> = {}) {
  // WebSocket 错误结构来自后端，先提取可读 detail，再映射成前端统一错误。
  const detail = typeof payload.detail === 'string'
    ? payload.detail
    : typeof payload.message === 'string'
      ? payload.message
      : ''

  if (messageType === 'transcription_error') {
    return createVoiceError('asr_failed', detail)
  }

  if (['audio_processing_error', 'refine_error', 'refine_selected_text_error'].includes(messageType)) {
    return createVoiceError('refine_failed', detail)
  }

  if (Number(payload.code) === 503 || detail.includes('尚未就绪')) {
    return createVoiceError('backend_unavailable', detail)
  }

  return createVoiceError('unknown', detail)
}

export function handleVoiceSocketMessage(event: MessageEvent, handlers: VoiceSocketHandlers) {
  try {
    // 后端 WebSocket 消息约定为 { K, V }，K 是消息类型，V 是具体载荷。
    const msg = JSON.parse(String(event.data)) as { K?: unknown; V?: unknown }
    const messageType = String(msg?.K || '')
    const payload = msg?.V && typeof msg.V === 'object' ? msg.V as Record<string, unknown> : {}
    const audioId = typeof payload.audio_id === 'string' ? payload.audio_id : ''

    // 后端可能返回迟到消息或旧会话消息，这里必须先按会话边界过滤。
    if (audioId && handlers.isIgnoredAudioId(audioId)) return
    const currentAudioId = handlers.getCurrentAudioId()
    if (audioId && currentAudioId && audioId !== currentAudioId) return
    if (handlers.isCancelledSession()) return
    if (messageType === 'error' && Number(payload.code) === 90002 && payload.detail === 'Unknown message type') return
    if (handlers.isTerminalSession() && (isVoiceFinalMessageType(messageType) || isVoiceErrorMessageType(messageType))) return

    if (messageType === 'transcription') {
      handlers.onRawText(readString(payload, 'text'), payload)
      return
    }

    if (messageType === 'meeting_translation_pending') {
      handlers.onMeetingTranslationPending(payload)
      return
    }

    if (messageType === 'meeting_translation') {
      handlers.onMeetingTranslation(readString(payload, 'text'), payload)
      return
    }

    if (messageType === 'meeting_translation_error') {
      handlers.onMeetingTranslationError(readString(payload, 'detail') || readString(payload, 'message'))
      return
    }

    if (messageType === 'important_notification') {
      const behavior = payload.behavior && typeof payload.behavior === 'object'
        ? payload.behavior as { interruptSession?: unknown }
        : null
      if (behavior?.interruptSession) {
        // 后端主动中断时按不可继续的会话失败处理，避免前端继续等待最终结果。
        handlers.onInterrupt(readString(payload, 'detail') || '会话已被中断')
      }
      return
    }

    if (isVoiceFinalMessageType(messageType)) {
      const refinedText = readString(payload, 'refined_text') || readString(payload, 'refine_text')
      const fallbackRawText = handlers.getCurrentRawText()
      if (!refinedText && !fallbackRawText) {
        handlers.onError(createVoiceError('audio_empty'))
        return
      }
      handlers.onFinalText(refinedText || fallbackRawText, payload)
      return
    }

    if (isVoiceErrorMessageType(messageType)) {
      handlers.onError(normalizeSocketError(messageType, payload))
    }
  } catch (error) {
    handlers.onError(createVoiceError('protocol_invalid', error instanceof Error ? error.message : String(error)))
  }
}

export function createVoiceSocketManager(
  handlers: VoiceSocketHandlers,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
): VoiceSocketManager {
  let socketRef: WebSocket | null = null

  const closeWebSocketSilently = () => {
    if (!socketRef) return

    const socket = socketRef
    socketRef = null
    // 主动关闭时先解绑回调，避免清理动作又触发失败状态。
    socket.onopen = null
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
    socket.close()
  }

  const ensureOpenWebSocket = (): Promise<WebSocket> => {
    // 已连接时直接复用，正在连接时等待同一个连接，避免并发创建多个 socket。
    if (socketRef?.readyState === WebSocket.OPEN) return Promise.resolve(socketRef)
    if (socketRef?.readyState === WebSocket.CONNECTING) return waitForOpenWebSocket(socketRef, connectTimeoutMs)

    // WebSocket 由 recorder 复用和关闭，避免多轮录音并发占用后端流式会话。
    const socket = new WebSocket(VOICE_SERVER_WS_URL)
    socketRef = socket
    socket.binaryType = 'arraybuffer'
    socket.onmessage = (event) => handleVoiceSocketMessage(event, handlers)
    socket.onclose = () => {
      if (socketRef === socket) socketRef = null
      if (handlers.shouldFailOnClose()) {
        handlers.onError(createVoiceError('websocket_closed'))
      }
    }
    socket.onerror = () => {
      if (socket.readyState !== WebSocket.CLOSED) socket.close()
    }

    return waitForOpenWebSocket(socket, connectTimeoutMs)
  }

  return {
    getSocket: () => socketRef,
    ensureOpenWebSocket,
    closeWebSocketSilently,
  }
}

export function waitForOpenWebSocket(socket: WebSocket, timeoutMs = CONNECT_TIMEOUT_MS): Promise<WebSocket> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve(socket)
  if (socket.readyState === WebSocket.CLOSED) return Promise.reject(createVoiceError('backend_unavailable'))

  return new Promise((resolve, reject) => {
    // 连接超时要尽快反馈给 UI，不能让用户停在 connecting 状态。
    const timer = window.setTimeout(() => reject(createVoiceError('websocket_timeout')), timeoutMs)
    socket.addEventListener('open', () => {
      window.clearTimeout(timer)
      resolve(socket)
    }, { once: true })
    socket.addEventListener('close', () => {
      window.clearTimeout(timer)
      reject(createVoiceError('backend_unavailable'))
    }, { once: true })
  })
}

function readString(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}
