const crypto = require('crypto');

const DEFAULT_VOICE_SERVER_URL = 'http://127.0.0.1:8000';

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function createVoiceBackendUrls(voiceServerUrl = DEFAULT_VOICE_SERVER_URL) {
  return {
    healthUrl: `${voiceServerUrl}/health`,
    readyUrl: `${voiceServerUrl}/ready`,
    voiceFlowUrl: `${voiceServerUrl}/ai/voice_flow`,
    modelsUrl: `${voiceServerUrl}/models`,
    configReloadUrl: `${voiceServerUrl}/config/reload`,
  };
}

function resolveVoiceServerProbeDetail(url, status, payload) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.detail === 'string' && payload.detail) return payload.detail;
    if (typeof payload.status === 'string' && payload.status) return payload.status;
  }

  return status > 0 ? `${url} 返回 ${status}` : `无法连接 ${url}`;
}

async function probeVoiceServer(url, {
  fetchImpl = fetch,
  timeoutMs = 700,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    const payload = await readJsonSafely(response);
    return {
      success: response.ok,
      status: response.status,
      detail: resolveVoiceServerProbeDetail(url, response.status, payload),
      payload,
    };
  } catch {
    return {
      success: false,
      status: 0,
      detail: `无法连接 ${url}`,
      payload: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeVoiceMode(mode) {
  const normalized = String(mode || 'transcript').toLowerCase();
  if (normalized === 'dictate' || normalized === 'dictation') return 'transcript';
  if (normalized === 'ask' || normalized === 'ask_anything') return 'ask_anything';
  if (normalized === 'translate' || normalized === 'translation') return 'translation';
  return 'transcript';
}

function bufferFromVoicePayload(payload = {}) {
  const candidates = [
    payload.arrayBuffer,
    payload.audioBuffer,
    payload.buffer,
    payload.data,
    payload.audio,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Buffer.isBuffer(candidate)) return candidate;
    if (candidate instanceof ArrayBuffer) return Buffer.from(candidate);
    if (ArrayBuffer.isView(candidate)) {
      return Buffer.from(candidate.buffer, candidate.byteOffset, candidate.byteLength);
    }
    if (candidate.type === 'Buffer' && Array.isArray(candidate.data)) {
      return Buffer.from(candidate.data);
    }
    if (typeof candidate === 'string') {
      return Buffer.from(candidate, 'base64');
    }
  }

  return null;
}

function appendJsonFormField(formData, name, value, fallback = {}) {
  if (typeof value === 'string') {
    formData.append(name, value || JSON.stringify(fallback));
    return;
  }
  formData.append(name, JSON.stringify(value || fallback));
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return typeof value === 'object' ? value : fallback;
}

function buildVoiceFlowParameters(payload = {}, {
  buildCurrentLlmRequestConfig = () => ({}),
  normalizeLlmRequestConfig = (value) => value || null,
} = {}) {
  const parameters = parseJsonObject(payload.parameters);
  const audioContext = parseJsonObject(payload.audioContext || payload.audio_context);
  const modeConfig = parseJsonObject(payload.modeConfig || payload.mode_config);

  const selectedText = (
    parameters.selected_text
    || payload.selectedText
    || payload.selected_text
    || audioContext.selected_text
    || audioContext.selectedText
    || ''
  );
  const outputLanguage = (
    parameters.output_language
    || payload.outputLanguage
    || payload.output_language
    || modeConfig.output_language
    || modeConfig.outputLanguage
    || ''
  );

  return {
    ...parameters,
    llm: normalizeLlmRequestConfig(parameters.llm) || buildCurrentLlmRequestConfig(),
    ...(selectedText ? { selected_text: selectedText } : {}),
    ...(outputLanguage ? { output_language: outputLanguage } : {}),
  };
}

function buildVoiceFlowFormData(payload = {}, options = {}) {
  const audioBuffer = bufferFromVoicePayload(payload);
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('缺少音频数据');
  }

  const mimeType = payload.mimeType || payload.contentType || 'audio/webm;codecs=opus';
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm';
  const audioId = payload.audioId || payload.audio_id || crypto.randomUUID();
  const formData = new FormData();
  const audioBlob = new Blob([audioBuffer], { type: mimeType });

  formData.append('audio_file', audioBlob, `${audioId}.${extension}`);
  formData.append('audio_id', audioId);
  formData.append('mode', normalizeVoiceMode(payload.mode));
  appendJsonFormField(formData, 'audio_context', payload.audioContext || payload.audio_context);
  appendJsonFormField(formData, 'audio_metadata', payload.audioMetadata || payload.audio_metadata);
  appendJsonFormField(formData, 'parameters', buildVoiceFlowParameters(payload, options));
  formData.append('is_retry', String(Boolean(payload.isRetry || payload.is_retry)));
  formData.append('device_name', payload.deviceName || payload.device_name || '');
  formData.append('user_over_time', String(payload.userOverTime || payload.user_over_time || ''));
  formData.append('send_time', String(Date.now()));

  return formData;
}

function createVoiceBackendClient({
  voiceServerUrl = DEFAULT_VOICE_SERVER_URL,
  fetchImpl = fetch,
  checkReadyFetchImpl = fetchImpl,
  buildCurrentLlmRequestConfig = () => ({}),
  normalizeLlmRequestConfig = (value) => value || null,
} = {}) {
  const urls = createVoiceBackendUrls(voiceServerUrl);
  const formOptions = { buildCurrentLlmRequestConfig, normalizeLlmRequestConfig };

  async function checkVoiceServerReady() {
    return probeVoiceServer(urls.readyUrl, { fetchImpl: checkReadyFetchImpl });
  }

  async function callModelBackend(pathname = '', options = {}) {
    const url = `${urls.modelsUrl}${pathname}`;
    try {
      const response = await fetchImpl(url, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const payload = await readJsonSafely(response);

      if (!response.ok) {
        return {
          success: false,
          code: response.status === 0 ? 'backend_unavailable' : 'model_request_failed',
          detail: payload?.detail || resolveVoiceServerProbeDetail(url, response.status, payload),
          data: payload,
        };
      }

      return { success: true, data: payload };
    } catch (error) {
      return {
        success: false,
        code: 'backend_unavailable',
        detail: error instanceof Error ? error.message : String(error),
        data: null,
      };
    }
  }

  async function reloadVoiceServerConfig() {
    try {
      const response = await fetchImpl(urls.configReloadUrl, { method: 'POST' });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        return {
          success: false,
          code: 'config_reload_failed',
          detail: payload?.detail || resolveVoiceServerProbeDetail(urls.configReloadUrl, response.status, payload),
          data: payload,
        };
      }
      return { success: true, detail: payload?.detail || '大模型配置已重载', data: payload };
    } catch (error) {
      return {
        success: false,
        code: 'backend_unavailable',
        detail: error instanceof Error ? error.message : String(error),
        data: null,
      };
    }
  }

  async function callVoiceFlowBackend(payload = {}) {
    const readyState = await checkVoiceServerReady();
    if (!readyState.success) {
      return {
        success: false,
        aborted: false,
        debug: readyState.payload,
        detail: readyState.detail,
        code: 'backend_not_ready',
        paywall: null,
        error: readyState.detail,
      };
    }

    const response = await fetchImpl(urls.voiceFlowUrl, {
      method: 'POST',
      body: buildVoiceFlowFormData(payload, formOptions),
    });
    const result = await readJsonSafely(response);

    if (!response.ok || !result || typeof result !== 'object' || result?.status === 'ERROR') {
      const detail = result?.data?.detail || result?.data?.refine_text || resolveVoiceServerProbeDetail(urls.voiceFlowUrl, response.status, result);
      return {
        success: false,
        aborted: false,
        debug: result,
        detail,
        code: result?.data?.code || 'voice_flow_failed',
        paywall: result?.data?.important_notification || null,
        web_metadata: result?.data?.web_metadata ?? null,
        external_action: result?.data?.external_action ?? null,
        error: result?.data?.refine_text || detail,
      };
    }

    const resultData = result.data || {};

    return {
      success: true,
      aborted: false,
      debug: result,
      data: resultData,
      detail: '',
      code: '',
      paywall: null,
      web_metadata: resultData.web_metadata ?? null,
      external_action: resultData.external_action ?? null,
      ...resultData,
    };
  }

  return {
    urls,
    checkVoiceServerReady,
    callModelBackend,
    reloadVoiceServerConfig,
    callVoiceFlowBackend,
  };
}

module.exports = {
  DEFAULT_VOICE_SERVER_URL,
  createVoiceBackendUrls,
  createVoiceBackendClient,
  readJsonSafely,
  resolveVoiceServerProbeDetail,
  probeVoiceServer,
  normalizeVoiceMode,
  bufferFromVoicePayload,
  appendJsonFormField,
  parseJsonObject,
  buildVoiceFlowParameters,
  buildVoiceFlowFormData,
};
