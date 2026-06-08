import type { MeetingStructuredItem, MeetingStructuredResult, MeetingTopicSegment } from './meetingStructuredResult'

export type MeetingNoteTitleSource = {
  title?: string
  transcript?: string
  translationText?: string
  summary?: string
  structuredResult?: MeetingStructuredResult | null
  importFile?: { name?: string | null } | null
}

export type MeetingNoteTitleOptions = {
  weakTitleHints?: Array<string | undefined | null>
  fallbackTitle?: string
}

const MEDIA_FILE_PATTERN = /\.(m4a|mp3|mp4|wav|ogg|flac|mov|avi|mkv|webm|opus)$/i
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u
const DEFAULT_WEAK_TITLES = [
  '新笔记',
  '实时翻译',
  '会议标题',
  '会议笔记',
  '新筆記',
  '即時翻譯',
  '會議筆記',
  'New note',
  'Live translation',
  'Meeting title',
  'Meeting Notes',
  '新規メモ',
  'リアルタイム翻訳',
  '会議メモ',
  '새 노트',
  '실시간 번역',
  '회의 노트',
]

function normalizeCompareText(value: string) {
  return cleanupTitleText(value).toLowerCase().replace(/[\s\-_.,，。:：/\\()[\]{}]+/g, '')
}

