import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  getFocusedSelectedText,
  getFocusedSelectionSnapshot,
  isFocusedSelectionStillActive,
  normalizeSelectedTextResult,
} from './focusedContext'

type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => void
  }
}

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
})

test('normalizeSelectedTextResult 兼容字符串返回值', () => {
  assert.equal(normalizeSelectedTextResult('  hello  '), 'hello')
})

test('normalizeSelectedTextResult 兼容对象返回值', () => {
  assert.equal(normalizeSelectedTextResult({ success: true, text: '  hello  ' }), 'hello')
  assert.equal(normalizeSelectedTextResult({ success: false, text: 'hello' }), '')
})

test('getFocusedSelectedText 通过 IPC 读取选区', async () => {
  const windowLike = globalThis as WindowWithIpc
  windowLike.ipcRenderer = {
    invoke: async (channel: string) => {
      assert.equal(channel, 'focused-context:get-selected-text')
      return { success: true, text: 'selected text' } as never
    },
    send: () => undefined,
    on: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowLike })

  assert.equal(await getFocusedSelectedText(), 'selected text')
})

test('getFocusedSelectionSnapshot 通过 IPC 读取选区快照', async () => {
  const windowLike = globalThis as WindowWithIpc
  windowLike.ipcRenderer = {
    invoke: async (channel: string) => {
      assert.equal(channel, 'focused-context:get-selection-snapshot')
      return {
        success: true,
        text: ' selected text ',
        focusInfo: {
          appInfo: {
            app_name: 'Notepad',
            app_identifier: 'notepad.exe',
            window_title: 'note.txt',
            app_type: 'native_app',
            app_metadata: { hwnd: '100' },
            browser_context: null,
          },
          elementInfo: {
            role: '',
            focused: true,
            editable: true,
            selected: true,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
          },
        },
      } as never
    },
    send: () => undefined,
    on: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowLike })

  const snapshot = await getFocusedSelectionSnapshot()

  assert.equal(snapshot.selectedText, 'selected text')
  assert.equal(snapshot.focusInfo?.appInfo.app_identifier, 'notepad.exe')
})

test('isFocusedSelectionStillActive 通过 IPC 校验焦点是否仍有效', async () => {
  const windowLike = globalThis as WindowWithIpc
  const focusInfo = {
    appInfo: {
      app_name: 'Notepad',
      app_identifier: 'notepad.exe',
      window_title: 'note.txt',
      app_type: 'native_app',
      app_metadata: { hwnd: '100' },
      browser_context: null,
    },
    elementInfo: {
      role: '',
      focused: true,
      editable: true,
      selected: true,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    },
  }

  windowLike.ipcRenderer = {
    invoke: async (channel: string, payload?: unknown) => {
      assert.equal(channel, 'focused-context:is-current-focus')
      assert.deepEqual(payload, focusInfo)
      return { success: true, same: true } as never
    },
    send: () => undefined,
    on: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowLike })

  assert.equal(await isFocusedSelectionStillActive(focusInfo), true)
})
