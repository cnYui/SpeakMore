const test = require('node:test');
const assert = require('node:assert/strict');
const { registerPermissionIpcHandlers } = require('./permission-ipc');

function createIpcMainHarness() {
  const handlers = new Map();
  return {
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    invoke: (channel, payload) => handlers.get(channel)?.({}, payload),
  };
}

test('permission:update-auto-launch 在开发态只保存偏好并跳过系统写入', () => {
  const harness = createIpcMainHarness();
  let setLoginItemCalls = 0;
  registerPermissionIpcHandlers({
    ipcMain: harness.ipcMain,
    app: {
      isPackaged: false,
      setLoginItemSettings: () => { setLoginItemCalls += 1; },
    },
    processExecPath: 'C:\\dev\\electron.exe',
  });

  const result = harness.invoke('permission:update-auto-launch', { enable: true });

  assert.deepEqual(result, {
    success: true,
    skipped: true,
    enabled: true,
    code: 'auto_launch_dev_skipped',
  });
  assert.equal(setLoginItemCalls, 0);
});

test('permission:update-auto-launch 在打包态写入隐藏启动登录项', () => {
  const harness = createIpcMainHarness();
  const calls = [];
  registerPermissionIpcHandlers({
    ipcMain: harness.ipcMain,
    app: {
      isPackaged: true,
      setLoginItemSettings: (options) => calls.push(options),
      getLoginItemSettings: () => ({ openAtLogin: true }),
    },
    processExecPath: 'C:\\Program Files\\SpeakMore\\SpeakMore.exe',
  });

  const result = harness.invoke('permission:update-auto-launch', { enable: true });

  assert.deepEqual(calls, [{
    openAtLogin: true,
    path: 'C:\\Program Files\\SpeakMore\\SpeakMore.exe',
    args: ['--hidden'],
  }]);
  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.equal(result.skipped, false);
});
