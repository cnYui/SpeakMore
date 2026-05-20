const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFloatingWindowOptions,
  buildMainWindowOptions,
  buildTrayMenuTemplate,
} = require('./window-manager-options');

test('buildMainWindowOptions 保持主窗口尺寸、标题栏和 webPreferences 配置', () => {
  const session = { partition: 'persist:no-proxy-session' };

  const options = buildMainWindowOptions({
    preloadPath: 'D:\\app\\preload.js',
    iconPath: 'D:\\app\\icon.png',
    session,
  });

  assert.equal(options.width, 1080);
  assert.equal(options.height, 750);
  assert.equal(options.minWidth, 988);
  assert.equal(options.minHeight, 658);
  assert.equal(options.title, 'SpeakMore');
  assert.equal(options.titleBarStyle, 'hidden');
  assert.deepEqual(options.titleBarOverlay, {
    color: '#ffffff00',
    symbolColor: 'rgba(0, 0, 0, 0.9)',
    height: 48,
  });
  assert.equal(options.icon, 'D:\\app\\icon.png');
  assert.deepEqual(options.webPreferences, {
    preload: 'D:\\app\\preload.js',
    contextIsolation: true,
    nodeIntegration: false,
    session,
    backgroundThrottling: false,
  });
});

test('buildFloatingWindowOptions 保持悬浮窗透明置顶和不可聚焦配置', () => {
  const bounds = { x: 11, y: 22, width: 400, height: 360 };

  const options = buildFloatingWindowOptions({
    bounds,
    preloadPath: 'D:\\app\\preload.js',
  });

  assert.deepEqual(options, {
    type: 'panel',
    x: 11,
    y: 22,
    width: 400,
    height: 360,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    fullscreen: false,
    webPreferences: {
      preload: 'D:\\app\\preload.js',
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
});

test('buildTrayMenuTemplate 保持托盘菜单文案和点击行为', () => {
  const calls = [];
  const template = buildTrayMenuTemplate({
    createMainWindow: () => calls.push('main'),
    createFloatingBar: () => calls.push('bar'),
    quit: () => calls.push('quit'),
  });

  assert.deepEqual(template.map((item) => item.label), ['打开主窗口', '显示悬浮条', '退出']);

  template[0].click();
  template[1].click();
  template[2].click();

  assert.deepEqual(calls, ['main', 'bar', 'quit']);
});
