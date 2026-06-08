import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { LlmProvider } from './settingsStore'
import sharedLlmProviders from '../../../../shared/llm-providers.json'
import sharedTranslationTargetLanguages from '../../../../shared/translation-target-languages.json'
import sharedMeetingLiveTargetLanguages from '../../../../shared/meeting-live-target-languages.json'
import sharedMeetingNoteTargetLanguages from '../../../../shared/meeting-note-target-languages.json'
import sharedInterfaceLanguages from '../../../../shared/interface-languages.json'

type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, ...payload: unknown[]) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => void
    off: (channel: string, listener: (...args: unknown[]) => void) => void
  }
}

const originalWindow = globalThis.window
const expectedInterfaceLanguageIds = [
  'en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'es-ES', 'pt-BR',
  'fr-FR', 'de-DE', 'it-IT', 'ru-RU', 'ar-SA', 'he-IL', 'hi-IN',
  'id-ID', 'ms-MY', 'nl-NL', 'pl-PL', 'th-TH',
]

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

async function loadSettingsStore(seed: string) {
  return import(new URL(`./settingsStore.ts?case=${seed}-${Date.now()}`, import.meta.url).href)
}

function installSettingsResponse(settings: unknown, calls: string[] = []) {
  const windowLike = globalThis as WindowWithIpc
  windowLike.ipcRenderer = {
    invoke: async (channel: string) => {
      calls.push(channel)
      if (channel === 'settings:reload-llm-backend') return { success: true } as never
      if (channel === 'settings:get') return settings as never
      if (channel === 'settings:update') return settings as never
      return {} as never
    },
    send: () => undefined,
    on: () => undefined,
    off: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowLike,
  })
}

test('loadSettings 会补齐默认大模型 provider 配置', async () => {
  installSettingsResponse({})
  const settingsStore = await loadSettingsStore('defaults')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.llm.providerId, 'deepseek')
  assert.equal(settings.llm.providers.some((provider: LlmProvider) => provider.id === 'deepseek'), true)
  assert.equal(settings.llm.providers.some((provider: LlmProvider) => provider.id === 'openai'), true)
  assert.equal(settings.llm.providers.some((provider: LlmProvider) => provider.id === 'anthropic'), true)
  assert.equal(settings.llm.providers.some((provider: LlmProvider) => provider.id === 'custom'), true)
  assert.equal(settings.llm.models.deepseek, 'deepseek-chat')
  assert.equal(settings.modelCacheDir, '')
  assert.equal(settings.asrDeviceMode, 'default')
  assert.equal(settings.interactionSoundsEnabled, true)
  assert.equal(settings.muteBackgroundAudioDuringRecording, true)
  assert.equal(settings.showActiveMicrophoneHint, true)
  assert.equal(settings.remindOnNewAudioDevice, true)
  assert.equal(settings.meetingDetectionEnabled, true)
  assert.equal(settings.meetingLiveAudioSource, 'microphone')
  assert.equal(settings.meetingLiveTargetLanguage, 'off')
  assert.equal(settings.meetingRealtimeAsrPreference, 'auto')
  assert.equal(settings.meetingRealtimeAsrModelEnabled, true)
  assert.equal(settings.translationEnginePreference, 'auto')
  assert.equal(settings.localTranslationModelEnabled, true)
  assert.equal(settings.translationModelCacheDir, '')
  assert.equal(settings.showFloatingBar, true)
  assert.equal(settings.hideMainWindowOnClose, true)
})

test('loadSettings 会保留音频和应用行为开关', async () => {
  installSettingsResponse({
    interactionSoundsEnabled: false,
    muteBackgroundAudioDuringRecording: false,
    showActiveMicrophoneHint: false,
    remindOnNewAudioDevice: false,
    meetingDetectionEnabled: false,
    meetingLiveAudioSource: 'microphone_system',
    meetingLiveTargetLanguage: 'ja',
    meetingRealtimeAsrPreference: 'streaming',
    meetingRealtimeAsrModelEnabled: false,
    translationEnginePreference: 'local',
    localTranslationModelEnabled: false,
    translationModelCacheDir: '  D:\\Models\\HyMT  ',
    showFloatingBar: false,
    hideMainWindowOnClose: false,
  })
  const settingsStore = await loadSettingsStore('audio-app-switches')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.interactionSoundsEnabled, false)
  assert.equal(settings.muteBackgroundAudioDuringRecording, false)
  assert.equal(settings.showActiveMicrophoneHint, false)
  assert.equal(settings.remindOnNewAudioDevice, false)
  assert.equal(settings.meetingDetectionEnabled, false)
  assert.equal(settings.meetingLiveAudioSource, 'microphone_system')
  assert.equal(settings.meetingLiveTargetLanguage, 'ja')
  assert.equal(settings.meetingRealtimeAsrPreference, 'streaming')
  assert.equal(settings.meetingRealtimeAsrModelEnabled, false)
  assert.equal(settings.translationEnginePreference, 'local')
  assert.equal(settings.localTranslationModelEnabled, false)
  assert.equal(settings.translationModelCacheDir, 'D:\\Models\\HyMT')
  assert.equal(settings.showFloatingBar, false)
  assert.equal(settings.hideMainWindowOnClose, false)
})

