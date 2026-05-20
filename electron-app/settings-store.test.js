const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_LANGUAGE,
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  normalizeLocalSettings,
  createSettingsStore,
} = require('./settings-store');

test('normalizeLocalSettings 会回退不支持的翻译目标语言和空设备', () => {
  const settings = normalizeLocalSettings({
    translationTargetLanguage: 'xx',
    selectedAudioDeviceId: '',
    launchAtSystemStartup: 1,
  });

  assert.equal(settings.preferredLanguage, DEFAULT_LANGUAGE);
  assert.equal(settings.translationTargetLanguage, DEFAULT_TRANSLATION_TARGET_LANGUAGE);
  assert.equal(settings.selectedAudioDeviceId, 'default');
  assert.equal(settings.launchAtSystemStartup, true);
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
      translationTargetLanguage: 'ja',
      selectedAudioDeviceId: 'mic-1',
      launchAtSystemStartup: true,
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
  assert.equal(settings.translationTargetLanguage, 'ja');
  assert.equal(synced.selectedAudioDeviceId, 'mic-1');

  const next = store.writeLocalSettings({
    translationTargetLanguage: 'en',
    selectedAudioDeviceId: 'default',
    launchAtSystemStartup: false,
    llm: settings.llm,
  });

  assert.equal(written.translationTargetLanguage, 'en');
  assert.equal(next.translationTargetLanguage, 'en');
  assert.equal(synced.translationTargetLanguage, 'en');
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
