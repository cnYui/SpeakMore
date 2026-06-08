/**
 * 录音输入采集和发送
 *
 * 需要处理麦克风和流式 PCM16 音频 chunk 时看这里。
 */
import { getSelectedAudioDeviceId } from '../settingsStore'
import { createVoiceError } from './voiceTypes'

export type RecordingTransport = 'pcm16'
export type MeetingAudioSource = 'microphone' | 'system' | 'microphone_system'

export type AudioQualityHint = 'low_volume' | 'clipping' | 'likely_noisy' | 'mostly_silence'

export type AudioQualitySummary = {
  average_rms: number
  peak: number
  clipping_ratio: number
  speech_frame_ratio: number
  low_volume_ratio: number
  estimated_noise_floor: number
  hints: AudioQualityHint[]
}

export type AudioQualityTracker = {
  observe: (samples: Float32Array) => void
  summarize: () => AudioQualitySummary | null
}

export type AudioSender = {
  stop: () => void
  setPaused?: (paused: boolean) => void
}

export type Pcm16AudioSenderOptions = {
  onPcm16Chunk?: (chunk: ArrayBuffer) => void
}

const ACTIVE_CHANNEL_RATIO = 0.15
const MIN_GAIN_RMS = 0.003
const TARGET_SPEECH_RMS = 0.08
const MAX_SPEECH_GAIN = 8
const MAX_GAIN_PEAK = 0.95
const QUALITY_LOW_VOLUME_RMS = 0.018
const QUALITY_SPEECH_RMS = 0.025
const QUALITY_CLIPPING_SAMPLE = 0.98
const QUALITY_LIKELY_NOISE_FLOOR = 0.018
const MAX_SOCKET_BUFFERED_BYTES = 512 * 1024
const streamCleanupHandlers = new WeakMap<MediaStream, () => void>()

function createAudioConstraints(selectedAudioDeviceId: string, relaxed = false): MediaStreamConstraints {
  const deviceConstraint = selectedAudioDeviceId === 'default' ? {} : { deviceId: { exact: selectedAudioDeviceId } }
  if (relaxed) {
    return {
      audio: Object.keys(deviceConstraint).length ? deviceConstraint : true,
    }
  }

  return {
    audio: {
      ...deviceConstraint,
      // 耳机/蓝牙麦克风常见采样率较低；这些只能作为偏好，不能作为硬约束。
      sampleRate: { ideal: 16000 },
      channelCount: { ideal: 1 },
      // 带降噪/通透模式的耳机通常依赖浏览器或系统语音处理来稳定电平和底噪。
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
    },
  }
}

function isConstraintFailure(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError'
}

function isDeviceLookupFailure(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  return name === 'NotFoundError' || name === 'DevicesNotFoundError'
}

function isPermissionFailure(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  return name === 'NotAllowedError' || name === 'SecurityError'
}

function toMicrophoneUnavailable(error: unknown) {
  return createVoiceError('microphone_unavailable', String(error))
}

async function getAudioStreamWithConstraints(selectedAudioDeviceId: string, relaxed = false) {
  return navigator.mediaDevices.getUserMedia(createAudioConstraints(selectedAudioDeviceId, relaxed))
}

async function getDefaultAudioStreamOrThrow() {
  try {
    return await getAudioStreamWithConstraints('default', true)
  } catch (fallbackError) {
    if (isPermissionFailure(fallbackError)) {
      throw createVoiceError('microphone_permission_denied', String(fallbackError))
    }
    throw toMicrophoneUnavailable(fallbackError)
  }
}

export async function getAudioStreamForDevice(selectedAudioDeviceId: string) {
  try {
    // 浏览器音频增强对蓝牙/降噪耳机更稳定；采样率和声道只作为偏好。
    return await getAudioStreamWithConstraints(selectedAudioDeviceId)
  } catch (error) {
    if (isPermissionFailure(error)) {
      throw createVoiceError('microphone_permission_denied', String(error))
    }

    if (isConstraintFailure(error)) {
      try {
        return await getAudioStreamWithConstraints(selectedAudioDeviceId, true)
      } catch (fallbackError) {
        if (isPermissionFailure(fallbackError)) {
          throw createVoiceError('microphone_permission_denied', String(fallbackError))
        }
        if (selectedAudioDeviceId !== 'default') {
          return getDefaultAudioStreamOrThrow()
        }
        throw toMicrophoneUnavailable(fallbackError)
      }
    }

    if (selectedAudioDeviceId !== 'default' && isDeviceLookupFailure(error)) {
      return getDefaultAudioStreamOrThrow()
    }

    throw toMicrophoneUnavailable(error)
  }
}

