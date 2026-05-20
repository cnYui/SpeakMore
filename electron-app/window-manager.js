const path = require('path');
const {
  FLOATING_BAR_COMPLETED_HIDE_DELAY_MS,
  createFloatingWindowController,
} = require('./floating-window-controller');
const {
  buildFloatingWindowOptions,
  buildMainWindowOptions,
  buildTrayMenuTemplate,
} = require('./window-manager-options');

const FLOATING_BAR_SIZE = { width: 400, height: 360 };
const FLOATING_PANEL_SIZE = { width: 440, height: 220 };
const FLOATING_WINDOW_BOTTOM_GAP = 32;

function createWindowManager({
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  session,
  screen,
  baseDir = __dirname,
  preloadPath = () => path.join(baseDir, 'preload.js'),
  iconPath = () => '',
  trayIconPath = () => '',
  mainRendererPath = () => path.join(baseDir, 'renderer', 'dist', 'index.html'),
  floatingBarRendererPath = () => path.join(baseDir, 'renderer', 'dist', 'floating-bar.html'),
  floatingPanelRendererPath = () => path.join(baseDir, 'renderer', 'dist', 'floating-panel.html'),
  resolveBottomCenterBounds,
  isActiveVoiceState = () => false,
  isErrorVoiceState = () => false,
  isTerminalVoiceState = () => false,
  shouldShowShortcutHint = () => true,
  sendToMain = () => undefined,
  sendToFloatingBar = () => undefined,
  sendToFloatingPanel = () => undefined,
  getAppIsQuitting = () => false,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof BrowserWindow !== 'function') {
    throw new Error('BrowserWindow is required');
  }
  if (typeof Tray !== 'function') {
    throw new Error('Tray is required');
  }
  if (!Menu || typeof Menu.buildFromTemplate !== 'function') {
    throw new Error('Menu.buildFromTemplate is required');
  }
  if (!nativeImage || typeof nativeImage.createFromPath !== 'function') {
    throw new Error('nativeImage.createFromPath is required');
  }
  if (!session || typeof session.fromPartition !== 'function') {
    throw new Error('session.fromPartition is required');
  }
  if (!screen || typeof screen.getDisplayNearestPoint !== 'function') {
    throw new Error('screen is required');
  }
  if (typeof resolveBottomCenterBounds !== 'function') {
    throw new Error('resolveBottomCenterBounds is required');
  }

  let mainWindow = null;
  let floatingBar = null;
  let floatingPanelWindow = null;
  let tray = null;
  let floatingWindowController = null;

  function getCurrentFloatingWorkArea() {
    try {
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    } catch {
      return screen.getPrimaryDisplay().workArea;
    }
  }

  function resolveFloatingBarBounds() {
    return resolveBottomCenterBounds(getCurrentFloatingWorkArea(), FLOATING_BAR_SIZE, FLOATING_WINDOW_BOTTOM_GAP);
  }

  function resolveFloatingPanelBounds() {
    return resolveBottomCenterBounds(getCurrentFloatingWorkArea(), FLOATING_PANEL_SIZE, FLOATING_WINDOW_BOTTOM_GAP);
  }

  function positionFloatingBar() {
    if (!floatingBar || floatingBar.isDestroyed()) return;
    floatingBar.setBounds(resolveFloatingBarBounds(), false);
  }

  function positionFloatingPanel() {
    if (!floatingPanelWindow || floatingPanelWindow.isDestroyed()) return;
    floatingPanelWindow.setBounds(resolveFloatingPanelBounds(), false);
  }

  function showFloatingBar() {
    if (!floatingBar || floatingBar.isDestroyed()) return;
    positionFloatingBar();
    floatingBar.setIgnoreMouseEvents(false);
    floatingBar.show();
  }

  function hideFloatingBar() {
    if (!floatingBar || floatingBar.isDestroyed()) return;
    floatingBar.setIgnoreMouseEvents(true, { forward: true });
    floatingBar.hide();
  }

  function showFloatingPanel() {
    createFloatingPanelWindow();
    if (!floatingPanelWindow || floatingPanelWindow.isDestroyed()) return;
    positionFloatingPanel();
    floatingPanelWindow.setIgnoreMouseEvents(false);
    floatingPanelWindow.show();
  }

  function hideFloatingPanel() {
    if (!floatingPanelWindow || floatingPanelWindow.isDestroyed()) return;
    floatingPanelWindow.setIgnoreMouseEvents(true, { forward: true });
    floatingPanelWindow.hide();
  }

  function handleFloatingBarUpdatePositions(payload = []) {
    if (floatingBar && !floatingBar.isDestroyed()) {
      const positions = Array.isArray(payload) ? payload : payload?.positions;
      floatingBar.setIgnoreMouseEvents(!Array.isArray(positions) || positions.length === 0, { forward: false });
    }
    return true;
  }

  function handleFloatingBarSetAlwaysOnTopForWindows() {
    if (floatingBar && !floatingBar.isDestroyed()) {
      floatingBar.setAlwaysOnTop(true, 'screen-saver', 1);
      floatingBar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    return true;
  }

  function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      return mainWindow;
    }

    const mainSession = session.fromPartition('persist:no-proxy-session');

    mainWindow = new BrowserWindow({
      ...buildMainWindowOptions({
        preloadPath: preloadPath(),
        iconPath: iconPath(),
        session: mainSession,
      }),
    });

    mainWindow.loadFile(mainRendererPath());
    mainWindow.on('close', (event) => {
      if (getAppIsQuitting()) return;
      event.preventDefault();
      mainWindow.hide();
      sendToMain('page-event--hub--window-blurred');
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    mainWindow.on('blur', () => sendToMain('page-event--hub--window-blurred'));
    return mainWindow;
  }

  function createFloatingBar() {
    if (floatingBar && !floatingBar.isDestroyed()) return floatingBar;

    floatingBar = new BrowserWindow({
      ...buildFloatingWindowOptions({
        bounds: resolveFloatingBarBounds(),
        preloadPath: preloadPath(),
      }),
    });

    floatingBar.loadFile(floatingBarRendererPath());
    floatingBar.setIgnoreMouseEvents(true, { forward: true });
    floatingBar.setAlwaysOnTop(true, 'screen-saver', 1);
    floatingBar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    floatingBar.setFullScreenable(false);
    floatingBar.on('closed', () => {
      floatingBar = null;
    });
    return floatingBar;
  }

  function createFloatingPanelWindow() {
    if (floatingPanelWindow && !floatingPanelWindow.isDestroyed()) return floatingPanelWindow;

    floatingPanelWindow = new BrowserWindow({
      ...buildFloatingWindowOptions({
        bounds: resolveFloatingPanelBounds(),
        preloadPath: preloadPath(),
      }),
    });

    floatingPanelWindow.loadFile(floatingPanelRendererPath());
    floatingPanelWindow.setIgnoreMouseEvents(true, { forward: true });
    floatingPanelWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    floatingPanelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    floatingPanelWindow.setFullScreenable(false);
    floatingPanelWindow.on('closed', () => {
      floatingWindowController?.handleFloatingPanelClosed();
      floatingPanelWindow = null;
    });
    return floatingPanelWindow;
  }

  function createTray() {
    if (tray && typeof tray.isDestroyed === 'function' && !tray.isDestroyed()) return tray;
    if (tray && typeof tray.isDestroyed !== 'function') return tray;

    const image = nativeImage.createFromPath(trayIconPath()).resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip('SpeakMore');
    tray.on('click', createMainWindow);
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
      createMainWindow,
      createFloatingBar,
      quit: () => app.quit(),
    })));
    return tray;
  }

  floatingWindowController = createFloatingWindowController({
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
    showFloatingBar,
    hideFloatingBar,
    showFloatingPanel,
    hideFloatingPanel,
    sendToMain,
    sendToFloatingBar,
    sendToFloatingPanel,
    setTimer,
    clearTimer,
  });

  function updateFloatingBarVisibility(keys) {
    return floatingWindowController.updateFloatingBarVisibility(keys);
  }

  function handleEscapeKeydown() {
    return floatingWindowController.handleEscapeKeydown();
  }

  function handleFloatingPanelEvent(payload = {}) {
    return floatingWindowController.handleFloatingPanelEvent(payload);
  }

  function handleVoiceState(payload = {}) {
    return floatingWindowController.handleVoiceState(payload);
  }

  function renderFloatingBarForVoiceState(payload = {}) {
    return floatingWindowController.renderFloatingBarForVoiceState(payload);
  }

  function dispose() {
    floatingWindowController?.dispose();
  }

  return {
    createMainWindow,
    createFloatingBar,
    createFloatingPanelWindow,
    createTray,
    showFloatingBar,
    hideFloatingBar,
    showFloatingPanel,
    hideFloatingPanel,
    positionFloatingBar,
    positionFloatingPanel,
    renderFloatingBarForVoiceState,
    updateFloatingBarVisibility,
    handleEscapeKeydown,
    handleFloatingPanelEvent,
    handleVoiceState,
    handleFloatingBarUpdatePositions,
    handleFloatingBarSetAlwaysOnTopForWindows,
    dispose,
    sendToMain,
    sendToFloatingBar,
    sendToFloatingPanel,
    getMainWindow: () => mainWindow,
    getFloatingBar: () => floatingBar,
    getFloatingPanelWindow: () => floatingPanelWindow,
    getTray: () => tray,
    getLastVoiceState: () => floatingWindowController?.getLastVoiceState() || null,
    getFloatingPanelType: () => floatingWindowController?.getFloatingPanelType() || null,
  };
}

module.exports = {
  FLOATING_BAR_COMPLETED_HIDE_DELAY_MS,
  FLOATING_BAR_SIZE,
  FLOATING_PANEL_SIZE,
  FLOATING_WINDOW_BOTTOM_GAP,
  createWindowManager,
};
