import type { VoiceErrorCode, VoiceMode } from './voiceTypes'
import { ipcClient } from './ipc'

export const HAND_TYPED_CHARS_PER_MINUTE = 60

export type VoiceHistoryItem = {
  id: string
  createdAt: string
  mode: VoiceMode
  status: 'completed' | 'error'
  rawText: string
  refinedText: string
  errorCode?: VoiceErrorCode
  durationMs: number
  textLength: number
}

export type VoiceStats = {
  totalCount: number
  completedCount: number
  totalDurationMs: number
  totalTextLength: number
  averageCharsPerMinute: number
  savedMs: number
}

export const emptyVoiceStats: VoiceStats = {
  totalCount: 0,
  completedCount: 0,
  totalDurationMs: 0,
  totalTextLength: 0,
  averageCharsPerMinute: 0,
  savedMs: 0,
}

function normalizeHistoryItem(item: VoiceHistoryItem): VoiceHistoryItem {
  const finalText = item.refinedText || item.rawText
  return {
    ...item,
    durationMs: Math.max(0, Number(item.durationMs) || 0),
    textLength: Math.max(0, Number(item.textLength) || finalText.trim().length),
  }
}

export async function listVoiceHistory(): Promise<VoiceHistoryItem[]> {
  try {
    const items = await ipcClient.invoke<VoiceHistoryItem[]>('db:history-list')
    return Array.isArray(items) ? items.map(normalizeHistoryItem) : []
  } catch {
    return []
  }
}

export async function saveVoiceHistory(item: VoiceHistoryItem): Promise<VoiceHistoryItem | null> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean; data?: VoiceHistoryItem }>('db:history-upsert', normalizeHistoryItem(item))
    return response?.data ? normalizeHistoryItem(response.data) : null
  } catch {
    return null
  }
}

export async function clearVoiceHistory(): Promise<void> {
  try {
    await ipcClient.invoke('db:history-clear')
  } catch {
    // 浏览器预览环境没有主进程历史数据可清理。
  }
}

export async function loadVoiceStats(): Promise<VoiceStats> {
  try {
    return { ...emptyVoiceStats, ...(await ipcClient.invoke<VoiceStats>('db:history-stats')) }
  } catch {
    return emptyVoiceStats
  }
}

export function formatDurationMinutes(durationMs: number): string {
  return `${Math.floor(Math.max(0, durationMs) / 60000)} 分钟`
}

export function formatSavedMinutes(savedMs: number): string {
  return `${Math.floor(Math.max(0, savedMs) / 60000)} 分钟`
}

export function formatAverageSpeed(charsPerMinute: number): string {
  if (!charsPerMinute) return '--'
  return `${Math.max(0, Math.round(charsPerMinute))} 字/分钟`
}
