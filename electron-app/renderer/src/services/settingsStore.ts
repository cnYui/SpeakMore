const SETTINGS_KEY = 'typeless-local-settings'

export type LocalSettings = {
  enableSoundEffects: boolean
  showFloatingBar: boolean
  launchAtSystemStartup: boolean
}

export const defaultSettings: LocalSettings = {
  enableSoundEffects: true,
  showFloatingBar: true,
  launchAtSystemStartup: false,
}

export function loadSettings(): LocalSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: LocalSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  return settings
}
