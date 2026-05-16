import { ipcClient } from './ipc'

export type SelectedTextResult = {
  success?: boolean
  text?: string
  source?: string
  confidence?: string
  reason?: string
}

export type FocusedInfo = {
  appInfo: {
    app_name: string
    app_identifier: string
    window_title: string
    app_type: string
    app_metadata: Record<string, unknown>
    browser_context: unknown
  }
  elementInfo: {
    role: string
    focused: boolean
    editable: boolean
    selected: boolean
    bounds: { x: number; y: number; width: number; height: number }
  }
}

export type SelectionSource = 'uia' | 'none'
export type SelectionConfidence = 'confirmed' | 'none'

export type FocusedSelectionSnapshot = {
  selectedText: string
  source: SelectionSource
  confidence: SelectionConfidence
  focusInfo: FocusedInfo | null
}

export function normalizeSelectedTextResult(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''

  const result = value as SelectedTextResult
  if (!result.success) return ''
  return typeof result.text === 'string' ? result.text.trim() : ''
}

function normalizeFocusedInfo(value: unknown): FocusedInfo | null {
  if (!value || typeof value !== 'object') return null
  const objectValue = value as { appInfo?: unknown; elementInfo?: unknown }
  const appInfo = objectValue.appInfo && typeof objectValue.appInfo === 'object'
    ? objectValue.appInfo as Record<string, unknown>
    : {}
  const elementInfo = objectValue.elementInfo && typeof objectValue.elementInfo === 'object'
    ? objectValue.elementInfo as Record<string, unknown>
    : {}
  const bounds = elementInfo.bounds && typeof elementInfo.bounds === 'object'
    ? elementInfo.bounds as Partial<{ x: number; y: number; width: number; height: number }>
    : {}

  return {
    appInfo: {
      app_name: typeof appInfo.app_name === 'string' ? appInfo.app_name : '',
      app_identifier: typeof appInfo.app_identifier === 'string' ? appInfo.app_identifier : '',
      window_title: typeof appInfo.window_title === 'string' ? appInfo.window_title : '',
      app_type: typeof appInfo.app_type === 'string' ? appInfo.app_type : 'native_app',
      app_metadata: appInfo.app_metadata && typeof appInfo.app_metadata === 'object'
        ? appInfo.app_metadata as Record<string, unknown>
        : {},
      browser_context: appInfo.browser_context ?? null,
    },
    elementInfo: {
      role: typeof elementInfo.role === 'string' ? elementInfo.role : '',
      focused: Boolean(elementInfo.focused),
      editable: elementInfo.editable !== false,
      selected: Boolean(elementInfo.selected),
      bounds: {
        x: typeof bounds.x === 'number' ? bounds.x : 0,
        y: typeof bounds.y === 'number' ? bounds.y : 0,
        width: typeof bounds.width === 'number' ? bounds.width : 0,
        height: typeof bounds.height === 'number' ? bounds.height : 0,
      },
    },
  }
}

export function normalizeSelectionSnapshot(value: unknown): FocusedSelectionSnapshot {
  if (!value || typeof value !== 'object') {
    return { selectedText: '', source: 'none', confidence: 'none', focusInfo: null }
  }

  const snapshot = value as SelectedTextResult & { focusInfo?: unknown }
  const text = normalizeSelectedTextResult(snapshot)
  const focusInfo = normalizeFocusedInfo(snapshot.focusInfo)
  const isConfirmedUia = snapshot.source === 'uia'
    && snapshot.confidence === 'confirmed'
    && Boolean(text)

  if (!isConfirmedUia) {
    return {
      selectedText: '',
      source: 'none',
      confidence: 'none',
      focusInfo,
    }
  }

  return {
    selectedText: text,
    source: 'uia',
    confidence: 'confirmed',
    focusInfo,
  }
}

export async function getFocusedSelectedText(): Promise<string> {
  try {
    return normalizeSelectedTextResult(await ipcClient.invoke('focused-context:get-selected-text'))
  } catch {
    return ''
  }
}

export async function getFocusedSelectionSnapshot(): Promise<FocusedSelectionSnapshot> {
  try {
    return normalizeSelectionSnapshot(await ipcClient.invoke('focused-context:get-selection-snapshot'))
  } catch {
    return { selectedText: '', source: 'none', confidence: 'none', focusInfo: null }
  }
}

export async function isFocusedSelectionStillActive(focusInfo: FocusedInfo | null): Promise<boolean> {
  if (!focusInfo) return false

  try {
    const result = await ipcClient.invoke('focused-context:is-current-focus', focusInfo) as { same?: unknown }
    return result.same === true
  } catch {
    return false
  }
}
