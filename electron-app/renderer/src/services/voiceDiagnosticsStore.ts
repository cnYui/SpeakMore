import { ipcClient } from './ipc'
import type { VoiceMode } from './voice/voiceTypes'

export type VoiceDiagnosticStatus = 'completed' | 'error' | 'cancelled'

export type VoiceDiagnosticEvent = {
  name: string
  at: string
  offsetMs: number
  status?: string
  detailCode?: string
}

export type VoiceDiagnosticMetrics = {
  startupMs?: number
  readyMs?: number
  socketMs?: number
  microphoneMs?: number
  parametersMs?: number
  firstTranscriptionMs?: number
  firstPartialTranscriptionMs?: number
  firstStableTranscriptionMs?: number
  firstTranslationPendingMs?: number
  firstPreviewTranslationMs?: number
  firstCommitTranslationMs?: number
  firstTranslationMs?: number
  lastAsrLatencyMs?: number
  asrBacklogMs?: number
  asrRtf?: number
  lastTranslationLatencyMs?: number
  finalRefineMs?: number
}

export type VoiceDiagnosticAudioQuality = {
  average_rms?: number
  peak?: number
  clipping_ratio?: number
  speech_frame_ratio?: number
  low_volume_ratio?: number
  estimated_noise_floor?: number
  hints?: string[]
}

export type VoiceDiagnosticSession = {
  id: string
  audioId: string
  mode: VoiceMode
  status: VoiceDiagnosticStatus
  startedAt: string
  endedAt: string
  durationMs: number
  events: VoiceDiagnosticEvent[]
  metrics: VoiceDiagnosticMetrics
  audioQuality?: VoiceDiagnosticAudioQuality
  errorCode?: string
  errorDetail?: string
}

export type VoiceDiagnosticsChangeEvent = {
  reason: string
  session?: VoiceDiagnosticSession
  changedAt?: string
}

export async function listVoiceDiagnostics(): Promise<VoiceDiagnosticSession[]> {
  try {
    const sessions = await ipcClient.invoke<VoiceDiagnosticSession[]>('voice-diagnostics:list')
    return Array.isArray(sessions) ? sessions : []
  } catch {
    return []
  }
}

export async function saveVoiceDiagnosticSession(session: VoiceDiagnosticSession) {
  try {
    return await ipcClient.invoke<{ success?: boolean; data?: VoiceDiagnosticSession }>('voice-diagnostics:save', session)
  } catch {
    return { success: false }
  }
}

export async function clearVoiceDiagnostics() {
  try {
    const response = await ipcClient.invoke<{ success?: boolean }>('voice-diagnostics:clear')
    return Boolean(response?.success)
  } catch {
    return false
  }
}

export function subscribeVoiceDiagnosticsChanges(listener: (event: VoiceDiagnosticsChangeEvent) => void) {
  return ipcClient.on('voice-diagnostics:changed', (_event, payload) => {
    listener((payload || {}) as VoiceDiagnosticsChangeEvent)
  })
}
