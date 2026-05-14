import { ipcClient } from './ipc'
import { getSelectedAudioDeviceId } from './settingsStore'
import {
  createVoiceError,
  initialVoiceSession,
  toFloatingBarState,
  toVoiceFlowMode,
  type VoiceError,
  type VoiceMode,
  type VoiceSession,
  type VoiceStatus,
} from './voiceTypes'

const WS_URL = 'ws://localhost:8000/ws/rt_voice_flow'
const CONNECT_TIMEOUT_MS = 2500
const TRANSCRIBE_TIMEOUT_MS = 60000
const CANCELABLE_STATUSES = new Set<VoiceStatus>(['connecting', 'recording', 'stopping', 'transcribing'])

type VoiceSessionListener = (session: VoiceSession) => void

let session: VoiceSession = initialVoiceSession
let ws: WebSocket | null = null
let mediaRecorder: MediaRecorder | null = null
let activeStream: MediaStream | null = null
let transcribeTimer: number | null = null
let recordingStartedAt = 0
let backgroundAudioRestorePending = false
let activeSessionId: string | null = null
let levelAudioContext: AudioContext | null = null
let levelAnalyser: AnalyserNode | null = null
let levelSource: MediaStreamAudioSourceNode | null = null
let levelFrameId: number | null = null
let levelData: Float32Array<ArrayBuffer> | null = null
let smoothedInputLevel = 0
const ignoredAudioIds = new Set<string>()
const listeners = new Set<VoiceSessionListener>()

export function getVoiceSession() {
  return session
}

export function subscribeVoiceSession(listener: VoiceSessionListener) {
  listeners.add(listener)
  listener(session)
  return () => {
    listeners.delete(listener)
  }
}

export async function toggleRecording(mode: VoiceMode) {
  if (session.status === 'recording') {
    stopRecording()
    return
  }

  if (session.status === 'connecting' || session.status === 'stopping' || session.status === 'transcribing') {
    return
  }

  await startRecording(mode)
}

export async function startRecording(mode: VoiceMode) {
  backgroundAudioRestorePending = false
  recordingStartedAt = 0
  const audioId = crypto.randomUUID()
  activeSessionId = audioId
  setSession({
    ...initialVoiceSession,
    status: 'connecting',
    mode,
    audioId,
  })

  try {
    await ensureVoiceServerReady()
    if (!isSessionActive(audioId)) return
    const socket = await ensureOpenWebSocket()
    if (!isSessionActive(audioId)) {
      closeWebSocketSilently()
      return
    }
    const stream = await getAudioStream()
    if (!isSessionActive(audioId)) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    activeStream = stream
    startAudioLevelMonitoring(stream)
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && ws?.readyState === WebSocket.OPEN) {
        event.data.arrayBuffer().then((buffer) => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(buffer)
        })
      }
    }

    mediaRecorder.onerror = () => {
      if (!isSessionActive(audioId)) return
      failSession(createVoiceError('recording_start_failed'))
    }

    socket.send(JSON.stringify({
      type: 'start_audio',
      audio_id: audioId,
      mode: toVoiceFlowMode(mode),
      audio_context: {},
      parameters: {},
    }))

    mediaRecorder.start(500)
    recordingStartedAt = Date.now()
    setSessionStatus('recording')
    void muteBackgroundAudio()
  } catch (error) {
    if (!isSessionActive(audioId) || ignoredAudioIds.has(audioId)) return
    cleanupRecording()
    failSession(normalizeVoiceError(error, 'recording_start_failed'))
  }
}

export function stopRecording() {
  if (!mediaRecorder || session.status !== 'recording') return

  try {
    setSessionStatus('stopping')
    mediaRecorder.stop()
    cleanupAudioLevelMonitoring()
    cleanupStream()

    if (ws?.readyState === WebSocket.OPEN && session.audioId) {
      ws.send(JSON.stringify({ type: 'end_audio', audio_id: session.audioId }))
      setSessionStatus('transcribing')
      startTranscribeTimeout()
      return
    }

    failSession(createVoiceError('websocket_closed'))
  } catch (error) {
    failSession(normalizeVoiceError(error, 'recording_stop_failed'))
  } finally {
    mediaRecorder = null
  }
}

