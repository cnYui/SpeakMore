const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const path = require('node:path');
const {
  createWindowManager,
  FLOATING_BAR_COMPLETED_HIDE_DELAY_MS,
  resolveMeetingDetectionSize,
} = require('./window-manager');
const {
  isActiveVoiceState,
  isErrorVoiceState,
  isTerminalVoiceState,
  shouldShowShortcutHint,
} = require('./floating-window-state');

function createFakeBrowserWindowClass() {
  const instances = [];

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.hidden = options.show === false;
      this.shown = options.show !== false;
      this.focused = false;
      this.showCallCount = 0;
      this.showInactiveCallCount = 0;
      this.loadFilePath = null;
      this.bounds = null;
      this.ignoreMouseEvents = null;
      this.alwaysOnTopArgs = null;
      this.alwaysOnTopCalls = [];
      this.visibleOnAllWorkspacesArgs = null;
      this.visibleOnAllWorkspacesCalls = [];
      this.fullScreenable = null;
      this.moveTopCallCount = 0;
      this.webContents = {
        sent: [],
        devToolsOpened: false,
        send: (channel, payload) => {
          this.webContents.sent.push({ channel, payload });
        },
        openDevTools: (options) => {
          this.webContents.devToolsOpened = options || {};
        },
        closeDevTools: () => {
          this.webContents.devToolsOpened = false;
        },
        isDevToolsOpened: () => Boolean(this.webContents.devToolsOpened),
      };
      instances.push(this);
    }

    loadFile(filePath) {
      this.loadFilePath = filePath;
    }

    show() {
      this.showCallCount += 1;
      this.shown = true;
      this.hidden = false;
    }

    showInactive() {
      this.showInactiveCallCount += 1;
      this.shown = true;
      this.hidden = false;
    }

    hide() {
      this.hidden = true;
      this.shown = false;
    }

    focus() {
      this.focused = true;
    }

    isDestroyed() {
      return this.destroyed;
    }

    close() {
      const event = {
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      this.emit('close', event);
      if (!event.prevented) {
        this.destroyed = true;
        this.emit('closed');
      }
    }

    setBounds(bounds, animate) {
      this.bounds = { bounds, animate };
    }

    setIgnoreMouseEvents(flag, options) {
      this.ignoreMouseEvents = { flag, options };
    }

    setAlwaysOnTop(...args) {
      this.alwaysOnTopArgs = args;
      this.alwaysOnTopCalls.push(args);
    }

    setVisibleOnAllWorkspaces(...args) {
      this.visibleOnAllWorkspacesArgs = args;
      this.visibleOnAllWorkspacesCalls.push(args);
    }

    setFullScreenable(value) {
      this.fullScreenable = value;
    }

    moveTop() {
      this.moveTopCallCount += 1;
    }
  }

  FakeBrowserWindow.instances = instances;
  FakeBrowserWindow.getAllWindows = () => instances.filter((instance) => !instance.destroyed);
  return FakeBrowserWindow;
}

function createFakeTrayClass() {
  return class FakeTray extends EventEmitter {
    constructor(image) {
      super();
      this.image = image;
      this.tooltip = null;
      this.menu = null;
    }

    setToolTip(value) {
      this.tooltip = value;
    }

    setContextMenu(menu) {
      this.menu = menu;
    }
  };
}

test('createWindowManager 构造阶段不读取 Electron screen 方法', () => {
  const screen = {};
  Object.defineProperty(screen, 'getDisplayNearestPoint', {
    get() {
      throw new Error('screen should not be accessed before ready');
    },
  });

  assert.doesNotThrow(() => createWindowManager({
    app: { quit: () => undefined },
    BrowserWindow: createFakeBrowserWindowClass(),
    Tray: createFakeTrayClass(),
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (filePath) => ({ filePath, resize: () => ({ filePath }) }) },
    session: { fromPartition: (partition) => ({ partition }) },
    screen,
    resolveBottomCenterBounds: () => ({ x: 0, y: 0, width: 220, height: 224 }),
  }));
});

