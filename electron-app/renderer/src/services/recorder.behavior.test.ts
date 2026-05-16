import assert from 'node:assert/strict'
import { test } from 'node:test'

type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => void
    off: (channel: string, listener: (...args: unknown[]) => void) => void
  }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function createTestEnvironment(options: { userMediaPromise?: Promise<MediaStream> } = {}) {
  const originalWindow = globalThis.window
  const originalNavigator = globalThis.navigator
  const originalCrypto = globalThis.crypto
  const originalWebSocket = globalThis.WebSocket
  const originalMediaRecorder = globalThis.MediaRecorder
  const originalAudioContext = globalThis.AudioContext
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame

  const sentPayloads: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = []
  const invokeCalls: Array<{ channel: string; payload?: unknown }> = []
  const sendCalls: Array<{ channel: string; payload?: unknown }> = []
  const sockets: FakeWebSocket[] = []
  let restoreCalls = 0
  let trackStops = 0

  const mediaStream = {
    getTracks: () => [{ stop: () => { trackStops += 1 } }],
  } as unknown as MediaStream

  class FakeAnalyserNode {
    fftSize = 2048
    smoothingTimeConstant = 0

    getFloatTimeDomainData(target: Float32Array) {
      target.fill(0)
    }
  }

  class FakeMediaStreamAudioSourceNode {
    connect(_node: FakeAnalyserNode) {}

    disconnect() {}
  }

  class FakeAudioContext {
    createAnalyser() {
      return new FakeAnalyserNode()
    }

    createMediaStreamSource(_stream: MediaStream) {
      return new FakeMediaStreamAudioSourceNode()
    }

    resume() {
      return Promise.resolve()
    }

    close() {
      return Promise.resolve()
    }
  }

  class FakeWebSocket extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    readyState = FakeWebSocket.CONNECTING
    binaryType = 'blob'
    onopen: ((event: Event) => void) | null = null
    onclose: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null

    constructor(public readonly url: string) {
      super()
      sockets.push(this)
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN
        const event = new Event('open')
        this.dispatchEvent(event)
        this.onopen?.(event)
      })
    }

    send(payload: string | ArrayBufferLike | Blob | ArrayBufferView) {
      sentPayloads.push(payload)
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED
      const event = new Event('close')
      this.dispatchEvent(event)
      this.onclose?.(event)
    }

    emitJson(payload: unknown) {
      this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
    }
  }

  class FakeMediaRecorder {
    state: 'inactive' | 'recording' = 'inactive'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onerror: (() => void) | null = null

    constructor(_stream: MediaStream, _options: MediaRecorderOptions) {}

    start() {
      this.state = 'recording'
    }

    stop() {
      this.state = 'inactive'
    }
  }

  const userMediaPromise = options.userMediaPromise ?? Promise.resolve(mediaStream)
  const windowLike = globalThis as WindowWithIpc
  windowLike.ipcRenderer = {
    invoke: async (channel: string, payload?: unknown) => {
      invokeCalls.push({ channel, payload })
      if (channel === 'audio:ensure-voice-server') return { success: true } as never
      if (channel === 'audio:check-voice-server-ready') return { success: true } as never
      if (channel === 'audio:mute-background-sessions') return { success: true } as never
      if (channel === 'audio:restore-background-sessions') {
        restoreCalls += 1
        return { success: true } as never
      }
      if (channel === 'settings:get') {
        return {
          selectedAudioDeviceId: 'default',
          showFloatingBar: true,
          launchAtSystemStartup: false,
        } as never
      }
      if (channel === 'keyboard:type-transcript') return { success: true } as never
      return {} as never
    },
    send: (channel: string, payload?: unknown) => {
      sendCalls.push({ channel, payload })
    },
    on: () => undefined,
    off: () => undefined,
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowLike,
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => userMediaPromise } },
  })
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID: () => 'audio-1' },
  })
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeWebSocket,
  })
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: FakeMediaRecorder,
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: FakeAudioContext,
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: () => 1,
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: () => undefined,
  })

  return {
    mediaStream,
    sentPayloads,
    invokeCalls,
    sendCalls,
    sockets,
    getRestoreCalls: () => restoreCalls,
    getTrackStops: () => trackStops,
    restore() {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      })
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      })
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      })
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        value: originalWebSocket,
      })
      Object.defineProperty(globalThis, 'MediaRecorder', {
        configurable: true,
        value: originalMediaRecorder,
      })
      Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        value: originalAudioContext,
      })
      Object.defineProperty(globalThis, 'requestAnimationFrame', {
        configurable: true,
        value: originalRequestAnimationFrame,
      })
      Object.defineProperty(globalThis, 'cancelAnimationFrame', {
        configurable: true,
        value: originalCancelAnimationFrame,
      })
      delete windowLike.ipcRenderer
    },
  }
}

async function loadRecorderModule(seed: string) {
  return import(new URL(`./recorder.ts?case=${seed}-${Date.now()}`, import.meta.url).href)
}

