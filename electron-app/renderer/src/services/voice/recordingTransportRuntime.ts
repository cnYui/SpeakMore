/**
 * 录音传输运行时
 *
 * 需要管理 PCM16 sender、麦克风流和输入音量监控时看这里。
 */
import {
  createAudioQualityTracker,
  createPcm16AudioSender,
  encodeWavFromPcm16Chunks,
  stopStreamTracks,
  type AudioQualitySummary,
  type AudioQualityTracker,
  type AudioSender,
} from './audioCapture'
import { cleanupAudioLevelMonitoring, startAudioLevelMonitoring } from './audioLevelMonitor'
import type { PreparedRecordingStart } from './recordingStartup'

export type RecordingTransportRuntime = {
  attach: (
    prepared: PreparedRecordingStart,
    onInputLevel: (level: number) => void,
    onRecorderError: () => void,
  ) => void
  start: () => void
  getAudioQuality: () => AudioQualitySummary | null
  getRetryAudioWavBase64: () => string
  discardRetryAudio: () => void
  setPaused: (paused: boolean) => void
  stopSenders: () => void
  cleanup: () => void
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function createRecordingTransportRuntime(): RecordingTransportRuntime {
  let pcmAudioSender: AudioSender | null = null
  let activeStream: MediaStream | null = null
  let qualityTracker: AudioQualityTracker | null = null
  let resetInputLevel: (() => void) | null = null
  let retryPcm16Chunks: ArrayBuffer[] = []

  const stopSenders = () => {
    if (pcmAudioSender) {
      pcmAudioSender.stop()
      pcmAudioSender = null
    }
  }

  return {
    attach: (prepared, onInputLevel, _onRecorderError) => {
      const { socket, stream } = prepared
      activeStream = stream
      qualityTracker = createAudioQualityTracker()
      resetInputLevel = () => onInputLevel(0)
      startAudioLevelMonitoring(stream, onInputLevel)

      retryPcm16Chunks = []
      pcmAudioSender = createPcm16AudioSender(stream, socket, qualityTracker, {
        onPcm16Chunk: (chunk) => {
          retryPcm16Chunks.push(chunk.slice(0))
        },
      })
    },
    start: () => undefined,
    getAudioQuality: () => qualityTracker?.summarize() ?? null,
    getRetryAudioWavBase64: () => {
      if (!retryPcm16Chunks.length) return ''
      return arrayBufferToBase64(encodeWavFromPcm16Chunks(retryPcm16Chunks))
    },
    discardRetryAudio: () => {
      retryPcm16Chunks = []
    },
    setPaused: (paused) => {
      pcmAudioSender?.setPaused?.(paused)
    },
    stopSenders,
    cleanup: () => {
      // 录音清理只处理音频相关资源，WebSocket 是否关闭由调用路径决定。
      stopSenders()
      cleanupAudioLevelMonitoring()
      resetInputLevel?.()
      resetInputLevel = null
      qualityTracker = null
      stopStreamTracks(activeStream)
      activeStream = null
    },
  }
}
