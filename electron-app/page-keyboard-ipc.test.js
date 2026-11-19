const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { registerPageIpcHandlers } = require('./page-ipc');
const { CLIPBOARD_RESTORE_DELAY_MS, registerKeyboardIpcHandlers } = require('./keyboard-ipc');

function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    options: {
      setTimeoutImpl: (callback, delay) => {
        const id = nextId++;
        pending.set(id, { callback, delay });
        return id;
      },
      clearTimeoutImpl: (id) => pending.delete(id),
    },
    delays: () => [...pending.values()].map((timer) => timer.delay),
    runAll: () => {
      const timers = [...pending.values()];
      pending.clear();
      timers.forEach((timer) => timer.callback());
    },
  };
}

function createWindowsPasteHarness({ clipboardText = 'before' } = {}) {
  const ipcMain = createFakeIpcMain();
  const timers = createFakeTimers();
  const restoreCalls = [];
  const snapshotCalls = [];
  const clipboard = {
    current: clipboardText,
    writeText(text) {
      this.current = text;
    },
    readText() {
      return this.current;
    },
  };

  registerKeyboardIpcHandlers({
    ipcMain,
    clipboard,
    platform: 'win32',
    ...timers.options,
    spawnProcess: () => {
      const child = createFakeChildProcess();
      setImmediate(() => child.emit('exit', 0));
      return child;
    },
    readFocusedTextTarget: async () => ({ success: true }),
    createClipboardSnapshot: (target) => {
      snapshotCalls.push(target.current);
      return { text: target.current };
    },
    restoreClipboardSnapshot: (target, snapshot) => {
      restoreCalls.push(snapshot.text);
      target.current = snapshot.text;
    },
    readFocusedInfo: async () => ({}),
    textObservationManager: { start: async () => undefined },
    randomUUID: () => 'audio-1',
    logger: { info() {}, warn() {}, error() {} },
  });

  return { ipcMain, timers, clipboard, restoreCalls, snapshotCalls };
}

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
    handleFloatingWindowsBringToFront: () => {
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
  assert.equal(await ipcMain.invoke('page:floating-windows-bring-to-front'), true);
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
  const timers = createFakeTimers();
  clipboard.readText = () => clipboardWrites[clipboardWrites.length - 1];

  registerKeyboardIpcHandlers({
    ipcMain,
    clipboard,
    platform: 'win32',
    ...timers.options,
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
  // 剪贴板延迟恢复：结果返回时还不能恢复，否则目标应用可能读到旧剪贴板。
  assert.deepEqual(restoreCalls, []);
  assert.deepEqual(timers.delays(), [CLIPBOARD_RESTORE_DELAY_MS]);
  timers.runAll();
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
    platform: 'win32',
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

test('registerKeyboardIpcHandlers 将粘贴上下文传给焦点目标检测', async () => {
  const ipcMain = createFakeIpcMain();
  const child = createFakeChildProcess();
  let receivedOptions = null;

  registerKeyboardIpcHandlers({
    ipcMain,
    clipboard: { writeText: () => undefined },
    platform: 'win32',
    spawnProcess: () => {
      setImmediate(() => child.emit('exit', 0));
      return child;
    },
    readFocusedTextTarget: async (options) => {
      receivedOptions = options;
      return { success: true, source: 'uia', confidence: 'confirmed' };
    },
    createClipboardSnapshot: () => ({}),
    restoreClipboardSnapshot: () => undefined,
    readFocusedInfo: async () => ({}),
    textObservationManager: { start: async () => undefined },
    randomUUID: () => 'audio-1',
  });

  const startFocusInfo = {
    appInfo: { app_metadata: { hwnd: '700' } },
  };

  assert.deepEqual(await ipcMain.invoke('keyboard:type-transcript', 'hello', { startFocusInfo }), { success: true });
  assert.deepEqual(receivedOptions, { startFocusInfo });
});

test('registerKeyboardIpcHandlers 在自动学习启动异常时仍静默完成粘贴', async () => {
  const ipcMain = createFakeIpcMain();
  const child = createFakeChildProcess();
  const clipboardWrites = [];
  const clipboard = {
    writeText: (text) => clipboardWrites.push(text),
  };
  const restoreCalls = [];
  const spawnCalls = [];
  const timers = createFakeTimers();
  clipboard.readText = () => clipboardWrites[clipboardWrites.length - 1];

  registerKeyboardIpcHandlers({
    ipcMain,
    clipboard,
    platform: 'win32',
    ...timers.options,
    spawnProcess: (...args) => {
      spawnCalls.push(args);
      setImmediate(() => child.emit('exit', 0));
      return child;
    },
    readFocusedTextTarget: async () => ({ success: true }),
    createClipboardSnapshot: () => ({ text: 'before' }),
    restoreClipboardSnapshot: (clipboard, snapshot) => {
      restoreCalls.push([clipboard, snapshot]);
    },
    readFocusedInfo: async () => ({ success: true }),
    textObservationManager: {
      start: async () => {
        throw new Error('observer failed');
      },
    },
    randomUUID: () => 'audio-1',
  });

  await assert.doesNotReject(async () => {
    assert.deepEqual(await ipcMain.invoke('keyboard:type-transcript', 'hello'), { success: true });
  });

  assert.deepEqual(clipboardWrites, ['hello']);
  assert.equal(spawnCalls.length, 1);
  timers.runAll();
  assert.deepEqual(restoreCalls, [[clipboard, { text: 'before' }]]);
});

test('registerKeyboardIpcHandlers 在 macOS 通过平台能力粘贴后启动自动学习观察', async () => {
  const ipcMain = createFakeIpcMain();
  const calls = [];
  const startFocusInfo = { appInfo: { app_identifier: 'com.apple.TextEdit' } };
  const focusInfo = { appInfo: { app_identifier: 'com.apple.TextEdit' } };

  registerKeyboardIpcHandlers({
    ipcMain,
    clipboard: { writeText: () => undefined },
    platform: 'darwin',
    spawnProcess: () => {
      throw new Error('macOS should not spawn powershell');
    },
    readFocusedTextTarget: async () => {
      throw new Error('macOS should use macosPlatformCapabilities');
    },
    createClipboardSnapshot: () => ({}),
    restoreClipboardSnapshot: () => undefined,
    readFocusedInfo: async () => focusInfo,
    textObservationManager: {
      start: async (payload) => {
        calls.push(['observer-start', payload]);
        return { success: true };
      },
    },
    macosPlatformCapabilities: {
      pasteText: async (text, options) => {
        calls.push(['paste', text, options]);
        return { success: true, platform: 'darwin' };
      },
    },
  });

  assert.deepEqual(await ipcMain.invoke('keyboard:type-transcript', 'hello', { startFocusInfo }), {
    success: true,
    platform: 'darwin',
  });
  assert.deepEqual(calls, [
    ['paste', 'hello', { startFocusInfo }],
    ['observer-start', {
      audioId: calls[1][1].audioId,
      pastedText: 'hello',
      focusInfo,
    }],
  ]);
  assert.equal(typeof calls[1][1].audioId, 'string');
});

test('registerKeyboardIpcHandlers 在 macOS 平台能力失败时返回 reason', async () => {
  const ipcMain = createFakeIpcMain();
  const calls = [];

  registerKeyboardIpcHandlers({
    ipcMain,
    clipboard: { writeText: () => undefined },
    platform: 'darwin',
    spawnProcess: () => createFakeChildProcess(),
    readFocusedTextTarget: async () => ({ success: true }),
    createClipboardSnapshot: () => ({}),
    restoreClipboardSnapshot: () => undefined,
    readFocusedInfo: async () => ({}),
    textObservationManager: { start: async () => calls.push('observer-start') },
    macosPlatformCapabilities: {
      pasteText: async () => ({ success: false, reason: 'macos_accessibility_permission_missing' }),
    },
  });

  assert.deepEqual(await ipcMain.invoke('keyboard:type-transcript', 'hello'), {
    success: false,
    reason: 'macos_accessibility_permission_missing',
  });
  assert.deepEqual(calls, []);
});

test('registerKeyboardIpcHandlers 粘贴后延迟恢复剪贴板，期间用户复制了新内容就不覆盖', async () => {
  const { ipcMain, timers, clipboard, restoreCalls } = createWindowsPasteHarness({ clipboardText: '用户原来的剪贴板' });

  assert.deepEqual(await ipcMain.invoke('keyboard:type-transcript', '听写结果'), { success: true });
  assert.equal(clipboard.current, '听写结果');
  clipboard.writeText('用户刚复制的内容');
  timers.runAll();

  assert.deepEqual(restoreCalls, []);
  assert.equal(clipboard.current, '用户刚复制的内容');
});

test('registerKeyboardIpcHandlers 连续两次听写时恢复的是最初的用户剪贴板', async () => {
  const { ipcMain, timers, clipboard, restoreCalls, snapshotCalls } = createWindowsPasteHarness({ clipboardText: '用户原来的剪贴板' });

  await ipcMain.invoke('keyboard:type-transcript', '第一句');
  await ipcMain.invoke('keyboard:type-transcript', '第二句');
  assert.deepEqual(timers.delays(), [CLIPBOARD_RESTORE_DELAY_MS]);
  timers.runAll();

  assert.deepEqual(snapshotCalls, ['用户原来的剪贴板']);
  assert.deepEqual(restoreCalls, ['用户原来的剪贴板']);
  assert.equal(clipboard.current, '用户原来的剪贴板');
});
