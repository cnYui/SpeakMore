import { ipcClient } from './ipc'

export type LocalSettings = {
  showFloatingBar: boolean
  launchAtSystemStartup: boolean
  selectedAudioDeviceId: string
}

export const defaultSettings: LocalSettings = {
  showFloatingBar: true,
  launchAtSystemStartup: false,
  selectedAudioDeviceId: 'default',
}

function normalizeSettings(settings?: Partial<LocalSettings> | null): LocalSettings {
  return {
    ...defaultSettings,
    ...settings,
    showFloatingBar: settings?.showFloatingBar !== false,
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
