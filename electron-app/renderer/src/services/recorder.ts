const WS_URL = 'ws://localhost:8000/ws/rt_voice_flow'

type RecorderCallbacks = {
  onTranscription: (text: string) => void
  onRefined: (text: string) => void
  onStatusChange: (status: string) => void
  onError: (error: string) => void
}

let ws: WebSocket | null = null
let mediaRecorder: MediaRecorder | null = null
let isRecording = false
let currentAudioId = ''

export function toVoiceFlowMode(mode: string) {
  if (mode === 'Ask') return 'ask_anything'
  if (mode === 'Translate') return 'translation'
  return 'transcript'
}

export function connectWs(callbacks: RecorderCallbacks) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  ws = new WebSocket(WS_URL)
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => callbacks.onStatusChange('已连接')
  ws.onclose = () => { ws = null; setTimeout(() => connectWs(callbacks), 2000) }
  ws.onerror = () => ws?.close()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.K === 'transcription') callbacks.onTranscription(msg.V.text || '')
    else if (msg.K === 'audio_processing_completed') {
      const text = msg.V.refined_text || msg.V.refine_text || ''
      callbacks.onRefined(text)
      // 自动粘贴到焦点应用
      if (text && (window as any).ipcRenderer) {
        (window as any).ipcRenderer.invoke('keyboard:type-transcript', text)
      }
    }
  }
}

export async function startRecording(mode: string, callbacks: RecorderCallbacks) {
  if (isRecording) return
  connectWs(callbacks)
  // 等待连接
  for (let i = 0; i < 20 && (!ws || ws.readyState !== WebSocket.OPEN); i++) {
    await new Promise(r => setTimeout(r, 100))
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    callbacks.onError('后端未连接')
    return
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 32000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  })
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
  currentAudioId = crypto.randomUUID()
  ws.send(JSON.stringify({ type: 'start_audio', audio_id: currentAudioId, mode: toVoiceFlowMode(mode), audio_context: {}, parameters: {} }))

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
      e.data.arrayBuffer().then(buf => ws!.send(buf))
    }
  }
  mediaRecorder.start(500)
  isRecording = true
  callbacks.onStatusChange('Listening...')
}

export function stopRecording(callbacks: RecorderCallbacks) {
  if (!mediaRecorder || !isRecording) return
  isRecording = false
  mediaRecorder.stop()
  mediaRecorder.stream.getTracks().forEach(t => t.stop())
  mediaRecorder = null
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'end_audio', audio_id: currentAudioId }))
  }
  callbacks.onStatusChange('Transcribing...')
}

export function toggleRecording(mode: string, callbacks: RecorderCallbacks) {
  if (isRecording) stopRecording(callbacks)
  else startRecording(mode, callbacks)
}

export function getIsRecording() { return isRecording }
