import type { VoiceMode } from './voiceTypes'

export const LONG_PRESS_MS = 500

type KeyboardLike = {
  keyName?: string
  isKeydown?: boolean
}

export type ShortcutGuardAction =
  | { type: 'none' }
  | { type: 'start-recording'; mode: VoiceMode }

export type ShortcutGuardState = {
  isRightAltDown: boolean
  isBlocked: boolean
  modalVisible: boolean
  activeMode: VoiceMode | null
  longPressTimer: number | null
}

export function createInitialShortcutGuardState(): ShortcutGuardState {
  return {
    isRightAltDown: false,
    isBlocked: false,
    modalVisible: false,
    activeMode: null,
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
    activeMode: null,
    longPressTimer: null,
  }
}

function resolveMode(keys: KeyboardLike[]): VoiceMode {
  if (keys.some((key) => key.keyName === 'Space' && key.isKeydown)) return 'Ask'
  if (keys.some((key) => key.keyName === 'RightShift' && key.isKeydown)) return 'Translate'
  return 'Dictate'
}

export function reduceShortcutGuard(
  state: ShortcutGuardState,
  rawKeys: unknown,
  onLongPress: () => void,
): { state: ShortcutGuardState; action: ShortcutGuardAction } {
  const keys = Array.isArray(rawKeys) ? rawKeys as KeyboardLike[] : []
  const rightAltDown = keys.some((key) => key.keyName === 'RightAlt' && key.isKeydown)

  if (!rightAltDown) {
    if (state.isRightAltDown && !state.isBlocked && state.activeMode) {
      return {
        state: resetPressCycle(state),
        action: { type: 'start-recording', mode: state.activeMode },
      }
    }

    return {
      state: resetPressCycle(state),
      action: { type: 'none' },
    }
  }

  const nextMode = resolveMode(keys)

  if (!state.isRightAltDown) {
    const timer = window.setTimeout(onLongPress, LONG_PRESS_MS)
    return {
      state: {
        ...state,
        isRightAltDown: true,
        isBlocked: false,
        modalVisible: false,
        activeMode: nextMode,
        longPressTimer: timer,
      },
      action: { type: 'none' },
    }
  }

  return {
    state: {
      ...state,
      activeMode: nextMode,
    },
    action: { type: 'none' },
  }
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

export function closeShortcutHint(state: ShortcutGuardState): ShortcutGuardState {
  return {
    ...state,
    modalVisible: false,
  }
}

export function disposeShortcutGuard(state: ShortcutGuardState) {
  clearTimer(state.longPressTimer)
}