export function cancelRecording() {
  if (!CANCELABLE_STATUSES.has(session.status)) return

  const durationMs = getRecordingDurationMs()
  activeSessionId = null
  if (session.audioId) {
    ignoredAudioIds.add(session.audioId)
  }

  clearTranscribeTimeout()
  cleanupRecording()
  closeWebSocketSilently()
  void restoreBackgroundAudio()
  recordingStartedAt = 0

  setSession({
    ...session,
    status: 'cancelled',
    refinedText: '',
    durationMs,
    error: null,
    inputLevel: 0,
  })
}

export function disposeRecorder() {
  activeSessionId = null
  ignoredAudioIds.clear()
  clearTranscribeTimeout()
  cleanupRecording()
  void restoreBackgroundAudio()
  closeWebSocketSilently()
  recordingStartedAt = 0
  listeners.clear()
}

function setSession(next: VoiceSession) {
  session = next
  listeners.forEach((listener) => listener(session))
  ipcClient.send('voice-state', toFloatingBarState(session))
}

function setSessionStatus(status: VoiceStatus) {
  setSession({ ...session, status, error: null })
}

function updateSessionInputLevel(inputLevel: number) {
  const normalizedInputLevel = Math.max(0, Math.min(1, inputLevel))
  if (Math.abs(session.inputLevel - normalizedInputLevel) < 0.005) return
  setSession({ ...session, inputLevel: normalizedInputLevel })
}

function failSession(error: VoiceError) {
  activeSessionId = null
  clearTranscribeTimeout()
  const durationMs = getRecordingDurationMs()
  cleanupRecording()
  void restoreBackgroundAudio()
  setSession({ ...session, status: 'error', durationMs, error })
  recordingStartedAt = 0
}

async function completeSession(refinedText: string) {
  activeSessionId = null
  clearTranscribeTimeout()
  const durationMs = getRecordingDurationMs()
  const textLength = countTextLength(refinedText || session.rawText)
  setSession({ ...session, status: 'completed', refinedText, durationMs, textLength, error: null })
  recordingStartedAt = 0
  await restoreBackgroundAudio()
  if (!refinedText) return

  ipcClient.invoke('keyboard:type-transcript', refinedText).catch((error) => {
    void restoreBackgroundAudio()
    setSession({
      ...session,
      status: 'error',
      error: createVoiceError('paste_failed', error instanceof Error ? error.message : String(error)),
    })
  })
}

function handleRawText(text: string) {
  setSession({ ...session, rawText: text, textLength: countTextLength(text) })
}

function handleSocketMessage(event: MessageEvent) {
  try {
    const msg = JSON.parse(String(event.data))
    const audioId = msg?.V?.audio_id
    if (audioId && ignoredAudioIds.has(audioId)) return
    if (audioId && session.audioId && audioId !== session.audioId) return
    if (session.status === 'cancelled') return

    if (msg.K === 'transcription') {
      handleRawText(msg.V?.text || '')
      return
    }

    if (msg.K === 'audio_processing_completed') {
      const refinedText = msg.V?.refined_text || msg.V?.refine_text || ''
      if (!refinedText && !session.rawText) {
        failSession(createVoiceError('audio_empty'))
        return
      }
      void completeSession(refinedText || session.rawText)
    }
  } catch (error) {
    failSession(createVoiceError('protocol_invalid', error instanceof Error ? error.message : String(error)))
  }
}

function ensureOpenWebSocket(): Promise<WebSocket> {
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve(ws)
  if (ws?.readyState === WebSocket.CONNECTING) return waitForOpenWebSocket(ws)

  ws = new WebSocket(WS_URL)
  ws.binaryType = 'arraybuffer'
  ws.onmessage = handleSocketMessage
  ws.onclose = () => {
    ws = null
    if (session.status === 'recording' || session.status === 'transcribing') {
      failSession(createVoiceError('websocket_closed'))
    }
  }
  ws.onerror = () => {
    if (ws?.readyState !== WebSocket.CLOSED) ws?.close()
  }

  return waitForOpenWebSocket(ws)
}

function isSessionActive(audioId: string) {
  return activeSessionId === audioId && session.audioId === audioId
}

function closeWebSocketSilently() {
  if (!ws) return

  const socket = ws
  ws = null
  socket.onopen = null
  socket.onclose = null
  socket.onerror = null
  socket.onmessage = null
  socket.close()
}

function waitForOpenWebSocket(socket: WebSocket): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(createVoiceError('websocket_timeout')), CONNECT_TIMEOUT_MS)
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