test('createWindowManager 创建主窗口并在关闭时隐藏', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const trayActions = [];
  const manager = createWindowManager({
    app: {
      quit: () => trayActions.push('quit'),
    },
    BrowserWindow,
    Tray: createFakeTrayClass(),
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (filePath) => ({ filePath, resize: () => ({ filePath }) }) },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    path,
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    preloadPath: () => 'C:\\repo\\SpeakMore\\electron-app\\preload.js',
    iconPath: () => 'C:\\repo\\SpeakMore\\electron-app\\assets\\tray-placeholder.png',
    trayIconPath: () => 'C:\\repo\\SpeakMore\\electron-app\\assets\\tray-placeholder.png',
    resolveBottomCenterBounds: () => ({ x: 100, y: 200, width: 220, height: 224 }),
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
    sendToMain: (channel, payload) => trayActions.push({ channel, payload }),
    sendToFloatingBar: () => undefined,
    sendToFloatingPanel: () => undefined,
    getAppIsQuitting: () => false,
  });

  const mainWindow = manager.createMainWindow();
  assert.equal(mainWindow.loadFilePath, path.join('C:\\repo\\SpeakMore\\electron-app', 'renderer', 'dist', 'index.html'));
  assert.equal(manager.getMainWindow(), mainWindow);

  mainWindow.close();

  assert.equal(mainWindow.hidden, true);
  assert.equal(mainWindow.destroyed, false);
  assert.deepEqual(trayActions, [{ channel: 'page-event--hub--window-blurred', payload: undefined }]);
});

test('createWindowManager 支持隐藏启动并可由托盘重新显示', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const manager = createWindowManager({
    app: { quit: () => undefined },
    BrowserWindow,
    Tray: createFakeTrayClass(),
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (filePath) => ({ filePath, resize: () => ({ filePath }) }) },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    resolveBottomCenterBounds: () => ({ x: 100, y: 200, width: 220, height: 224 }),
  });

  const mainWindow = manager.createMainWindow({ show: false });
  assert.equal(mainWindow.hidden, true);
  assert.equal(mainWindow.shown, false);

  manager.createMainWindow();

  assert.equal(mainWindow.hidden, false);
  assert.equal(mainWindow.showCallCount, 1);
  assert.equal(mainWindow.focused, true);
});

test('createWindowManager 关闭时退出选项会走真实退出流程', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const actions = [];
  const manager = createWindowManager({
    app: { quit: () => actions.push('quit') },
    BrowserWindow,
    Tray: createFakeTrayClass(),
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (filePath) => ({ filePath, resize: () => ({ filePath }) }) },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    resolveBottomCenterBounds: () => ({ x: 100, y: 200, width: 220, height: 224 }),
    shouldHideMainWindowOnClose: () => false,
    requestAppQuit: () => actions.push('quit'),
  });

  const mainWindow = manager.createMainWindow();
  mainWindow.close();

  assert.equal(mainWindow.hidden, false);
  assert.equal(mainWindow.destroyed, false);
  assert.deepEqual(actions, ['quit']);
});