test('cancelRecording 在 connecting 态会终止启动链路并停在 cancelled', async () => {
  const deferred = createDeferred<MediaStream>()
  const env = createTestEnvironment({ userMediaPromise: deferred.promise })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null
  let deferredResolved = false

  try {
    recorder = await loadRecorderModule('connecting')
    assert.equal(typeof recorder.cancelRecording, 'function', 'cancelRecording 未导出')
    const pendingStart = recorder.startRecording('Dictate')

    assert.equal(recorder.getVoiceSession().status, 'connecting')

    recorder.cancelRecording()
    deferred.resolve(env.mediaStream)
    deferredResolved = true
    await pendingStart

    const sentMessages = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))

    assert.equal(recorder.getVoiceSession().status, 'cancelled')
    assert.equal(sentMessages.some((message) => message.type === 'start_audio'), false)
    assert.equal(env.invokeCalls.some((call) => call.channel === 'keyboard:type-transcript'), false)
  } finally {
    if (!deferredResolved) {
      deferred.resolve(env.mediaStream)
    }
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('cancelRecording 在 recording 态不会发送 end_audio，也不会自动粘贴', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('recording')
    assert.equal(typeof recorder.cancelRecording, 'function', 'cancelRecording 未导出')
    await recorder.startRecording('Dictate')

    recorder.cancelRecording()

    const sentMessages = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))

    assert.equal(recorder.getVoiceSession().status, 'cancelled')
    assert.equal(sentMessages.some((message) => message.type === 'end_audio'), false)
    assert.equal(env.invokeCalls.some((call) => call.channel === 'keyboard:type-transcript'), false)
    assert.equal(env.getRestoreCalls(), 1)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('cancelRecording 在 transcribing 态会忽略迟到完成消息且不会转成错误', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('transcribing')
    assert.equal(typeof recorder.cancelRecording, 'function', 'cancelRecording 未导出')
    await recorder.startRecording('Dictate')
    recorder.stopRecording()

    assert.equal(recorder.getVoiceSession().status, 'transcribing')

    const socket = env.sockets[env.sockets.length - 1]
    assert.ok(socket)

    recorder.cancelRecording()
    socket.emitJson({
      K: 'audio_processing_completed',
      V: {
        audio_id: 'audio-1',
        refined_text: 'should be ignored',
        refine_text: 'should be ignored',
      },
    })
    await Promise.resolve()

    assert.equal(recorder.getVoiceSession().status, 'cancelled')
    assert.equal(recorder.getVoiceSession().refinedText, '')
    assert.equal(recorder.getVoiceSession().error, null)
    assert.equal(env.invokeCalls.some((call) => call.channel === 'keyboard:type-transcript'), false)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('startRecording 会先通过新 IPC 检查 ready，并连接集中定义的 WebSocket 地址', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('ready-check')
    await recorder.startRecording('Dictate')

    const readyCheckIndex = env.invokeCalls.findIndex((call) => call.channel === 'audio:check-voice-server-ready')
    const settingsGetIndex = env.invokeCalls.findIndex((call) => call.channel === 'settings:get')
    const socket = env.sockets[0]

    assert.ok(socket)
    assert.notEqual(readyCheckIndex, -1)
    assert.notEqual(settingsGetIndex, -1)
    assert.ok(readyCheckIndex < settingsGetIndex)
    assert.match(socket.url, /\/ws\/rt_voice_flow\?v=[^&]+&t=[^&]+&m=0/)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('普通听写完成后仍自动粘贴最终结果', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('refine-completed')
    await recorder.startRecording('Dictate')
    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
    assert.ok(socket)

    socket.emitJson({
      K: 'refine_completed',
      V: {
        audio_id: 'audio-1',
        refined_text: 'hello refined',
        refine_text: 'hello refined',
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(recorder.getVoiceSession().status, 'completed')
    assert.equal(recorder.getVoiceSession().refinedText, 'hello refined')
    assert.equal(env.invokeCalls.some((call) => call.channel === 'keyboard:type-transcript'), true)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('自由提问完成后不自动粘贴，改为展示悬浮结果面板', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('ask-completed-panel')
    await recorder.startRecording('Ask')
    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
    assert.ok(socket)

    socket.emitJson({
      K: 'refine_completed',
      V: {
        audio_id: 'audio-1',
        refined_text: '1 加 1 等于 2。',
        refine_text: '1 加 1 等于 2。',
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    const resultPanelCall = env.sendCalls.find((call) => {
      const payload = call.payload as { type?: string } | undefined
      return call.channel === 'floating-panel' && payload?.type === 'free-ask-result'
    })

    assert.equal(recorder.getVoiceSession().status, 'completed')
    assert.equal(recorder.getVoiceSession().mode, 'Ask')
    assert.equal(env.invokeCalls.some((call) => call.channel === 'keyboard:type-transcript'), false)
    assert.deepEqual(resultPanelCall?.payload, {
      visible: true,
      type: 'free-ask-result',
      text: '1 加 1 等于 2。',
    })
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('开始新录音时会关闭旧悬浮结果面板', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('hide-panel-on-start')
    await recorder.startRecording('Ask')

    assert.deepEqual(env.sendCalls[0], {
      channel: 'floating-panel',
      payload: { visible: false },
    })
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('transcription_error 会映射为本地 asr_failed 错误', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('transcription-error')
    await recorder.startRecording('Dictate')
    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
    assert.ok(socket)

    socket.emitJson({
      K: 'transcription_error',
      V: {
        audio_id: 'audio-1',
        code: 'transcription_failed',
        detail: 'boom',
      },
    })
    await Promise.resolve()

    assert.equal(recorder.getVoiceSession().status, 'error')
    assert.equal(recorder.getVoiceSession().error?.code, 'asr_failed')
    assert.equal(recorder.getVoiceSession().error?.detail, 'boom')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})
