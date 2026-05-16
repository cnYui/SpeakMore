import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  blockByLongPress,
  createInitialShortcutGuardState,
  reduceShortcutGuard,
} from './shortcutGuard'

const originalWindow = globalThis.window

afterEach(() => {
  ;(globalThis as { window: unknown }).window = originalWindow
})

function installTimerWindow() {
  const timers: Array<() => void> = []
  ;(globalThis as { window: unknown }).window = {
    setTimeout: (callback: () => void) => {
      timers.push(callback)
      return timers.length
    },
    clearTimeout: (_timer: number) => {},
  }
  return timers
}

const rightAltDown = [{ keyName: 'RightAlt', isKeydown: true }]
const rightAltUp = [{ keyName: 'RightAlt', isKeydown: false }]
const rightAltAndSpaceDown = [
  { keyName: 'RightAlt', isKeydown: true },
  { keyName: 'Space', isKeydown: true },
]
const rightAltAndRightShiftDown = [
  { keyName: 'RightAlt', isKeydown: true },
  { keyName: 'RightShift', isKeydown: true },
]
const rightShiftUp = [{ keyName: 'RightShift', isKeydown: false }]
const spaceUp = [{ keyName: 'Space', isKeydown: false }]
const rightAltSpaceAndRightShiftDown = [
  { keyName: 'RightAlt', isKeydown: true },
  { keyName: 'Space', isKeydown: true },
  { keyName: 'RightShift', isKeydown: true },
]

test('空闲短按 RightAlt 在释放边沿触发普通听写意图', () => {
  installTimerWindow()
  const pressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltDown, { voiceStatus: 'idle' }, () => {})
  const released = reduceShortcutGuard(pressed.state, rightAltUp, { voiceStatus: 'idle' }, () => {})

  assert.deepEqual(released.action, { type: 'toggle-recording', intent: 'DictateShortcut' })
})

test('空闲长按 RightAlt 会显示提示并阻断释放边沿', () => {
  installTimerWindow()
  const pressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltDown, { voiceStatus: 'idle' }, () => {})
  const blockedState = blockByLongPress(pressed.state)
  const released = reduceShortcutGuard(blockedState, rightAltUp, { voiceStatus: 'idle' }, () => {})

  assert.equal(blockedState.modalVisible, true)
  assert.deepEqual(released.action, { type: 'none' })
})

test('录音中长按 RightAlt 不显示提示，释放仍触发停止录音的普通听写意图', () => {
  const timers = installTimerWindow()
  let longPressCalls = 0
  const pressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltDown, { voiceStatus: 'recording' }, () => {
    longPressCalls += 1
  })
  const released = reduceShortcutGuard(pressed.state, rightAltUp, { voiceStatus: 'recording' }, () => {})

  assert.equal(timers.length, 0)
  assert.equal(longPressCalls, 0)
  assert.equal(pressed.state.modalVisible, false)
  assert.deepEqual(released.action, { type: 'toggle-recording', intent: 'DictateShortcut' })
})

test('RightAlt + Space 在释放边沿触发自由提问意图', () => {
  installTimerWindow()
  const pressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltAndSpaceDown, { voiceStatus: 'idle' }, () => {})
  const released = reduceShortcutGuard(pressed.state, rightAltUp, { voiceStatus: 'idle' }, () => {})

  assert.deepEqual(released.action, { type: 'toggle-recording', intent: 'AskShortcut' })
})

test('RightAlt + RightShift 在释放边沿触发翻译意图', () => {
  installTimerWindow()
  const pressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltAndRightShiftDown, { voiceStatus: 'idle' }, () => {})
  const released = reduceShortcutGuard(pressed.state, rightAltUp, { voiceStatus: 'idle' }, () => {})

  assert.deepEqual(released.action, { type: 'toggle-recording', intent: 'TranslateShortcut' })
})

test('RightAlt + RightShift 先释放 RightShift 时，直到 RightAlt 释放才触发翻译意图', () => {
  installTimerWindow()
  const rightAltPressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltDown, { voiceStatus: 'idle' }, () => {})
  const comboPressed = reduceShortcutGuard(rightAltPressed.state, rightAltAndRightShiftDown, { voiceStatus: 'idle' }, () => {})
  const shiftReleased = reduceShortcutGuard(comboPressed.state, rightShiftUp, { voiceStatus: 'idle' }, () => {})
  const rightAltRestored = reduceShortcutGuard(shiftReleased.state, rightAltDown, { voiceStatus: 'idle' }, () => {})
  const rightAltReleased = reduceShortcutGuard(rightAltRestored.state, rightAltUp, { voiceStatus: 'idle' }, () => {})

  assert.deepEqual(shiftReleased.action, { type: 'none' })
  assert.deepEqual(rightAltReleased.action, { type: 'toggle-recording', intent: 'TranslateShortcut' })
})

test('RightAlt + Space 先释放 Space 时，直到 RightAlt 释放才触发自由提问意图', () => {
  installTimerWindow()
  const rightAltPressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltDown, { voiceStatus: 'idle' }, () => {})
  const comboPressed = reduceShortcutGuard(rightAltPressed.state, rightAltAndSpaceDown, { voiceStatus: 'idle' }, () => {})
  const spaceReleased = reduceShortcutGuard(comboPressed.state, spaceUp, { voiceStatus: 'idle' }, () => {})
  const rightAltRestored = reduceShortcutGuard(spaceReleased.state, rightAltDown, { voiceStatus: 'idle' }, () => {})
  const rightAltReleased = reduceShortcutGuard(rightAltRestored.state, rightAltUp, { voiceStatus: 'idle' }, () => {})

  assert.deepEqual(spaceReleased.action, { type: 'none' })
  assert.deepEqual(rightAltReleased.action, { type: 'toggle-recording', intent: 'AskShortcut' })
})

test('Space 和 RightShift 同时存在时优先翻译意图，避免 Space 抢占', () => {
  installTimerWindow()
  const pressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltSpaceAndRightShiftDown, { voiceStatus: 'idle' }, () => {})
  const released = reduceShortcutGuard(pressed.state, rightAltUp, { voiceStatus: 'idle' }, () => {})

  assert.deepEqual(released.action, { type: 'toggle-recording', intent: 'TranslateShortcut' })
})

test('传入 debugLog 时记录当前键态、模式和动作', () => {
  installTimerWindow()
  const logs: Array<{ event: string; payload: unknown }> = []
  const pressed = reduceShortcutGuard(
    createInitialShortcutGuardState(),
    rightAltAndRightShiftDown,
    { voiceStatus: 'idle', debugLog: (event, payload) => logs.push({ event, payload }) },
    () => {},
  )
  reduceShortcutGuard(
    pressed.state,
    rightAltUp,
    { voiceStatus: 'idle', debugLog: (event, payload) => logs.push({ event, payload }) },
    () => {},
  )

  assert.equal(logs.some((log) => log.event === 'shortcut-guard:reduce'), true)
})
