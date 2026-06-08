/**
 * 设置页状态
 *
 * 需要加载本地设置、枚举麦克风或保存大模型配置时看这里。
 */
import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import {
  defaultSettings,
  loadSettings,
  reloadLlmBackendConfig,
  saveSettings,
  subscribeSettingsChanges,
  updateAutoLaunchPreference,
  type LlmProvider,
  type LocalSettings,
} from '../../services/settingsStore'

export type AudioDevice = { deviceId: string; label?: string }

function toAudioInputDevices(devices: MediaDeviceInfo[]): AudioDevice[] {
  return devices
    .filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default')
    .map((device) => ({ deviceId: device.deviceId, label: device.label }))
}

export function useSettingsPageState() {
  const [settings, setSettings] = useState<LocalSettings>(defaultSettings)
  const [llmDraft, setLlmDraft] = useState<LocalSettings['llm']>(defaultSettings.llm)
  const [isLlmEditing, setIsLlmEditing] = useState(false)
  const [isSavingLlm, setIsSavingLlm] = useState(false)
  const [llmSaveMessage, setLlmSaveMessage] = useState('')
  const [settingsSaveMessage, setSettingsSaveMessage] = useState('')
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const settingsUpdateSeq = useRef(0)
  const settingsRef = useRef(defaultSettings)
  const isLlmEditingRef = useRef(false)

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([])
      return
    }

    try {
      setDevices(toAudioInputDevices(await navigator.mediaDevices.enumerateDevices()))
    } catch {
      setDevices([])
    }
  }, [])

  useEffect(() => {
    isLlmEditingRef.current = isLlmEditing
  }, [isLlmEditing])

  useEffect(() => subscribeSettingsChanges((nextSettings) => {
    settingsRef.current = nextSettings
    setSettings(nextSettings)
    if (!isLlmEditingRef.current) setLlmDraft(nextSettings.llm)
  }), [])

  useEffect(() => {
    let cancelled = false

    loadSettings()
      .then((loadedSettings) => {
        if (cancelled) return
        settingsRef.current = loadedSettings
        setSettings(loadedSettings)
        setLlmDraft(loadedSettings.llm)
      })
      .catch(() => undefined)

    refreshDevices().catch(() => {
      if (!cancelled) setDevices([])
    })

    return () => {
      cancelled = true
    }
  }, [refreshDevices])

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return undefined
    const handleDeviceChange = () => {
      void refreshDevices()
    }
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', handleDeviceChange)
  }, [refreshDevices])

  const updateSettings = useCallback(async (next: LocalSettings) => {
    const seq = settingsUpdateSeq.current + 1
    settingsUpdateSeq.current = seq
    const previous = settingsRef.current
    settingsRef.current = next
    setSettings(next)
    setSettingsSaveMessage('')

    if (next.launchAtSystemStartup !== previous.launchAtSystemStartup) {
      const autoLaunchResult = await updateAutoLaunchPreference(next.launchAtSystemStartup)
      if (!autoLaunchResult.success && !autoLaunchResult.skipped) {
        if (settingsUpdateSeq.current === seq) {
          settingsRef.current = previous
          setSettings(previous)
          setSettingsSaveMessage('settings.appBehavior.autoLaunchUpdateFailed')
        }
        return
      }
      if (autoLaunchResult.skipped && settingsUpdateSeq.current === seq) {
        setSettingsSaveMessage('settings.appBehavior.autoLaunchDevSkipped')
      }
    }

    const saved = await saveSettings(next)
    if (settingsUpdateSeq.current === seq) {
      settingsRef.current = saved
      setSettings(saved)
    }
  }, [])

  const llmView = useMemo(() => (
    isLlmEditing ? llmDraft : settings.llm
  ), [isLlmEditing, llmDraft, settings.llm])

  const currentProvider = useMemo(() => (
    llmView.providers.find((provider) => provider.id === llmView.providerId)
      ?? llmView.providers[0]
  ), [llmView])

  const updateProvider = useCallback((providerId: string) => {
    setLlmDraft((currentDraft) => {
      if (!currentDraft.providers.some((provider) => provider.id === providerId)) return currentDraft
      return { ...currentDraft, providerId }
    })
  }, [])

  const updateCurrentProvider = useCallback((updater: (provider: LlmProvider) => LlmProvider) => {
    setLlmDraft((currentDraft) => {
      const providerId = currentDraft.providerId
      if (!currentDraft.providers.some((provider) => provider.id === providerId)) return currentDraft
      return {
        ...currentDraft,
        providers: currentDraft.providers.map((provider) => (
          provider.id === providerId ? updater(provider) : provider
        )),
      }
    })
  }, [])

  const updateCurrentApiKey = useCallback((apiKey: string) => {
    setLlmDraft((currentDraft) => ({
      ...currentDraft,
      apiKeys: currentDraft.providers.some((provider) => provider.id === currentDraft.providerId)
        ? { ...currentDraft.apiKeys, [currentDraft.providerId]: apiKey }
        : currentDraft.apiKeys,
    }))
  }, [])

  const updateCurrentModel = useCallback((model: string) => {
    setLlmDraft((currentDraft) => ({
      ...currentDraft,
      models: currentDraft.providers.some((provider) => provider.id === currentDraft.providerId)
        ? { ...currentDraft.models, [currentDraft.providerId]: model }
        : currentDraft.models,
    }))
  }, [])

  const beginLlmEdit = useCallback(() => {
    setLlmDraft(settingsRef.current.llm)
    setLlmSaveMessage('')
    setIsLlmEditing(true)
  }, [])

  const cancelLlmEdit = useCallback(() => {
    setLlmDraft(settingsRef.current.llm)
    setLlmSaveMessage('')
    setIsLlmEditing(false)
  }, [])

  const saveLlmSettings = useCallback(async () => {
    setIsSavingLlm(true)
    setLlmSaveMessage('')

    try {
      const saved = await saveSettings({ ...settingsRef.current, llm: llmDraft })
      settingsRef.current = saved
      setSettings(saved)
      setLlmDraft(saved.llm)

      const reloadResult = await reloadLlmBackendConfig()
      if (reloadResult.success) {
        setIsLlmEditing(false)
        setLlmSaveMessage('已保存')
        return
      }

      setLlmSaveMessage(`后端重载失败：${reloadResult.detail || reloadResult.code || '未知错误'}`)
    } finally {
      setIsSavingLlm(false)
    }
  }, [llmDraft])

  return {
    settings,
    llmDraft,
    llmView,
    currentProvider,
    isLlmEditing,
    isSavingLlm,
    llmSaveMessage,
    settingsSaveMessage,
    devices,
    refreshDevices,
    updateSettings,
    updateProvider,
    updateCurrentProvider,
    updateCurrentApiKey,
    updateCurrentModel,
    beginLlmEdit,
    cancelLlmEdit,
    saveLlmSettings,
  }
}