export async function getAudioStream() {
  return getAudioStreamForDevice(await getSelectedAudioDeviceId())
}

async function getSystemAudioStream() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw createVoiceError('microphone_unavailable', '系统音频采集不可用')
  }

  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    })
  } catch (error) {
    if (isPermissionFailure(error)) {
      throw createVoiceError('microphone_permission_denied', String(error))
    }
    throw createVoiceError('microphone_unavailable', String(error))
  }

  if (!stream.getAudioTracks().length) {
    stopStreamTracks(stream)
    throw createVoiceError('microphone_unavailable', '没有捕获到系统音频')
  }
  stream.getVideoTracks().forEach((track) => track.stop())
  return stream
}

async function mixAudioStreams(streams: MediaStream[]) {
  const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) {
    streams.forEach(stopStreamTracks)
    throw createVoiceError('microphone_unavailable', '当前环境不支持音频混音')
  }

  const audioContext = new AudioContextConstructor()
  const destination = audioContext.createMediaStreamDestination()
  const compressor = audioContext.createDynamicsCompressor()
  compressor.threshold.value = -18
  compressor.knee.value = 18
  compressor.ratio.value = 3
  compressor.attack.value = 0.003
  compressor.release.value = 0.18
  compressor.connect(destination)
  const nodes: Array<MediaStreamAudioSourceNode | GainNode | BiquadFilterNode | DynamicsCompressorNode> = [compressor]
  streams.forEach((stream, index) => {
    const source = audioContext.createMediaStreamSource(stream)
    const highpass = audioContext.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = index === 0 && streams.length > 1 ? 80 : 40
    const gain = audioContext.createGain()
    gain.gain.value = streams.length > 1 && index > 0 ? 0.62 : 1
    source.connect(highpass)
    highpass.connect(gain)
    gain.connect(compressor)
    nodes.push(source, highpass, gain)
  })
  const mixedStream = destination.stream
  streamCleanupHandlers.set(mixedStream, () => {
    nodes.forEach((node) => node.disconnect())
    streams.forEach(stopStreamTracks)
    void audioContext.close().catch(() => undefined)
  })
  await audioContext.resume().catch(() => undefined)
  return mixedStream
}

export async function getMeetingAudioStream(audioSource: MeetingAudioSource = 'microphone') {
  if (audioSource === 'system') return getSystemAudioStream()
  if (audioSource === 'microphone_system') {
    const micStream = await getAudioStream()
    try {
      const systemStream = await getSystemAudioStream()
      return mixAudioStreams([micStream, systemStream])
    } catch (error) {
      stopStreamTracks(micStream)
      throw error
    }
  }
  return getAudioStream()
}

export function stopStreamTracks(stream: MediaStream | null) {
  // stop track 才会真正释放浏览器侧麦克风占用。
  if (!stream) return
  const cleanup = streamCleanupHandlers.get(stream)
  if (cleanup) {
    streamCleanupHandlers.delete(stream)
    cleanup()
  }
  stream.getTracks().forEach((track) => track.stop())
}

export function resampleToSampleRate(input: Float32Array, inputSampleRate: number, targetSampleRate: number) {
  const sourceRate = Number(inputSampleRate)
  const outputRate = Number(targetSampleRate)
  if (!input.length || !Number.isFinite(sourceRate) || !Number.isFinite(outputRate) || sourceRate <= 0 || outputRate <= 0) {
    return input
  }
  if (sourceRate === outputRate) return input

  // 流式模型固定吃 16k 单声道 PCM。蓝牙耳机麦克风可能只有 8k，也必须升采样到 16k。
  const ratio = sourceRate / outputRate
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(outputLength)
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio
    const leftIndex = Math.floor(sourceIndex)
    const rightIndex = Math.min(input.length - 1, leftIndex + 1)
    const weight = sourceIndex - leftIndex
    const left = input[leftIndex] ?? 0
    const right = input[rightIndex] ?? left
    output[index] = left + (right - left) * weight
  }
  return output
}

