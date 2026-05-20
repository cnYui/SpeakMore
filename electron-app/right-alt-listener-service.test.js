const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { createRightAltListenerService } = require('./right-alt-listener-service');

function createFakeProcess() {
  const process = new EventEmitter();
  process.killed = false;
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.kill = () => {
    process.killed = true;
  };
  return process;
}

test('handleListenerLine 将普通按键 payload 转交给 relay', () => {
  const handled = [];
  const service = createRightAltListenerService({
    emitKeyboardState: () => undefined,
    createRelay: () => ({
      handlePayload: (payload) => handled.push(payload),
      dispose: () => undefined,
    }),
  });

  service.handleListenerLine('{"key":"RightAlt","isKeydown":true}');

  assert.deepEqual(handled, [{ key: 'RightAlt', isKeydown: true }]);
});

test('handleListenerLine 遇到 Escape keydown 时调用专用回调，不进入 relay', () => {
  let escapeCount = 0;
  let relayCount = 0;
  const service = createRightAltListenerService({
    emitKeyboardState: () => undefined,
    handleEscapeKeydown: () => {
      escapeCount += 1;
    },
    createRelay: () => ({
      handlePayload: () => {
        relayCount += 1;
      },
      dispose: () => undefined,
    }),
  });

  service.handleListenerLine('{"key":"Escape","isKeydown":true}');

  assert.equal(escapeCount, 1);
  assert.equal(relayCount, 0);
});

test('start 在非 Windows 平台不启动监听进程', () => {
  let spawned = false;
  const service = createRightAltListenerService({
    processPlatform: 'linux',
    spawnProcess: () => {
      spawned = true;
      return createFakeProcess();
    },
  });

  assert.equal(service.start(), false);
  assert.equal(spawned, false);
});

test('start 在 Windows 平台启动 PowerShell 并路由 stdout 行', () => {
  const child = createFakeProcess();
  const handled = [];
  const service = createRightAltListenerService({
    processPlatform: 'win32',
    rightAltListenerPath: () => 'D:\\right-alt-listener.ps1',
    spawnProcess: () => child,
    emitKeyboardState: () => undefined,
    createRelay: () => ({
      handlePayload: (payload) => handled.push(payload),
      dispose: () => undefined,
    }),
  });

  assert.equal(service.start(), true);
  child.stdout.emit('data', '{"key":"RightAlt","isKeydown":true}\n');

  assert.deepEqual(handled, [{ key: 'RightAlt', isKeydown: true }]);
});
