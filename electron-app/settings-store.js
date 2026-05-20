const TRANSLATION_TARGET_LANGUAGES = require('../shared/translation-target-languages.json');

const DEFAULT_LANGUAGE = 'zh-CN';
const DEFAULT_LLM_PROVIDER_ID = 'deepseek';
const DEFAULT_LLM_PROVIDERS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    allowBaseUrlEdit: false,
    authType: 'bearer',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    allowBaseUrlEdit: false,
    authType: 'bearer',
  },
  {
    id: 'zai',
    label: 'Z.AI',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'glm-4.6',
    allowBaseUrlEdit: false,
    authType: 'bearer',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5.4',
    allowBaseUrlEdit: false,
    authType: 'bearer',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    allowBaseUrlEdit: false,
    authType: 'anthropic',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    allowBaseUrlEdit: false,
    authType: 'bearer',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    allowBaseUrlEdit: false,
    authType: 'bearer',
  },
  {
    id: 'custom',
    label: 'Custom',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: '',
    allowBaseUrlEdit: true,
    authType: 'bearer',
  },
];
const DEFAULT_TRANSLATION_TARGET_LANGUAGE = TRANSLATION_TARGET_LANGUAGES[0]?.id || 'en';
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

function normalizeLocalSettings(value = {}) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    preferredLanguage: DEFAULT_LANGUAGE,
    translationTargetLanguage: SUPPORTED_TRANSLATION_TARGET_LANGUAGES.has(settings.translationTargetLanguage)
      ? settings.translationTargetLanguage
      : DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    launchAtSystemStartup: Boolean(settings.launchAtSystemStartup),
    selectedAudioDeviceId: typeof settings.selectedAudioDeviceId === 'string' && settings.selectedAudioDeviceId
      ? settings.selectedAudioDeviceId
      : 'default',
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
  DEFAULT_LLM_PROVIDER_ID,
  DEFAULT_LLM_PROVIDERS,
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  SUPPORTED_TRANSLATION_TARGET_LANGUAGES,
  createDefaultLlmSettings,
  createDefaultLocalSettings,
  normalizeStringMap,
  normalizeLlmProvider,
  normalizeLlmSettings,
  normalizeLlmRequestConfig,
  normalizeLocalSettings,
  buildCurrentLlmRequestConfig,
  createSettingsStore,
};
