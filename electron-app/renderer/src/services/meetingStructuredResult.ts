export type MeetingStructuredItem = {
  id?: string
  text: string
  source?: string
  [key: string]: unknown
}

export type MeetingTranscriptSegment = {
  index: number
  text: string
  contentLevel?: string
  [key: string]: unknown
}

export type MeetingTopicSegment = {
  id?: string
  title: string
  summary: string
  segmentIndexes?: number[]
  [key: string]: unknown
}

export type MeetingStructuredResult = {
  version: number
  scenario: string
  scenarios: string[]
  contentLevel: 'limited' | 'short' | 'medium' | 'long' | string
  summary: string
  topics: MeetingTopicSegment[]
  decisions: MeetingStructuredItem[]
  actionItems: MeetingStructuredItem[]
  scheduleItems: MeetingStructuredItem[]
  risks: MeetingStructuredItem[]
  questions: MeetingStructuredItem[]
  followUps: MeetingStructuredItem[]
  transcriptSegments: MeetingTranscriptSegment[]
  source: 'recording' | 'import' | 'unknown' | string
  partialSuccess?: boolean
  summaryError?: string
  [key: string]: unknown
}

export function normalizeMeetingStructuredResult(value: unknown): MeetingStructuredResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<MeetingStructuredResult>
  return {
    ...candidate,
    version: Number(candidate.version) || 1,
    scenario: String(candidate.scenario || 'general_meeting_or_voice_note'),
    scenarios: Array.isArray(candidate.scenarios) ? candidate.scenarios.map((item) => String(item || '')).filter(Boolean) : [],
    contentLevel: String(candidate.contentLevel || 'limited'),
    summary: String(candidate.summary || ''),
    topics: Array.isArray(candidate.topics) ? candidate.topics as MeetingTopicSegment[] : [],
    decisions: Array.isArray(candidate.decisions) ? candidate.decisions as MeetingStructuredItem[] : [],
    actionItems: Array.isArray(candidate.actionItems) ? candidate.actionItems as MeetingStructuredItem[] : [],
    scheduleItems: Array.isArray(candidate.scheduleItems) ? candidate.scheduleItems as MeetingStructuredItem[] : [],
    risks: Array.isArray(candidate.risks) ? candidate.risks as MeetingStructuredItem[] : [],
    questions: Array.isArray(candidate.questions) ? candidate.questions as MeetingStructuredItem[] : [],
    followUps: Array.isArray(candidate.followUps) ? candidate.followUps as MeetingStructuredItem[] : [],
    transcriptSegments: Array.isArray(candidate.transcriptSegments) ? candidate.transcriptSegments as MeetingTranscriptSegment[] : [],
    source: String(candidate.source || 'unknown'),
    partialSuccess: candidate.partialSuccess === true,
    summaryError: typeof candidate.summaryError === 'string' ? candidate.summaryError : '',
  }
}
