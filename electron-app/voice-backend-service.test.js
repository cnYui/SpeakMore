const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createVoiceBackendService } = require('./voice-backend-service');

function createChild() {
  const child = new EventEmitter();
  child.pid = 1234;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.killed = true;
    child.emit('exit', 0, null);
  };
  return child;
}

test('start 在打包态启动后端 exe 并注入 ffmpeg PATH', async () => {
  const child = createChild();
  const calls = [];
  const service = createVoiceBackendService({
    isPackaged: true,
    backendExecutablePath: () => 'C:\\app\\resources\\backend\\speakmore-backend.exe',
    ffmpegBinDir: () => 'C:\\app\\resources\\ffmpeg\\bin',
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    },
    probeReady: async () => ({ success: false, detail: 'starting' }),
    logger: { info() {}, warn() {}, error() {} },
  });

  const result = await service.start();

  assert.equal(result.success, true);
  assert.equal(calls[0].command, 'C:\\app\\resources\\backend\\speakmore-backend.exe');
  assert.deepEqual(calls[0].args, []);
  assert.match(calls[0].options.env.PATH, /ffmpeg\\bin/);
});

test('start 在打包态启动后端 exe 时注入用户选择的模型缓存目录', async () => {
  const child = createChild();
  const calls = [];
  const service = createVoiceBackendService({
    isPackaged: true,
    backendExecutablePath: () => 'C:\\app\\resources\\backend\\speakmore-backend.exe',
    ffmpegBinDir: () => 'C:\\app\\resources\\ffmpeg\\bin',
    getModelCacheDir: () => 'D:\\Models\\FunASR',
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    },
    probeReady: async () => ({ success: false, detail: 'starting' }),
    logger: { info() {}, warn() {}, error() {} },
  });

  await service.start();

  assert.equal(calls[0].options.env.TYPELESS_MODEL_CACHE_DIR, 'D:\\Models\\FunASR');
});

test('ensureReady 启动后轮询 ready 成功', async () => {
  const child = createChild();
  let probeCount = 0;
  const service = createVoiceBackendService({
    isPackaged: true,
    backendExecutablePath: () => 'C:\\backend.exe',
    ffmpegBinDir: () => 'C:\\ffmpeg\\bin',
    spawnProcess: () => child,
    probeReady: async () => {
      probeCount += 1;
      return probeCount >= 2
        ? { success: true, detail: 'ready' }
        : { success: false, detail: 'starting' };
    },
    wait: async () => undefined,
    logger: { info() {}, warn() {}, error() {} },
  });

  const result = await service.ensureReady({ timeoutMs: 1000, intervalMs: 1 });

  assert.equal(result.success, true);
  assert.equal(probeCount, 2);
});

test('ensureReady 发现模型未缓存时直接提示先下载模型', async () => {
  const child = createChild();
  let probeCount = 0;
  let waitCount = 0;
  const service = createVoiceBackendService({
    isPackaged: true,
    backendExecutablePath: () => 'C:\\backend.exe',
    ffmpegBinDir: () => 'C:\\ffmpeg\\bin',
    spawnProcess: () => child,
    probeReady: async () => {
      probeCount += 1;
      return {
        success: false,
        detail: 'SenseVoiceSmall 模型尚未下载或加载',
        payload: { status: 'idle', cached: false, ready: false },
      };
    },
    wait: async () => {
      waitCount += 1;
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  const result = await service.ensureReady({ timeoutMs: 1000, intervalMs: 1 });

  assert.equal(result.success, false);
  assert.equal(result.code, 'voice_model_missing');
  assert.equal(result.detail, '还没有下载语音模型，请先下载模型。');
  assert.equal(probeCount, 1);
  assert.equal(waitCount, 0);
});

test('ensureReady 在后端退出时返回明确错误', async () => {
  const child = createChild();
  const service = createVoiceBackendService({
    isPackaged: true,
    backendExecutablePath: () => 'C:\\backend.exe',
    ffmpegBinDir: () => 'C:\\ffmpeg\\bin',
    spawnProcess: () => child,
    probeReady: async () => ({ success: false, detail: 'ASR 模型预热中' }),
    wait: async () => child.emit('exit', 1, null),
    logger: { info() {}, warn() {}, error() {} },
  });

  const result = await service.ensureReady({ timeoutMs: 1000, intervalMs: 1 });

  assert.equal(result.success, false);
  assert.equal(result.code, 'backend_exited');
  assert.match(result.detail, /语音后端已退出/);
});

test('stop 结束已启动的后端进程', async () => {
  const child = createChild();
  const service = createVoiceBackendService({
    isPackaged: true,
    backendExecutablePath: () => 'C:\\backend.exe',
    ffmpegBinDir: () => 'C:\\ffmpeg\\bin',
    spawnProcess: () => child,
    probeReady: async () => ({ success: true, detail: 'ready' }),
    logger: { info() {}, warn() {}, error() {} },
  });

  await service.start();
  service.stop();

  assert.equal(child.killed, true);
});
