import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  conditionAudioForAsr,
  createAudioQualityTracker,
  createPcm16Chunk,
  encodePcm16,
  encodeWavFromPcm16Chunks,
  getAudioStream,
  mixAudioBufferToMono,
  resampleToSampleRate,
  sendPcm16Chunk,
} from './audioCapture'

function createFakeAudioBuffer(channels: Float32Array[]): AudioBuffer {
  return {
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => channels[channel] ?? new Float32Array(0),
  } as AudioBuffer
}

test('encodePcm16 会裁剪并编码到 PCM16 范围', () => {
  const pcm = encodePcm16(Float32Array.from([-2, -1, -0.5, 0, 0.5, 1, 2]))

  assert.deepEqual(Array.from(pcm), [-32768, -32768, -16384, 0, 16384, 32767, 32767])
})

test('resampleToSampleRate 会按比例从高采样率降采样', () => {
  const input = Float32Array.from([0, 1, 2, 3, 4, 5])
  const downsampled = resampleToSampleRate(input, 48000, 16000)

  assert.deepEqual(Array.from(downsampled), [0, 3])
})

test('resampleToSampleRate 会把蓝牙耳机常见低采样率升到目标采样率', () => {
  const input = Float32Array.from([0.1, 0.2])
  const resampled = resampleToSampleRate(input, 8000, 16000)

  assert.notEqual(resampled, input)
  assert.deepEqual(Array.from(resampled), [0.1, 0.15, 0.2, 0.2].map((value) => Math.fround(value)))
})

test('sendPcm16Chunk 会把 8k 耳机输入转成协议要求的 16k PCM', () => {
  const sentPayloads: unknown[] = []
  const openSocket = {
    readyState: WebSocket.OPEN,
    send: (payload: unknown) => { sentPayloads.push(payload) },
  } as unknown as WebSocket

  sendPcm16Chunk(openSocket, Float32Array.from([0, 0.5]), 8000)

  assert.equal(sentPayloads.length, 1)
  assert.deepEqual(Array.from(new Int16Array(sentPayloads[0] as ArrayBuffer)), [0, 8192, 16384, 16384])
})

test('encodeWavFromPcm16Chunks 会把缓存的 PCM16 封装成 16k 单声道 WAV', () => {
  const chunk = createPcm16Chunk(Float32Array.from([0, 0.5, -0.5]), 16000)
  assert.ok(chunk)

  const wav = encodeWavFromPcm16Chunks([chunk])
  const bytes = new Uint8Array(wav)
  const view = new DataView(wav)

  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF')
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE')
  assert.equal(String.fromCharCode(...bytes.slice(36, 40)), 'data')
  assert.equal(view.getUint16(20, true), 1)
  assert.equal(view.getUint16(22, true), 1)
  assert.equal(view.getUint32(24, true), 16000)
  assert.equal(view.getUint16(34, true), 16)
  assert.equal(view.getUint32(40, true), chunk.byteLength)
  assert.deepEqual(Array.from(new Int16Array(wav, 44)), [0, 16384, -16384])
})

test('sendPcm16Chunk 只在 WebSocket OPEN 时发送 ArrayBuffer', () => {
  const sentPayloads: unknown[] = []
  const openSocket = {
    readyState: WebSocket.OPEN,
    send: (payload: unknown) => { sentPayloads.push(payload) },
  } as unknown as WebSocket
  const closedSocket = {
    readyState: WebSocket.CLOSED,
    send: (payload: unknown) => { sentPayloads.push(payload) },
  } as unknown as WebSocket

  sendPcm16Chunk(openSocket, Float32Array.from([0, 0.5, -0.5]), 16000)
  sendPcm16Chunk(closedSocket, Float32Array.from([1]), 16000)

  assert.equal(sentPayloads.length, 1)
  assert.ok(sentPayloads[0] instanceof ArrayBuffer)
  assert.deepEqual(Array.from(new Int16Array(sentPayloads[0] as ArrayBuffer)), [0, 16384, -16384])
})

test('mixAudioBufferToMono 会保留落在第二声道的耳机输入', () => {
  const inputBuffer = createFakeAudioBuffer([
    Float32Array.from([0, 0, 0]),
    Float32Array.from([0.4, -0.2, 0.1]),
  ])

  const mixed = mixAudioBufferToMono(inputBuffer)

  assert.deepEqual(Array.from(mixed), Array.from(Float32Array.from([0.4, -0.2, 0.1])))
})

test('mixAudioBufferToMono 会混合有效双声道输入', () => {
  const inputBuffer = createFakeAudioBuffer([
    Float32Array.from([0.2, 0.2, -0.4]),
    Float32Array.from([0.6, -0.2, 0.2]),
  ])

  const mixed = mixAudioBufferToMono(inputBuffer)

  assert.deepEqual(Array.from(mixed), Array.from(Float32Array.from([0.4, 0, -0.1])))
})

