const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_LANGUAGE,
  DEFAULT_ASR_DEVICE_MODE,
  DEFAULT_LLM_PROVIDERS,
  DEFAULT_MEETING_LIVE_AUDIO_SOURCE,
  DEFAULT_MEETING_LIVE_TARGET_LANGUAGE,
  DEFAULT_MEETING_REALTIME_ASR_PREFERENCE,
  DEFAULT_TRANSLATION_ENGINE_PREFERENCE,
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  INTERFACE_LANGUAGES,
  SUPPORTED_INTERFACE_LANGUAGES,
  normalizeLocalSettings,
  createSettingsStore,
} = require('./settings-store');
const sharedLlmProviders = require('../shared/llm-providers.json');
const sharedTranslationTargetLanguages = require('../shared/translation-target-languages.json');
const sharedMeetingLiveTargetLanguages = require('../shared/meeting-live-target-languages.json');
const sharedInterfaceLanguages = require('../shared/interface-languages.json');

const EXPECTED_INTERFACE_LANGUAGE_IDS = [
  'en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'es-ES', 'pt-BR',
  'fr-FR', 'de-DE', 'it-IT', 'ru-RU', 'ar-SA', 'he-IL', 'hi-IN',
  'id-ID', 'ms-MY', 'nl-NL', 'pl-PL', 'th-TH',
];

test('默认 LLM provider 元数据来自共享 JSON', () => {
  assert.strictEqual(DEFAULT_LLM_PROVIDERS, sharedLlmProviders);

  const openaiProvider = DEFAULT_LLM_PROVIDERS.find((provider) => provider.id === 'openai');
  assert.equal(openaiProvider.defaultModel, 'gpt-5.4');
});

test('界面语言元数据来自共享 JSON 并覆盖截图语言', () => {
  assert.strictEqual(INTERFACE_LANGUAGES, sharedInterfaceLanguages);
  assert.deepEqual(
    INTERFACE_LANGUAGES.map((language) => language.id),
    EXPECTED_INTERFACE_LANGUAGE_IDS,
  );
  assert.equal(
    INTERFACE_LANGUAGES.every((language) => SUPPORTED_INTERFACE_LANGUAGES.has(language.id)),
    true,
  );
  assert.equal(
    INTERFACE_LANGUAGES.every((language) => language.labelKey === `settings.interfaceLanguage.${language.id}`),
    true,
  );
});

test('翻译目标语言元数据来自共享 JSON 并包含设置页扩展语言', () => {
  assert.deepEqual(
    sharedTranslationTargetLanguages.map((language) => language.id),
    [
      'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'pt', 'pt-BR', 'fr', 'de',
      'it', 'ru', 'uk', 'ar', 'he', 'fa', 'hi', 'bn', 'ur', 'th',
      'vi', 'id', 'ms', 'fil', 'my', 'km', 'lo', 'nl', 'pl', 'tr',
      'el', 'cs', 'ro', 'hu', 'sv', 'da', 'no', 'fi', 'sw',
    ],
  );
  assert.equal(sharedTranslationTargetLanguages.some((language) => language.id === 'yue'), false);
  assert.deepEqual(
    sharedMeetingLiveTargetLanguages.map((language) => language.id),
    ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de'],
  );
});

test('normalizeLocalSettings 会回退不支持的翻译目标语言和空设备', () => {
  const settings = normalizeLocalSettings({
    translationTargetLanguage: 'xx',
    selectedAudioDeviceId: '',
    launchAtSystemStartup: 1,
    modelCacheDir: 123,
    asrDeviceMode: 'gpu',
    translationEnginePreference: 'bad',
    meetingRealtimeAsrPreference: 'bad',
    meetingRealtimeAsrModelEnabled: 0,
    translationModelCacheDir: 123,
  });

  assert.equal(settings.preferredLanguage, DEFAULT_LANGUAGE);
  assert.equal(settings.translationTargetLanguage, DEFAULT_TRANSLATION_TARGET_LANGUAGE);
  assert.equal(settings.selectedAudioDeviceId, 'default');
  assert.equal(settings.launchAtSystemStartup, true);
  assert.equal(settings.interactionSoundsEnabled, true);
  assert.equal(settings.muteBackgroundAudioDuringRecording, true);
  assert.equal(settings.showActiveMicrophoneHint, true);
  assert.equal(settings.remindOnNewAudioDevice, true);
    assert.equal(settings.meetingDetectionEnabled, true);
    assert.equal(settings.meetingLiveAudioSource, DEFAULT_MEETING_LIVE_AUDIO_SOURCE);
    assert.equal(settings.meetingLiveTargetLanguage, DEFAULT_MEETING_LIVE_TARGET_LANGUAGE);
    assert.equal(settings.meetingRealtimeAsrPreference, DEFAULT_MEETING_REALTIME_ASR_PREFERENCE);
    assert.equal(settings.meetingRealtimeAsrModelEnabled, false);
    assert.equal(settings.translationEnginePreference, DEFAULT_TRANSLATION_ENGINE_PREFERENCE);
    assert.equal(settings.localTranslationModelEnabled, true);
    assert.equal(settings.translationModelCacheDir, '');
    assert.equal(settings.showFloatingBar, true);
  assert.equal(settings.hideMainWindowOnClose, true);
  assert.equal(settings.modelCacheDir, '');
  assert.equal(settings.asrDeviceMode, DEFAULT_ASR_DEVICE_MODE);
});

