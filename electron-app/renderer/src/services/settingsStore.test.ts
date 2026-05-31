import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { LlmProvider } from './settingsStore'
import sharedLlmProviders from '../../../../shared/llm-providers.json'

type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, ...payload: unknown[]) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => void
    off: (channel: string, listener: (...args: unknown[]) => void) => void
  }
}

const originalWindow = globalThis.window

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
})

test('loadSettings 会保留用户选择的模型缓存目录', async () => {
  installSettingsResponse({ modelCacheDir: '  D:\\Models\\FunASR  ' })
  const settingsStore = await loadSettingsStore('model-cache-dir')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.modelCacheDir, 'D:\\Models\\FunASR')
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
    settingsStore.TRANSLATION_TARGET_LANGUAGES.map((language: { id: string; displayName: string }) => ({
      id: language.id,
      displayName: language.displayName,
    })),
    [
      { id: 'en', displayName: '英文 (en)' },
      { id: 'ja', displayName: '日语 (ja)' },
    ],
  )
})

test('loadSettings 会保留共享元数据中的日语翻译目标语言', async () => {
  installSettingsResponse({ translationTargetLanguage: 'ja' })
  const settingsStore = await loadSettingsStore('translation-language-ja')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.translationTargetLanguage, 'ja')
})

test('loadSettings 遇到未知翻译目标语言会回退默认英文', async () => {
  installSettingsResponse({ translationTargetLanguage: 'xx' })
  const settingsStore = await loadSettingsStore('translation-language-unknown')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.translationTargetLanguage, 'en')
})

test('loadSettings 会保留英文界面语言', async () => {
  installSettingsResponse({ preferredLanguage: 'en-US' })
  const settingsStore = await loadSettingsStore('interface-language-en')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.preferredLanguage, 'en-US')
})

test('loadSettings 遇到未知界面语言会回退简体中文', async () => {
  installSettingsResponse({ preferredLanguage: 'xx' })
  const settingsStore = await loadSettingsStore('interface-language-unknown')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.preferredLanguage, 'zh-CN')
})