export const downsampleToSampleRate = resampleToSampleRate

export function encodePcm16(samples: Float32Array) {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    // PCM16 只能表达 [-1, 1] 范围内的采样，编码前必须裁剪避免溢出。
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    pcm[index] = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)))
  }
  return pcm
}

export function createPcm16Chunk(samples: Float32Array, inputSampleRate: number) {
  const downsampled = resampleToSampleRate(samples, inputSampleRate, 16000)
  if (!downsampled.length) return null

  const pcm = encodePcm16(downsampled)
  return pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
}

export function encodeWavFromPcm16Chunks(chunks: ArrayBuffer[], sampleRate = 16000, channels = 1) {
  const bytesPerSample = 2
  const dataLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index))
      offset += 1
    }
  }

  writeString('RIFF')
  view.setUint32(offset, 36 + dataLength, true); offset += 4
  writeString('WAVE')
  writeString('fmt ')
  view.setUint32(offset, 16, true); offset += 4
  view.setUint16(offset, 1, true); offset += 2
  view.setUint16(offset, channels, true); offset += 2
  view.setUint32(offset, sampleRate, true); offset += 4
  view.setUint32(offset, sampleRate * channels * bytesPerSample, true); offset += 4
  view.setUint16(offset, channels * bytesPerSample, true); offset += 2
  view.setUint16(offset, bytesPerSample * 8, true); offset += 2
  writeString('data')
  view.setUint32(offset, dataLength, true); offset += 4

  for (const chunk of chunks) {
    bytes.set(new Uint8Array(chunk), offset)
    offset += chunk.byteLength
  }

  return buffer
}

function calculateRms(samples: Float32Array) {
  if (!samples.length) return 0
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length)
}

function calculatePeak(samples: Float32Array) {
  let peak = 0
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0))
  }
  return peak
}

function calculateClippingSamples(samples: Float32Array) {
  let clippingSamples = 0
  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index] ?? 0) >= QUALITY_CLIPPING_SAMPLE) clippingSamples += 1
  }
  return clippingSamples
}

function roundQualityMetric(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Number(Math.min(1, value).toFixed(4))
}

function estimateNoiseFloor(rmsFrames: number[]) {
  if (!rmsFrames.length) return 0
  const sorted = [...rmsFrames].sort((left, right) => left - right)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.2)))
  return sorted[index] ?? 0
}

export function createAudioQualityTracker(): AudioQualityTracker {
  let frameCount = 0
  let sampleCount = 0
  let rmsSum = 0
  let peak = 0
  let clippingSamples = 0
  let lowVolumeFrames = 0
  let speechFrames = 0
  const rmsFrames: number[] = []

  return {
    observe: (samples) => {
      if (!samples.length) return

      const rms = calculateRms(samples)
      frameCount += 1
      sampleCount += samples.length
      rmsSum += rms
      rmsFrames.push(rms)
      peak = Math.max(peak, calculatePeak(samples))
      clippingSamples += calculateClippingSamples(samples)
      if (rms < QUALITY_LOW_VOLUME_RMS) lowVolumeFrames += 1
      if (rms >= QUALITY_SPEECH_RMS) speechFrames += 1
    },
    summarize: () => {
      if (!frameCount || !sampleCount) return null

      const averageRms = rmsSum / frameCount
      const clippingRatio = clippingSamples / sampleCount
      const speechFrameRatio = speechFrames / frameCount
      const lowVolumeRatio = lowVolumeFrames / frameCount
      const noiseFloor = estimateNoiseFloor(rmsFrames)
      const hints: AudioQualityHint[] = []

      if (averageRms < QUALITY_SPEECH_RMS && peak < 0.35) hints.push('low_volume')
      if (clippingRatio >= 0.01 || peak >= 0.995) hints.push('clipping')
      if (speechFrameRatio < 0.08 && lowVolumeRatio > 0.6) hints.push('mostly_silence')
      if (noiseFloor >= QUALITY_LIKELY_NOISE_FLOOR && (peak - noiseFloor < 0.12 || speechFrameRatio < 0.35)) {
        hints.push('likely_noisy')
      }

      return {
        average_rms: roundQualityMetric(averageRms),
        peak: roundQualityMetric(peak),
        clipping_ratio: roundQualityMetric(clippingRatio),
        speech_frame_ratio: roundQualityMetric(speechFrameRatio),
        low_volume_ratio: roundQualityMetric(lowVolumeRatio),
        estimated_noise_floor: roundQualityMetric(noiseFloor),
        hints,
      }
    },
  }
}