test('createWindowManager 创建悬浮条、悬浮面板和托盘', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const Tray = createFakeTrayClass();
  const nativeImageCalls = [];
  const manager = createWindowManager({
    app: {
      quit: () => undefined,
    },
    BrowserWindow,
    Tray,
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: {
      createFromPath: (filePath) => {
        nativeImageCalls.push(filePath);
        return {
          filePath,
          resize: ({ width, height }) => ({ filePath, width, height }),
        };
      },
    },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    path,
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    preloadPath: () => 'C:\\repo\\SpeakMore\\electron-app\\preload.js',
    iconPath: () => 'C:\\repo\\SpeakMore\\electron-app\\assets\\tray-placeholder.png',
    trayIconPath: () => 'C:\\repo\\SpeakMore\\electron-app\\assets\\tray-placeholder.png',
    resolveBottomCenterBounds: (_, windowSize) => ({ x: 11, y: 22, width: windowSize.width, height: windowSize.height }),
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
    sendToMain: () => undefined,
    sendToFloatingBar: () => undefined,
    sendToFloatingPanel: () => undefined,
    getAppIsQuitting: () => false,
  });

  const floatingBar = manager.createFloatingBar();
  const floatingPanel = manager.createFloatingPanelWindow();
  const tray = manager.createTray();

  assert.equal(BrowserWindow.instances.length, 2);
  assert.equal(floatingBar.loadFilePath, path.join('C:\\repo\\SpeakMore\\electron-app', 'renderer', 'dist', 'floating-bar.html'));
  assert.equal(floatingPanel.loadFilePath, path.join('C:\\repo\\SpeakMore\\electron-app', 'renderer', 'dist', 'floating-panel.html'));
  assert.equal(floatingBar.options.x, 11);
  assert.equal(floatingBar.options.y, 22);
  assert.equal(floatingBar.options.width, 220);
  assert.equal(floatingBar.options.height, 224);
  assert.equal(floatingPanel.options.x, 11);
  assert.equal(floatingPanel.options.y, 22);
  assert.equal(floatingPanel.options.width, 440);
  assert.equal(floatingPanel.options.height, 220);
  assert.deepEqual(floatingBar.ignoreMouseEvents, { flag: true, options: { forward: true } });
  assert.deepEqual(floatingBar.alwaysOnTopArgs, [true, 'screen-saver', 1]);
  assert.deepEqual(floatingBar.visibleOnAllWorkspacesArgs[1], { visibleOnFullScreen: true, skipTransformProcessType: true });
  assert.deepEqual(floatingBar.fullScreenable, false);
  assert.equal(tray.tooltip, 'SpeakMore');
  assert.deepEqual(nativeImageCalls, ['C:\\repo\\SpeakMore\\electron-app\\assets\\tray-placeholder.png']);
  assert.deepEqual(tray.menu[0].label, '打开主窗口');
  assert.deepEqual(tray.menu[1].label, '退出');

  tray.emit('click');
  assert.equal(manager.getMainWindow().shown, true);
});

test('createWindowManager 托盘首选图标为空时使用主图标兜底', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const Tray = createFakeTrayClass();
  const nativeImageCalls = [];
  const manager = createWindowManager({
    app: { quit: () => undefined },
    BrowserWindow,
    Tray,
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: {
      createFromPath: (filePath) => {
        nativeImageCalls.push(filePath);
        const empty = filePath.includes('missing');
        return {
          filePath,
          isEmpty: () => empty,
          resize: ({ width, height }) => ({ filePath, width, height, empty }),
        };
      },
    },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    path,
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    preloadPath: () => 'C:\\repo\\SpeakMore\\electron-app\\preload.js',
    iconPath: () => 'C:\\repo\\SpeakMore\\electron-app\\assets\\tray-placeholder.png',
    trayIconPath: () => 'C:\\repo\\SpeakMore\\missing\\tray-placeholder.png',
    resolveBottomCenterBounds: (_, windowSize) => ({ x: 11, y: 22, width: windowSize.width, height: windowSize.height }),
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
    sendToMain: () => undefined,
    sendToFloatingBar: () => undefined,
    sendToFloatingPanel: () => undefined,
    getAppIsQuitting: () => false,
  });

  const tray = manager.createTray();

  assert.deepEqual(nativeImageCalls, [
    'C:\\repo\\SpeakMore\\missing\\tray-placeholder.png',
    'C:\\repo\\SpeakMore\\electron-app\\assets\\tray-placeholder.png',
  ]);
  assert.equal(tray.image.filePath, 'C:\\repo\\SpeakMore\\electron-app\\assets\\tray-placeholder.png');
  assert.equal(tray.image.empty, false);
});