test('normalizeLocalSettings 会保留音频和应用行为开关', () => {
  const settings = normalizeLocalSettings({
    interactionSoundsEnabled: false,
    muteBackgroundAudioDuringRecording: false,
    showActiveMicrophoneHint: false,
    remindOnNewAudioDevice: false,
    meetingDetectionEnabled: false,
    meetingLiveAudioSource: 'system',
    meetingLiveTargetLanguage: 'ko',
    meetingRealtimeAsrPreference: 'streaming',
    meetingRealtimeAsrModelEnabled: false,
    translationEnginePreference: 'local',
    localTranslationModelEnabled: false,
    translationModelCacheDir: '  D:\\Models\\HyMT  ',
    showFloatingBar: false,
    hideMainWindowOnClose: false,
  });

  assert.equal(settings.interactionSoundsEnabled, false);
  assert.equal(settings.muteBackgroundAudioDuringRecording, false);
  assert.equal(settings.showActiveMicrophoneHint, false);
  assert.equal(settings.remindOnNewAudioDevice, false);
  assert.equal(settings.meetingDetectionEnabled, false);
  assert.equal(settings.meetingLiveAudioSource, 'system');
  assert.equal(settings.meetingLiveTargetLanguage, 'ko');
  assert.equal(settings.meetingRealtimeAsrPreference, 'streaming');
  assert.equal(settings.meetingRealtimeAsrModelEnabled, false);
  assert.equal(settings.translationEnginePreference, 'local');
  assert.equal(settings.localTranslationModelEnabled, false);
  assert.equal(settings.translationModelCacheDir, 'D:\\Models\\HyMT');
  assert.equal(settings.showFloatingBar, false);
  assert.equal(settings.hideMainWindowOnClose, false);
});

test('normalizeLocalSettings 会保留用户选择的模型缓存目录', () => {
  const settings = normalizeLocalSettings({
    modelCacheDir: '  D:\\Models\\SenseVoice  ',
  });

  assert.equal(settings.modelCacheDir, 'D:\\Models\\SenseVoice');
});

test('normalizeLocalSettings 会保留合法的 ASR 运行设备模式', () => {
  assert.equal(normalizeLocalSettings({ asrDeviceMode: 'mps' }).asrDeviceMode, 'mps');
  assert.equal(normalizeLocalSettings({ asrDeviceMode: 'cuda' }).asrDeviceMode, 'cuda');
  assert.equal(normalizeLocalSettings({ asrDeviceMode: 'cpu' }).asrDeviceMode, 'cpu');
  assert.equal(normalizeLocalSettings({ asrDeviceMode: 'auto' }).asrDeviceMode, DEFAULT_ASR_DEVICE_MODE);
});

test('normalizeLocalSettings 会保留截图界面语言并回退未知界面语言', () => {
  assert.equal(
    normalizeLocalSettings({ preferredLanguage: 'en-US' }).preferredLanguage,
    'en-US',
  );
  assert.equal(
    normalizeLocalSettings({ preferredLanguage: 'ja-JP' }).preferredLanguage,
    'ja-JP',
  );
  assert.equal(
    normalizeLocalSettings({ preferredLanguage: 'th-TH' }).preferredLanguage,
    'th-TH',
  );
  assert.equal(
    normalizeLocalSettings({ preferredLanguage: 'xx' }).preferredLanguage,
    DEFAULT_LANGUAGE,
  );
});

test('normalizeLocalSettings 会保留合法的 LLM 配置', () => {
  const settings = normalizeLocalSettings({
    llm: {
      providerId: 'custom',
      providers: [
        {
          id: 'custom',
          label: '  Custom API  ',
          baseUrl: 'http://localhost:11434/v1',
          defaultModel: 'gpt-4.1',
          allowBaseUrlEdit: true,
          authType: 'bearer',
        },
      ],
      apiKeys: { custom: 'abc123' },
      models: { custom: '  model-x  ' },
    },
  });

  const customProvider = settings.llm.providers.find((provider) => provider.id === 'custom');
  assert.equal(settings.llm.providerId, 'custom');
  assert.equal(customProvider.label, 'Custom API');
  assert.equal(customProvider.baseUrl, 'http://localhost:11434/v1');
  assert.equal(settings.llm.apiKeys.custom, 'abc123');
  assert.equal(settings.llm.models.custom, 'model-x');
});

