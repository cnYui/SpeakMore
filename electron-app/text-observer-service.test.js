const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { createTextObserverService } = require('./text-observer-service');

function createFakeProcess() {
  const process = new EventEmitter();
  process.killed = false;
  process.stdin = {
    writable: true,
    writes: [],
    write(chunk) {
      this.writes.push(chunk);
      return true;
    },
  };
  process.stdout = new EventEmitter();
  process.stdout.setEncoding = () => {};
  process.stderr = new EventEmitter();
  process.stderr.setEncoding = () => {};
  process.kill = () => {
    process.killed = true;
  };
  return process;
}

test('createTextObserverService 启动时向 helper 发送 observe-start', async () => {
  const child = createFakeProcess();
  const spawnCalls = [];
  const service = createTextObserverService({
    processPlatform: 'win32',
    exePath: 'C:\\helper.exe',
    spawnProcess: (...args) => {
      spawnCalls.push(args);
      return child;
    },
    learnCorrection: async () => undefined,
    createSessionManager: undefined,
  });

  const result = await service.textObservationManager.start({
    audioId: 'audio-1',
    pastedText: 'hello',
    focusInfo: null,
  });

  assert.equal(result.success, true);
  assert.equal(spawnCalls.length, 1);
  assert.match(child.stdin.writes[0], /"type":"observe-start"/);
  await service.textObservationManager.stop('test');
});

test('createTextObserverService 观察到文本修改后会调用 learnCorrection', async () => {
  const child = createFakeProcess();
  const learned = [];
  const service = createTextObserverService({
    processPlatform: 'win32',
    exePath: 'C:\\helper.exe',
    spawnProcess: () => child,
    learnCorrection: async (candidate) => {
      learned.push(candidate);
    },
  });

  await service.textObservationManager.start({
    audioId: 'audio-2',
    pastedText: 'client to api',
    focusInfo: null,
  });
  const result = await service.textObservationManager.handleObservedText({
    audioId: 'audio-2',
    text: 'Client2API',
  });

  assert.equal(result.success, true);
  assert.equal(learned.length > 0, true);
  assert.equal(child.stdin.writes.some((chunk) => chunk.includes('"type":"observe-stop"')), true);
  await service.textObservationManager.stop('test');
});
