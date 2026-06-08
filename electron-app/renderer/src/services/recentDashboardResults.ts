/**
 * 首页最近结果筛选规则
 *
 * 需要从历史记录中提取非自由提问的最近完成结果时看这里。
 */
import type { VoiceHistoryItem } from './historyStore'

export const RECENT_DASHBOARD_RESULT_LIMIT = 3

export type RecentDashboardResult = {
  id: string
  createdAt: string
  text: string
  status: VoiceHistoryItem['status']
  errorMessage?: string
  retryable?: boolean
}

function finalResultText(item: Pick<VoiceHistoryItem, 'rawText' | 'refinedText'>): string {
  return (item.refinedText || item.rawText).trim()
}

function toRecentDashboardResult(item: VoiceHistoryItem): RecentDashboardResult | null {
  if (item.mode === 'Ask') return null
  if (item.mode === 'MeetingNotes') return null

  const text = item.status === 'error'
    ? (item.errorMessage || item.errorCode || finalResultText(item)).trim()
    : finalResultText(item)
  return text ? {
    id: item.id,
    createdAt: item.createdAt,
    text,
    status: item.status,
    errorMessage: item.errorMessage,
    retryable: item.retryable,
  } : null
}

function normalizeRecentDashboardResult(result: RecentDashboardResult): RecentDashboardResult | null {
  const text = result.text.trim()
  return text ? {
    id: result.id,
    createdAt: result.createdAt || new Date().toISOString(),
    text,
    status: result.status || 'completed',
    errorMessage: result.errorMessage,
    retryable: result.retryable,
  } : null
}

export function selectRecentDashboardResults(
  items: VoiceHistoryItem[],
  limit = RECENT_DASHBOARD_RESULT_LIMIT,
): RecentDashboardResult[] {
  const results: RecentDashboardResult[] = []

  for (const item of items) {
    if (results.length >= limit) break

    const result = toRecentDashboardResult(item)
    if (result) results.push(result)
  }

  return results
}

export function prependRecentDashboardResult(
  current: RecentDashboardResult[],
  next: RecentDashboardResult,
  limit = RECENT_DASHBOARD_RESULT_LIMIT,
): RecentDashboardResult[] {
  const normalized = normalizeRecentDashboardResult(next)
  if (!normalized) return current.slice(0, limit)

  return [
    normalized,
    ...current.filter((item) => item.id !== normalized.id),
  ].slice(0, limit)
}
