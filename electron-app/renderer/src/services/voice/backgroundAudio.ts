/**
 * 后台音频静音封装
 *
 * 需要检查录音期间 Windows 音频会话静音和恢复语义时看这里。
 */
import { ipcClient } from '../ipc'
import { loadSettings } from '../settingsStore'

let backgroundAudioRestorePending = false

export function resetBackgroundAudioRestoreState() {
  backgroundAudioRestorePending = false
}

export async function muteBackgroundAudio() {
  try {
    const settings = await loadSettings()
    if (!settings.muteBackgroundAudioDuringRecording) {
      backgroundAudioRestorePending = false
      return
    }

    const result = await ipcClient.invoke('audio:mute-background-sessions') as { success?: boolean }
    // 只在本轮确实静音成功时恢复，避免误改用户原本的音频会话状态。
    backgroundAudioRestorePending = Boolean(result?.success)
  } catch {
    backgroundAudioRestorePending = false
  }
}

export async function restoreBackgroundAudio() {
  if (!backgroundAudioRestorePending) return

  try {
    await ipcClient.invoke('audio:restore-background-sessions')
  } finally {
    backgroundAudioRestorePending = false
  }
}
