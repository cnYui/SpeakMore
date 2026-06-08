import assert from 'node:assert/strict'
import { test } from 'node:test'

import { muteBackgroundAudio, resetBackgroundAudioRestoreState, restoreBackgroundAudio } from './backgroundAudio'

type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => void
  }
}

function installIpcStub(options: { muteResult?: unknown; muteReject?: boolean; settings?: unknown } = {}) {
  const originalWindow = globalThis.window
  const windowLike = globalThis as WindowWithIpc
  const invokeCalls: string[] = []

  windowLike.ipcRenderer = {
    invoke: async (channel: string) => {
      invokeCalls.push(channel)
      if (channel === 'settings:get') {
        return (options.settings ?? {}) as never
      }
      if (channel === 'audio:mute-background-sessions') {
        if (options.muteReject) throw new Error('mute failed')
        return (options.muteResult ?? { success: true }) as never
      }
      if (channel === 'audio:restore-background-sessions') {
        return { success: true } as never
      }
      return {} as never
    },
    send: () => undefined,
    on: () => undefined,
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowLike,
  })

  return {
    invokeCalls,
    restore() {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      })
      delete windowLike.ipcRenderer
    },
  }
}

test('静音成功后只恢复一次后台音频', async () => {
  const env = installIpcStub()

  try {
    await muteBackgroundAudio()
    await restoreBackgroundAudio()
    await restoreBackgroundAudio()

    assert.deepEqual(env.invokeCalls, [
      'settings:get',
      'audio:mute-background-sessions',
      'audio:restore-background-sessions',
    ])
  } finally {
    env.restore()
  }
})

test('静音失败时不恢复后台音频', async () => {
  const env = installIpcStub({ muteResult: { success: false } })

  try {
    await muteBackgroundAudio()
    await restoreBackgroundAudio()

    assert.deepEqual(env.invokeCalls, ['settings:get', 'audio:mute-background-sessions'])
  } finally {
    env.restore()
  }
})

test('静音 IPC 抛错时不恢复后台音频', async () => {
  const env = installIpcStub({ muteReject: true })

  try {
    await muteBackgroundAudio()
    await restoreBackgroundAudio()

    assert.deepEqual(env.invokeCalls, ['settings:get', 'audio:mute-background-sessions'])
  } finally {
    env.restore()
  }
})

test('重置恢复状态后不会恢复上一轮后台音频', async () => {
  const env = installIpcStub()

  try {
    await muteBackgroundAudio()
    resetBackgroundAudioRestoreState()
    await restoreBackgroundAudio()

    assert.deepEqual(env.invokeCalls, ['settings:get', 'audio:mute-background-sessions'])
  } finally {
    env.restore()
  }
})

test('关闭语音输入时静音后不会调用后台音频静音 IPC', async () => {
  const env = installIpcStub({ settings: { muteBackgroundAudioDuringRecording: false } })

  try {
    await muteBackgroundAudio()
    await restoreBackgroundAudio()

    assert.deepEqual(env.invokeCalls, ['settings:get'])
  } finally {
    env.restore()
  }
})
