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

  function normalizeTranslationModelCacheDirOption(options = {}) {
    return typeof options.cacheDir === 'string' ? options.cacheDir.trim() : '';
  }

  function withModelCacheDirQuery(url, options = {}) {
    const cacheDir = normalizeModelCacheDirOption(options);
    if (!cacheDir) return url;
    const nextUrl = new URL(url);
    nextUrl.searchParams.set('cache_dir', cacheDir);
    return nextUrl.toString();
  }

  function withTranslationModelCacheDirQuery(url, options = {}) {
    const cacheDir = normalizeTranslationModelCacheDirOption(options);
    if (!cacheDir) return url;
    const nextUrl = new URL(url);
    nextUrl.searchParams.set('cache_dir', cacheDir);
    return nextUrl.toString();
  }

  function buildModelDownloadInit(options = {}) {
    const cacheDir = normalizeModelCacheDirOption(options);
    if (!cacheDir) return { method: 'POST' };
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cache_dir: cacheDir }),
    };
  }

  function buildTranslationModelJsonInit(options = {}) {
    const cacheDir = normalizeTranslationModelCacheDirOption(options);
    if (!cacheDir) return { method: 'POST' };
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cache_dir: cacheDir }),
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

  async function getTranslationModelStatus(options = {}) {
    const url = withTranslationModelCacheDirQuery(urls.translationModelStatusUrl, options);
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

  async function callTranslationModelAction(url, options = {}) {
    let response = null;
    let payload = null;
    try {
      response = await fetchImpl(url, buildTranslationModelJsonInit(options));
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

  async function startTranslationModelDownload(options = {}) {
    return callTranslationModelAction(urls.translationModelDownloadUrl, options);
  }

  async function loadTranslationModel(options = {}) {
    return callTranslationModelAction(urls.translationModelLoadUrl, options);
  }

  async function unloadTranslationModel(options = {}) {
    return callTranslationModelAction(urls.translationModelUnloadUrl, options);
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

  async function callTextRefineBackend(payload = {}) {
    let response = null;
    let result = null;
    try {
      response = await fetchImpl(urls.textRefineUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: String(payload.text || payload.rawText || payload.raw_text || ''),
          mode: normalizeVoiceMode(payload.mode),
          audio_context: parseJsonObject(payload.audioContext || payload.audio_context),
          parameters: buildVoiceFlowParameters(payload, formOptions),
        }),
      });
      result = await readJsonSafely(response);
    } catch (error) {
      return {
        success: false,
        aborted: false,
        debug: result,
        detail: String(error?.message || error || 'text refine request failed'),
        code: 'text_refine_unavailable',
        paywall: null,
        error: String(error?.message || error || 'text refine request failed'),
      };
    }

    if (!response.ok || !result || typeof result !== 'object' || result?.status === 'ERROR') {
      const detail = result?.data?.detail || result?.data?.refine_text || resolveVoiceServerProbeDetail(urls.textRefineUrl, response.status, result);
      return {
        success: false,
        aborted: false,
        debug: result,
        detail,
        code: result?.data?.code || 'text_refine_failed',
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
    getTranslationModelStatus,
    startTranslationModelDownload,
    loadTranslationModel,
    unloadTranslationModel,
    reloadVoiceServerConfig,
    callVoiceFlowBackend,
    callTextRefineBackend,
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