test('conditionAudioForAsr 会提升低电平耳机语音', () => {
  const input = Float32Array.from([0.01, -0.01, 0.012, -0.012])
  const conditioned = conditionAudioForAsr(input)

  assert.notEqual(conditioned, input)
  assert.ok(Math.max(...Array.from(conditioned).map(Math.abs)) > 0.05)
})

test('conditionAudioForAsr 不会放大接近静音的底噪', () => {
  const input = Float32Array.from([0.0002, -0.0002, 0.0001, -0.0001])
  const conditioned = conditionAudioForAsr(input)

  assert.deepEqual(Array.from(conditioned), Array.from(input))
})

test('conditionAudioForAsr 会清理耳机输入里的直流偏移', () => {
  const input = Float32Array.from([0.11, 0.09, 0.11, 0.09])
  const conditioned = conditionAudioForAsr(input)
  const average = Array.from(conditioned).reduce((sum, value) => sum + value, 0) / conditioned.length

  assert.ok(Math.abs(average) < 0.000001)
})

test('createAudioQualityTracker 会统计削波比例和 clipping 提示', () => {
  const tracker = createAudioQualityTracker()

  tracker.observe(Float32Array.from([1, -1, 0, 0]))
  const summary = tracker.summarize()

  assert.ok(summary)
  assert.equal(summary.peak, 1)
  assert.equal(summary.clipping_ratio, 0.5)
  assert.equal(summary.speech_frame_ratio, 1)
  assert.equal(summary.low_volume_ratio, 0)
  assert.ok(summary.hints.includes('clipping'))
})

test('createAudioQualityTracker 会识别低音量和大部分静音', () => {
  const tracker = createAudioQualityTracker()

  tracker.observe(Float32Array.from([0.001, -0.001, 0.001, -0.001]))
  const summary = tracker.summarize()

  assert.ok(summary)
  assert.equal(summary.low_volume_ratio, 1)
  assert.equal(summary.speech_frame_ratio, 0)
  assert.ok(summary.hints.includes('low_volume'))
  assert.ok(summary.hints.includes('mostly_silence'))
})

test('createAudioQualityTracker 会估算噪声底并生成 likely_noisy 提示', () => {
  const tracker = createAudioQualityTracker()

  tracker.observe(Float32Array.from([0.03, -0.03, 0.03, -0.03]))
  tracker.observe(Float32Array.from([0.032, -0.032, 0.032, -0.032]))
  const summary = tracker.summarize()

  assert.ok(summary)
  assert.equal(summary.estimated_noise_floor, 0.03)
  assert.ok(summary.hints.includes('likely_noisy'))
})

test('getAudioStream 在耳机不接受采样率约束时使用同一设备降级重试', async () => {
  const originalNavigator = globalThis.navigator
  const originalWindow = globalThis.window
  const calls: MediaStreamConstraints[] = []
  const stream = {} as MediaStream
  const overconstrained = new DOMException('sample rate unsupported', 'OverconstrainedError')

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      ipcRenderer: {
        invoke: async (channel: string) => {
          assert.equal(channel, 'settings:get')
          return { selectedAudioDeviceId: 'headset-device' }
        },
      },
    },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          calls.push(constraints)
          if (calls.length === 1) throw overconstrained
          return stream
        },
      },
    },
  })

  try {
    assert.equal(await getAudioStream(), stream)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0], {
      audio: {
        deviceId: { exact: 'headset-device' },
        sampleRate: { ideal: 16000 },
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
    })
    assert.deepEqual(calls[1], {
      audio: {
        deviceId: { exact: 'headset-device' },
      },
    })
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
})

test('getAudioStream 在选中耳机降级重试仍失效时回退到默认输入', async () => {
  const originalNavigator = globalThis.navigator
  const originalWindow = globalThis.window
  const calls: MediaStreamConstraints[] = []
  const stream = {} as MediaStream
  const overconstrained = new DOMException('sample rate unsupported', 'OverconstrainedError')
  const missingDevice = new DOMException('headset disconnected', 'NotFoundError')

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      ipcRenderer: {
        invoke: async (channel: string) => {
          assert.equal(channel, 'settings:get')
          return { selectedAudioDeviceId: 'headset-device' }
        },
      },
    },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          calls.push(constraints)
          if (calls.length === 1) throw overconstrained
          if (calls.length === 2) throw missingDevice
          return stream
        },
      },
    },
  })

  try {
    assert.equal(await getAudioStream(), stream)
    assert.equal(calls.length, 3)
    assert.deepEqual(calls[0], {
      audio: {
        deviceId: { exact: 'headset-device' },
        sampleRate: { ideal: 16000 },
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
    })
    assert.deepEqual(calls[1], {
      audio: {
        deviceId: { exact: 'headset-device' },
      },
    })
    assert.deepEqual(calls[2], {
      audio: true,
    })
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
})