function removeDcOffset(samples: Float32Array) {
  if (!samples.length) return samples

  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] ?? 0
  }

  const offset = sum / samples.length
  if (Math.abs(offset) < 0.000001) return samples

  const output = new Float32Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = (samples[index] ?? 0) - offset
  }
  return output
}

export function mixAudioBufferToMono(inputBuffer: AudioBuffer) {
  const channelCount = Math.max(1, inputBuffer.numberOfChannels || 1)
  if (channelCount === 1) {
    return inputBuffer.getChannelData(0)
  }

  const channels: Float32Array[] = []
  const rmsValues: number[] = []
  let maxRms = 0
  for (let channel = 0; channel < channelCount; channel += 1) {
    const samples = inputBuffer.getChannelData(channel)
    const rms = calculateRms(samples)
    channels.push(samples)
    rmsValues.push(rms)
    maxRms = Math.max(maxRms, rms)
  }

  const activeChannels = maxRms > 0
    ? channels.filter((_, index) => (rmsValues[index] ?? 0) >= maxRms * ACTIVE_CHANNEL_RATIO)
    : channels
  const output = new Float32Array(inputBuffer.length)
  for (let index = 0; index < output.length; index += 1) {
    let sum = 0
    for (const channel of activeChannels) {
      sum += channel[index] ?? 0
    }
    output[index] = sum / Math.max(1, activeChannels.length)
  }
  return output
}

export function conditionAudioForAsr(samples: Float32Array) {
  const normalized = removeDcOffset(samples)
  const rms = calculateRms(normalized)
  if (rms < MIN_GAIN_RMS) return normalized

  const peak = calculatePeak(normalized)
  if (peak <= 0 || rms >= TARGET_SPEECH_RMS) return normalized

  const gain = Math.min(MAX_SPEECH_GAIN, TARGET_SPEECH_RMS / rms, MAX_GAIN_PEAK / peak)
  if (gain <= 1.01) return normalized

  const output = new Float32Array(normalized.length)
  for (let index = 0; index < normalized.length; index += 1) {
    output[index] = (normalized[index] ?? 0) * gain
  }
  return output
}

export function sendPcm16Chunk(socket: WebSocket, samples: Float32Array, inputSampleRate: number) {
  // PCM 发送路径只负责实时推 chunk，不缓存整段音频。
  if (socket.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount > MAX_SOCKET_BUFFERED_BYTES) return

  const buffer = createPcm16Chunk(samples, inputSampleRate)
  if (!buffer) return
  socket.send(buffer)
  return buffer
}

function createScriptProcessorPcm16AudioSender(
  stream: MediaStream,
  socket: WebSocket,
  qualityTracker?: AudioQualityTracker | null,
  options: Pcm16AudioSenderOptions = {},
): AudioSender {
  // 这个 sender 直接推 PCM16 chunk，避免浏览器容器格式影响后端 ASR 输入。
  const audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(stream)
  // ScriptProcessor 虽旧但这里足够小范围使用；保留双声道输入，避免部分耳机的人声落在非第 0 声道。
  const processor = audioContext.createScriptProcessor(4096, 2, 1)
  const inputSampleRate = audioContext.sampleRate || 16000
  let paused = false

  processor.onaudioprocess = (event) => {
    if (paused) {
      for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel += 1) {
        event.outputBuffer.getChannelData(channel).fill(0)
      }
      return
    }
    const mixed = mixAudioBufferToMono(event.inputBuffer)
    qualityTracker?.observe(mixed)
    const input = conditionAudioForAsr(mixed)
    const chunk = sendPcm16Chunk(socket, input, inputSampleRate)
    if (chunk) options.onPcm16Chunk?.(chunk)

    for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel += 1) {
      event.outputBuffer.getChannelData(channel).fill(0)
    }
  }

  source.connect(processor)
  processor.connect(audioContext.destination)
  void audioContext.resume().catch(() => undefined)

  return {
    setPaused: (nextPaused) => {
      paused = nextPaused
    },
    stop: () => {
      processor.onaudioprocess = null
      processor.disconnect()
      source.disconnect()
      void audioContext.close().catch(() => undefined)
    },
  }
}

