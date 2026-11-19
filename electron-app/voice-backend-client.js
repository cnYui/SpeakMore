const {
  DEFAULT_VOICE_SERVER_URL,
  createVoiceBackendUrls,
} = require('./voice-backend-urls');
const {
  readJsonSafely,
  resolveVoiceServerProbeDetail,
  probeVoiceServer,
} = require('./backend-http-utils');
const {
  normalizeVoiceMode,
  bufferFromVoicePayload,
  appendJsonFormField,
  parseJsonObject,
  buildVoiceFlowParameters,
  buildVoiceFlowFormData,
} = require('./voice-flow-form-data');
const { createVoiceConfigClient } = require('./voice-config-client');

function createVoiceBackendClient({
  voiceServerUrl = DEFAULT_VOICE_SERVER_URL,
  fetchImpl = fetch,
  checkReadyFetchImpl = fetchImpl,
  buildCurrentLlmRequestConfig = () => ({}),
  normalizeLlmRequestConfig = (value) => value || null,
} = {}) {
  const urls = createVoiceBackendUrls(voiceServerUrl);
  const formOptions = { buildCurrentLlmRequestConfig, normalizeLlmRequestConfig };
  const reloadVoiceServerConfig = createVoiceConfigClient({
    configReloadUrl: urls.configReloadUrl,
    fetchImpl,
    readJsonSafely,
    resolveVoiceServerProbeDetail,
  });

  async function checkVoiceServerReady() {
    return probeVoiceServer(urls.readyUrl, { fetchImpl: checkReadyFetchImpl });
  }

  function normalizeModelCacheDirOption(options = {}) {
    return typeof options.cacheDir === 'string' ? options.cacheDir.trim() : '';
  }

  function normalizeModelIdOption(options = {}) {
    return typeof options.modelId === 'string' ? options.modelId.trim() : '';
  }

  function withModelCacheDirQuery(url, options = {}) {
    const cacheDir = normalizeModelCacheDirOption(options);
    const modelId = normalizeModelIdOption(options);
    if (!cacheDir && !modelId) return url;
    const nextUrl = new URL(url);
    if (cacheDir) nextUrl.searchParams.set('cache_dir', cacheDir);
    if (modelId) nextUrl.searchParams.set('model_id', modelId);
    return nextUrl.toString();
  }

  // load=false 只下载不切换；省略 load 时后端下载后加载为当前模型（兼容旧调用）。
  function buildModelDownloadInit(options = {}) {
    const cacheDir = normalizeModelCacheDirOption(options);
    const modelId = normalizeModelIdOption(options);
    const body = {};
    if (cacheDir) body.cache_dir = cacheDir;
    if (modelId) body.model_id = modelId;
    if (options.load === false) body.load = false;
    if (!Object.keys(body).length) return { method: 'POST' };
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  async function getVoiceModelStatus(options = {}) {
    const url = withModelCacheDirQuery(urls.modelStatusUrl, options);
    let response = null;
    let payload = null;
    try {
      response = await fetchImpl(url);
      payload = await readJsonSafely(response);
    } catch {
      return {
        success: false,
        status: 'unavailable',
        detail: resolveVoiceServerProbeDetail(url, 0, null),
        payload: null,
      };
    }
    if (!response.ok || !payload || typeof payload !== 'object') {
      return {
        success: false,
        status: 'unavailable',
        detail: resolveVoiceServerProbeDetail(url, response.status, payload),
        payload,
      };
    }
    return {
      success: true,
      ...payload,
      payload,
    };
  }

  async function startVoiceModelDownload(options = {}) {
    let response = null;
    let payload = null;
    try {
      response = await fetchImpl(urls.modelDownloadUrl, buildModelDownloadInit(options));
      payload = await readJsonSafely(response);
    } catch {
      return {
        success: false,
        status: 'unavailable',
        detail: resolveVoiceServerProbeDetail(urls.modelDownloadUrl, 0, null),
        payload: null,
      };
    }
    if (!response.ok || !payload || typeof payload !== 'object') {
      return {
        success: false,
        status: 'unavailable',
        detail: resolveVoiceServerProbeDetail(urls.modelDownloadUrl, response.status, payload),
        payload,
      };
    }
    return {
      success: true,
      ...payload,
      payload,
    };
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
    getVoiceModelStatus,
    startVoiceModelDownload,
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