test('loadSettings 会保留用户选择的模型缓存目录', async () => {
  installSettingsResponse({ modelCacheDir: '  D:\\Models\\FunASR  ' })
  const settingsStore = await loadSettingsStore('model-cache-dir')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.modelCacheDir, 'D:\\Models\\FunASR')
})

test('loadSettings 会保留合法 ASR 运行设备并回退未知值', async () => {
  installSettingsResponse({ asrDeviceMode: 'mps' })
  const settingsStore = await loadSettingsStore('asr-device-mps')

  assert.equal((await settingsStore.loadSettings()).asrDeviceMode, 'mps')

  installSettingsResponse({ asrDeviceMode: 'cuda' })
  const cudaStore = await loadSettingsStore('asr-device-cuda')

  assert.equal((await cudaStore.loadSettings()).asrDeviceMode, 'cuda')

  installSettingsResponse({ asrDeviceMode: 'auto' })
  const fallbackStore = await loadSettingsStore('asr-device-fallback')

  assert.equal((await fallbackStore.loadSettings()).asrDeviceMode, 'default')
})

test('默认 LLM provider 元数据来自共享 JSON', async () => {
  installSettingsResponse({})
  const settingsStore = await loadSettingsStore('shared-llm-providers')

  assert.strictEqual(settingsStore.DEFAULT_LLM_PROVIDERS, sharedLlmProviders)

  const customProvider = settingsStore.DEFAULT_LLM_PROVIDERS.find((provider: LlmProvider) => provider.id === 'custom')
  assert.equal(customProvider?.allowBaseUrlEdit, true)
})

test('getCurrentLlmConfig 返回当前 provider 可直接传给后端的配置', async () => {
  installSettingsResponse({
    llm: {
      providerId: 'openai',
      apiKeys: { openai: 'sk-openai' },
      models: { openai: 'gpt-5.4' },
    },
  })
  const settingsStore = await loadSettingsStore('current-config')

  const config = await settingsStore.getCurrentLlmConfig()

  assert.deepEqual(config, {
    provider_id: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-openai',
    model: 'gpt-5.4',
    auth_type: 'bearer',
  })
})

test('getCurrentLlmConfig 支持 Custom provider 的 Base URL 和空 API Key', async () => {
  installSettingsResponse({
    llm: {
      providerId: 'custom',
      providers: [
        {
          id: 'custom',
          label: 'Custom',
          baseUrl: 'http://127.0.0.1:11434/v1',
          defaultModel: 'qwen3',
          allowBaseUrlEdit: true,
          authType: 'bearer',
        },
      ],
      apiKeys: { custom: '' },
      models: { custom: 'qwen3' },
    },
  })
  const settingsStore = await loadSettingsStore('custom-config')

  const config = await settingsStore.getCurrentLlmConfig()

  assert.deepEqual(config, {
    provider_id: 'custom',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: '',
    model: 'qwen3',
    auth_type: 'bearer',
  })
})

test('reloadLlmBackendConfig 通过主进程触发后端配置重载', async () => {
  const calls: string[] = []
  installSettingsResponse({}, calls)
  const settingsStore = await loadSettingsStore('reload-llm-backend')

  const result = await settingsStore.reloadLlmBackendConfig()

  assert.deepEqual(result, { success: true })
  assert.equal(calls.includes('settings:reload-llm-backend'), true)
})

