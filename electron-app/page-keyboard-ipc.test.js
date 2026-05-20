const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { registerPageIpcHandlers } = require('./page-ipc');
const { registerKeyboardIpcHandlers } = require('./keyboard-ipc');

function createFakeIpcMain() {
  const handles = new Map();
  const listeners = new Map();

  return {
    handles,
    listeners,
    handle(channel, handler) {
      handles.set(channel, handler);
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    async invoke(channel, ...args) {
      const handler = handles.get(channel);
      if (!handler) throw new Error(`missing handler: ${channel}`);
      return handler({}, ...args);
    },
    emit(channel, ...args) {
      const listener = listeners.get(channel);
      if (!listener) throw new Error(`missing listener: ${channel}`);
      return listener({}, ...args);
    },
  };
}

function createFakeChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

test('registerPageIpcHandlers 注册页面和浮窗通道', async () => {
  const ipcMain = createFakeIpcMain();
  const calls = [];
  let interactiveCardPayload = null;

  registerPageIpcHandlers({
    ipcMain,
    createMainWindow: () => calls.push('create-main'),
    createFloatingBar: () => calls.push('create-bar'),
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        openDevTools: (options) => calls.push(['main-devtools', options]),
        isDevToolsOpened: () => false,
        closeDevTools: () => calls.push('main-close-devtools'),
      },
    }),
    getFloatingBar: () => ({
      isDestroyed: () => false,
      webContents: {
        openDevTools: (options) => calls.push(['bar-devtools', options]),
        isDevToolsOpened: () => false,
        closeDevTools: () => calls.push('bar-close-devtools'),
      },
      close: () => calls.push('bar-close'),
    }),
    sendToMain: (channel, payload) => calls.push([channel, payload]),
    handleFloatingPanelEvent: (payload) => calls.push(['panel', payload]),
    handleVoiceState: (payload) => calls.push(['voice', payload]),
    handleFloatingBarUpdatePositions: (payload) => {
      calls.push(['positions', payload]);
      return true;
    },
    handleFloatingBarSetAlwaysOnTopForWindows: () => {
      calls.push('always-on-top');
      return true;
    },
    openExternalUrl: (url) => {
      calls.push(['open-url', url]);
      return true;
    },
    shell: {
      openPath: async (filePath) => {
        calls.push(['open-path', filePath]);
        return '';
      },
    },
    getInteractiveCardPayload: () => interactiveCardPayload,
    setInteractiveCardPayload: (payload) => {
      interactiveCardPayload = payload;
    },
  });

  assert.equal(await ipcMain.invoke('page:open-hub'), true);
  assert.equal(await ipcMain.invoke('page:open-typeless-bar'), true);
  assert.equal(await ipcMain.invoke('page:open-interactive-card', { id: 1 }), true);
  assert.deepEqual(await ipcMain.invoke('page:get-interactive-card-payload'), { id: 1 });
  assert.equal(await ipcMain.invoke('page:close-interactive-card'), true);
  assert.equal(await ipcMain.invoke('page:launch-application', { path: 'D:\\notes.txt' }), true);
  assert.equal(await ipcMain.invoke('page:open-url', { url: 'https://example.com' }), true);
  assert.equal(await ipcMain.invoke('page:floating-bar-update-positions', [{ x: 1 }]), true);
  assert.equal(await ipcMain.invoke('page:floating-bar-set-always-on-top-for-windows'), true);
  ipcMain.emit('floating-panel', { visible: true, type: 'shortcut-hint' });
  ipcMain.emit('voice-state', { status: 'recording' });

  assert.deepEqual(calls, [
    'create-main',
    'create-bar',
    ['interactive-card:update', { id: 1 }],
    ['interactive-card:update', null],
    ['open-path', 'D:\\notes.txt'],
    ['open-url', 'https://example.com'],
    ['positions', [{ x: 1 }]],
    'always-on-top',
    ['panel', { visible: true, type: 'shortcut-hint' }],
    ['voice', { status: 'recording' }],
  ]);
  assert.equal(interactiveCardPayload, null);
});

test('registerKeyboardIpcHandlers 处理转写粘贴与观察启动', async () => {
  const ipcMain = createFakeIpcMain();
  const child = createFakeChildProcess();
  const clipboardWrites = [];
  const clipboard = {
    writeText: (text) => clipboardWrites.push(text),
  };
  const snapshotCalls = [];
  const restoreCalls = [];
  const observationStarts = [];
  const spawnCalls = [];

  registerKeyboardIpcHandlers({
    ipcMain,
    clipboard,
    spawnProcess: (...args) => {
      spawnCalls.push(args);
      setImmediate(() => child.emit('exit', 0));
      return child;
    },
    readFocusedTextTarget: async () => ({ success: true }),
    createClipboardSnapshot: (clipboard) => {
      snapshotCalls.push(clipboard);
      return { text: 'before' };
    },
    restoreClipboardSnapshot: (clipboard, snapshot) => {
      restoreCalls.push([clipboard, snapshot]);
    },
    readFocusedInfo: async () => ({ success: true, title: 'Target' }),
    textObservationManager: {
      start: async (payload) => {
        observationStarts.push(payload);
      },
    },
    randomUUID: () => 'audio-1',
  });

  assert.deepEqual(await ipcMain.invoke('keyboard:type-transcript', 'hello'), { success: true });

  assert.deepEqual(clipboardWrites, ['hello']);
  assert.equal(snapshotCalls[0], clipboard);
  assert.deepEqual(restoreCalls, [[clipboard, { text: 'before' }]]);
  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(observationStarts, [{
    audioId: 'audio-1',
    pastedText: 'hello',
    focusInfo: { success: true, title: 'Target' },
  }]);
});

test('registerKeyboardIpcHandlers 在无法读取焦点文本目标时返回原因', async () => {
  const ipcMain = createFakeIpcMain();

  registerKeyboardIpcHandlers({
    ipcMain,
    clipboard: { writeText: () => undefined },
    spawnProcess: () => createFakeChildProcess(),
    readFocusedTextTarget: async () => ({ success: false, reason: 'no-target' }),
    createClipboardSnapshot: () => ({}),
    restoreClipboardSnapshot: () => undefined,
    readFocusedInfo: async () => ({}),
    textObservationManager: { start: async () => undefined },
    randomUUID: () => 'audio-1',
  });

  assert.deepEqual(await ipcMain.invoke('keyboard:type-transcript', 'hello'), {
    success: false,
    reason: 'no-target',
  });
});
