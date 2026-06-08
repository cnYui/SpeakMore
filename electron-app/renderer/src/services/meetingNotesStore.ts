import { ipcClient } from './ipc'
import { normalizeMeetingStructuredResult, type MeetingStructuredResult } from './meetingStructuredResult'
import { getCurrentLlmConfig, type MeetingLiveTargetLanguage } from './settingsStore'

export type MeetingNoteStatus = 'draft' | 'recording' | 'processing' | 'completed' | 'error'
export type MeetingNoteSource = 'manual' | 'recording' | 'import'
export type MeetingAudioSource = 'microphone' | 'system' | 'microphone_system'
export type MeetingTranslationTarget = MeetingLiveTargetLanguage

export type MeetingNote = {
  id: string
  title: string
  status: MeetingNoteStatus
  source: MeetingNoteSource
  transcript: string
  translationText: string
  summary: string
  structuredResult: MeetingStructuredResult | null
  audioSource: MeetingAudioSource
  targetLanguage: MeetingTranslationTarget
  showOriginal: boolean
  showTranslation: boolean
  durationMs: number
  importFile: { name: string; size: number; type: string } | null
  createdAt: string
  updatedAt: string
  error: string
}

export type MeetingNoteChangeEvent = {
  reason: string
  note?: MeetingNote
  id?: string
  changedAt?: string
}

export type MeetingImportResult = {
  success: boolean
  transcript: string
  translationText: string
  summary: string
  structuredResult: MeetingStructuredResult | null
  detail: string
  partialSuccess?: boolean
  summaryError?: string
}

export const MEETING_MEDIA_EXTENSIONS = ['m4a', 'mp3', 'mp4', 'wav', 'ogg', 'flac', 'mov', 'avi', 'mkv', 'webm', 'opus']
export const MAX_MEETING_MEDIA_BYTES = 1024 * 1024 * 1024
const VOICE_FLOW_URL = 'http://127.0.0.1:8000/ai/voice_flow'

function normalizeNotes(value: unknown): MeetingNote[] {
  return Array.isArray(value) ? value.filter((item): item is MeetingNote => Boolean(item && typeof item === 'object')) : []
}

export function createDraftMeetingNote(): Partial<MeetingNote> {
  const createdAt = new Date().toISOString()
  return {
    title: '',
    status: 'draft',
    source: 'manual',
    transcript: '',
    translationText: '',
    summary: '',
    structuredResult: null,
    audioSource: 'microphone',
    targetLanguage: 'off',
    showOriginal: true,
    showTranslation: true,
    durationMs: 0,
    importFile: null,
    createdAt,
    updatedAt: createdAt,
    error: '',
  }
}

export async function listMeetingNotes(): Promise<MeetingNote[]> {
  try {
    return normalizeNotes(await ipcClient.invoke<MeetingNote[]>('meeting-note:list'))
  } catch {
    return []
  }
}

export async function getMeetingNote(id: string): Promise<MeetingNote | null> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean; data?: MeetingNote | null }>('meeting-note:get', id)
    return response?.data || null
  } catch {
    return null
  }
}

export async function saveMeetingNote(note: Partial<MeetingNote>): Promise<MeetingNote | null> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean; data?: MeetingNote }>('meeting-note:upsert', note)
    return response?.data || null
  } catch {
    return null
  }
}

export async function deleteMeetingNote(id: string): Promise<boolean> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean }>('meeting-note:delete', id)
    return Boolean(response?.success)
  } catch {
    return false
  }
}

export function subscribeMeetingNoteChanges(listener: (event: MeetingNoteChangeEvent) => void) {
  return ipcClient.on('meeting-note:changed', (_event, payload) => {
    listener((payload || {}) as MeetingNoteChangeEvent)
  })
}

export function isSupportedMeetingMediaFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  return MEETING_MEDIA_EXTENSIONS.includes(extension)
}

export async function importMeetingMediaFile(file: File): Promise<MeetingImportResult> {
  if (!isSupportedMeetingMediaFile(file)) {
    return { success: false, transcript: '', translationText: '', summary: '', structuredResult: null, detail: 'unsupported_media_type' }
  }
  if (file.size > MAX_MEETING_MEDIA_BYTES) {
    return { success: false, transcript: '', translationText: '', summary: '', structuredResult: null, detail: 'media_file_too_large' }
  }

  try {
    await ipcClient.invoke('audio:ensure-voice-server')
  } catch {
    // The direct local upload can still surface a precise backend error.
  }

  const llm = await getCurrentLlmConfig()
  if (!llm.api_key.trim()) {
    return { success: false, transcript: '', translationText: '', summary: '', structuredResult: null, detail: 'llm_api_key_missing' }
  }

  const formData = new FormData()
  formData.append('audio_file', file, file.name)
  formData.append('audio_id', `meeting-import-${Date.now()}`)
  formData.append('mode', 'meeting_notes')
  formData.append('audio_context', JSON.stringify({
    import_source: 'meeting_media',
    meeting_module: 'import_file',
    meeting_capture_profile: 'imported_media',
  }))
  formData.append('audio_metadata', JSON.stringify({ source: 'meeting_import', file_name: file.name, file_size: file.size }))
  formData.append('parameters', JSON.stringify({
    llm,
    import_source: 'meeting_media',
    meeting_notes_quality_profile: 'frontier_minutes',
    meeting_notes_pipeline: 'extractive_then_synthesize',
    meeting_module: 'import_file',
    meeting_capture_profile: 'imported_media',
    import_processing_profile: 'frontier_import',
    meeting_scenario_coverage: 'meeting,class,interview,customer_call,project_sync,training,retrospective,brainstorm,task_plan,voice_memo,field_notes',
    meeting_output_depth: 'comprehensive_minutes_with_transcript_fallback',
  }))
  formData.append('is_retry', 'false')
  formData.append('device_name', '')
  formData.append('user_over_time', '')
  formData.append('send_time', String(Date.now()))

  try {
    const response = await fetch(VOICE_FLOW_URL, { method: 'POST', body: formData })
    const payload = await response.json().catch(() => null) as { status?: string; data?: Record<string, unknown> } | null
    const data = payload?.data || {}
    if (!response.ok || payload?.status === 'ERROR') {
      return {
        success: false,
        transcript: String(data.user_prompt || ''),
        translationText: String(data.translation_text || ''),
        summary: '',
        structuredResult: normalizeMeetingStructuredResult(data.meeting_structured),
        detail: String(data.detail || data.refine_text || response.statusText || 'voice_flow_failed'),
      }
    }
    return {
      success: true,
      transcript: String(data.user_prompt || ''),
      translationText: String(data.translation_text || ''),
      summary: String(data.refine_text || ''),
      structuredResult: normalizeMeetingStructuredResult(data.meeting_structured),
      detail: String(data.summary_error || ''),
      partialSuccess: data.partial_success === true,
      summaryError: String(data.summary_error || ''),
    }
  } catch (error) {
    return {
      success: false,
      transcript: '',
      translationText: '',
      summary: '',
      structuredResult: null,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