test('createWindowManager shows meeting detection notification and hides after timeout', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const timers = [];
  const manager = createWindowManager({
    app: { quit: () => undefined },
    BrowserWindow,
    Tray: createFakeTrayClass(),
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (filePath) => ({ filePath, resize: () => ({ filePath }) }) },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    path,
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    preloadPath: () => 'C:\\repo\\SpeakMore\\electron-app\\preload.js',
    resolveBottomCenterBounds: (_, windowSize) => ({ x: 11, y: 22, width: windowSize.width, height: windowSize.height }),
    setTimer: (callback, ms) => {
      timers.push({ callback, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });

  manager.showMeetingDetectionNotification({ appName: 'Feishu', visibleMs: 15000 });
  const notification = manager.getMeetingDetectionWindow();

  assert.equal(notification.loadFilePath, path.join('C:\\repo\\SpeakMore\\electron-app', 'renderer', 'dist', 'meeting-detection.html'));
  assert.equal(notification.options.width, 461);
  assert.equal(notification.options.height, 99);
  assert.equal(notification.options.x, 1449);
  assert.equal(notification.options.y, 10);
  assert.equal(notification.showInactiveCallCount, 1);
  assert.equal(notification.focused, false);
  assert.deepEqual(notification.ignoreMouseEvents, { flag: false, options: undefined });
  assert.deepEqual(notification.webContents.sent[0], {
    channel: 'meeting-detector:detected',
    payload: { visible: true, appName: 'Feishu', visibleMs: 15000 },
  });
  assert.equal(timers[0].ms, 15000);

  timers[0].callback();

  assert.equal(notification.hidden, true);
  assert.deepEqual(notification.webContents.sent.at(-1), {
    channel: 'meeting-detector:detected',
    payload: { visible: false },
  });
});

test('meeting detection notification size adapts to common PC work areas', () => {
  assert.deepEqual(resolveMeetingDetectionSize({ width: 1366 }), { width: 360, height: 82 });
  assert.deepEqual(resolveMeetingDetectionSize({ width: 1600 }), { width: 384, height: 86 });
  assert.deepEqual(resolveMeetingDetectionSize({ width: 1920 }), { width: 461, height: 99 });
  assert.deepEqual(resolveMeetingDetectionSize({ width: 2560 }), { width: 480, height: 102 });
});

test('显示悬浮窗口时使用非激活显示，避免抢占外部输入焦点', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const manager = createWindowManager({
    app: { quit: () => undefined },
    BrowserWindow,
    Tray: createFakeTrayClass(),
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (filePath) => ({ filePath, resize: () => ({ filePath }) }) },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    path,
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    preloadPath: () => 'C:\\repo\\SpeakMore\\electron-app\\preload.js',
    iconPath: () => 'C:\\repo\\SpeakMore\\release-artifacts\\assets\\tray-placeholder.png',
    trayIconPath: () => 'C:\\repo\\SpeakMore\\release-artifacts\\assets\\tray-placeholder.png',
    resolveBottomCenterBounds: (_, windowSize) => ({ x: 11, y: 22, width: windowSize.width, height: windowSize.height }),
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
    sendToMain: () => undefined,
    sendToFloatingBar: () => undefined,
    sendToFloatingPanel: () => undefined,
    getAppIsQuitting: () => false,
  });

  const floatingBar = manager.createFloatingBar();
  const floatingPanel = manager.createFloatingPanelWindow();

  manager.showFloatingBar();
  manager.showFloatingPanel();

  assert.equal(floatingBar.showInactiveCallCount, 1);
  assert.equal(floatingBar.showCallCount, 0);
  assert.equal(floatingBar.shown, true);
  assert.deepEqual(floatingBar.ignoreMouseEvents, { flag: true, options: { forward: true } });
  assert.equal(floatingPanel.showInactiveCallCount, 1);
  assert.equal(floatingPanel.showCallCount, 0);
  assert.equal(floatingPanel.shown, true);
});

