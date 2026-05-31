/**
 * 本地设置数据源
 *
 * 需要读取或保存麦克风、翻译目标语言、大模型配置时看这里。
 */
import { ipcClient } from './ipc'
import translationTargetLanguages from '../../../../shared/translation-target-languages.json'
import llmProviders from '../../../../shared/llm-providers.json'

export type TranslationTargetLanguage = string
export type InterfaceLanguage = 'zh-CN' | 'en-US'
export type LlmAuthType = 'bearer' | 'anthropic'

export type TranslationTargetLanguageConfig = {
  id: string
  label: string
  displayName: string
  promptName: string
}

export const TRANSLATION_TARGET_LANGUAGES: TranslationTargetLanguageConfig[] = translationTargetLanguages
export const DEFAULT_TRANSLATION_TARGET_LANGUAGE: TranslationTargetLanguage =
  TRANSLATION_TARGET_LANGUAGES[0]?.id ?? 'en'

const translationTargetLanguageIds = new Set(TRANSLATION_TARGET_LANGUAGES.map((language) => language.id))
const interfaceLanguageIds = new Set<InterfaceLanguage>(['zh-CN', 'en-US'])

export type LlmProvider = {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  allowBaseUrlEdit: boolean
  authType: LlmAuthType
}

export type LlmSettings = {
  providerId: string
  providers: LlmProvider[]
  apiKeys: Record<string, string>
  models: Record<string, string>
}

export type LlmRequestConfig = {
  provider_id: string
  base_url: string
  api_key: string
  model: string
  auth_type: LlmAuthType
}

export type BackendReloadResult = {
  success: boolean
  detail?: string
  code?: string
}

export const DEFAULT_LLM_PROVIDERS: LlmProvider[] = llmProviders as LlmProvider[]

function createDefaultLlmSettings(): LlmSettings {
  return {
    providerId: 'deepseek',
    providers: DEFAULT_LLM_PROVIDERS,
    apiKeys: Object.fromEntries(DEFAULT_LLM_PROVIDERS.map((provider) => [provider.id, ''])),
    models: Object.fromEntries(DEFAULT_LLM_PROVIDERS.map((provider) => [provider.id, provider.defaultModel])),
  }
}

export type LocalSettings = {
  preferredLanguage: InterfaceLanguage
  translationTargetLanguage: TranslationTargetLanguage
  launchAtSystemStartup: boolean
  selectedAudioDeviceId: string
  modelCacheDir: string
  llm: LlmSettings
}

export const defaultSettings: LocalSettings = {
  preferredLanguage: 'zh-CN',
  translationTargetLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  launchAtSystemStartup: false,
  selectedAudioDeviceId: 'default',
  modelCacheDir: '',
  llm: createDefaultLlmSettings(),
}

function normalizeTranslationTargetLanguage(value: unknown): TranslationTargetLanguage {
  if (typeof value !== 'string') return DEFAULT_TRANSLATION_TARGET_LANGUAGE
  const languageId = value.trim()
  return translationTargetLanguageIds.has(languageId)
    ? languageId
    : DEFAULT_TRANSLATION_TARGET_LANGUAGE
}

function normalizeInterfaceLanguage(value: unknown): InterfaceLanguage {
  return typeof value === 'string' && interfaceLanguageIds.has(value as InterfaceLanguage)
    ? value as InterfaceLanguage
    : 'zh-CN'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLlmProvider(value: unknown, fallback: LlmProvider): LlmProvider {
  const provider = isRecord(value) ? value : {}
  const baseUrl = typeof provider.baseUrl === 'string' && provider.baseUrl.trim()
    ? provider.baseUrl.trim()
    : fallback.baseUrl
  const defaultModel = typeof provider.defaultModel === 'string'
    ? provider.defaultModel.trim()
    : fallback.defaultModel
  const authType = provider.authType === 'anthropic' ? 'anthropic' : fallback.authType

  return {
    id: fallback.id,
    label: typeof provider.label === 'string' && provider.label.trim() ? provider.label.trim() : fallback.label,
    baseUrl: fallback.allowBaseUrlEdit ? baseUrl : fallback.baseUrl,
    defaultModel: defaultModel || fallback.defaultModel,
    allowBaseUrlEdit: fallback.allowBaseUrlEdit,
    authType,
  }
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, item]) => [key, item]),
  )
}

function normalizeOptionalPath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeLlmSettings(value: unknown): LlmSettings {
  const settings = isRecord(value) ? value : {}
  const providedProviders = Array.isArray(settings.providers) ? settings.providers : []
  const providers = DEFAULT_LLM_PROVIDERS.map((fallback) => {
    const existing = providedProviders.find((provider) => isRecord(provider) && provider.id === fallback.id)
    return normalizeLlmProvider(existing, fallback)
  })
  const providerId = typeof settings.providerId === 'string'
    && providers.some((provider) => provider.id === settings.providerId)
    ? settings.providerId
    : 'deepseek'
  const apiKeySource = normalizeStringMap(settings.apiKeys)
  const modelSource = normalizeStringMap(settings.models)
  const apiKeys = Object.fromEntries(providers.map((provider) => [provider.id, apiKeySource[provider.id] ?? '']))
  const models = Object.fromEntries(providers.map((provider) => [
    provider.id,
    (modelSource[provider.id] ?? provider.defaultModel).trim(),
  ]))

  return { providerId, providers, apiKeys, models }
}

function normalizeSettings(settings?: Partial<LocalSettings> | null): LocalSettings {
  return {
    ...defaultSettings,
    preferredLanguage: normalizeInterfaceLanguage(settings?.preferredLanguage),
    translationTargetLanguage: normalizeTranslationTargetLanguage(settings?.translationTargetLanguage),
    launchAtSystemStartup: Boolean(settings?.launchAtSystemStartup),
    selectedAudioDeviceId: settings?.selectedAudioDeviceId || 'default',
    modelCacheDir: normalizeOptionalPath(settings?.modelCacheDir),
    llm: normalizeLlmSettings(settings?.llm),
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

export async function reloadLlmBackendConfig(): Promise<BackendReloadResult> {
  try {
    return await ipcClient.invoke<BackendReloadResult>('settings:reload-llm-backend')
  } catch (error) {
    return {
      success: false,
      code: 'backend_unavailable',
      detail: error instanceof Error ? error.message : String(error),
    }
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

export async function getCurrentLlmConfig(): Promise<LlmRequestConfig> {
  const settings = await loadSettings()
  const provider = settings.llm.providers.find((item) => item.id === settings.llm.providerId)
    ?? settings.llm.providers[0]
    ?? DEFAULT_LLM_PROVIDERS[0]
  const model = settings.llm.models[provider.id] || provider.defaultModel
  return {
    provider_id: provider.id,
    base_url: provider.baseUrl,
    api_key: settings.llm.apiKeys[provider.id] ?? '',
    model,
    auth_type: provider.authType,
  }
}