test('createSettingsStore 读取和写入时都会同步 legacy store', () => {
  let written = null;
  let synced = null;
  const store = createSettingsStore({
    readJsonFile: () => ({
      translationTargetLanguage: 'fr',
      selectedAudioDeviceId: 'mic-1',
      modelCacheDir: 'D:\\Models\\FunASR',
      asrDeviceMode: 'mps',
      launchAtSystemStartup: true,
      meetingLiveAudioSource: 'microphone_system',
      meetingLiveTargetLanguage: 'es',
      meetingRealtimeAsrPreference: 'sensevoice_fallback',
      meetingRealtimeAsrModelEnabled: false,
      translationEnginePreference: 'llm',
      localTranslationModelEnabled: false,
      translationModelCacheDir: 'D:\\Models\\HyMT',
      muteBackgroundAudioDuringRecording: false,
      showFloatingBar: false,
      llm: {
        providerId: 'openai',
        providers: [],
        apiKeys: { openai: 'sk-test' },
        models: { openai: 'gpt-5.4' },
      },
    }),
    writeJsonFile: (_, value) => {
      written = value;
      return value;
    },
    syncSettings: (value) => {
      synced = value;
    },
  });

  const settings = store.readLocalSettings();
  assert.equal(settings.translationTargetLanguage, 'fr');
  assert.equal(synced.selectedAudioDeviceId, 'mic-1');
  assert.equal(settings.modelCacheDir, 'D:\\Models\\FunASR');
  assert.equal(settings.asrDeviceMode, 'mps');
  assert.equal(settings.meetingLiveAudioSource, 'microphone_system');
  assert.equal(settings.meetingLiveTargetLanguage, 'es');
  assert.equal(settings.meetingRealtimeAsrPreference, 'sensevoice_fallback');
  assert.equal(settings.meetingRealtimeAsrModelEnabled, false);
  assert.equal(settings.translationEnginePreference, 'llm');
  assert.equal(settings.localTranslationModelEnabled, false);
  assert.equal(settings.translationModelCacheDir, 'D:\\Models\\HyMT');
  assert.equal(settings.muteBackgroundAudioDuringRecording, false);
  assert.equal(synced.showFloatingBar, false);

  const next = store.writeLocalSettings({
    translationTargetLanguage: 'zh-CN',
    selectedAudioDeviceId: 'default',
    modelCacheDir: 'E:\\SpeakMoreModels',
    asrDeviceMode: 'cpu',
    launchAtSystemStartup: false,
    interactionSoundsEnabled: false,
    muteBackgroundAudioDuringRecording: true,
    showActiveMicrophoneHint: false,
    remindOnNewAudioDevice: false,
    meetingDetectionEnabled: false,
    meetingLiveAudioSource: 'system',
    meetingLiveTargetLanguage: 'de',
    meetingRealtimeAsrPreference: 'streaming',
    meetingRealtimeAsrModelEnabled: true,
    translationEnginePreference: 'local',
    localTranslationModelEnabled: true,
    translationModelCacheDir: 'E:\\HyMT',
    showFloatingBar: true,
    hideMainWindowOnClose: false,
    llm: settings.llm,
  });

  assert.equal(written.translationTargetLanguage, 'zh-CN');
  assert.equal(written.modelCacheDir, 'E:\\SpeakMoreModels');
  assert.equal(written.asrDeviceMode, 'cpu');
  assert.equal(written.interactionSoundsEnabled, false);
  assert.equal(written.meetingDetectionEnabled, false);
  assert.equal(written.meetingLiveAudioSource, 'system');
  assert.equal(written.meetingLiveTargetLanguage, 'de');
  assert.equal(written.meetingRealtimeAsrPreference, 'streaming');
  assert.equal(written.meetingRealtimeAsrModelEnabled, true);
  assert.equal(written.translationEnginePreference, 'local');
  assert.equal(written.localTranslationModelEnabled, true);
  assert.equal(written.translationModelCacheDir, 'E:\\HyMT');
  assert.equal(written.hideMainWindowOnClose, false);
  assert.equal(next.translationTargetLanguage, 'zh-CN');
  assert.equal(synced.translationTargetLanguage, 'zh-CN');
  assert.equal(synced.muteBackgroundAudioDuringRecording, true);
});

test('buildCurrentLlmRequestConfig 会按当前 provider 生成请求配置', () => {
  const store = createSettingsStore({
    readJsonFile: () => ({
      translationTargetLanguage: 'en',
      selectedAudioDeviceId: 'default',
      llm: {
        providerId: 'anthropic',
        providers: [],
        apiKeys: { anthropic: 'sk-anthropic' },
        models: { anthropic: 'claude-sonnet-4-5' },
      },
    }),
    writeJsonFile: () => undefined,
    syncSettings: () => undefined,
  });

  assert.deepEqual(store.buildCurrentLlmRequestConfig(), {
    provider_id: 'anthropic',
    base_url: 'https://api.anthropic.com/v1',
    api_key: 'sk-anthropic',
    model: 'claude-sonnet-4-5',
    auth_type: 'anthropic',
  });
});
