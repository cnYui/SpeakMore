const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createElectronApi,
  createIpcBridge,
  exposeElectronApi,
  exposeIpcBridge,
} = require('./preload-ipc-bridge');

function createFakeIpcRenderer() {
  const calls = [];

  return {
    calls,
    on(channel, listener) {
      calls.push(['on', channel, listener]);
      return 'on-result';
    },
    off(channel, listener) {
      calls.push(['off', channel, listener]);
      return 'off-result';
    },
    addListener(channel, listener) {
      calls.push(['addListener', channel, listener]);
      return 'add-result';
    },
    removeListener(channel, listener) {
      calls.push(['removeListener', channel, listener]);
      return 'remove-result';
    },
    send(channel, ...args) {
      calls.push(['send', channel, ...args]);
      return 'send-result';
    },
    invoke(channel, ...args) {
      calls.push(['invoke', channel, ...args]);
      return Promise.resolve({ channel, args });
    },
  };
}

test('createIpcBridge 保持 preload 暴露的 ipcRenderer API', async () => {
  const ipcRenderer = createFakeIpcRenderer();
  const bridge = createIpcBridge({
    ipcRenderer,
    processEnv: { __TYPELESS_CLIENT__RUNTIME_PLATFORM__: 'local-win32' },
    processPlatform: 'linux',
  });
  const listener = () => undefined;

  assert.equal(bridge.platform, 'local-win32');
  assert.equal(bridge.on('voice-state', listener), 'on-result');
  assert.equal(bridge.off('voice-state', listener), 'off-result');
  assert.equal(bridge.send('page:open-hub', { id: 1 }), 'send-result');
  assert.deepEqual(await bridge.invoke('settings:get', { id: 2 }), {
    channel: 'settings:get',
    args: [{ id: 2 }],
  });

  assert.deepEqual(ipcRenderer.calls.slice(0, 4), [
    ['on', 'voice-state', listener],
    ['off', 'voice-state', listener],
    ['send', 'page:open-hub', { id: 1 }],
    ['invoke', 'settings:get', { id: 2 }],
  ]);
});

test('createIpcBridge 按 key 保存 listener 并在移除时优先使用保存值', () => {
  const ipcRenderer = createFakeIpcRenderer();
  const bridge = createIpcBridge({
    ipcRenderer,
    processEnv: {},
    processPlatform: 'win32',
  });
  const savedListener = () => undefined;
  const fallbackListener = () => undefined;

  assert.equal(bridge.addKeyListener('global-keyboard', 'RightAlt', savedListener), 'add-result');
  assert.equal(bridge.removeKeyListener('global-keyboard', 'RightAlt', fallbackListener), 'remove-result');
  assert.equal(bridge.removeKeyListener('global-keyboard', 'Space', fallbackListener), 'remove-result');

  assert.deepEqual(ipcRenderer.calls, [
    ['addListener', 'global-keyboard', savedListener],
    ['removeListener', 'global-keyboard', savedListener],
    ['removeListener', 'global-keyboard', fallbackListener],
  ]);
});

test('createElectronApi 保持 electronAPI 的 channel 映射', async () => {
  const ipcRenderer = createFakeIpcRenderer();
  const api = createElectronApi({ ipcRenderer });
  const listener = () => undefined;

  assert.equal(api.onToggleRecording(listener), 'on-result');
  assert.deepEqual(await api.clipboardWrite('hello'), {
    channel: 'clipboard-write',
    args: ['hello'],
  });
  assert.deepEqual(ipcRenderer.calls, [
    ['on', 'toggle-recording', listener],
    ['invoke', 'clipboard-write', 'hello'],
  ]);
});

test('exposeIpcBridge 和 exposeElectronApi 暴露原有全局对象名', () => {
  const ipcRenderer = createFakeIpcRenderer();
  const exposed = {};
  const contextBridge = {
    exposeInMainWorld(name, value) {
      exposed[name] = value;
    },
  };

  exposeIpcBridge({
    contextBridge,
    ipcRenderer,
    processEnv: {},
    processPlatform: 'darwin',
  });
  exposeElectronApi({ contextBridge, ipcRenderer });

  assert.equal(exposed.ipcRenderer.platform, 'darwin');
  assert.equal(typeof exposed.ipcRenderer.invoke, 'function');
  assert.equal(typeof exposed.electronAPI.clipboardWrite, 'function');
});