function createMeetingAudioWorkletModuleUrl() {
  const source = `
class SpeakMorePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.frameCount = 0;
    this.batchFrames = Math.max(256, Math.round(sampleRate * 0.04));
    this.paused = false;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'paused') this.paused = Boolean(event.data.value);
    };
  }
  process(inputs, outputs) {
    const output = outputs[0] || [];
    for (let channel = 0; channel < output.length; channel += 1) output[channel].fill(0);
    if (this.paused) return true;
    const input = inputs[0] || [];
    if (!input.length || !input[0]) return true;
    const length = input[0].length;
    for (let index = 0; index < length; index += 1) {
      let sum = 0;
      let active = 0;
      for (let channel = 0; channel < input.length; channel += 1) {
        const value = input[channel]?.[index] || 0;
        if (Math.abs(value) >= 0.00001) active += 1;
        sum += value;
      }
      this.buffer.push(active > 0 ? sum / Math.max(1, input.length) : 0);
      this.frameCount += 1;
      if (this.frameCount >= this.batchFrames) {
        const samples = new Float32Array(this.buffer);
        this.port.postMessage(samples, [samples.buffer]);
        this.buffer = [];
        this.frameCount = 0;
      }
    }
    return true;
  }
}
registerProcessor('speakmore-pcm-processor', SpeakMorePcmProcessor);
`
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
}

function createAudioWorkletPcm16AudioSender(
  stream: MediaStream,
  socket: WebSocket,
  qualityTracker?: AudioQualityTracker | null,
  options: Pcm16AudioSenderOptions = {},
): AudioSender {
  const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) {
    return createScriptProcessorPcm16AudioSender(stream, socket, qualityTracker, options)
  }

  const audioContext = new AudioContextConstructor()
  const inputSampleRate = audioContext.sampleRate || 16000
  let source: MediaStreamAudioSourceNode | null = null
  let node: AudioWorkletNode | null = null
  let fallbackSender: AudioSender | null = null
  let stopped = false
  let paused = false
  let moduleUrl = ''

  const setupFallback = () => {
    if (stopped || fallbackSender) return
    void audioContext.close().catch(() => undefined)
    fallbackSender = createScriptProcessorPcm16AudioSender(stream, socket, qualityTracker, options)
    fallbackSender.setPaused?.(paused)
  }

  const setup = async () => {
    if (!audioContext.audioWorklet) {
      setupFallback()
      return
    }
    moduleUrl = createMeetingAudioWorkletModuleUrl()
    await audioContext.audioWorklet.addModule(moduleUrl)
    if (stopped) return
    source = audioContext.createMediaStreamSource(stream)
    node = new AudioWorkletNode(audioContext, 'speakmore-pcm-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    node.port.onmessage = (event) => {
      if (stopped || paused) return
      const samples = event.data instanceof Float32Array ? event.data : null
      if (!samples || !samples.length) return
      qualityTracker?.observe(samples)
      const input = conditionAudioForAsr(samples)
      const chunk = sendPcm16Chunk(socket, input, inputSampleRate)
      if (chunk) options.onPcm16Chunk?.(chunk)
    }
    node.port.postMessage({ type: 'paused', value: paused })
    source.connect(node)
    node.connect(audioContext.destination)
    await audioContext.resume().catch(() => undefined)
  }

  void setup().catch(setupFallback).finally(() => {
    if (moduleUrl) URL.revokeObjectURL(moduleUrl)
  })

  return {
    setPaused: (nextPaused) => {
      paused = nextPaused
      node?.port.postMessage({ type: 'paused', value: nextPaused })
      fallbackSender?.setPaused?.(nextPaused)
    },
    stop: () => {
      stopped = true
      fallbackSender?.stop()
      fallbackSender = null
      node?.port.close()
      node?.disconnect()
      source?.disconnect()
      void audioContext.close().catch(() => undefined)
    },
  }
}

export function createPcm16AudioSender(
  stream: MediaStream,
  socket: WebSocket,
  qualityTracker?: AudioQualityTracker | null,
  options: Pcm16AudioSenderOptions = {},
): AudioSender {
  return createAudioWorkletPcm16AudioSender(stream, socket, qualityTracker, options)
}
