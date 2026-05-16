import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { getFocusedSelectedText, normalizeSelectedTextResult } from './focusedContext'

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
