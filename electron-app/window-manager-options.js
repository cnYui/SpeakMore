function buildMainWindowOptions({
  preloadPath,
  iconPath,
  session,
  show = true,
} = {}) {
  return {
    width: 1080,
    height: 750,
    minWidth: 988,
    minHeight: 658,
    title: 'SpeakMore',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff00', symbolColor: 'rgba(0, 0, 0, 0.9)', height: 48 },
    backgroundColor: '#ffffff',
    hasShadow: true,
    transparent: false,
    show,
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
