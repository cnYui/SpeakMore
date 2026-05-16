import { ipcClient } from './ipc'

export type TranslationTargetLanguage = 'en'

export type LocalSettings = {
  preferredLanguage: 'zh-CN'
  translationTargetLanguage: TranslationTargetLanguage
  launchAtSystemStartup: boolean
  selectedAudioDeviceId: string
}

export const defaultSettings: LocalSettings = {
  preferredLanguage: 'zh-CN',
  translationTargetLanguage: 'en',
  launchAtSystemStartup: false,
  selectedAudioDeviceId: 'default',
}

function normalizeTranslationTargetLanguage(value: unknown): TranslationTargetLanguage {
  return value === 'en' ? 'en' : defaultSettings.translationTargetLanguage
}

function normalizeSettings(settings?: Partial<LocalSettings> | null): LocalSettings {
  return {
    ...defaultSettings,
    preferredLanguage: 'zh-CN',
    translationTargetLanguage: normalizeTranslationTargetLanguage(settings?.translationTargetLanguage),
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

export async function getTranslationTargetLanguage(): Promise<TranslationTargetLanguage> {
  const settings = await loadSettings()
  return settings.translationTargetLanguage
}
