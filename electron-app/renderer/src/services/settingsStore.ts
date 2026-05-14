import { ipcClient } from './ipc'

export type LocalSettings = {
  preferredLanguage: 'zh-CN'
  launchAtSystemStartup: boolean
  selectedAudioDeviceId: string
}

export const defaultSettings: LocalSettings = {
  preferredLanguage: 'zh-CN',
  launchAtSystemStartup: false,
  selectedAudioDeviceId: 'default',
}

function normalizeSettings(settings?: Partial<LocalSettings> | null): LocalSettings {
  return {
    ...defaultSettings,
    preferredLanguage: 'zh-CN',
    launchAtSystemStartup: Boolean(settings?.launchAtSystemStartup),
    selectedAudioDeviceId: settings?.selectedAudioDeviceId || 'default',
  }
}

export async function loadSettings(): Promise<LocalSettings> {
  try {
    return normalizeSettings(await ipcClient.invoke<LocalSettings>('settings:get'))
  } catch {
    return defaultSettings
  }
}

export async function saveSettings(settings: LocalSettings): Promise<LocalSettings> {
  try {
    return normalizeSettings(await ipcClient.invoke<LocalSettings>('settings:update', settings))
  } catch {
    return normalizeSettings(settings)
  }
}

export async function getSelectedAudioDeviceId(): Promise<string> {
  const settings = await loadSettings()
  return settings.selectedAudioDeviceId
}
