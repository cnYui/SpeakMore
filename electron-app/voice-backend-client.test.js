const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createVoiceBackendClient,
  buildVoiceFlowParameters,
  buildVoiceFlowFormData,
  normalizeVoiceMode,
} = require('./voice-backend-client');

test('normalizeVoiceMode 统一兼容听写、翻译和自由提问模式', () => {
  assert.equal(normalizeVoiceMode('dictation'), 'transcript');
  assert.equal(normalizeVoiceMode('ask_anything'), 'ask_anything');
  assert.equal(normalizeVoiceMode('translation'), 'translation');
  assert.equal(normalizeVoiceMode('unknown'), 'transcript');
});

test('buildVoiceFlowParameters 解析选区、输出语言和 LLM 配置', () => {
  const params = buildVoiceFlowParameters({
    parameters: {
      selected_text: 'selected from params',
      output_language: 'ja',
      llm: { provider_id: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-5.4' },
      extra: 'value',
    },
    audioContext: { selectedText: 'fallback selected' },
    modeConfig: { outputLanguage: 'en' },
  }, {
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
  });

  assert.equal(params.selected_text, 'selected from params');
  assert.equal(params.output_language, 'ja');
  assert.equal(params.extra, 'value');
  assert.equal(params.llm.provider_id, 'openai');
});

test('buildVoiceFlowFormData 组装音频文件和参数', () => {
  const formData = buildVoiceFlowFormData({
    audioBuffer: Buffer.from('abc'),
    audioId: 'audio-1',
    mode: 'translation',
    selected_text: 'selected',
    outputLanguage: 'en',
    parameters: { llm: { provider_id: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-5.4' } },
  }, {
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
  });

  assert.equal(formData.get('audio_id'), 'audio-1');
  assert.equal(formData.get('mode'), 'translation');
  assert.equal(formData.get('is_retry'), 'false');
  assert.equal(formData.get('device_name'), '');
});

test('createVoiceBackendClient 的模型接口失败时返回 backend_unavailable', async () => {
  const client = createVoiceBackendClient({
    fetchImpl: async () => {
      throw new Error('network down');
    },
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek', base_url: 'https://api.deepseek.com/v1', api_key: '', model: 'deepseek-chat', auth_type: 'bearer' }),
    normalizeLlmRequestConfig: (value) => value,
  });

  const result = await client.callModelBackend();

  assert.equal(result.success, false);
  assert.equal(result.code, 'backend_unavailable');
});

test('createVoiceBackendClient 的语音接口在后端未就绪时返回 backend_not_ready', async () => {
  const client = createVoiceBackendClient({
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ detail: 'not ready' }) }),
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek', base_url: 'https://api.deepseek.com/v1', api_key: '', model: 'deepseek-chat', auth_type: 'bearer' }),
    normalizeLlmRequestConfig: (value) => value,
    checkReadyFetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ detail: 'not ready' }) }),
  });

  const result = await client.callVoiceFlowBackend({
    audioBuffer: Buffer.from('abc'),
  });

  assert.equal(result.success, false);
  assert.equal(result.code, 'backend_not_ready');
});
