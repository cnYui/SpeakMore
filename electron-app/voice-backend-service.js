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

function createVoiceBackendService({
  isPackaged = false,
  backendExecutablePath = () => '',
  ffmpegBinDir = () => '',
  getModelCacheDir = () => '',
  spawnProcess,
  probeReady,
  processEnv = process.env,
  wait = delay,
  logger = console,
} = {}) {
  let child = null;
  let lastExit = null;

  function buildEnv() {
    const ffmpegDir = ffmpegBinDir();
    const env = {
      ...processEnv,
      PATH: [ffmpegDir, processEnv.PATH].filter(Boolean).join(';'),
      HOST: processEnv.HOST || '127.0.0.1',
      PORT: processEnv.PORT || '8000',
    };
    const modelCacheDir = typeof getModelCacheDir === 'function' ? String(getModelCacheDir() || '').trim() : '';
    if (modelCacheDir) env.TYPELESS_MODEL_CACHE_DIR = modelCacheDir;
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
    ensureReady,
    stop,
    getProcess: () => child,
    getLastExit: () => lastExit,
  };
}

module.exports = {
  createVoiceBackendService,
};