test('显示悬浮窗口时会重新提升置顶层级但不抢焦点', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const manager = createWindowManager({
    app: { quit: () => undefined },
    BrowserWindow,
    Tray: createFakeTrayClass(),
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (filePath) => ({ filePath, resize: () => ({ filePath }) }) },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    path,
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    preloadPath: () => 'C:\\repo\\SpeakMore\\electron-app\\preload.js',
    iconPath: () => 'C:\\repo\\SpeakMore\\release-artifacts\\assets\\tray-placeholder.png',
    trayIconPath: () => 'C:\\repo\\SpeakMore\\release-artifacts\\assets\\tray-placeholder.png',
    resolveBottomCenterBounds: (_, windowSize) => ({ x: 11, y: 22, width: windowSize.width, height: windowSize.height }),
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
    sendToMain: () => undefined,
    sendToFloatingBar: () => undefined,
    sendToFloatingPanel: () => undefined,
    getAppIsQuitting: () => false,
    processPlatform: 'win32',
  });

  const floatingBar = manager.createFloatingBar();
  const floatingPanel = manager.createFloatingPanelWindow();

  assert.equal(floatingBar.alwaysOnTopCalls.length, 1);
  assert.equal(floatingPanel.alwaysOnTopCalls.length, 1);
  assert.equal(floatingBar.moveTopCallCount, 0);
  assert.equal(floatingPanel.moveTopCallCount, 0);

  manager.showFloatingBar();
  manager.showFloatingPanel();

  assert.equal(floatingBar.alwaysOnTopCalls.length, 2);
  assert.equal(floatingPanel.alwaysOnTopCalls.length, 2);
  assert.equal(floatingBar.visibleOnAllWorkspacesCalls.length, 2);
  assert.equal(floatingPanel.visibleOnAllWorkspacesCalls.length, 2);
  assert.deepEqual(floatingBar.alwaysOnTopArgs, [true, 'screen-saver', 1]);
  assert.deepEqual(floatingPanel.alwaysOnTopArgs, [true, 'screen-saver', 1]);
  assert.deepEqual(floatingBar.visibleOnAllWorkspacesArgs[1], { visibleOnFullScreen: true, skipTransformProcessType: true });
  assert.deepEqual(floatingPanel.visibleOnAllWorkspacesArgs[1], { visibleOnFullScreen: true, skipTransformProcessType: true });
  assert.equal(floatingBar.moveTopCallCount, 1);
  assert.equal(floatingPanel.moveTopCallCount, 1);
  assert.equal(floatingBar.focused, false);
  assert.equal(floatingPanel.focused, false);
});

test('macOS 显示悬浮窗口时会刷新 alwaysOnTop 层级但不抢焦点', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const manager = createWindowManager({
    app: { quit: () => undefined },
    BrowserWindow,
    Tray: createFakeTrayClass(),
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (filePath) => ({ filePath, resize: () => ({ filePath }) }) },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    path,
    baseDir: '/repo/SpeakMore/electron-app',
    preloadPath: () => '/repo/SpeakMore/electron-app/preload.js',
    iconPath: () => '/repo/SpeakMore/electron-app/assets/tray-placeholder.png',
    trayIconPath: () => '/repo/SpeakMore/electron-app/assets/tray-placeholder.png',
    resolveBottomCenterBounds: (_, windowSize) => ({ x: 11, y: 22, width: windowSize.width, height: windowSize.height }),
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
    sendToMain: () => undefined,
    sendToFloatingBar: () => undefined,
    sendToFloatingPanel: () => undefined,
    getAppIsQuitting: () => false,
    processPlatform: 'darwin',
  });

  const floatingBar = manager.createFloatingBar();
  const floatingPanel = manager.createFloatingPanelWindow();

  manager.showFloatingBar();
  manager.showFloatingPanel();

  assert.deepEqual(floatingBar.alwaysOnTopCalls, [
    [true, 'screen-saver', 1],
    [false],
    [true, 'screen-saver', 1],
  ]);
  assert.deepEqual(floatingPanel.alwaysOnTopCalls, [
    [true, 'screen-saver', 1],
    [false],
    [true, 'screen-saver', 1],
  ]);
  assert.equal(floatingBar.moveTopCallCount, 1);
  assert.equal(floatingPanel.moveTopCallCount, 1);
  assert.equal(floatingBar.focused, false);
  assert.equal(floatingPanel.focused, false);
});

