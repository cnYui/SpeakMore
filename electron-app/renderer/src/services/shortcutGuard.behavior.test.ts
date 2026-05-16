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

test('空闲短按 RightAlt 在释放边沿触发 toggle-recording', () => {
  installTimerWindow()
  const pressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltDown, { voiceStatus: 'idle' }, () => {})
  const released = reduceShortcutGuard(pressed.state, rightAltUp, { voiceStatus: 'idle' }, () => {})

  assert.deepEqual(released.action, { type: 'toggle-recording', mode: 'Dictate' })
})

test('空闲长按 RightAlt 会显示提示并阻断释放边沿', () => {
  installTimerWindow()
  const pressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltDown, { voiceStatus: 'idle' }, () => {})
  const blockedState = blockByLongPress(pressed.state)
  const released = reduceShortcutGuard(blockedState, rightAltUp, { voiceStatus: 'idle' }, () => {})

  assert.equal(blockedState.modalVisible, true)
  assert.deepEqual(released.action, { type: 'none' })
})

test('录音中长按 RightAlt 不显示提示，释放仍触发停止录音的 toggle-recording', () => {
  const timers = installTimerWindow()
  let longPressCalls = 0
  const pressed = reduceShortcutGuard(createInitialShortcutGuardState(), rightAltDown, { voiceStatus: 'recording' }, () => {
    longPressCalls += 1
  })
  const released = reduceShortcutGuard(pressed.state, rightAltUp, { voiceStatus: 'recording' }, () => {})

  assert.equal(timers.length, 0)
  assert.equal(longPressCalls, 0)
  assert.equal(pressed.state.modalVisible, false)
  assert.deepEqual(released.action, { type: 'toggle-recording', mode: 'Dictate' })
})
