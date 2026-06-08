const TRANSLATION_TARGET_LANGUAGES = require('../shared/translation-target-languages.json');
const MEETING_LIVE_TARGET_LANGUAGES = require('../shared/meeting-live-target-languages.json');
const INTERFACE_LANGUAGES = require('../shared/interface-languages.json');
const DEFAULT_LLM_PROVIDERS = require('../shared/llm-providers.json');

const DEFAULT_LANGUAGE = 'zh-CN';
const DEFAULT_LLM_PROVIDER_ID = 'deepseek';
const DEFAULT_TRANSLATION_TARGET_LANGUAGE = TRANSLATION_TARGET_LANGUAGES.some((language) => language.id === 'en')
  ? 'en'
  : TRANSLATION_TARGET_LANGUAGES[0]?.id || 'en';
const DEFAULT_ASR_DEVICE_MODE = 'default';
const DEFAULT_MEETING_LIVE_AUDIO_SOURCE = 'microphone';
const DEFAULT_MEETING_LIVE_TARGET_LANGUAGE = 'off';
const DEFAULT_MEETING_REALTIME_ASR_PREFERENCE = 'auto';
const DEFAULT_TRANSLATION_ENGINE_PREFERENCE = 'auto';
const SUPPORTED_INTERFACE_LANGUAGES = new Set(INTERFACE_LANGUAGES.map((language) => language.id));
const SUPPORTED_ASR_DEVICE_MODES = new Set(['default', 'mps', 'cuda', 'cpu']);
const SUPPORTED_MEETING_AUDIO_SOURCES = new Set(['microphone', 'system', 'microphone_system']);
const SUPPORTED_MEETING_REALTIME_ASR_PREFERENCES = new Set(['auto', 'streaming', 'sensevoice_fallback']);
const SUPPORTED_TRANSLATION_ENGINE_PREFERENCES = new Set(['auto', 'local', 'llm']);
const SUPPORTED_TRANSLATION_TARGET_LANGUAGES = new Set(
  TRANSLATION_TARGET_LANGUAGES.map((language) => language.id),
);
const SUPPORTED_MEETING_TRANSLATION_TARGETS = new Set([
  'off',
  ...MEETING_LIVE_TARGET_LANGUAGES.map((language) => language.id),
]);

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
    interactionSoundsEnabled: true,
    muteBackgroundAudioDuringRecording: true,
    showActiveMicrophoneHint: true,
    remindOnNewAudioDevice: true,
    meetingDetectionEnabled: true,
    meetingLiveAudioSource: DEFAULT_MEETING_LIVE_AUDIO_SOURCE,
    meetingLiveTargetLanguage: DEFAULT_MEETING_LIVE_TARGET_LANGUAGE,
    meetingRealtimeAsrPreference: DEFAULT_MEETING_REALTIME_ASR_PREFERENCE,
    meetingRealtimeAsrModelEnabled: true,
    translationEnginePreference: DEFAULT_TRANSLATION_ENGINE_PREFERENCE,
    localTranslationModelEnabled: true,
    translationModelCacheDir: '',
    showFloatingBar: true,
    hideMainWindowOnClose: true,
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

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

function normalizeAsrDeviceMode(value) {
  return SUPPORTED_ASR_DEVICE_MODES.has(value) ? value : DEFAULT_ASR_DEVICE_MODE;
}

function normalizeMeetingLiveAudioSource(value) {
  return SUPPORTED_MEETING_AUDIO_SOURCES.has(value) ? value : DEFAULT_MEETING_LIVE_AUDIO_SOURCE;
}

function normalizeMeetingLiveTargetLanguage(value) {
  return SUPPORTED_MEETING_TRANSLATION_TARGETS.has(value) ? value : DEFAULT_MEETING_LIVE_TARGET_LANGUAGE;
}

function normalizeTranslationEnginePreference(value) {
  return SUPPORTED_TRANSLATION_ENGINE_PREFERENCES.has(value) ? value : DEFAULT_TRANSLATION_ENGINE_PREFERENCE;
}

