import assert from 'node:assert/strict'
import { test } from 'node:test'

type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, ...payload: unknown[]) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => void
    off: (channel: string, listener: (...args: unknown[]) => void) => void
  }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

const testLlmConfig = {
  provider_id: 'deepseek',
  base_url: 'https://api.deepseek.com/v1',
  api_key: 'sk-deepseek',
  model: 'deepseek-chat',
  auth_type: 'bearer',
}

const pcm16AudioFormat = {
  type: 'pcm_s16le',
  sample_rate: 16000,
  channels: 1,
}

function withPcm16AudioFormat(parameters: Record<string, unknown>) {
  return {
    ...parameters,
    translation_engine_preference: 'auto',
    local_translation_model_enabled: true,
    meeting_realtime_asr_preference: 'auto',
    meeting_realtime_asr_model_enabled: true,
    audio_format: pcm16AudioFormat,
  }
}

function createSettingsWithEmptyApiKey(overrides: Record<string, unknown> = {}) {
  return {
    selectedAudioDeviceId: 'default',
    translationTargetLanguage: 'en',
    translationEnginePreference: 'auto',
    localTranslationModelEnabled: true,
    meetingRealtimeAsrPreference: 'auto',
    meetingRealtimeAsrModelEnabled: true,
    translationModelCacheDir: '',
    launchAtSystemStartup: false,
    llm: {
      providerId: 'deepseek',
      apiKeys: { deepseek: '' },
      models: { deepseek: testLlmConfig.model },
      providers: [{
        id: 'deepseek',
        label: 'DeepSeek',
        baseUrl: testLlmConfig.base_url,
        defaultModel: testLlmConfig.model,
        allowBaseUrlEdit: false,
        authType: 'bearer',
      }],
    },
    ...overrides,
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createTestEnvironment(options: {
  userMediaPromise?: Promise<MediaStream>
  readyPromise?: Promise<{ success?: boolean; detail?: string; status?: string; code?: string }>
  settingsPromise?: Promise<unknown>
  dictionaryTermsPromise?: Promise<unknown>
  selectedTextResult?: unknown
  selectionSnapshot?: unknown
  focusStillActive?: boolean
  fetchResponseText?: string
  pasteShouldFail?: boolean
  pasteResult?: unknown
  translationTargetLanguage?: string
  translationModelStatus?: unknown
  audioContextSampleRate?: number
} = {}) {
  const originalWindow = globalThis.window
  const originalNavigator = globalThis.navigator
  const originalCrypto = globalThis.crypto
  const originalWebSocket = globalThis.WebSocket
  const originalMediaRecorder = globalThis.MediaRecorder
  const originalAudioContext = globalThis.AudioContext
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const originalFetch = globalThis.fetch

  const sentPayloads: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = []
  const invokeCalls: Array<{ channel: string; payload?: unknown; payloads?: unknown[] }> = []
  const sendCalls: Array<{ channel: string; payload?: unknown }> = []
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
  const sockets: FakeWebSocket[] = []
  const intervalCallbacks = new Map<number, () => void>()
  const timeoutCallbacks = new Map<number, { callback: () => void; timeoutMs: number }>()
  const audioProcessNodes: FakeScriptProcessorNode[] = []
  const clearedIntervals: number[] = []
  const clearedTimeouts: number[] = []
  let restoreCalls = 0
  let trackStops = 0
  let userMediaCalls = 0
  let nextIntervalId = 1
  let nextTimeoutId = 1
  let analyserSample = 0.04

  const audioTrack = {
    enabled: true,
    muted: false,
    readyState: 'live',
    stop: () => { trackStops += 1 },
  }
  const mediaStream = {
    active: true,
    getTracks: () => [audioTrack],
    getAudioTracks: () => [audioTrack],
  } as unknown as MediaStream

  class FakeAnalyserNode {
    fftSize = 2048
    smoothingTimeConstant = 0

    getFloatTimeDomainData(target: Float32Array) {
      target.fill(analyserSample)
    }
  }

  class FakeMediaStreamAudioSourceNode {
    connect(_node: unknown) {}

    disconnect() {}
  }

  class FakeScriptProcessorNode {
    onaudioprocess: ((event: {
      inputBuffer: { getChannelData: (channel: number) => Float32Array }
      outputBuffer: { numberOfChannels: number; getChannelData: (channel: number) => Float32Array }
    }) => void) | null = null

    connect(_node: unknown) {}

    disconnect() {}

    emit(samples: Float32Array) {
      this.onaudioprocess?.({
        inputBuffer: {
          getChannelData: () => samples,
        },
        outputBuffer: {
          numberOfChannels: 1,
          getChannelData: () => new Float32Array(samples.length),
        },
      })
    }
  }

  class FakeAudioContext {
    sampleRate = options.audioContextSampleRate ?? 16000
    destination = {}

    createAnalyser() {
      return new FakeAnalyserNode()
    }

    createMediaStreamSource(_stream: MediaStream) {
      return new FakeMediaStreamAudioSourceNode()
    }

    createScriptProcessor() {
      const node = new FakeScriptProcessorNode()
      audioProcessNodes.push(node)
      return node
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
    invoke: async (channel: string, ...payloads: unknown[]) => {
      const payload = payloads[0]
      invokeCalls.push({ channel, payload, payloads })
      if (channel === 'audio:ensure-voice-server') return (options.readyPromise ?? Promise.resolve({ success: true })) as never
      if (channel === 'audio:check-voice-server-ready') return (options.readyPromise ?? Promise.resolve({ success: true })) as never
      if (channel === 'audio:mute-background-sessions') return { success: true } as never
      if (channel === 'audio:restore-background-sessions') {
        restoreCalls += 1
        return { success: true } as never
      }
      if (channel === 'focused-context:get-selected-text') {
        return (options.selectedTextResult ?? { success: false, text: '' }) as never
      }
      if (channel === 'focused-context:get-selection-snapshot') {
        const selectedText = (options.selectedTextResult as { text?: string } | undefined)?.text ?? ''
        const hasSelectedText = Boolean(selectedText)
        return (options.selectionSnapshot ?? {
          success: hasSelectedText,
          text: selectedText,
          source: hasSelectedText ? 'uia' : 'none',
          confidence: hasSelectedText ? 'confirmed' : 'none',
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
        }) as never
      }
      if (channel === 'focused-context:get-last-focused-info') {
        return {
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
            selected: false,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
          },
        } as never
      }
      if (channel === 'focused-context:is-current-focus') {
        return { success: true, same: options.focusStillActive !== false } as never
      }
      if (channel === 'settings:get') {
        const defaultSettings = {
          selectedAudioDeviceId: 'default',
          translationTargetLanguage: options.translationTargetLanguage ?? 'en',
          translationEnginePreference: 'auto',
          localTranslationModelEnabled: true,
          meetingRealtimeAsrPreference: 'auto',
          meetingRealtimeAsrModelEnabled: true,
          translationModelCacheDir: '',
          meetingLiveAudioSource: 'microphone',
          meetingLiveTargetLanguage: 'off',
          showFloatingBar: true,
          launchAtSystemStartup: false,
          llm: {
            providerId: 'deepseek',
            apiKeys: { deepseek: testLlmConfig.api_key },
            models: { deepseek: testLlmConfig.model },
            providers: [{
              id: 'deepseek',
              label: 'DeepSeek',
              baseUrl: testLlmConfig.base_url,
              defaultModel: testLlmConfig.model,
              allowBaseUrlEdit: false,
              authType: 'bearer',
            }],
          },
        }
        return (options.settingsPromise ?? Promise.resolve(defaultSettings)) as never
      }
      if (channel === 'translation-model:get-status') {
        return (options.translationModelStatus ?? {
          success: true,
          status: 'idle',
          detail: '',
          ready: false,
          cached: false,
        }) as never
      }
      if (channel === 'dictionary:prompt-terms') {
        return (options.dictionaryTermsPromise ?? Promise.resolve([])) as never
      }
      if (channel === 'keyboard:type-transcript') {
        if (options.pasteShouldFail) throw new Error('paste boom')
        if (options.pasteResult !== undefined) return options.pasteResult as never
        return { success: true } as never
      }
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
    value: {
      mediaDevices: {
        getUserMedia: () => {
          userMediaCalls += 1
          return userMediaPromise
        },
      },
    },
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
  Object.defineProperty(globalThis, 'setInterval', {
    configurable: true,
    value: (callback: () => void) => {
      const id = nextIntervalId
      nextIntervalId += 1
      intervalCallbacks.set(id, callback)
      return id
    },
  })
  Object.defineProperty(globalThis, 'clearInterval', {
    configurable: true,
    value: (id: number) => {
      clearedIntervals.push(id)
      intervalCallbacks.delete(id)
    },
  })
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value: (callback: () => void, timeoutMs = 0) => {
      if (timeoutMs <= 0) return originalSetTimeout(callback, timeoutMs)
      const id = nextTimeoutId
      nextTimeoutId += 1
      timeoutCallbacks.set(id, { callback, timeoutMs })
      return id
    },
  })
  Object.defineProperty(globalThis, 'clearTimeout', {
    configurable: true,
    value: (id: number | ReturnType<typeof setTimeout>) => {
      if (typeof id !== 'number') {
        originalClearTimeout(id)
        return
      }
      clearedTimeouts.push(id)
      timeoutCallbacks.delete(id)
    },
  })
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init })
      return {
        ok: true,
        json: async () => ({ status: 'OK', data: { refine_text: options.fetchResponseText ?? 'translated text' } }),
      } as Response
    },
  })

  return {
    mediaStream,
    sentPayloads,
    invokeCalls,
    sendCalls,
    fetchCalls,
    sockets,
    getRestoreCalls: () => restoreCalls,
    getTrackStops: () => trackStops,
    getUserMediaCalls: () => userMediaCalls,
    getClearedIntervals: () => clearedIntervals,
    getClearedTimeouts: () => clearedTimeouts,
    emitAudioProcess(samples: Float32Array) {
      const node = audioProcessNodes[audioProcessNodes.length - 1]
      assert.ok(node, '没有创建 PCM 采样节点')
      node.emit(samples)
    },
    runLevelTick(count = 1) {
      for (let index = 0; index < count; index += 1) {
        Array.from(intervalCallbacks.values()).forEach((callback) => callback())
      }
    },
    runTimeoutByDelay(timeoutMs: number) {
      const matchedTimers = Array.from(timeoutCallbacks.entries())
        .filter(([, timer]) => timer.timeoutMs === timeoutMs)
      matchedTimers.forEach(([id, timer]) => {
        timeoutCallbacks.delete(id)
        timer.callback()
      })
    },
    setAnalyserSample: (value: number) => { analyserSample = value },
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
      Object.defineProperty(globalThis, 'setInterval', {
        configurable: true,
        value: originalSetInterval,
      })
      Object.defineProperty(globalThis, 'clearInterval', {
        configurable: true,
        value: originalClearInterval,
      })
      Object.defineProperty(globalThis, 'setTimeout', {
        configurable: true,
        value: originalSetTimeout,
      })
      Object.defineProperty(globalThis, 'clearTimeout', {
        configurable: true,
        value: originalClearTimeout,
      })
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: originalFetch,
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
    const diagnosticSave = env.invokeCalls.find((call) => call.channel === 'voice-diagnostics:save')
    assert.ok(diagnosticSave)
    assert.equal((diagnosticSave.payload as { status?: string }).status, 'cancelled')
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

test('startRecording 会先通过新 IPC 确保 ready，并连接集中定义的 WebSocket 地址', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('ready-check')
    await recorder.startRecording('Dictate')

    const readyCheckIndex = env.invokeCalls.findIndex((call) => call.channel === 'audio:ensure-voice-server')
    const settingsGetIndex = env.invokeCalls.findIndex((call) => call.channel === 'settings:get')
    const socket = env.sockets[0]

    assert.ok(socket)
    assert.notEqual(readyCheckIndex, -1)
    assert.notEqual(settingsGetIndex, -1)
    assert.match(socket.url, /\/ws\/rt_voice_flow\?v=[^&]+&t=[^&]+&m=0/)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('未填写 DeepSeek API Key 时拦截录音启动且不打开麦克风', async () => {
  const env = createTestEnvironment({
    settingsPromise: Promise.resolve({
      selectedAudioDeviceId: 'default',
      translationTargetLanguage: 'en',
      launchAtSystemStartup: false,
      llm: {
        providerId: 'deepseek',
        apiKeys: { deepseek: '' },
        models: { deepseek: testLlmConfig.model },
        providers: [{
          id: 'deepseek',
          label: 'DeepSeek',
          baseUrl: testLlmConfig.base_url,
          defaultModel: testLlmConfig.model,
          allowBaseUrlEdit: false,
          authType: 'bearer',
        }],
      },
    }),
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('missing-api-key')
    await recorder.startRecording('Dictate')

    assert.equal(recorder.getVoiceSession().status, 'error')
    assert.equal(recorder.getVoiceSession().error?.code, 'llm_api_key_missing')
    assert.equal(recorder.getVoiceSession().error?.message, '还没有填写 DeepSeek API Key，请先到设置页填写后再使用。')
    assert.equal(env.getUserMediaCalls(), 0)
    assert.equal(env.sockets.length, 0)
    assert.equal(env.invokeCalls.some((call) => call.channel === 'audio:ensure-voice-server'), false)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('SenseVoiceSmall 模型启动时通过 WebSocket 发送 PCM16 音频块', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('streaming-pcm16')
    await recorder.startRecording('Dictate')
    env.emitAudioProcess(Float32Array.from([0, 0.5, -0.5, 1, -1]))

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')
    const pcmPayload = env.sentPayloads.find((payload): payload is ArrayBuffer => payload instanceof ArrayBuffer)

    assert.equal(env.invokeCalls.some((call) => call.channel === 'model:list'), false)
    assert.deepEqual(startAudioMessage.parameters, withPcm16AudioFormat({ llm: testLlmConfig }))
    assert.ok(pcmPayload)
    assert.deepEqual(Array.from(new Int16Array(pcmPayload)), [0, 16384, -16384, 32767, -32768])
    assert.equal(env.sentPayloads.some((payload) => payload instanceof Blob), false)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('setRecordingPaused 会暂停和恢复 PCM16 音频发送', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('pause-pcm16')
    await recorder.startRecording('Dictate')
    env.emitAudioProcess(Float32Array.from([0.5, -0.5]))
    const sentBeforePause = env.sentPayloads.filter((payload) => payload instanceof ArrayBuffer).length

    recorder.setRecordingPaused(true)
    env.emitAudioProcess(Float32Array.from([0.5, -0.5]))
    const sentWhilePaused = env.sentPayloads.filter((payload) => payload instanceof ArrayBuffer).length

    recorder.setRecordingPaused(false)
    env.emitAudioProcess(Float32Array.from([0.5, -0.5]))
    const sentAfterResume = env.sentPayloads.filter((payload) => payload instanceof ArrayBuffer).length

    assert.equal(sentBeforePause, 1)
    assert.equal(sentWhilePaused, 1)
    assert.equal(sentAfterResume, 2)
    assert.equal(recorder.getVoiceSession().paused, false)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation 会保存原文和译文成对实时段落', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-segments')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: '你好',
        text: 'Hello',
        target_language: 'en',
        chunk_index: 1,
        partial: true,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.sourceText, '你好')
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, 'Hello')
    assert.equal(session.meetingLiveSegments?.[0]?.targetLanguage, 'en')
    assert.equal(session.meetingLiveSegments?.[0]?.status, 'translated')
    assert.equal(session.meetingLiveSegments?.[0]?.normalizedSourceText, '你好')
    assert.equal(session.translationText, 'Hello')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_notes start and config messages include realtime commit and minutes profile', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-notes-internal-params')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: false,
    })

    const messages = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
    const startAudioMessage = messages.find((message) => message.type === 'start_audio')

    assert.deepEqual(startAudioMessage.parameters, withPcm16AudioFormat({
      llm: testLlmConfig,
      meeting_audio_source: 'microphone',
      meeting_translation_target_language: 'en',
      show_original: true,
      show_translation: false,
      meeting_module: 'new_note',
      meeting_realtime_commit_policy: 'sentence_or_phrase_group',
      meeting_realtime_profile: 'frontier_live_note',
      meeting_notes_quality_profile: 'frontier_minutes',
      meeting_notes_pipeline: 'extractive_then_synthesize',
      meeting_capture_profile: 'live_note',
      meeting_scenario_coverage: 'meeting,class,interview,customer_call,project_sync,training,retrospective,brainstorm,task_plan,field_notes',
      meeting_output_depth: 'comprehensive_minutes',
    }))

    recorder.updateMeetingNotesRecordingOptions({
      audioSource: 'microphone',
      targetLanguage: 'ja',
      showOriginal: false,
      showTranslation: true,
      module: 'new_note',
    })

    const configMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .findLast((message) => message.type === 'set_mode_config')

    assert.deepEqual(configMessage, {
      type: 'set_mode_config',
      mode: 'meeting_notes',
      parameters: {
        meeting_audio_source: 'microphone',
        meeting_translation_target_language: 'ja',
        show_original: false,
        show_translation: true,
        meeting_module: 'new_note',
        meeting_realtime_commit_policy: 'sentence_or_phrase_group',
        meeting_realtime_profile: 'frontier_live_note',
        meeting_notes_quality_profile: 'frontier_minutes',
        meeting_notes_pipeline: 'extractive_then_synthesize',
        meeting_capture_profile: 'live_note',
        meeting_scenario_coverage: 'meeting,class,interview,customer_call,project_sync,training,retrospective,brainstorm,task_plan,field_notes',
        meeting_output_depth: 'comprehensive_minutes',
      },
    })
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_notes live translation messages use live translation profile', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-notes-live-module-params')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
      module: 'live_translation',
    })

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.equal(startAudioMessage.parameters.meeting_module, 'live_translation')
    assert.equal(startAudioMessage.parameters.meeting_realtime_profile, 'frontier_simulst')
    assert.equal(startAudioMessage.parameters.meeting_capture_profile, 'live_translation')
    assert.equal(startAudioMessage.parameters.meeting_output_depth, 'bilingual_realtime_plus_final_minutes')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('stopRecording 会把音频质量摘要随 end_audio 发送给后端', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('audio-quality-summary')
    await recorder.startRecording('Dictate')
    env.emitAudioProcess(Float32Array.from([0.01, -0.01, 0.012, -0.012]))

    recorder.stopRecording()

    const endAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'end_audio')

    assert.ok(endAudioMessage)
    assert.equal(endAudioMessage.audio_id, 'audio-1')
    assert.equal(endAudioMessage.parameters.audio_quality.low_volume_ratio, 1)
    assert.equal(endAudioMessage.parameters.audio_quality.speech_frame_ratio, 0)
    assert.ok(endAudioMessage.parameters.audio_quality.hints.includes('low_volume'))
    assert.ok(endAudioMessage.parameters.audio_quality.hints.includes('mostly_silence'))
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('录音达到 50 秒时通过 voice-state 提示即将自动结束', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('recording-limit-warning')
    await recorder.startRecording('Dictate')

    env.runTimeoutByDelay(50000)

    const voiceStates = env.sendCalls
      .filter((call) => call.channel === 'voice-state')
    const latestVoiceState = voiceStates[voiceStates.length - 1]

    assert.equal(recorder.getVoiceSession().status, 'recording')
    assert.deepEqual(latestVoiceState?.payload, {
      visible: true,
      status: 'recording',
      mode: 'Dictate',
      inputLevel: 0,
      displayText: '录音将在 10 秒后自动结束',
      errorMessage: undefined,
    })
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('录音达到 60 秒时自动停止并发送 end_audio 进入转写', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('recording-limit-stop')
    await recorder.startRecording('Dictate')

    env.runTimeoutByDelay(60000)

    const messages = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))

    assert.equal(messages.some((message) => message.type === 'end_audio' && message.audio_id === 'audio-1'), true)
    assert.equal(recorder.getVoiceSession().status, 'transcribing')
    assert.equal(env.getTrackStops() > 0, true)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('会议笔记录音不会因为普通听写 60 秒上限自动结束', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-no-recording-limit-stop')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
    })

    env.runTimeoutByDelay(50000)
    env.runTimeoutByDelay(60000)

    const messages = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))

    assert.equal(messages.some((message) => message.type === 'end_audio' && message.audio_id === 'audio-1'), false)
    assert.equal(recorder.getVoiceSession().status, 'recording')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('startRecording 并行准备 ready 和麦克风，减少 connecting 串行等待', async () => {
  const ready = createDeferred<{ success?: boolean }>()
  const env = createTestEnvironment({ readyPromise: ready.promise })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('parallel-startup')
    const pendingStart = recorder.startRecording('Dictate')

    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(
      env.invokeCalls.some((call) => call.channel === 'audio:ensure-voice-server'),
      true,
    )
    assert.equal(env.sockets.length > 0, true)
    assert.equal(env.getUserMediaCalls() > 0, true)
    assert.equal(
      env.sentPayloads
        .filter((payload): payload is string => typeof payload === 'string')
        .map((payload) => JSON.parse(payload))
        .some((message) => message.type === 'start_audio'),
      false,
    )

    ready.resolve({ success: true })
    await pendingStart

    assert.equal(recorder.getVoiceSession().status, 'recording')
  } finally {
    ready.resolve({ success: true })
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('startRecording 并行准备参数和启动资源', async () => {
  const ready = createDeferred<{ success?: boolean }>()
  const dictionaryTerms = createDeferred<unknown>()
  const env = createTestEnvironment({
    readyPromise: ready.promise,
    dictionaryTermsPromise: dictionaryTerms.promise,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null
  let pendingStart: Promise<void> | null = null

  try {
    recorder = await loadRecorderModule('parallel-parameters')
    pendingStart = recorder.startRecording('Dictate')

    await new Promise((resolve) => setTimeout(resolve, 0))

    const dictionaryStartedBeforeReadyResolved = env.invokeCalls.some((call) => call.channel === 'dictionary:prompt-terms')
    const settingsGetCountBeforeReadyResolved = env.invokeCalls.filter((call) => call.channel === 'settings:get').length

    assert.equal(env.invokeCalls.some((call) => call.channel === 'audio:ensure-voice-server'), true)
    assert.equal(env.sockets.length > 0, true)
    assert.equal(env.getUserMediaCalls() > 0, true)
    assert.equal(dictionaryStartedBeforeReadyResolved, true)
    assert.equal(settingsGetCountBeforeReadyResolved >= 2, true)
    assert.equal(
      env.sentPayloads
        .filter((payload): payload is string => typeof payload === 'string')
        .map((payload) => JSON.parse(payload))
        .some((message) => message.type === 'start_audio'),
      false,
    )

    dictionaryTerms.resolve([])
    ready.resolve({ success: true })
    await pendingStart

    assert.equal(recorder.getVoiceSession().status, 'recording')
  } finally {
    dictionaryTerms.resolve([])
    ready.resolve({ success: true })
    await pendingStart?.catch(() => undefined)
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('start_audio 等 ready socket microphone 和参数都完成后才发送', async () => {
  const ready = createDeferred<{ success?: boolean }>()
  const dictionaryTerms = createDeferred<unknown>()
  const env = createTestEnvironment({
    readyPromise: ready.promise,
    dictionaryTermsPromise: dictionaryTerms.promise,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null
  let pendingStart: Promise<void> | null = null

  try {
    recorder = await loadRecorderModule('start-audio-after-all-prepared')
    pendingStart = recorder.startRecording('Dictate')

    await new Promise((resolve) => setTimeout(resolve, 0))

    let startAudioMessages = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .filter((message) => message.type === 'start_audio')
    assert.equal(startAudioMessages.length, 0)

    dictionaryTerms.resolve([{ phrase: 'Client2API', aliases: ['client to api'] }])
    await new Promise((resolve) => setTimeout(resolve, 0))

    startAudioMessages = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .filter((message) => message.type === 'start_audio')
    assert.equal(startAudioMessages.length, 0)

    ready.resolve({ success: true })
    await pendingStart

    startAudioMessages = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .filter((message) => message.type === 'start_audio')
    assert.equal(startAudioMessages.length, 1)
    assert.deepEqual(startAudioMessages[0].parameters.dictionary_terms, [{ phrase: 'Client2API', aliases: ['client to api'] }])
  } finally {
    dictionaryTerms.resolve([])
    ready.resolve({ success: true })
    await pendingStart?.catch(() => undefined)
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('ready 失败时不发送 start_audio，并清理已打开的麦克风', async () => {
  const env = createTestEnvironment({
    readyPromise: Promise.resolve({ success: false, detail: 'ASR 模型预热中' }),
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('ready-failed-cleanup')
    await recorder.startRecording('Dictate')

    const sentMessages = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))

    assert.equal(sentMessages.some((message) => message.type === 'start_audio'), false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(env.getTrackStops(), 1)
    assert.equal(env.sockets[0]?.readyState, 3)
    assert.equal(recorder.getVoiceSession().status, 'error')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('模型缺失时提示到设置页下载模型且不发送 start_audio', async () => {
  const env = createTestEnvironment({
    readyPromise: Promise.resolve({
      success: false,
      detail: '还没有下载语音模型，请到设置页下载模型。',
      code: 'voice_model_missing',
    }),
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('voice-model-missing')
    await recorder.startRecording('Dictate')

    const sentMessages = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))

    assert.equal(sentMessages.some((message) => message.type === 'start_audio'), false)
    assert.equal(recorder.getVoiceSession().status, 'error')
    assert.equal(recorder.getVoiceSession().error?.code, 'voice_model_missing')
    assert.equal(recorder.getVoiceSession().error?.message, '还没有下载语音模型，请到设置页下载模型。')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('录音期间通过 interval 采样同步非零 inputLevel，停止时清理定时器', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('level-interval')
    await recorder.startRecording('Dictate')
    env.runLevelTick(15)

    const voiceStates = env.sendCalls.filter((call) => call.channel === 'voice-state')
    const hasNonZeroInputLevel = voiceStates.some((call) => {
      const payload = call.payload as { inputLevel?: number }
      return typeof payload.inputLevel === 'number' && payload.inputLevel > 0
    })

    assert.equal(hasNonZeroInputLevel, true)
    assert.equal(env.sendCalls.some((call) => call.channel === 'voice-level-debug'), false)

    recorder.stopRecording()
    assert.equal(env.getClearedIntervals().length > 0, true)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('翻译模式启动时会把设置里的目标语言传给后端', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('translate-target-language')
    await recorder.startRecording('Translate')

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.deepEqual(startAudioMessage, {
      type: 'start_audio',
      audio_id: 'audio-1',
      mode: 'translation',
      audio_context: {},
      parameters: withPcm16AudioFormat({
        llm: testLlmConfig,
        output_language: 'en',
      }),
    })
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('翻译模式启动时会把日语目标语言传给后端', async () => {
  const env = createTestEnvironment({ translationTargetLanguage: 'ja' })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('translate-target-language-ja')
    await recorder.startRecording('Translate')

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.deepEqual(startAudioMessage.parameters, withPcm16AudioFormat({
      llm: testLlmConfig,
      output_language: 'ja',
    }))
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('启动录音时会把启用词典词条传给后端', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    const originalInvoke = window.ipcRenderer!.invoke
    window.ipcRenderer!.invoke = async <T = unknown>(channel: string, payload?: unknown): Promise<T> => {
      if (channel === 'dictionary:prompt-terms') {
        env.invokeCalls.push({ channel, payload })
        return [{ phrase: 'Client2API', aliases: ['client to api'] }] as T
      }
      return originalInvoke(channel, payload)
    }

    recorder = await loadRecorderModule('dictionary-terms')
    await recorder.startRecording('Dictate')

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.deepEqual(startAudioMessage.parameters, withPcm16AudioFormat({
      llm: testLlmConfig,
      dictionary_terms: [{ phrase: 'Client2API', aliases: ['client to api'] }],
    }))
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('RightAlt + RightShift 有选区时仍启动语音翻译并粘贴结果', async () => {
  const env = createTestEnvironment({
    selectedTextResult: { success: true, text: '你好' },
    fetchResponseText: 'hello',
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('translate-selected-text')
    await recorder.toggleRecordingByShortcut('TranslateShortcut')

    assert.equal(env.sockets.length, 1)
    assert.equal(env.getTrackStops(), 0)
    assert.equal(env.fetchCalls.length, 0)

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.equal(startAudioMessage.mode, 'translation')
    assert.deepEqual(startAudioMessage.parameters, withPcm16AudioFormat({
      llm: testLlmConfig,
      output_language: 'en',
    }))

    recorder.stopRecording()
    const socket = env.sockets[env.sockets.length - 1]
    socket.emitJson({
      K: 'refine_completed',
      V: {
        audio_id: 'audio-1',
        refined_text: 'hello from voice',
        refine_text: 'hello from voice',
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(recorder.getVoiceSession().status, 'completed')
    assert.equal(recorder.getVoiceSession().refinedText, 'hello from voice')
    assert.equal(env.invokeCalls.some((call) => call.channel === 'keyboard:type-transcript' && call.payload === 'hello from voice'), true)
    assert.deepEqual(
      env.invokeCalls.find((call) => call.channel === 'keyboard:type-transcript' && call.payload === 'hello from voice')?.payloads?.[1],
      {
        startFocusInfo: {
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
            selected: false,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
          },
        },
      },
    )
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('翻译模式无选区时保留语音翻译 WebSocket 流程', async () => {
  const env = createTestEnvironment({ selectedTextResult: { success: false, text: '' } })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('translate-without-selection')
    await recorder.startRecording('Translate')

    assert.equal(env.sockets.length, 1)
    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.deepEqual(startAudioMessage.parameters, withPcm16AudioFormat({
      llm: testLlmConfig,
      output_language: 'en',
    }))
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
    assert.deepEqual(
      env.invokeCalls.find((call) => call.channel === 'keyboard:type-transcript')?.payloads?.[1],
      {
        startFocusInfo: {
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
            selected: false,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
          },
        },
      },
    )
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

test('自由提问有选区时会把 selected_text 注入 start_audio.parameters', async () => {
  const env = createTestEnvironment({
    selectedTextResult: { success: true, text: '被选中的代码' },
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('ask-with-selection')
    await recorder.startRecording('Ask')

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.equal(env.sockets.length, 1)
    assert.deepEqual(startAudioMessage.parameters, withPcm16AudioFormat({
      llm: testLlmConfig,
      selected_text: '被选中的代码',
    }))
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('RightAlt 有 UIA 选区时通过快捷键意图仍保留普通听写录音', async () => {
  const env = createTestEnvironment({
    selectedTextResult: { success: true, text: '你好' },
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('shortcut-dictate-with-selection')
    assert.equal(typeof recorder.toggleRecordingByShortcut, 'function')

    await recorder.toggleRecordingByShortcut('DictateShortcut')
    await Promise.resolve()
    await Promise.resolve()

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.equal(env.sockets.length, 1)
    assert.equal(env.getTrackStops(), 0)
    assert.equal(env.fetchCalls.length, 0)
    assert.equal(startAudioMessage.mode, 'transcript')
    assert.deepEqual(startAudioMessage.parameters, withPcm16AudioFormat({ llm: testLlmConfig }))
    assert.equal(recorder.getVoiceSession().mode, 'Dictate')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('RightAlt 无选区时通过快捷键意图保留普通听写录音', async () => {
  const env = createTestEnvironment({
    selectedTextResult: { success: false, text: '' },
    selectionSnapshot: { success: false, text: '', focusInfo: null },
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('shortcut-dictate-without-selection')
    await recorder.toggleRecordingByShortcut('DictateShortcut')

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.equal(env.sockets.length, 1)
    assert.equal(startAudioMessage.mode, 'transcript')
    assert.deepEqual(startAudioMessage.parameters, withPcm16AudioFormat({ llm: testLlmConfig }))
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('RightAlt + Space 有 UIA 选区时传 selected_text 且结果展示悬浮卡片', async () => {
  const env = createTestEnvironment({
    selectedTextResult: { success: true, text: '旧内容' },
    focusStillActive: true,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('ask-selection-panel')
    await recorder.toggleRecordingByShortcut('AskShortcut')

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.deepEqual(startAudioMessage.parameters, withPcm16AudioFormat({
      llm: testLlmConfig,
      selected_text: '旧内容',
    }))

    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
    socket.emitJson({
      K: 'refine_completed',
      V: {
        audio_id: 'audio-1',
        refined_text: '新内容',
        refine_text: '新内容',
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const resultPanelCall = env.sendCalls.find((call) => {
      const payload = call.payload as { type?: string } | undefined
      return call.channel === 'floating-panel' && payload?.type === 'free-ask-result'
    })

    assert.equal(env.invokeCalls.some((call) => call.channel === 'keyboard:type-transcript'), false)
    assert.deepEqual(resultPanelCall?.payload, {
      visible: true,
      type: 'free-ask-result',
      text: '新内容',
    })
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('RightAlt + Space 有选区但目标失效时展示悬浮结果，不覆盖选区', async () => {
  const env = createTestEnvironment({
    selectedTextResult: { success: true, text: '旧内容' },
    focusStillActive: false,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('ask-selection-invalid')
    await recorder.toggleRecordingByShortcut('AskShortcut')
    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
    socket.emitJson({
      K: 'refine_completed',
      V: {
        audio_id: 'audio-1',
        refined_text: '新内容',
        refine_text: '新内容',
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const resultPanelCall = env.sendCalls.find((call) => {
      const payload = call.payload as { type?: string } | undefined
      return call.channel === 'floating-panel' && payload?.type === 'free-ask-result'
    })

    assert.equal(env.invokeCalls.some((call) => call.channel === 'keyboard:type-transcript'), false)
    assert.deepEqual(resultPanelCall?.payload, {
      visible: true,
      type: 'free-ask-result',
      text: '新内容',
    })
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('普通听写粘贴失败时展示悬浮卡片', async () => {
  const env = createTestEnvironment({ pasteShouldFail: true })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('dictate-paste-fallback')
    await recorder.startRecording('Dictate')
    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
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
    await new Promise((resolve) => setTimeout(resolve, 0))

    const resultPanelCall = env.sendCalls.find((call) => {
      const payload = call.payload as { type?: string } | undefined
      return call.channel === 'floating-panel' && payload?.type === 'free-ask-result'
    })

    assert.equal(recorder.getVoiceSession().status, 'completed')
    assert.deepEqual(resultPanelCall?.payload, {
      visible: true,
      type: 'free-ask-result',
      text: 'hello refined',
    })
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('普通听写无可粘贴目标时展示悬浮卡片', async () => {
  const env = createTestEnvironment({
    pasteResult: { success: false, reason: 'focused_text_target_unavailable' },
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('dictate-no-text-target-fallback')
    await recorder.startRecording('Dictate')
    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
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
    await new Promise((resolve) => setTimeout(resolve, 0))

    const resultPanelCall = env.sendCalls.find((call) => {
      const payload = call.payload as { type?: string } | undefined
      return call.channel === 'floating-panel' && payload?.type === 'free-ask-result'
    })

    assert.equal(recorder.getVoiceSession().status, 'completed')
    assert.deepEqual(resultPanelCall?.payload, {
      visible: true,
      type: 'free-ask-result',
      text: 'hello refined',
    })
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('RightAlt + RightShift 语音翻译粘贴失败时展示悬浮卡片', async () => {
  const env = createTestEnvironment({ pasteShouldFail: true })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('voice-translate-paste-fallback')
    await recorder.toggleRecordingByShortcut('TranslateShortcut')
    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
    socket.emitJson({
      K: 'refine_completed',
      V: {
        audio_id: 'audio-1',
        refined_text: 'translated voice',
        refine_text: 'translated voice',
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const resultPanelCall = env.sendCalls.find((call) => {
      const payload = call.payload as { type?: string } | undefined
      return call.channel === 'floating-panel' && payload?.type === 'free-ask-result'
    })

    assert.equal(recorder.getVoiceSession().status, 'completed')
    assert.deepEqual(resultPanelCall?.payload, {
      visible: true,
      type: 'free-ask-result',
      text: 'translated voice',
    })
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('RightAlt + RightShift 无可粘贴目标时展示悬浮卡片', async () => {
  const env = createTestEnvironment({
    pasteResult: { success: false, reason: 'focused_text_target_unavailable' },
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('voice-translate-no-text-target-fallback')
    await recorder.toggleRecordingByShortcut('TranslateShortcut')
    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
    socket.emitJson({
      K: 'refine_completed',
      V: {
        audio_id: 'audio-1',
        refined_text: 'translated voice',
        refine_text: 'translated voice',
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const resultPanelCall = env.sendCalls.find((call) => {
      const payload = call.payload as { type?: string } | undefined
      return call.channel === 'floating-panel' && payload?.type === 'free-ask-result'
    })

    assert.equal(recorder.getVoiceSession().status, 'completed')
    assert.deepEqual(resultPanelCall?.payload, {
      visible: true,
      type: 'free-ask-result',
      text: 'translated voice',
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

test('录音失败时会保留本轮 WAV 重试音频', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('retry-audio-on-error')
    await recorder.startRecording('Dictate')
    env.emitAudioProcess(Float32Array.from([0, 0.5, -0.5]))
    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
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
    assert.match(recorder.getVoiceSession().retryAudioWavBase64 || '', /^UklGR/)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('录音成功完成后会丢弃临时重试音频', async () => {
  const env = createTestEnvironment()
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('discard-retry-audio-on-success')
    await recorder.startRecording('Dictate')
    env.emitAudioProcess(Float32Array.from([0, 0.5, -0.5]))
    recorder.stopRecording()

    const socket = env.sockets[env.sockets.length - 1]
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
    assert.equal(recorder.getVoiceSession().retryAudioWavBase64, '')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_notes transcription keeps stable text and only replaces partial tail', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-transcript-stable-partial')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'off',
      showOriginal: true,
      showTranslation: false,
    })

    env.sockets[0]?.emitJson({
      K: 'transcription',
      V: {
        audio_id: 'audio-1',
        text: 'We need confirm',
        stable_text: 'We need',
        partial_text: 'confirm',
        stable: false,
        is_partial: true,
        revision_id: '1:partial:1',
        utterance_id: '1',
        asr_engine: 'sensevoice_endpoint',
      },
    })
    env.sockets[0]?.emitJson({
      K: 'transcription',
      V: {
        audio_id: 'audio-1',
        text: 'We need confirm budget',
        stable_text: 'We need',
        partial_text: 'confirm budget',
        stable: false,
        is_partial: true,
        revision_id: '1:partial:2',
        utterance_id: '1',
        asr_engine: 'sensevoice_endpoint',
      },
    })
    env.sockets[0]?.emitJson({
      K: 'transcription',
      V: {
        audio_id: 'audio-1',
        text: 'We',
        stable_text: 'We',
        partial_text: '',
        stable: true,
        is_partial: false,
        revision_id: '1:stable:3',
        utterance_id: '1',
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.stableTranscriptText, 'We need')
    assert.equal(session.partialTranscriptText, '')
    assert.equal(session.rawText, 'We need')
    assert.equal(session.transcriptRevisionId, '1:stable:3')
    assert.equal(session.transcriptUtteranceId, '1')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation preview and commit keep one sentence row with phase metadata', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-preview-commit-phase')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'zh',
      showOriginal: true,
      showTranslation: true,
      module: 'live_translation',
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation_pending',
      V: {
        audio_id: 'audio-1',
        source_text: 'Your time is limited',
        target_language: 'zh',
        chunk_index: 1,
        sentence_index: 1,
        sentence_id: 'audio-1:sentence:1',
        phase: 'preview',
        source_stable: false,
        provisional: true,
      },
    })
    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: 'Your time is limited',
        text: 'preview translation',
        target_language: 'zh',
        chunk_index: 1,
        sentence_index: 1,
        sentence_id: 'audio-1:sentence:1',
        phase: 'preview',
        source_stable: false,
        provisional: true,
        translation_engine: 'local_hy_mt',
        translation_latency_ms: 320,
        local_model_status: 'ready',
      },
    })
    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: 'Your time is limited.',
        text: 'committed translation',
        target_language: 'zh',
        chunk_index: 1,
        sentence_index: 1,
        sentence_id: 'audio-1:sentence:1',
        phase: 'commit',
        source_stable: true,
        committed: true,
        stable: true,
        translation_engine: 'llm',
        translation_latency_ms: 880,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.sourceText, 'Your time is limited.')
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, 'committed translation')
    assert.equal(session.meetingLiveSegments?.[0]?.phase, 'commit')
    assert.equal(session.meetingLiveSegments?.[0]?.sourceStable, true)
    assert.equal(session.meetingLiveSegments?.[0]?.translationEngine, 'llm')
    assert.equal(session.meetingLiveSegments?.[0]?.translationLatencyMs, 880)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation_pending 会先创建翻译中的实时段落', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-pending')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation_pending',
      V: {
        audio_id: 'audio-1',
        source_text: '你好',
        chunk_index: 1,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.sourceText, '你好')
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, '')
    assert.equal(session.meetingLiveSegments?.[0]?.status, 'pending')
    assert.equal(session.translationText, '')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation 会按 chunk_index 原地更新 pending 段落', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-pending-update')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation_pending',
      V: {
        audio_id: 'audio-1',
        source_text: '你好',
        chunk_index: 1,
      },
    })
    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: '你好',
        text: 'Hello',
        target_language: 'en',
        chunk_index: 1,
        partial: true,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.status, 'translated')
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, 'Hello')
    assert.equal(session.translationText, 'Hello')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation 会优先按 sentence_index 原地更新实时句子', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-sentence-index')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation_pending',
      V: {
        audio_id: 'audio-1',
        source_text: '今天开会。',
        chunk_index: 99,
        sentence_index: 1,
        committed: true,
      },
    })
    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: '今天开会。',
        text: 'We have a meeting today.',
        target_language: 'en',
        chunk_index: 99,
        sentence_index: 1,
        partial: true,
        committed: true,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.chunkIndex, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.sentenceIndex, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, 'We have a meeting today.')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation 会优先按 sentence_id 原地更新 pending 段落', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-sentence-id')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation_pending',
      V: {
        audio_id: 'audio-1',
        source_text: 'Your time is limited.',
        source_fingerprint: 'yourtimeislimited',
        target_language: 'en',
        chunk_index: 1,
        sentence_index: 1,
        sentence_id: 'audio-1:sentence:1',
        committed: true,
      },
    })
    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: 'Your time is limited.',
        source_fingerprint: 'yourtimeislimited',
        text: '你的时间有限。',
        target_language: 'zh',
        chunk_index: 1,
        sentence_index: 1,
        sentence_id: 'audio-1:sentence:1',
        partial: true,
        committed: true,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.sentenceId, 'audio-1:sentence:1')
    assert.equal(session.meetingLiveSegments?.[0]?.targetLanguage, 'zh')
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, '你的时间有限。')
    assert.equal(session.translationText, '你的时间有限。')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation 相同原文不会追加重复实时行', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-duplicate-source')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: '今天开会。',
        text: 'We have a meeting today.',
        target_language: 'en',
        chunk_index: 1,
        partial: true,
      },
    })
    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: '今天开会。',
        text: 'Today we are having a meeting.',
        target_language: 'en',
        chunk_index: 2,
        partial: true,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.chunkIndex, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, 'Today we are having a meeting.')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation 会清理实时原文和译文里的 emoji', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-strip-emoji')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: '你好🙂。',
        text: 'Hello 🙂',
        target_language: 'en',
        chunk_index: 1,
        partial: true,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.sourceText, '你好。')
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, 'Hello')
    assert.equal(session.translationText, 'Hello')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation preview does not overwrite committed translation', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-preview-does-not-overwrite-stable')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'zh',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: 'Your time is limited.',
        text: '你的时间有限。',
        target_language: 'zh',
        chunk_index: 1,
        sentence_index: 1,
        sentence_id: 'audio-1:sentence:1',
        committed: true,
        stable: true,
      },
    })
    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: 'Your time',
        text: '你的时间',
        target_language: 'zh',
        chunk_index: 1,
        sentence_index: 1,
        sentence_id: 'audio-1:sentence:1',
        committed: false,
        stable: false,
        provisional: true,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, '你的时间有限。')
    assert.equal(session.meetingLiveSegments?.[0]?.stable, true)
    assert.equal(session.meetingLiveSegments?.[0]?.isPreview, false)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation_pending keeps existing preview translation', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-pending-keeps-preview')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'zh',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: 'Your time',
        text: '你的时间',
        target_language: 'zh',
        chunk_index: 1,
        sentence_index: 1,
        sentence_id: 'audio-1:sentence:1',
        committed: false,
        stable: false,
        provisional: true,
      },
    })
    env.sockets[0]?.emitJson({
      K: 'meeting_translation_pending',
      V: {
        audio_id: 'audio-1',
        source_text: 'Your time is limited.',
        target_language: 'zh',
        chunk_index: 1,
        sentence_index: 1,
        sentence_id: 'audio-1:sentence:1',
        committed: true,
        stable: true,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.sourceText, 'Your time is limited.')
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, '你的时间')
    assert.equal(session.meetingLiveSegments?.[0]?.isPreview, true)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_translation replaces_chunk_index 不会追加重复行', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-replace-chunk')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation_pending',
      V: {
        audio_id: 'audio-1',
        source_text: '你好',
        chunk_index: 1,
      },
    })
    env.sockets[0]?.emitJson({
      K: 'meeting_translation_pending',
      V: {
        audio_id: 'audio-1',
        source_text: '你好你叫什么名字',
        chunk_index: 1,
        replaces_chunk_index: 1,
      },
    })
    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: '你好你叫什么名字',
        text: 'Hello, what is your name?',
        target_language: 'en',
        chunk_index: 1,
        replaces_chunk_index: 1,
        partial: true,
      },
    })

    const session = recorder.getVoiceSession()
    assert.equal(session.meetingLiveSegments?.length, 1)
    assert.equal(session.meetingLiveSegments?.[0]?.sourceText, '你好你叫什么名字')
    assert.equal(session.meetingLiveSegments?.[0]?.translationText, 'Hello, what is your name?')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('meeting_notes 完成后使用最终 payload 翻译并清空实时片段', async () => {
  const env = createTestEnvironment({
    audioContextSampleRate: 16000,
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('meeting-live-final-overrides')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
    })

    env.sockets[0]?.emitJson({
      K: 'meeting_translation',
      V: {
        audio_id: 'audio-1',
        source_text: 'noise',
        text: 'noisy realtime',
        target_language: 'en',
        chunk_index: 1,
        partial: true,
      },
    })
    recorder.stopRecording()
    env.sockets[0]?.emitJson({
      K: 'audio_processing_completed',
      V: {
        audio_id: 'audio-1',
        refined_text: 'final meeting notes',
        refine_text: 'final meeting notes',
        user_prompt: 'final transcript',
        translation_text: 'clean final translation',
        meeting_structured: {
          version: 1,
          scenario: 'project_sync',
          scenarios: ['project_sync'],
          contentLevel: 'short',
          summary: 'final meeting notes',
          topics: [],
          decisions: [],
          actionItems: [{ id: 'action-1', text: 'Alice sends report', source: 'action' }],
          scheduleItems: [],
          risks: [],
          questions: [],
          followUps: [],
          transcriptSegments: [{ index: 1, text: 'final transcript' }],
          source: 'recording',
        },
      },
    })
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const session = recorder.getVoiceSession()
    assert.equal(session.status, 'completed')
    assert.equal(session.refinedText, 'final meeting notes')
    assert.equal(session.translationText, 'clean final translation')
    assert.equal(session.meetingStructuredResult?.scenario, 'project_sync')
    assert.equal(session.meetingStructuredResult?.actionItems[0]?.text, 'Alice sends report')
    assert.equal(session.meetingLiveSegments?.length, 0)
    const diagnosticSave = env.invokeCalls.find((call) => call.channel === 'voice-diagnostics:save')
    assert.ok(diagnosticSave)
    const diagnosticText = JSON.stringify(diagnosticSave.payload)
    assert.equal((diagnosticSave.payload as { status?: string }).status, 'completed')
    assert.equal(diagnosticText.includes('final meeting notes'), false)
    assert.equal(diagnosticText.includes('final transcript'), false)
    assert.equal(diagnosticText.includes('clean final translation'), false)
    assert.match(diagnosticText, /first_translation/)
    assert.match(diagnosticText, /end_audio_sent/)
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('local translation model ready lets Translate start without an LLM API Key', async () => {
  const env = createTestEnvironment({
    settingsPromise: Promise.resolve(createSettingsWithEmptyApiKey()),
    translationModelStatus: {
      success: true,
      status: 'ready',
      ready: true,
      cached: true,
      detail: '',
    },
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('local-translation-without-api-key')
    await recorder.startRecording('Translate')

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.equal(recorder.getVoiceSession().status, 'recording')
    assert.equal(env.getUserMediaCalls() > 0, true)
    assert.equal(startAudioMessage.mode, 'translation')
    assert.equal(startAudioMessage.parameters.output_language, 'en')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})

test('local translation model ready lets meeting live translation start without an LLM API Key', async () => {
  const env = createTestEnvironment({
    settingsPromise: Promise.resolve(createSettingsWithEmptyApiKey()),
    translationModelStatus: {
      success: true,
      status: 'ready',
      ready: true,
      cached: true,
      detail: '',
    },
  })
  let recorder: Awaited<ReturnType<typeof loadRecorderModule>> | null = null

  try {
    recorder = await loadRecorderModule('local-meeting-live-translation-without-api-key')
    await recorder.toggleMeetingNotesRecording({
      audioSource: 'microphone',
      targetLanguage: 'en',
      showOriginal: true,
      showTranslation: true,
      module: 'live_translation',
    })

    const startAudioMessage = env.sentPayloads
      .filter((payload): payload is string => typeof payload === 'string')
      .map((payload) => JSON.parse(payload))
      .find((message) => message.type === 'start_audio')

    assert.equal(recorder.getVoiceSession().status, 'recording')
    assert.equal(env.getUserMediaCalls() > 0, true)
    assert.equal(startAudioMessage.mode, 'meeting_notes')
    assert.equal(startAudioMessage.parameters.meeting_module, 'live_translation')
    assert.equal(startAudioMessage.parameters.meeting_translation_target_language, 'en')
  } finally {
    recorder?.disposeRecorder()
    env.restore()
  }
})