function cleanupTitleText(value: string) {
  return String(value || '')
    .replace(EMOJI_PATTERN, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripFileExtension(value: string) {
  return value.replace(MEDIA_FILE_PATTERN, '').trim()
}

function looksLikeWeakDefaultTitle(title: string, hints: string[]) {
  const cleanTitle = cleanupTitleText(title)
  if (!cleanTitle) return true

  const normalizedTitle = normalizeCompareText(cleanTitle)
  const normalizedHints = [...DEFAULT_WEAK_TITLES, ...hints]
    .map((hint) => normalizeCompareText(String(hint || '')))
    .filter(Boolean)

  if (normalizedHints.includes(normalizedTitle)) return true
  if (MEDIA_FILE_PATTERN.test(cleanTitle)) return true
  if (/^(untitled|未命名|无标题|無標題)$/i.test(cleanTitle)) return true
  if (/^(topic|主题|主題)\d+$/i.test(normalizedTitle)) return true

  return ['新笔记', '新筆記', 'newnote'].some((suffix) => normalizedTitle.endsWith(normalizeCompareText(suffix)))
}

function isGenericCandidate(value: string) {
  const normalized = normalizeCompareText(value)
  if (!normalized) return true
  if (/^(topic|主题|主題)\d+$/i.test(normalized)) return true
  return [
    '会议摘要',
    '會議摘要',
    'meetingSummary',
    'summary',
    '笔记',
    '筆記',
    'notes',
    '待办事项',
    'actionItems',
  ].some((item) => normalized === normalizeCompareText(item))
}

function getItemText(item: MeetingStructuredItem | undefined) {
  return cleanupTitleText(item?.text || '')
}

function getTopicCandidate(topic: MeetingTopicSegment | undefined) {
  const title = cleanupTitleText(topic?.title || '')
  if (title && !isGenericCandidate(title)) return title
  return cleanupTitleText(topic?.summary || '')
}

function collectTitleCandidates(source: MeetingNoteTitleSource) {
  const structured = source.structuredResult || null
  const candidates: string[] = []
  if (structured) {
    candidates.push(getTopicCandidate(structured.topics?.[0]))
    candidates.push(cleanupTitleText(structured.summary || ''))
    candidates.push(getItemText(structured.decisions?.[0]))
    candidates.push(getItemText(structured.actionItems?.[0]))
    candidates.push(getItemText(structured.scheduleItems?.[0]))
    candidates.push(getItemText(structured.followUps?.[0]))
    candidates.push(getItemText(structured.risks?.[0]))
    candidates.push(cleanupTitleText(structured.transcriptSegments?.[0]?.text || ''))
  }
  candidates.push(cleanupTitleText(source.summary || ''))
  candidates.push(cleanupTitleText(source.transcript || ''))
  candidates.push(cleanupTitleText(source.translationText || ''))
  return candidates.filter((candidate) => candidate && !isGenericCandidate(candidate))
}

function stripLeadingBoilerplate(value: string) {
  let text = value
    .replace(/^[\s\-*•·\d一二三四五六七八九十]+[.)、:：]\s*/u, '')
    .replace(/^(会议|會議)?(纪要|紀要|摘要|总结|總結|主题|主題|标题|標題)\s*[:：-]\s*/u, '')
    .replace(/^(以下是|下面是).{0,12}?(会议|會議|内容|內容|记录|記錄|总结|總結)\s*[:：-]?\s*/u, '')
    .replace(/^(本次|这次|此次|今天|刚才)?(会议|會議|通话|通話|沟通|溝通|同步|讨论|討論|录音|錄音|内容|內容)?(主要|重点|重點)?(围绕|圍繞|关于|關於|讨论|討論|同步|沟通|溝通|记录|記錄|确认|確認|明确|明確|提到|讲了|講了)(了|一下|的是)?\s*/u, '')
    .replace(/^(this|the|today'?s)?\s*(meeting|call|discussion|recording|note)\s*(mainly\s*)?(discussed|covered|focused on|was about|is about)\s+/i, '')
    .replace(/^(summary|meeting summary|title|notes?)\s*[:：-]\s*/i, '')
    .trim()

  if (!text) text = value.trim()
  return text
}

function firstUsefulPhrase(value: string) {
  const cleaned = stripLeadingBoilerplate(cleanupTitleText(value))
  const line = cleaned.split(/\n+/).map((item) => item.trim()).find(Boolean) || ''
  const sentence = line.match(/^(.{4,96}?)[。！？!?；;]/u)?.[1] || line
  const firstClause = sentence.split(/[，,]/u)[0]?.trim() || ''
  if (CJK_PATTERN.test(firstClause) && Array.from(firstClause).length >= 6) return stripLeadingBoilerplate(firstClause)
  return stripLeadingBoilerplate(sentence)
    .replace(/[，,、；;：:。.!！?？\s]+$/u, '')
    .trim()
}

function truncateCjkTitle(value: string) {
  const chars = Array.from(value)
  if (chars.length <= 28) return value
  const preferredBreak = Math.max(
    value.lastIndexOf('，', 28),
    value.lastIndexOf('、', 28),
    value.lastIndexOf(',', 28),
    value.lastIndexOf('与', 28),
    value.lastIndexOf('和', 28),
  )
  if (preferredBreak >= 8) return value.slice(0, preferredBreak).trim()
  return `${chars.slice(0, 28).join('').trim()}...`
}

function truncateWordTitle(value: string) {
  const words = value.split(/\s+/).filter(Boolean)
  const short = words.length > 9 ? words.slice(0, 9).join(' ') : value
  return short.length > 72 ? `${short.slice(0, 69).trim()}...` : short
}

function toCompactTitle(value: string) {
  const phrase = firstUsefulPhrase(value)
  if (!phrase || isGenericCandidate(phrase)) return ''
  const normalized = phrase
    .replace(/^[“"'\u300c\u300e]+|[”"'\u300d\u300f]+$/g, '')
    .replace(/[，,、；;：:。.!！?？\s]+$/u, '')
    .trim()
  if (!normalized || isGenericCandidate(normalized)) return ''
  return CJK_PATTERN.test(normalized) ? truncateCjkTitle(normalized) : truncateWordTitle(normalized)
}

export function shouldGenerateMeetingNoteTitle(currentTitle: string | undefined, options: MeetingNoteTitleOptions = {}) {
  return looksLikeWeakDefaultTitle(currentTitle || '', options.weakTitleHints?.filter(Boolean) as string[] || [])
}

export function generateMeetingNoteTitle(source: MeetingNoteTitleSource, options: MeetingNoteTitleOptions = {}) {
  const currentTitle = cleanupTitleText(source.title || '')
  if (!shouldGenerateMeetingNoteTitle(currentTitle, options)) return currentTitle

  const hints = options.weakTitleHints?.filter(Boolean).map(String) || []
  const importedName = cleanupTitleText(source.importFile?.name || '')
  const candidates = collectTitleCandidates(source)
  if (importedName && !looksLikeWeakDefaultTitle(importedName, hints)) candidates.push(stripFileExtension(importedName))

  const seen = new Set<string>()
  for (const candidate of candidates) {
    const title = toCompactTitle(candidate)
    const key = normalizeCompareText(title)
    if (!title || seen.has(key)) continue
    seen.add(key)
    return title
  }

  return cleanupTitleText(options.fallbackTitle || currentTitle || stripFileExtension(importedName) || '')
}