function normalizeMeetingRealtimeAsrPreference(value) {
  return SUPPORTED_MEETING_REALTIME_ASR_PREFERENCES.has(value) ? value : DEFAULT_MEETING_REALTIME_ASR_PREFERENCE;
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
    preferredLanguage: SUPPORTED_INTERFACE_LANGUAGES.has(settings.preferredLanguage)
      ? settings.preferredLanguage
      : DEFAULT_LANGUAGE,
    translationTargetLanguage: SUPPORTED_TRANSLATION_TARGET_LANGUAGES.has(settings.translationTargetLanguage)
      ? settings.translationTargetLanguage
      : DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    launchAtSystemStartup: normalizeBoolean(settings.launchAtSystemStartup, false),
    selectedAudioDeviceId: typeof settings.selectedAudioDeviceId === 'string' && settings.selectedAudioDeviceId
      ? settings.selectedAudioDeviceId
      : 'default',
    interactionSoundsEnabled: normalizeBoolean(settings.interactionSoundsEnabled, true),
    muteBackgroundAudioDuringRecording: normalizeBoolean(settings.muteBackgroundAudioDuringRecording, true),
    showActiveMicrophoneHint: normalizeBoolean(settings.showActiveMicrophoneHint, true),
    remindOnNewAudioDevice: normalizeBoolean(settings.remindOnNewAudioDevice, true),
    meetingDetectionEnabled: normalizeBoolean(settings.meetingDetectionEnabled, true),
    meetingLiveAudioSource: normalizeMeetingLiveAudioSource(settings.meetingLiveAudioSource),
    meetingLiveTargetLanguage: normalizeMeetingLiveTargetLanguage(settings.meetingLiveTargetLanguage),
    meetingRealtimeAsrPreference: normalizeMeetingRealtimeAsrPreference(settings.meetingRealtimeAsrPreference),
    meetingRealtimeAsrModelEnabled: normalizeBoolean(settings.meetingRealtimeAsrModelEnabled, true),
    translationEnginePreference: normalizeTranslationEnginePreference(settings.translationEnginePreference),
    localTranslationModelEnabled: normalizeBoolean(settings.localTranslationModelEnabled, true),
    translationModelCacheDir: normalizeOptionalPath(settings.translationModelCacheDir),
    showFloatingBar: normalizeBoolean(settings.showFloatingBar, true),
    hideMainWindowOnClose: normalizeBoolean(settings.hideMainWindowOnClose, true),
    modelCacheDir: normalizeOptionalPath(settings.modelCacheDir),
    asrDeviceMode: normalizeAsrDeviceMode(settings.asrDeviceMode),
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
  DEFAULT_LLM_PROVIDER_ID,
  DEFAULT_LLM_PROVIDERS,
  INTERFACE_LANGUAGES,
  DEFAULT_MEETING_LIVE_AUDIO_SOURCE,
  DEFAULT_MEETING_LIVE_TARGET_LANGUAGE,
  DEFAULT_MEETING_REALTIME_ASR_PREFERENCE,
  DEFAULT_TRANSLATION_ENGINE_PREFERENCE,
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  SUPPORTED_ASR_DEVICE_MODES,
  SUPPORTED_INTERFACE_LANGUAGES,
  SUPPORTED_MEETING_AUDIO_SOURCES,
  SUPPORTED_MEETING_REALTIME_ASR_PREFERENCES,
  SUPPORTED_MEETING_TRANSLATION_TARGETS,
  SUPPORTED_TRANSLATION_ENGINE_PREFERENCES,
  SUPPORTED_TRANSLATION_TARGET_LANGUAGES,
  createDefaultLlmSettings,
  createDefaultLocalSettings,
  normalizeStringMap,
  normalizeOptionalPath,
  normalizeAsrDeviceMode,
  normalizeMeetingLiveAudioSource,
  normalizeMeetingLiveTargetLanguage,
  normalizeMeetingRealtimeAsrPreference,
  normalizeTranslationEnginePreference,
  normalizeLlmProvider,
  normalizeLlmSettings,
  normalizeLlmRequestConfig,
  normalizeBoolean,
  normalizeLocalSettings,
  buildCurrentLlmRequestConfig,
  createSettingsStore,
};
