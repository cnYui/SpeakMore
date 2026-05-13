import type { VoiceErrorCode, VoiceMode } from './voiceTypes'

const HISTORY_KEY = 'typeless-local-history'

export type VoiceHistoryItem = {
  id: string
  createdAt: string
  mode: VoiceMode
  status: 'completed' | 'error'
  rawText: string
  refinedText: string
  errorCode?: VoiceErrorCode
}

export function listVoiceHistory(): VoiceHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) as VoiceHistoryItem[] : []
  } catch {
    return []
  }
}

export function saveVoiceHistory(item: VoiceHistoryItem) {
  const items = [item, ...listVoiceHistory()].slice(0, 200)
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items))
  return items
}

export function clearVoiceHistory() {
  window.localStorage.removeItem(HISTORY_KEY)
}
