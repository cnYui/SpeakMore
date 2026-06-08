/**
 * 交互提示音
 *
 * 需要播放录音开始/停止短提示音时看这里。
 */
import { loadSettings } from './settingsStore'

export type InteractionSoundKind = 'start' | 'stop'

const SOUND_CONFIG: Record<InteractionSoundKind, { frequency: number; duration: number }> = {
  start: { frequency: 880, duration: 0.12 },
  stop: { frequency: 520, duration: 0.1 },
}

export async function playInteractionSound(kind: InteractionSoundKind) {
  try {
    const settings = await loadSettings()
    if (!settings.interactionSoundsEnabled) return

    const AudioContextConstructor = globalThis.AudioContext
    if (!AudioContextConstructor) return

    const audioContext = new AudioContextConstructor()
    if (
      typeof audioContext.createOscillator !== 'function'
      || typeof audioContext.createGain !== 'function'
    ) {
      await audioContext.close().catch(() => undefined)
      return
    }

    const config = SOUND_CONFIG[kind]
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const now = audioContext.currentTime
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(config.frequency, now)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + config.duration)
    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.onended = () => {
      void audioContext.close().catch(() => undefined)
    }
    await audioContext.resume().catch(() => undefined)
    oscillator.start(now)
    oscillator.stop(now + config.duration)
  } catch {
    // 提示音是辅助反馈，失败不能影响录音。
  }
}