test('显式拉前处理器会同时刷新悬浮条和悬浮面板层级', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const manager = createWindowManager({
    app: { quit: () => undefined },
    BrowserWindow,
    Tray: createFakeTrayClass(),
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (filePath) => ({ filePath, resize: () => ({ filePath }) }) },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    path,
    baseDir: '/repo/SpeakMore/electron-app',
    preloadPath: () => '/repo/SpeakMore/electron-app/preload.js',
    iconPath: () => '/repo/SpeakMore/electron-app/assets/tray-placeholder.png',
    trayIconPath: () => '/repo/SpeakMore/electron-app/assets/tray-placeholder.png',
    resolveBottomCenterBounds: (_, windowSize) => ({ x: 11, y: 22, width: windowSize.width, height: windowSize.height }),
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
    sendToMain: () => undefined,
    sendToFloatingBar: () => undefined,
    sendToFloatingPanel: () => undefined,
    getAppIsQuitting: () => false,
    processPlatform: 'win32',
  });

  const floatingBar = manager.createFloatingBar();
  const floatingPanel = manager.createFloatingPanelWindow();

  assert.equal(manager.handleFloatingWindowsBringToFront(), true);

  assert.deepEqual(floatingBar.alwaysOnTopCalls.slice(-2), [[false], [true, 'screen-saver', 1]]);
  assert.deepEqual(floatingPanel.alwaysOnTopCalls.slice(-2), [[false], [true, 'screen-saver', 1]]);
  assert.equal(floatingBar.moveTopCallCount, 1);
  assert.equal(floatingPanel.moveTopCallCount, 1);
});

test('handleVoiceState 对终态会显示悬浮条并安排自动隐藏', () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const timerCalls = [];
  const manager = createWindowManager({
    app: { quit: () => undefined },
    BrowserWindow,
    Tray: createFakeTrayClass(),
    Menu: { buildFromTemplate: (template) => template },
    nativeImage: { createFromPath: (filePath) => ({ filePath, resize: () => ({ filePath }) }) },
    session: { fromPartition: (partition) => ({ partition }) },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    path,
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    preloadPath: () => 'C:\\repo\\SpeakMore\\electron-app\\preload.js',
    iconPath: () => 'C:\\repo\\SpeakMore\\release-artifacts\\assets\\tray-placeholder.png',
    trayIconPath: () => 'C:\\repo\\SpeakMore\\release-artifacts\\assets\\tray-placeholder.png',
    resolveBottomCenterBounds: (_, windowSize) => ({ x: 11, y: 22, width: windowSize.width, height: windowSize.height }),
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
    setTimer: (callback, delay) => {
      timerCalls.push({ callback, delay });
      return timerCalls.length;
    },
    clearTimer: () => undefined,
    sendToMain: () => undefined,
    sendToFloatingBar: () => undefined,
    sendToFloatingPanel: () => undefined,
    getAppIsQuitting: () => false,
  });

  const floatingBar = manager.createFloatingBar();
  manager.handleVoiceState({ status: 'completed', visible: true });

  assert.equal(floatingBar.shown, true);
  assert.equal(timerCalls[0].delay, FLOATING_BAR_COMPLETED_HIDE_DELAY_MS);

  timerCalls[0].callback();

  assert.equal(floatingBar.hidden, true);
});
