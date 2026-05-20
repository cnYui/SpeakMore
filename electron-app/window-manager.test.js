const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const path = require('node:path');
const { createWindowManager, FLOATING_BAR_COMPLETED_HIDE_DELAY_MS } = require('./window-manager');
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
      this.loadFilePath = null;
      this.bounds = null;
      this.ignoreMouseEvents = null;
      this.alwaysOnTopArgs = null;
      this.visibleOnAllWorkspacesArgs = null;
      this.fullScreenable = null;
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
    }

    setVisibleOnAllWorkspaces(...args) {
      this.visibleOnAllWorkspacesArgs = args;
    }

    setFullScreenable(value) {
      this.fullScreenable = value;
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
    baseDir: 'D:\\CodeWorkSpace\\typeless\\electron-app',
    preloadPath: () => 'D:\\CodeWorkSpace\\typeless\\electron-app\\preload.js',
    iconPath: () => 'D:\\CodeWorkSpace\\typeless\\app-extracted\\build\\icons\\png\\32x32.png',
    trayIconPath: () => 'D:\\CodeWorkSpace\\typeless\\app-extracted\\build\\tray-win32.png',
    resolveBottomCenterBounds: () => ({ x: 100, y: 200, width: 400, height: 360 }),
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
  assert.equal(mainWindow.loadFilePath, path.join('D:\\CodeWorkSpace\\typeless\\electron-app', 'renderer', 'dist', 'index.html'));
  assert.equal(manager.getMainWindow(), mainWindow);

  mainWindow.close();

  assert.equal(mainWindow.hidden, true);
  assert.equal(mainWindow.destroyed, false);
  assert.deepEqual(trayActions, [{ channel: 'page-event--hub--window-blurred', payload: undefined }]);
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
    baseDir: 'D:\\CodeWorkSpace\\typeless\\electron-app',
    preloadPath: () => 'D:\\CodeWorkSpace\\typeless\\electron-app\\preload.js',
    iconPath: () => 'D:\\CodeWorkSpace\\typeless\\app-extracted\\build\\icons\\png\\32x32.png',
    trayIconPath: () => 'D:\\CodeWorkSpace\\typeless\\app-extracted\\build\\tray-win32.png',
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
  assert.equal(floatingBar.loadFilePath, path.join('D:\\CodeWorkSpace\\typeless\\electron-app', 'renderer', 'dist', 'floating-bar.html'));
  assert.equal(floatingPanel.loadFilePath, path.join('D:\\CodeWorkSpace\\typeless\\electron-app', 'renderer', 'dist', 'floating-panel.html'));
  assert.equal(floatingBar.options.x, 11);
  assert.equal(floatingBar.options.y, 22);
  assert.equal(floatingBar.options.width, 400);
  assert.equal(floatingBar.options.height, 360);
  assert.equal(floatingPanel.options.x, 11);
  assert.equal(floatingPanel.options.y, 22);
  assert.equal(floatingPanel.options.width, 440);
  assert.equal(floatingPanel.options.height, 220);
  assert.deepEqual(floatingBar.ignoreMouseEvents, { flag: true, options: { forward: true } });
  assert.deepEqual(floatingBar.alwaysOnTopArgs, [true, 'screen-saver', 1]);
  assert.deepEqual(floatingBar.visibleOnAllWorkspacesArgs[1], { visibleOnFullScreen: true, skipTransformProcessType: true });
  assert.deepEqual(floatingBar.fullScreenable, false);
  assert.equal(tray.tooltip, 'SpeakMore');
  assert.deepEqual(nativeImageCalls, ['D:\\CodeWorkSpace\\typeless\\app-extracted\\build\\tray-win32.png']);
  assert.deepEqual(tray.menu[0].label, '打开主窗口');
  assert.deepEqual(tray.menu[1].label, '显示悬浮条');
  assert.deepEqual(tray.menu[2].label, '退出');

  tray.emit('click');
  assert.equal(manager.getMainWindow().shown, true);
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
    baseDir: 'D:\\CodeWorkSpace\\typeless\\electron-app',
    preloadPath: () => 'D:\\CodeWorkSpace\\typeless\\electron-app\\preload.js',
    iconPath: () => 'D:\\CodeWorkSpace\\typeless\\app-extracted\\build\\icons\\png\\32x32.png',
    trayIconPath: () => 'D:\\CodeWorkSpace\\typeless\\app-extracted\\build\\tray-win32.png',
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