async function ensureVoiceServerReady() {
  const result = await ipcClient.invoke('audio:ensure-voice-server') as { success?: boolean }
  if (!result?.success) {
    throw createVoiceError('backend_unavailable')
  }
}

async function getAudioStream() {
  try {
    const selectedAudioDeviceId = await getSelectedAudioDeviceId()
    const deviceConstraint = selectedAudioDeviceId === 'default' ? {} : { deviceId: { exact: selectedAudioDeviceId } }
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        ...deviceConstraint,
        sampleRate: 32000,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw createVoiceError('microphone_permission_denied', String(error))
    }
    throw createVoiceError('microphone_unavailable', String(error))
  }
}

function startAudioLevelMonitoring(stream: MediaStream) {
  cleanupAudioLevelMonitoring()

  try {
    levelAudioContext = new AudioContext()
    levelAnalyser = levelAudioContext.createAnalyser()
    levelAnalyser.fftSize = 2048
    levelAnalyser.smoothingTimeConstant = 0.18
    levelSource = levelAudioContext.createMediaStreamSource(stream)
    levelSource.connect(levelAnalyser)
    levelData = new Float32Array(new ArrayBuffer(levelAnalyser.fftSize * Float32Array.BYTES_PER_ELEMENT))
    smoothedInputLevel = 0
    void levelAudioContext.resume().catch(() => undefined)

    const tick = () => {
      if (!levelAnalyser || !levelData) return

      levelAnalyser.getFloatTimeDomainData(levelData)
      let sum = 0
      for (const sample of levelData) {
        sum += sample * sample
      }

      const rms = Math.sqrt(sum / levelData.length)
      const normalizedLevel = Math.min(1, rms * 3.2)
      const smoothing = normalizedLevel > smoothedInputLevel ? 0.42 : 0.18
      smoothedInputLevel += (normalizedLevel - smoothedInputLevel) * smoothing
      updateSessionInputLevel(Number(smoothedInputLevel.toFixed(4)))
      levelFrameId = window.requestAnimationFrame(tick)
    }

    levelFrameId = window.requestAnimationFrame(tick)
  } catch {
    cleanupAudioLevelMonitoring()
  }
}

function getRecordingDurationMs() {
  return recordingStartedAt > 0 ? Math.max(0, Date.now() - recordingStartedAt) : 0
}

function countTextLength(text: string) {
  return text.trim().length
}

function startTranscribeTimeout() {
  clearTranscribeTimeout()
  transcribeTimer = window.setTimeout(() => {
    failSession(createVoiceError('websocket_timeout'))
  }, TRANSCRIBE_TIMEOUT_MS)
}

function clearTranscribeTimeout() {
  if (transcribeTimer) window.clearTimeout(transcribeTimer)
  transcribeTimer = null
}

async function muteBackgroundAudio() {
  try {
    const result = await ipcClient.invoke('audio:mute-background-sessions') as { success?: boolean }
    backgroundAudioRestorePending = Boolean(result?.success)
  } catch {
    backgroundAudioRestorePending = false
  }
}

async function restoreBackgroundAudio() {
  if (!backgroundAudioRestorePending) return

  try {
    await ipcClient.invoke('audio:restore-background-sessions')
  } finally {
    backgroundAudioRestorePending = false
  }
}

function cleanupStream() {
  activeStream?.getTracks().forEach((track) => track.stop())
  activeStream = null
}

function cleanupAudioLevelMonitoring() {
  if (levelFrameId !== null) window.cancelAnimationFrame(levelFrameId)
  levelFrameId = null

  levelSource?.disconnect()
  levelSource = null
  levelAnalyser = null
  levelData = null
  smoothedInputLevel = 0

  const audioContext = levelAudioContext
  levelAudioContext = null
  if (audioContext) void audioContext.close().catch(() => undefined)

  if (session.inputLevel !== 0) {
    setSession({ ...session, inputLevel: 0 })
  }
}

function cleanupRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop()
    } catch {
      // 避免在已有原始错误时被 stop 的二次异常覆盖。
    }
  }
  mediaRecorder = null
  cleanupAudioLevelMonitoring()
  cleanupStream()
}

function normalizeVoiceError(error: unknown, fallbackCode: Parameters<typeof createVoiceError>[0]) {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as VoiceError
  }
  return createVoiceError(fallbackCode, error instanceof Error ? error.message : String(error))
}
