/**
 * 听写历史和统计数据源
 *
 * 需要保存语音结果、读取历史列表或展示累计统计时看这里。
 */
import type { VoiceErrorCode, VoiceMode } from './voice/voiceTypes'
import { ipcClient } from './ipc'

export const HAND_TYPED_CHARS_PER_MINUTE = 60
export const VOICE_HISTORY_UPDATED_EVENT = 'voice-history-updated'

export type VoiceHistoryItem = {
  id: string
  createdAt: string
  mode: VoiceMode
  status: 'completed' | 'error'
  rawText: string
  refinedText: string
  errorCode?: VoiceErrorCode
  errorMessage?: string
  hasRetryAudio?: boolean
  retryable?: boolean
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
  const retryableMode = item.mode === 'Dictate' || item.mode === 'Translate'
  const isError = item.status === 'error'
  return {
    ...item,
    errorMessage: isError ? item.errorMessage || item.errorCode || '' : '',
    hasRetryAudio: isError && retryableMode && Boolean(item.hasRetryAudio),
    retryable: isError && retryableMode && Boolean(item.retryable || item.hasRetryAudio || item.rawText.trim()),
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

export async function deleteVoiceHistory(id: string): Promise<boolean> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean }>('db:history-delete', id)
    return response?.success !== false
  } catch {
    return false
  }
}

export async function retryVoiceHistory(id: string): Promise<VoiceHistoryItem | null> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean; data?: VoiceHistoryItem }>('db:history-retry', id)
    return response?.data ? normalizeHistoryItem(response.data) : null
  } catch {
    return null
  }
}

export async function saveVoiceHistoryRetryAudio(id: string, wavBase64: string): Promise<VoiceHistoryItem | null> {
  if (!id || !wavBase64) return null
  try {
    const response = await ipcClient.invoke<{ success?: boolean; data?: VoiceHistoryItem }>('db:history-save-audio', { id, wavBase64 })
    return response?.data ? normalizeHistoryItem(response.data) : null
  } catch {
    return null
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
