const TRANSLATION_TARGET_LANGUAGES = require('../shared/translation-target-languages.json');
const DEFAULT_LLM_PROVIDERS = require('../shared/llm-providers.json');
const ASR_MODELS = require('../shared/asr-models.json');

const DEFAULT_LANGUAGE = 'zh-CN';
const DEFAULT_LLM_PROVIDER_ID = 'deepseek';
const DEFAULT_TRANSLATION_TARGET_LANGUAGE = TRANSLATION_TARGET_LANGUAGES[0]?.id || 'en';
const DEFAULT_ASR_DEVICE_MODE = 'default';
const DEFAULT_ASR_MODEL_ID = (ASR_MODELS.find((model) => model.default) || ASR_MODELS[0]).id;
const SUPPORTED_ASR_MODEL_IDS = new Set(ASR_MODELS.map((model) => model.id));
const SUPPORTED_INTERFACE_LANGUAGES = new Set(['zh-CN', 'en-US']);
const SUPPORTED_ASR_DEVICE_MODES = new Set(['default', 'mps', 'cuda', 'cpu']);
const SUPPORTED_TRANSLATION_TARGET_LANGUAGES = new Set(
  TRANSLATION_TARGET_LANGUAGES.map((language) => language.id),
);

function createDefaultLlmSettings() {
  return {
    providerId: DEFAULT_LLM_PROVIDER_ID,
    providers: DEFAULT_LLM_PROVIDERS,
    apiKeys: Object.fromEntries(DEFAULT_LLM_PROVIDERS.map((provider) => [provider.id, ''])),
    models: Object.fromEntries(DEFAULT_LLM_PROVIDERS.map((provider) => [provider.id, provider.defaultModel])),
  };
}

function createDefaultLocalSettings() {
  return normalizeLocalSettings({
    preferredLanguage: DEFAULT_LANGUAGE,
    translationTargetLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    launchAtSystemStartup: false,
    selectedAudioDeviceId: 'default',
    llm: createDefaultLlmSettings(),
  });
}

function normalizeStringMap(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) => typeof entry[1] === 'string')
      .map(([key, item]) => [key, item]),
  );
}

function normalizeOptionalPath(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAsrDeviceMode(value) {
  return SUPPORTED_ASR_DEVICE_MODES.has(value) ? value : DEFAULT_ASR_DEVICE_MODE;
}

function normalizeLlmProvider(candidate, fallback) {
  const value = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
  const baseUrl = typeof value.baseUrl === 'string' && value.baseUrl.trim()
    ? value.baseUrl.trim()
    : fallback.baseUrl;
  const defaultModel = typeof value.defaultModel === 'string'
    ? value.defaultModel.trim()
    : fallback.defaultModel;
  return {
    id: fallback.id,
    label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : fallback.label,
    baseUrl: fallback.allowBaseUrlEdit ? baseUrl : fallback.baseUrl,
    defaultModel: defaultModel || fallback.defaultModel,
    allowBaseUrlEdit: fallback.allowBaseUrlEdit,
    authType: value.authType === 'anthropic' ? 'anthropic' : fallback.authType,
  };
}

function normalizeLlmSettings(value = {}) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const existingProviders = Array.isArray(settings.providers) ? settings.providers : [];
  const providers = DEFAULT_LLM_PROVIDERS.map((fallback) => {
    const existing = existingProviders.find((provider) => provider?.id === fallback.id);
    return normalizeLlmProvider(existing, fallback);
  });
  const providerId = providers.some((provider) => provider.id === settings.providerId)
    ? settings.providerId
    : DEFAULT_LLM_PROVIDER_ID;
  const apiKeySource = normalizeStringMap(settings.apiKeys);
  const modelSource = normalizeStringMap(settings.models);
  const apiKeys = Object.fromEntries(providers.map((provider) => [provider.id, apiKeySource[provider.id] || '']));
  const models = Object.fromEntries(providers.map((provider) => [
    provider.id,
    (modelSource[provider.id] || provider.defaultModel || '').trim(),
  ]));

  return { providerId, providers, apiKeys, models };
}

function normalizeLlmRequestConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const providerId = typeof value.provider_id === 'string' ? value.provider_id.trim() : '';
  const baseUrl = typeof value.base_url === 'string' ? value.base_url.trim() : '';
  const model = typeof value.model === 'string' ? value.model.trim() : '';
  if (!providerId || !baseUrl || !model) return null;
  return {
    provider_id: providerId,
    base_url: baseUrl,
    api_key: typeof value.api_key === 'string' ? value.api_key : '',
    model,
    auth_type: value.auth_type === 'anthropic' ? 'anthropic' : 'bearer',
  };
}

function normalizeAsrModelId(value) {
  return SUPPORTED_ASR_MODEL_IDS.has(value) ? value : DEFAULT_ASR_MODEL_ID;
}

function normalizeLocalSettings(value = {}) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    preferredLanguage: SUPPORTED_INTERFACE_LANGUAGES.has(settings.preferredLanguage)
      ? settings.preferredLanguage
      : DEFAULT_LANGUAGE,
    translationTargetLanguage: SUPPORTED_TRANSLATION_TARGET_LANGUAGES.has(settings.translationTargetLanguage)
      ? settings.translationTargetLanguage
      : DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    launchAtSystemStartup: Boolean(settings.launchAtSystemStartup),
    selectedAudioDeviceId: typeof settings.selectedAudioDeviceId === 'string' && settings.selectedAudioDeviceId
      ? settings.selectedAudioDeviceId
      : 'default',
    modelCacheDir: normalizeOptionalPath(settings.modelCacheDir),
    asrDeviceMode: normalizeAsrDeviceMode(settings.asrDeviceMode),
    asrModelId: normalizeAsrModelId(settings.asrModelId),
    llm: normalizeLlmSettings(settings.llm),
  };
}

function buildCurrentLlmRequestConfig(settings = createDefaultLocalSettings()) {
  const llm = normalizeLlmSettings(settings.llm);
  const provider = llm.providers.find((item) => item.id === llm.providerId) || llm.providers[0] || DEFAULT_LLM_PROVIDERS[0];
  return {
    provider_id: provider.id,
    base_url: provider.baseUrl,
    api_key: llm.apiKeys[provider.id] || '',
    model: llm.models[provider.id] || provider.defaultModel,
    auth_type: provider.authType,
  };
}

function createSettingsStore({
  readJsonFile,
  writeJsonFile,
  syncSettings = () => {},
  fileName = 'settings.json',
} = {}) {
  if (typeof readJsonFile !== 'function') {
    throw new Error('readJsonFile is required');
  }
  if (typeof writeJsonFile !== 'function') {
    throw new Error('writeJsonFile is required');
  }

  function readLocalSettings() {
    const settings = normalizeLocalSettings(readJsonFile(fileName, createDefaultLocalSettings()));
    syncSettings(settings);
    return settings;
  }

  function writeLocalSettings(settings) {
    const normalized = normalizeLocalSettings(settings);
    writeJsonFile(fileName, normalized);
    syncSettings(normalized);
    return normalized;
  }

  function buildCurrentLlmRequestConfigFromSettings(settings = readLocalSettings()) {
    return buildCurrentLlmRequestConfig(settings);
  }

  return {
    readLocalSettings,
    writeLocalSettings,
    buildCurrentLlmRequestConfig: buildCurrentLlmRequestConfigFromSettings,
  };
}

module.exports = {
  DEFAULT_LANGUAGE,
  DEFAULT_ASR_DEVICE_MODE,
  DEFAULT_ASR_MODEL_ID,
  DEFAULT_LLM_PROVIDER_ID,
  DEFAULT_LLM_PROVIDERS,
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  SUPPORTED_ASR_DEVICE_MODES,
  SUPPORTED_ASR_MODEL_IDS,
  SUPPORTED_INTERFACE_LANGUAGES,
  SUPPORTED_TRANSLATION_TARGET_LANGUAGES,
  createDefaultLlmSettings,
  createDefaultLocalSettings,
  normalizeStringMap,
  normalizeOptionalPath,
  normalizeAsrDeviceMode,
  normalizeAsrModelId,
  normalizeLlmProvider,
  normalizeLlmSettings,
  normalizeLlmRequestConfig,
  normalizeLocalSettings,
  buildCurrentLlmRequestConfig,
  createSettingsStore,
};
