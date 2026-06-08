import { saveVoiceDiagnosticSession, type VoiceDiagnosticAudioQuality, type VoiceDiagnosticEvent, type VoiceDiagnosticMetrics } from '../voiceDiagnosticsStore'
import type { VoiceError, VoiceMode } from './voiceTypes'

type ActiveDiagnosticSession = {
  id: string
  audioId: string
  mode: VoiceMode
  startedAt: string
  startedPerfMs: number
  events: VoiceDiagnosticEvent[]
  metrics: VoiceDiagnosticMetrics
  audioQuality?: VoiceDiagnosticAudioQuality
  endAudioPerfMs?: number
  finalized: boolean
}

function nowPerfMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function createId(audioId: string) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}`
  return `voice_diag_${audioId || suffix}`
}

function safeString(value: unknown, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function elapsedMs(session: ActiveDiagnosticSession) {
  return Math.max(0, Math.round(nowPerfMs() - session.startedPerfMs))
}

function normalizeAudioQuality(value: unknown): VoiceDiagnosticAudioQuality | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as VoiceDiagnosticAudioQuality
  const next: VoiceDiagnosticAudioQuality = {}
  const numericKeys: Array<keyof VoiceDiagnosticAudioQuality> = [
    'average_rms',
    'peak',
    'clipping_ratio',
    'speech_frame_ratio',
    'low_volume_ratio',
    'estimated_noise_floor',
  ]
  numericKeys.forEach((key) => {
    const numberValue = Number(source[key])
    if (Number.isFinite(numberValue) && numberValue >= 0) {
      next[key] = numberValue as never
    }
  })
  if (Array.isArray(source.hints)) {
    next.hints = source.hints.map((item) => safeString(item, 80)).filter(Boolean).slice(0, 12)
  }
  return Object.keys(next).length ? next : undefined
}

export function createVoiceDiagnosticsRuntime() {
  let activeSession: ActiveDiagnosticSession | null = null

  function start(audioId: string, mode: VoiceMode) {
    activeSession = {
      id: createId(audioId),
      audioId,
      mode,
      startedAt: new Date().toISOString(),
      startedPerfMs: nowPerfMs(),
      events: [],
      metrics: {},
      finalized: false,
    }
    recordEvent('start_requested')
  }

  function recordEvent(name: string, options: { status?: string; detailCode?: string } = {}) {
    if (!activeSession || activeSession.finalized) return
    activeSession.events.push({
      name,
      at: new Date().toISOString(),
      offsetMs: elapsedMs(activeSession),
      ...(options.status ? { status: safeString(options.status, 40) } : {}),
      ...(options.detailCode ? { detailCode: safeString(options.detailCode, 120) } : {}),
    })
  }

  function mergeMetrics(metrics: VoiceDiagnosticMetrics = {}) {
    if (!activeSession || activeSession.finalized) return
    activeSession.metrics = {
      ...activeSession.metrics,
      ...Object.fromEntries(
        Object.entries(metrics).filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0),
      ),
    }
  }

  function markFirstMetric(metricName: keyof VoiceDiagnosticMetrics, eventName: string) {
    if (!activeSession || activeSession.finalized || activeSession.metrics[metricName] !== undefined) return
    activeSession.metrics[metricName] = elapsedMs(activeSession)
    recordEvent(eventName)
  }

  function setAudioQuality(audioQuality: unknown) {
    if (!activeSession || activeSession.finalized) return
    activeSession.audioQuality = normalizeAudioQuality(audioQuality)
  }

  function markEndAudio(audioQuality?: unknown) {
    if (!activeSession || activeSession.finalized) return
    if (audioQuality) setAudioQuality(audioQuality)
    activeSession.endAudioPerfMs = nowPerfMs()
    recordEvent('end_audio_sent')
  }

  function finalize(
    status: 'completed' | 'error' | 'cancelled',
    options: { durationMs?: number; error?: VoiceError | null } = {},
  ) {
    if (!activeSession || activeSession.finalized) return
    const session = activeSession
    session.finalized = true
    const endedAt = new Date().toISOString()
    const durationMs = Math.max(0, Math.round(Number(options.durationMs) || elapsedMs(session)))
    if (status === 'completed' && session.endAudioPerfMs !== undefined && session.metrics.finalRefineMs === undefined) {
      session.metrics.finalRefineMs = Math.max(0, Math.round(nowPerfMs() - session.endAudioPerfMs))
    }
    session.events.push({
      name: status,
      at: endedAt,
      offsetMs: elapsedMs(session),
      status,
      ...(options.error?.code ? { detailCode: options.error.code } : {}),
    })
    activeSession = null
    void saveVoiceDiagnosticSession({
      id: session.id,
      audioId: session.audioId,
      mode: session.mode,
      status,
      startedAt: session.startedAt,
      endedAt,
      durationMs,
      events: session.events,
      metrics: session.metrics,
      ...(session.audioQuality ? { audioQuality: session.audioQuality } : {}),
      ...(options.error?.code ? { errorCode: options.error.code } : {}),
      ...(options.error?.detail ? { errorDetail: safeString(options.error.detail, 500) } : {}),
    })
  }

  function reset() {
    activeSession = null
  }

  return {
    start,
    recordEvent,
    mergeMetrics,
    markFirstMetric,
    setAudioQuality,
    markEndAudio,
    finalize,
    reset,
  }
}
