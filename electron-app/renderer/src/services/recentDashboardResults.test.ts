import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VoiceHistoryItem } from './historyStore'
import {
  RECENT_DASHBOARD_RESULT_LIMIT,
  prependRecentDashboardResult,
  selectRecentDashboardResults,
} from './recentDashboardResults'

function historyItem(overrides: Partial<VoiceHistoryItem> & { id: string }): VoiceHistoryItem {
  return {
    createdAt: '2026-05-18T00:00:00.000Z',
    mode: 'Dictate',
    status: 'completed',
    rawText: '',
    refinedText: '',
    durationMs: 0,
    textLength: 0,
    ...overrides,
  }
}

test('selectRecentDashboardResults 会展示非自由提问的最近三条完成或错误结果', () => {
  const results = selectRecentDashboardResults([
    historyItem({ id: '1', refinedText: '第一条润色' }),
    historyItem({ id: '2', mode: 'Ask', refinedText: '自由提问不进首页' }),
    historyItem({ id: '3', rawText: '第二条原文' }),
    historyItem({ id: 'meeting-1', mode: 'MeetingNotes', refinedText: '会议笔记不进首页' }),
    historyItem({ id: '4', status: 'error', errorMessage: '接口失败', retryable: true }),
    historyItem({ id: '5', refinedText: '   ' }),
    historyItem({ id: '6', refinedText: '第三条润色' }),
    historyItem({ id: '7', refinedText: '第四条被截断' }),
  ])

  assert.equal(RECENT_DASHBOARD_RESULT_LIMIT, 3)
  assert.deepEqual(results, [
    { id: '1', createdAt: '2026-05-18T00:00:00.000Z', text: '第一条润色', status: 'completed', errorMessage: undefined, retryable: undefined },
    { id: '3', createdAt: '2026-05-18T00:00:00.000Z', text: '第二条原文', status: 'completed', errorMessage: undefined, retryable: undefined },
    { id: '4', createdAt: '2026-05-18T00:00:00.000Z', text: '接口失败', status: 'error', errorMessage: '接口失败', retryable: true },
  ])
})

test('prependRecentDashboardResult 会把新结果放到顶部并按 id 去重', () => {
  const current = [
    { id: '1', createdAt: '2026-05-18T00:00:00.000Z', text: '旧第一条', status: 'completed' as const },
    { id: '2', createdAt: '2026-05-18T00:00:00.000Z', text: '旧第二条', status: 'completed' as const },
    { id: '3', createdAt: '2026-05-18T00:00:00.000Z', text: '旧第三条', status: 'completed' as const },
  ]

  assert.deepEqual(prependRecentDashboardResult(current, { id: '2', createdAt: '2026-05-19T00:00:00.000Z', text: '更新后的第二条', status: 'completed' }), [
    { id: '2', createdAt: '2026-05-19T00:00:00.000Z', text: '更新后的第二条', status: 'completed', errorMessage: undefined, retryable: undefined },
    { id: '1', createdAt: '2026-05-18T00:00:00.000Z', text: '旧第一条', status: 'completed' },
    { id: '3', createdAt: '2026-05-18T00:00:00.000Z', text: '旧第三条', status: 'completed' },
  ])

  assert.deepEqual(prependRecentDashboardResult(current, { id: '4', createdAt: '2026-05-20T00:00:00.000Z', text: '新结果', status: 'completed' }), [
    { id: '4', createdAt: '2026-05-20T00:00:00.000Z', text: '新结果', status: 'completed', errorMessage: undefined, retryable: undefined },
    { id: '1', createdAt: '2026-05-18T00:00:00.000Z', text: '旧第一条', status: 'completed' },
    { id: '2', createdAt: '2026-05-18T00:00:00.000Z', text: '旧第二条', status: 'completed' },
  ])
})
