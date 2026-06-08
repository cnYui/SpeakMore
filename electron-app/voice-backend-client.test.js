const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createVoiceBackendClient,
} = require('./voice-backend-client');
const {
  createVoiceBackendUrls,
} = require('./voice-backend-urls');
const {
  resolveVoiceServerProbeDetail,
} = require('./backend-http-utils');
const {
  buildVoiceFlowParameters,
  buildVoiceFlowFormData,
  bufferFromVoicePayload,
  normalizeVoiceMode,
} = require('./voice-flow-form-data');

test('createVoiceBackendUrls 统一生成后端接口 URL', () => {
  const urls = createVoiceBackendUrls('http://localhost:9000');

  assert.equal(urls.healthUrl, 'http://localhost:9000/health');
  assert.equal(urls.readyUrl, 'http://localhost:9000/ready');
  assert.equal(urls.modelStatusUrl, 'http://localhost:9000/model/status');
  assert.equal(urls.modelDownloadUrl, 'http://localhost:9000/model/download');
  assert.equal(urls.translationModelStatusUrl, 'http://localhost:9000/translation-model/status');
  assert.equal(urls.translationModelDownloadUrl, 'http://localhost:9000/translation-model/download');
  assert.equal(urls.translationModelLoadUrl, 'http://localhost:9000/translation-model/load');
  assert.equal(urls.translationModelUnloadUrl, 'http://localhost:9000/translation-model/unload');
  assert.equal(urls.voiceFlowUrl, 'http://localhost:9000/ai/voice_flow');
  assert.equal(urls.textRefineUrl, 'http://localhost:9000/ai/text_refine');
  assert.equal(urls.configReloadUrl, 'http://localhost:9000/config/reload');
  assert.equal('modelsUrl' in urls, false);
});

test('resolveVoiceServerProbeDetail 优先使用后端 detail 或 status', () => {
  assert.equal(resolveVoiceServerProbeDetail('/ready', 503, { detail: 'warming' }), 'warming');
  assert.equal(resolveVoiceServerProbeDetail('/ready', 200, { status: 'ready' }), 'ready');
  assert.equal(resolveVoiceServerProbeDetail('/ready', 503, null), '/ready 返回 503');
});

test('normalizeVoiceMode 统一兼容听写、翻译和自由提问模式', () => {
  assert.equal(normalizeVoiceMode('dictation'), 'transcript');
  assert.equal(normalizeVoiceMode('ask_anything'), 'ask_anything');
  assert.equal(normalizeVoiceMode('translation'), 'translation');
  assert.equal(normalizeVoiceMode('custom-command'), 'custom_command');
  assert.equal(normalizeVoiceMode('meeting-notes'), 'meeting_notes');
  assert.equal(normalizeVoiceMode('unknown'), 'transcript');
});

test('bufferFromVoicePayload 兼容 Buffer、ArrayBuffer、TypedArray 和序列化 Buffer', () => {
  assert.deepEqual(bufferFromVoicePayload({ audioBuffer: Buffer.from('abc') }), Buffer.from('abc'));
  assert.deepEqual(bufferFromVoicePayload({ arrayBuffer: Uint8Array.from([1, 2]).buffer }), Buffer.from([1, 2]));
  assert.deepEqual(bufferFromVoicePayload({ data: Uint8Array.from([3, 4]) }), Buffer.from([3, 4]));
  assert.deepEqual(bufferFromVoicePayload({ audio: { type: 'Buffer', data: [5, 6] } }), Buffer.from([5, 6]));
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

test('createVoiceBackendClient 不再暴露旧模型管理接口', async () => {
  const client = createVoiceBackendClient({
    fetchImpl: async () => {
      throw new Error('network down');
    },
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek', base_url: 'https://api.deepseek.com/v1', api_key: '', model: 'deepseek-chat', auth_type: 'bearer' }),
    normalizeLlmRequestConfig: (value) => value,
  });

  assert.equal('callModelBackend' in client, false);
});

test('createVoiceBackendClient 查询并触发单模型初始化接口', async () => {
  const calls = [];
  const client = createVoiceBackendClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: init?.method === 'POST' ? 'downloading' : 'idle',
          detail: '模型状态',
          model_id: 'sensevoice-small',
        }),
      };
    },
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek', base_url: 'https://api.deepseek.com/v1', api_key: '', model: 'deepseek-chat', auth_type: 'bearer' }),
    normalizeLlmRequestConfig: (value) => value,
  });

  const status = await client.getVoiceModelStatus();
  const download = await client.startVoiceModelDownload();

  assert.equal(status.status, 'idle');
  assert.equal(download.status, 'downloading');
  assert.equal(calls[0].url, 'http://127.0.0.1:8000/model/status');
  assert.equal(calls[1].url, 'http://127.0.0.1:8000/model/download');
  assert.equal(calls[1].init.method, 'POST');
});

