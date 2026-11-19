// Windows 11 的亚克力材质：窗口背景由系统绘制成半透明磨砂（模糊后面的桌面和其它窗口），页面本身必须是透明的才能透出来。
// 只在 Windows 启用；其它平台保持纯色背景。亚克力要求 Windows 11 22H2 及以上，更早的系统 Electron 会忽略该选项。
function buildMainWindowMaterialOptions(platform) {
  if (platform === 'win32') {
    return { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' };
  }
  return { backgroundColor: '#ffffff' };
}

function buildMainWindowOptions({
  preloadPath,
  iconPath,
  session,
  platform = process.platform,
} = {}) {
  return {
    width: 1080,
    height: 750,
    minWidth: 988,
    minHeight: 658,
    title: 'SpeakMore',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff00', symbolColor: 'rgba(0, 0, 0, 0.9)', height: 48 },
    ...buildMainWindowMaterialOptions(platform),
    hasShadow: true,
    transparent: false,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      session,
      backgroundThrottling: false,
    },
  };
}

function buildFloatingWindowOptions({
  bounds,
  preloadPath,
} = {}) {
  return {
    type: 'panel',
    ...bounds,
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
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
}

function buildTrayMenuTemplate({
  createMainWindow,
  quit,
} = {}) {
  return [
    { label: '打开主窗口', click: createMainWindow },
    { label: '退出', click: quit },
  ];
}

module.exports = {
  buildFloatingWindowOptions,
  buildMainWindowOptions,
  buildTrayMenuTemplate,
};