test('翻译目标语言选项来自共享元数据', async () => {
  installSettingsResponse({})
  const settingsStore = await loadSettingsStore('translation-language-options')

  assert.deepEqual(
    settingsStore.TRANSLATION_TARGET_LANGUAGES.map((language: { id: string; label: string; displayName: string; secondaryLabel?: string }) => ({
      id: language.id,
      label: language.label,
      displayName: language.displayName,
      secondaryLabel: language.secondaryLabel,
    })),
    sharedTranslationTargetLanguages.map((language) => ({
      id: language.id,
      label: language.label,
      displayName: language.displayName,
      secondaryLabel: language.secondaryLabel,
    })),
  )
  assert.equal(
    settingsStore.TRANSLATION_TARGET_LANGUAGES.find((language: { id: string; secondaryLabel?: string }) => language.id === 'pt-BR')?.secondaryLabel,
    '葡萄牙语（巴西）',
  )
  assert.equal(settingsStore.TRANSLATION_TARGET_LANGUAGES.some((language: { id: string }) => language.id === 'yue'), false)
  assert.deepEqual(
    settingsStore.MEETING_LIVE_TARGET_LANGUAGES.map((language: { id: string; label: string }) => ({
      id: language.id,
      label: language.label,
    })),
    sharedMeetingLiveTargetLanguages.map((language) => ({
      id: language.id,
      label: language.label,
    })),
  )
  assert.deepEqual(
    settingsStore.MEETING_NOTE_TARGET_LANGUAGES.map((language: { id: string; label: string }) => ({
      id: language.id,
      label: language.label,
    })),
    sharedMeetingNoteTargetLanguages.map((language) => ({
      id: language.id,
      label: language.label,
    })),
  )
  assert.deepEqual(
    settingsStore.MEETING_NOTE_TARGET_LANGUAGES.map((language: { id: string }) => language.id),
    ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt'],
  )
  assert.deepEqual(
    settingsStore.MEETING_LIVE_TARGET_LANGUAGES.map((language: { id: string }) => language.id),
    ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de'],
  )
})

test('界面语言选项来自共享元数据', async () => {
  installSettingsResponse({})
  const settingsStore = await loadSettingsStore('interface-language-options')

  assert.deepEqual(
    settingsStore.INTERFACE_LANGUAGES.map((language: { id: string; labelKey: string }) => ({
      id: language.id,
      labelKey: language.labelKey,
    })),
    sharedInterfaceLanguages.map((language) => ({
      id: language.id,
      labelKey: language.labelKey,
    })),
  )
  assert.deepEqual(
    settingsStore.INTERFACE_LANGUAGES.map((language: { id: string }) => language.id),
    expectedInterfaceLanguageIds,
  )
  assert.equal(
    settingsStore.INTERFACE_LANGUAGES.every(
      (language: { id: string; labelKey: string }) => language.labelKey === `settings.interfaceLanguage.${language.id}`,
    ),
    true,
  )
})

test('loadSettings 会保留共享元数据中的新增翻译目标语言', async () => {
  installSettingsResponse({ translationTargetLanguage: 'pt-BR', meetingLiveTargetLanguage: 'ko' })
  const settingsStore = await loadSettingsStore('translation-language-extended')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.translationTargetLanguage, 'pt-BR')
  assert.equal(settings.meetingLiveTargetLanguage, 'ko')
})

test('loadSettings 遇到未知翻译目标语言会回退默认英文', async () => {
  installSettingsResponse({ translationTargetLanguage: 'xx' })
  const settingsStore = await loadSettingsStore('translation-language-unknown')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.translationTargetLanguage, 'en')
})

test('loadSettings normalizes local translation engine settings', async () => {
  installSettingsResponse({
    translationEnginePreference: 'bad',
    meetingRealtimeAsrPreference: 'bad',
    meetingRealtimeAsrModelEnabled: 0,
    localTranslationModelEnabled: 0,
    translationModelCacheDir: '  E:\\HyMT  ',
  })
  const settingsStore = await loadSettingsStore('local-translation-settings')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.translationEnginePreference, 'auto')
  assert.equal(settings.meetingRealtimeAsrPreference, 'auto')
  assert.equal(settings.meetingRealtimeAsrModelEnabled, false)
  assert.equal(settings.localTranslationModelEnabled, false)
  assert.equal(settings.translationModelCacheDir, 'E:\\HyMT')
})

test('loadSettings 会保留截图中的界面语言', async () => {
  installSettingsResponse({ preferredLanguage: 'ja-JP' })
  const settingsStore = await loadSettingsStore('interface-language-ja')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.preferredLanguage, 'ja-JP')
})

test('loadSettings 遇到未知界面语言会回退简体中文', async () => {
  installSettingsResponse({ preferredLanguage: 'xx' })
  const settingsStore = await loadSettingsStore('interface-language-unknown')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.preferredLanguage, 'zh-CN')
})
