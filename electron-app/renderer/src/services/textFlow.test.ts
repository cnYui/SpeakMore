import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { requestTextFlow } from './textFlow'

const originalFetch = globalThis.fetch

afterEach(() => {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch })
})

test('requestTextFlow 返回后端 refine_text', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      return {
        ok: true,
        json: async () => ({ status: 'OK', data: { refine_text: 'translated text' } }),
      } as Response
    },
  })

  const result = await requestTextFlow({
    mode: 'translation',
    text: '你好',
    parameters: { output_language: 'en' },
  })

  assert.equal(result, 'translated text')
  assert.match(requests[0].url, /\/ai\/text_flow$/)
  assert.equal(JSON.parse(String(requests[0].init?.body)).text, '你好')
})

test('requestTextFlow 在后端错误时抛出 detail', async () => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ detail: '语音后端尚未就绪' }),
    }) as Response,
  })

  await assert.rejects(
    () => requestTextFlow({ mode: 'translation', text: '你好', parameters: { output_language: 'en' } }),
    /语音后端尚未就绪/,
  )
})

test('requestTextFlow 在业务状态 ERROR 时抛出 detail', async () => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ERROR', data: { refine_text: '错误: boom', detail: 'boom' } }),
    }) as Response,
  })

  await assert.rejects(
    () => requestTextFlow({ mode: 'translation', text: '你好', parameters: { output_language: 'en' } }),
    /boom/,
  )
})
