export const LONG_PRESS_MS = 500

type KeyboardLike = {
  keyName?: string
  isKeydown?: boolean
}

export type ShortcutIntent = 'DictateShortcut' | 'AskShortcut' | 'TranslateShortcut'

export type ShortcutGuardAction =
  | { type: 'none' }
  | { type: 'toggle-recording'; intent: ShortcutIntent }

export type ShortcutGuardContext = {
  voiceStatus?: string
  debugLog?: (event: string, payload: Record<string, unknown>) => void
}

export type ShortcutGuardState = {
  isRightAltDown: boolean
  isBlocked: boolean
  modalVisible: boolean
  activeIntent: ShortcutIntent | null
  longPressTimer: number | null
}

export function createInitialShortcutGuardState(): ShortcutGuardState {
  return {
    isRightAltDown: false,
    isBlocked: false,
    modalVisible: false,
    activeIntent: null,
    longPressTimer: null,
  }
}

function clearTimer(timer: number | null) {
  if (timer !== null) window.clearTimeout(timer)
}

function resetPressCycle(state: ShortcutGuardState): ShortcutGuardState {
  clearTimer(state.longPressTimer)
  return {
    ...state,
    isRightAltDown: false,
    isBlocked: false,
    activeIntent: null,
    longPressTimer: null,
  }
}

function resolveIntent(keys: KeyboardLike[]): ShortcutIntent {
  if (keys.some((key) => key.keyName === 'RightShift' && key.isKeydown)) return 'TranslateShortcut'
  if (keys.some((key) => key.keyName === 'Space' && key.isKeydown)) return 'AskShortcut'
  return 'DictateShortcut'
}

function canUseLongPressGuard(context: ShortcutGuardContext) {
  return context.voiceStatus !== 'recording'
}

export function reduceShortcutGuard(
  state: ShortcutGuardState,
  rawKeys: unknown,
  context: ShortcutGuardContext,
  onLongPress: () => void,
): { state: ShortcutGuardState; action: ShortcutGuardAction } {
  const keys = Array.isArray(rawKeys) ? rawKeys as KeyboardLike[] : []
  const debugLog = typeof context.debugLog === 'function' ? context.debugLog : null
  const finish = (nextState: ShortcutGuardState, action: ShortcutGuardAction) => {
    debugLog?.('shortcut-guard:reduce', {
      keys,
      voiceStatus: context.voiceStatus,
      activeIntent: nextState.activeIntent,
      action,
    })
    return { state: nextState, action }
  }
  const rightAltDown = keys.some((key) => key.keyName === 'RightAlt' && key.isKeydown)

  if (!rightAltDown) {
    if (state.isRightAltDown && !state.isBlocked && state.activeIntent) {
      return finish(resetPressCycle(state), { type: 'toggle-recording', intent: state.activeIntent })
    }

    return finish(resetPressCycle(state), { type: 'none' })
  }

  const nextIntent = resolveIntent(keys)

  if (!state.isRightAltDown) {
    const timer = canUseLongPressGuard(context) ? window.setTimeout(onLongPress, LONG_PRESS_MS) : null
    return finish({
      ...state,
      isRightAltDown: true,
      isBlocked: false,
      modalVisible: false,
      activeIntent: nextIntent,
      longPressTimer: timer,
    }, { type: 'none' })
  }

  return finish({
    ...state,
    activeIntent: nextIntent,
  }, { type: 'none' })
}

export function blockByLongPress(state: ShortcutGuardState): ShortcutGuardState {
  if (!state.isRightAltDown || state.isBlocked) return state

  clearTimer(state.longPressTimer)

  return {
    ...state,
    isBlocked: true,
    modalVisible: true,
    longPressTimer: null,
  }
}

export function disposeShortcutGuard(state: ShortcutGuardState) {
  clearTimer(state.longPressTimer)
}
