import { ipcClient } from './ipc'

export type SelectedTextResult = {
  success?: boolean
  text?: string
  source?: string
  reason?: string
}

export function normalizeSelectedTextResult(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''

  const result = value as SelectedTextResult
  if (!result.success) return ''
  return typeof result.text === 'string' ? result.text.trim() : ''
}

export async function getFocusedSelectedText(): Promise<string> {
  try {
    return normalizeSelectedTextResult(await ipcClient.invoke('focused-context:get-selected-text'))
  } catch {
    return ''
  }
}
