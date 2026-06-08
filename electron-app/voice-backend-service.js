const path = require('path');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isModelMissingReadyState(result) {
  const payload = result?.payload;
  if (!payload || typeof payload !== 'object') return false;
  const status = typeof payload.status === 'string' ? payload.status : '';
  const detail = typeof result.detail === 'string' ? result.detail : '';
  if (status === 'downloading' || status === 'loading') return false;
  return payload.cached === false && (
    status === 'idle'
    || detail.includes('尚未下载')
  );
}

function isCachedIdleModelStatus(result) {
  if (!result || typeof result !== 'object') return false;
  const status = typeof result.status === 'string' ? result.status : '';
  return result.cached === true && result.ready !== true && status === 'idle';
}

function isTerminalOrBusyModelStatus(result) {
  if (!result || typeof result !== 'object') return false;
  const status = typeof result.status === 'string' ? result.status : '';
  return result.ready === true || ['ready', 'loading', 'downloading'].includes(status);
}

function createVoiceBackendService({
  isPackaged = false,
  backendExecutablePath = () => '',
  ffmpegBinDir = () => '',
  getModelCacheDir = () => '',
  getTranslationModelCacheDir = () => '',
  getAsrDeviceMode = () => 'default',
  llamaServerPath = () => '',
  hyMtLlamaServerPath = () => '',
  spawnProcess,
  probeReady,
  probeModelStatus,
  startModelLoad,
  processEnv = process.env,
  pathDelimiter = path.delimiter,
  wait = delay,
  logger = console,
} = {}) {
  let child = null;
  let lastExit = null;

  function normalizeAsrDeviceMode(value) {
    return ['mps', 'cuda', 'cpu'].includes(value) ? value : 'default';
  }

  function buildEnv() {
    const ffmpegDir = ffmpegBinDir();
    const env = {
      ...processEnv,
      PATH: [ffmpegDir, processEnv.PATH].filter(Boolean).join(pathDelimiter),
      HOST: processEnv.HOST || '127.0.0.1',
      PORT: processEnv.PORT || '8000',
    };
    const modelCacheDir = typeof getModelCacheDir === 'function' ? String(getModelCacheDir() || '').trim() : '';
    if (modelCacheDir) env.TYPELESS_MODEL_CACHE_DIR = modelCacheDir;
    const translationModelCacheDir = typeof getTranslationModelCacheDir === 'function'
      ? String(getTranslationModelCacheDir() || '').trim()
      : '';
    if (translationModelCacheDir) env.SPEAKMORE_TRANSLATION_MODEL_CACHE_DIR = translationModelCacheDir;
    const resolvedLlamaServerPath = typeof llamaServerPath === 'function' ? String(llamaServerPath() || '').trim() : '';
    if (resolvedLlamaServerPath && !env.SPEAKMORE_BUNDLED_LLAMA_SERVER_PATH) {
      env.SPEAKMORE_BUNDLED_LLAMA_SERVER_PATH = resolvedLlamaServerPath;
    }
    const resolvedHyMtLlamaServerPath = typeof hyMtLlamaServerPath === 'function'
      ? String(hyMtLlamaServerPath() || '').trim()
      : '';
    if (resolvedHyMtLlamaServerPath && !env.SPEAKMORE_BUNDLED_HYMT_LLAMA_SERVER_PATH) {
      env.SPEAKMORE_BUNDLED_HYMT_LLAMA_SERVER_PATH = resolvedHyMtLlamaServerPath;
    }
    const asrDeviceMode = normalizeAsrDeviceMode(
      typeof getAsrDeviceMode === 'function' ? String(getAsrDeviceMode() || '').trim() : '',
    );
    delete env.FUNASR_DEVICE;
    if (asrDeviceMode === 'mps') env.FUNASR_DEVICE = 'mps';
    if (asrDeviceMode === 'cuda') env.FUNASR_DEVICE = 'cuda:0';
    if (asrDeviceMode === 'cpu') env.FUNASR_DEVICE = 'cpu';
    return env;
  }

  async function start() {
    if (!isPackaged) {
      return { success: true, skipped: true, detail: '开发模式不自动拉起后端' };
    }
    if (child && !child.killed) {
      return { success: true, skipped: false, detail: '后端已启动' };
    }
    if (typeof spawnProcess !== 'function') {
      return { success: false, detail: '缺少后端进程启动器', code: 'backend_spawn_missing' };
    }

    lastExit = null;
    const command = backendExecutablePath();
    child = spawnProcess(command, [], {
      windowsHide: true,
      env: buildEnv(),
    });
    child.stdout?.on?.('data', (chunk) => logger.info?.(`[voice-backend] ${String(chunk).trim()}`));
    child.stderr?.on?.('data', (chunk) => logger.warn?.(`[voice-backend] ${String(chunk).trim()}`));
    child.on?.('exit', (code, signal) => {
      lastExit = { code, signal };
      child = null;
      logger.warn?.('[voice-backend] exited', lastExit);
    });
    child.on?.('error', (error) => {
      lastExit = { code: 'spawn_error', signal: String(error?.message || error) };
      child = null;
      logger.error?.('[voice-backend] spawn error', error);
    });
    return { success: true, skipped: false, detail: '后端启动中' };
  }

  async function startAndPreloadCachedModel({ timeoutMs = 60000, intervalMs = 700 } = {}) {
    const startResult = await start();
    if (startResult?.success === false) return startResult;
    if (typeof probeModelStatus !== 'function' || typeof startModelLoad !== 'function') {
      return { success: true, skipped: true, detail: '未配置模型自动加载' };
    }

    const startedAt = Date.now();
    let latest = null;
    while (Date.now() - startedAt <= timeoutMs) {
      try {
        latest = await probeModelStatus();
      } catch (error) {
        latest = {
          success: false,
          status: 'unavailable',
          detail: String(error?.message || error || '语音后端暂不可用'),
        };
      }
      if (isCachedIdleModelStatus(latest)) {
        logger.info?.('[voice-backend] cached model found, starting preload');
        return startModelLoad();
      }
      if (isTerminalOrBusyModelStatus(latest) || latest?.cached === false) {
        return { success: true, skipped: true, detail: '无需自动加载模型', payload: latest };
      }
      if (lastExit) {
        return {
          success: false,
          detail: `语音后端已退出: ${JSON.stringify(lastExit)}`,
          code: 'backend_exited',
        };
      }
      await wait(intervalMs);
    }

    return {
      success: false,
      detail: latest?.detail || '等待语音模型状态超时',
      code: 'model_status_timeout',
      payload: latest,
    };
  }

  async function ensureReady({ timeoutMs = 120000, intervalMs = 700 } = {}) {
    const startResult = await start();
    if (startResult?.success === false) return startResult;

    const startedAt = Date.now();
    let latest = null;

    while (Date.now() - startedAt <= timeoutMs) {
      latest = await probeReady();
      if (latest?.success) return latest;
      if (isModelMissingReadyState(latest)) {
        return {
          success: false,
          detail: '还没有下载语音模型，请先下载模型。',
          code: 'voice_model_missing',
          payload: latest.payload,
        };
      }
      if (lastExit) {
        return {
          success: false,
          detail: `语音后端已退出: ${JSON.stringify(lastExit)}`,
          code: 'backend_exited',
        };
      }
      await wait(intervalMs);
    }

    return {
      success: false,
      detail: latest?.detail || '语音后端启动超时',
      code: 'backend_ready_timeout',
    };
  }

  function stop() {
    if (child && !child.killed) child.kill();
    child = null;
  }

  return {
    start,
    startAndPreloadCachedModel,
    ensureReady,
    stop,
    getProcess: () => child,
    getLastExit: () => lastExit,
  };
}

module.exports = {
  createVoiceBackendService,
};