test('createVoiceBackendClient manages optional local translation model endpoints', async () => {
  const calls = [];
  const client = createVoiceBackendClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: init?.method === 'POST' ? 'loading' : 'idle',
          detail: '',
          model_id: 'hy-mt-1.5-1.8b-2bit',
        }),
      };
    },
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek', base_url: 'https://api.deepseek.com/v1', api_key: '', model: 'deepseek-chat', auth_type: 'bearer' }),
    normalizeLlmRequestConfig: (value) => value,
  });

  await client.getTranslationModelStatus({ cacheDir: 'D:\\Models\\HyMT' });
  await client.startTranslationModelDownload({ cacheDir: 'D:\\Models\\HyMT' });
  await client.loadTranslationModel({ cacheDir: 'D:\\Models\\HyMT' });
  await client.unloadTranslationModel({ cacheDir: 'D:\\Models\\HyMT' });

  assert.equal(calls[0].url, 'http://127.0.0.1:8000/translation-model/status?cache_dir=D%3A%5CModels%5CHyMT');
  assert.equal(calls[1].url, 'http://127.0.0.1:8000/translation-model/download');
  assert.equal(calls[1].init.body, JSON.stringify({ cache_dir: 'D:\\Models\\HyMT' }));
  assert.equal(calls[2].url, 'http://127.0.0.1:8000/translation-model/load');
  assert.equal(calls[3].url, 'http://127.0.0.1:8000/translation-model/unload');
});

test('createVoiceBackendClient 在模型状态接口暂不可连接时返回 unavailable', async () => {
  const client = createVoiceBackendClient({
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek', base_url: 'https://api.deepseek.com/v1', api_key: '', model: 'deepseek-chat', auth_type: 'bearer' }),
    normalizeLlmRequestConfig: (value) => value,
  });

  const status = await client.getVoiceModelStatus();
  const download = await client.startVoiceModelDownload();

  assert.equal(status.success, false);
  assert.equal(status.status, 'unavailable');
  assert.match(status.detail, /无法连接/);
  assert.equal(download.success, false);
  assert.equal(download.status, 'unavailable');
  assert.match(download.detail, /无法连接/);
});

test('createVoiceBackendClient 会把用户选择的模型缓存目录传给后端', async () => {
  const calls = [];
  const client = createVoiceBackendClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'idle',
          detail: '',
          model_id: 'sensevoice-small',
          cache_dir: 'D:\\Models\\FunASR',
        }),
      };
    },
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek', base_url: 'https://api.deepseek.com/v1', api_key: '', model: 'deepseek-chat', auth_type: 'bearer' }),
    normalizeLlmRequestConfig: (value) => value,
  });

  await client.getVoiceModelStatus({ cacheDir: 'D:\\Models\\FunASR' });
  await client.startVoiceModelDownload({ cacheDir: 'D:\\Models\\FunASR' });

  assert.equal(calls[0].url, 'http://127.0.0.1:8000/model/status?cache_dir=D%3A%5CModels%5CFunASR');
  assert.equal(calls[1].url, 'http://127.0.0.1:8000/model/download');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers['content-type'], 'application/json');
  assert.equal(calls[1].init.body, JSON.stringify({ cache_dir: 'D:\\Models\\FunASR' }));
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

test('createVoiceBackendClient 文本重试接口会发送已有文本和当前 LLM 参数', async () => {
  const calls = [];
  const client = createVoiceBackendClient({
    voiceServerUrl: 'http://localhost:9000',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'OK',
          data: {
            refine_text: 'hello refined',
            user_prompt: 'hello raw',
            web_metadata: null,
            external_action: null,
          },
        }),
      };
    },
    buildCurrentLlmRequestConfig: () => ({ provider_id: 'deepseek', model: 'deepseek-chat' }),
    normalizeLlmRequestConfig: (value) => value,
  });

  const result = await client.callTextRefineBackend({
    text: 'hello raw',
    mode: 'Dictate',
    audioContext: { source: 'history_retry' },
    parameters: { extra: 'value' },
  });

  assert.equal(result.success, true);
  assert.equal(result.refine_text, 'hello refined');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:9000/ai/text_refine');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.text, 'hello raw');
  assert.equal(body.mode, 'transcript');
  assert.deepEqual(body.audio_context, { source: 'history_retry' });
  assert.equal(body.parameters.extra, 'value');
  assert.deepEqual(body.parameters.llm, { provider_id: 'deepseek', model: 'deepseek-chat' });
});
