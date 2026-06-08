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

const FLOATING_BAR_SIZE = { width: 220, height: 224 };
const FLOATING_PANEL_SIZE = { width: 440, height: 220 };
const MEETING_SUBTITLES_SIZE = { width: 1160, height: 360 };
const MEETING_DETECTION_MIN_SIZE = { width: 360, height: 82 };
const MEETING_DETECTION_MAX_SIZE = { width: 480, height: 102 };
const FLOATING_WINDOW_BOTTOM_GAP = 32;
const MEETING_DETECTION_TOP_GAP = 10;
const MEETING_DETECTION_RIGHT_GAP = 10;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveMeetingDetectionSize(workArea = {}) {
  const workAreaWidth = Number(workArea.width) || 1440;
  const width = Math.round(clampNumber(workAreaWidth * 0.24, MEETING_DETECTION_MIN_SIZE.width, MEETING_DETECTION_MAX_SIZE.width));
  const heightRatio = (width - MEETING_DETECTION_MIN_SIZE.width)
    / (MEETING_DETECTION_MAX_SIZE.width - MEETING_DETECTION_MIN_SIZE.width);
  const height = Math.round(
    MEETING_DETECTION_MIN_SIZE.height
    + clampNumber(heightRatio, 0, 1) * (MEETING_DETECTION_MAX_SIZE.height - MEETING_DETECTION_MIN_SIZE.height),
  );
  return { width, height };
}

function createWindowManager({
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  session,
  desktopCapturer,
  screen,
  baseDir = __dirname,
  preloadPath = () => path.join(baseDir, 'preload.js'),
  iconPath = () => '',
  trayIconPath = () => '',
  mainRendererPath = () => path.join(baseDir, 'renderer', 'dist', 'index.html'),
  floatingBarRendererPath = () => path.join(baseDir, 'renderer', 'dist', 'floating-bar.html'),
  floatingPanelRendererPath = () => path.join(baseDir, 'renderer', 'dist', 'floating-panel.html'),
  meetingSubtitlesRendererPath = () => path.join(baseDir, 'renderer', 'dist', 'meeting-subtitles.html'),
  meetingDetectionRendererPath = () => path.join(baseDir, 'renderer', 'dist', 'meeting-detection.html'),
  resolveBottomCenterBounds,
  isActiveVoiceState = () => false,
  isErrorVoiceState = () => false,
  isTerminalVoiceState = () => false,
  shouldShowShortcutHint = () => true,
  sendToMain = () => undefined,
  sendToFloatingBar = () => undefined,
  sendToFloatingPanel = () => undefined,
  sendToMeetingSubtitles = () => undefined,
  getAppIsQuitting = () => false,
  isFloatingBarEnabled = () => true,
  shouldHideMainWindowOnClose = () => true,
  requestAppQuit = () => app?.quit?.(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  processPlatform = process.platform,
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
  if (!screen) {
    throw new Error('screen is required');
  }
  if (typeof resolveBottomCenterBounds !== 'function') {
    throw new Error('resolveBottomCenterBounds is required');
  }

  let mainWindow = null;
  let floatingBar = null;
  let floatingPanelWindow = null;
  let meetingSubtitlesWindow = null;
  let meetingDetectionWindow = null;
  let meetingDetectionHideTimer = null;
  let tray = null;
  let floatingWindowController = null;
  const shouldRefreshFloatingWindowLayer = processPlatform === 'darwin';

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

  function resolveMeetingSubtitlesBounds() {
    return resolveBottomCenterBounds(getCurrentFloatingWorkArea(), MEETING_SUBTITLES_SIZE, 120);
  }

  function resolveMeetingDetectionBounds() {
    const workArea = getCurrentFloatingWorkArea();
    const size = resolveMeetingDetectionSize(workArea);
    return {
      x: Math.round(workArea.x + workArea.width - size.width - MEETING_DETECTION_RIGHT_GAP),
      y: Math.round(workArea.y + MEETING_DETECTION_TOP_GAP),
      ...size,
    };
  }

  function positionFloatingBar() {
    if (!floatingBar || floatingBar.isDestroyed()) return;
    floatingBar.setBounds(resolveFloatingBarBounds(), false);
  }

  function positionFloatingPanel() {
    if (!floatingPanelWindow || floatingPanelWindow.isDestroyed()) return;
    floatingPanelWindow.setBounds(resolveFloatingPanelBounds(), false);
  }

  function positionMeetingSubtitles() {
    if (!meetingSubtitlesWindow || meetingSubtitlesWindow.isDestroyed()) return;
    meetingSubtitlesWindow.setBounds(resolveMeetingSubtitlesBounds(), false);
  }

  function positionMeetingDetectionNotification() {
    if (!meetingDetectionWindow || meetingDetectionWindow.isDestroyed()) return;
    meetingDetectionWindow.setBounds(resolveMeetingDetectionBounds(), false);
  }

  function showWindowWithoutActivation(window) {
    if (typeof window.showInactive === 'function') {
      window.showInactive();
      return;
    }
    window.show();
  }

  function keepFloatingWindowOnTop(targetWindow, { moveToTop = true, forceRefresh = false } = {}) {
    if (!targetWindow || targetWindow.isDestroyed()) return;
    if (forceRefresh) {
      targetWindow.setAlwaysOnTop(false);
    }
    targetWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    targetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    if (moveToTop && typeof targetWindow.moveTop === 'function') {
      targetWindow.moveTop();
    }
  }

  function showFloatingBar() {
    if (!floatingBar || floatingBar.isDestroyed()) return;
    if (!isFloatingBarEnabled()) {
      hideFloatingBar();
      return;
    }
    positionFloatingBar();
    floatingBar.setIgnoreMouseEvents(true, { forward: true });
    showWindowWithoutActivation(floatingBar);
    keepFloatingWindowOnTop(floatingBar, { forceRefresh: shouldRefreshFloatingWindowLayer });
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
    showWindowWithoutActivation(floatingPanelWindow);
    keepFloatingWindowOnTop(floatingPanelWindow, { forceRefresh: shouldRefreshFloatingWindowLayer });
  }

  function hideFloatingPanel() {
    if (!floatingPanelWindow || floatingPanelWindow.isDestroyed()) return;
    floatingPanelWindow.setIgnoreMouseEvents(true, { forward: true });
    floatingPanelWindow.hide();
  }

  function handleFloatingBarUpdatePositions(payload = []) {
    if (floatingBar && !floatingBar.isDestroyed()) {
      floatingBar.setIgnoreMouseEvents(true, { forward: true });
    }
    return true;
  }

  function showMeetingSubtitles(payload = {}) {
    createMeetingSubtitlesWindow();
    if (!meetingSubtitlesWindow || meetingSubtitlesWindow.isDestroyed()) return;
    positionMeetingSubtitles();
    meetingSubtitlesWindow.setIgnoreMouseEvents(false);
    showWindowWithoutActivation(meetingSubtitlesWindow);
    keepFloatingWindowOnTop(meetingSubtitlesWindow, { forceRefresh: shouldRefreshFloatingWindowLayer });
    sendToMeetingSubtitles('meeting-subtitles', { visible: true, ...payload });
  }

  function hideMeetingSubtitles() {
    if (!meetingSubtitlesWindow || meetingSubtitlesWindow.isDestroyed()) return;
    meetingSubtitlesWindow.setIgnoreMouseEvents(true, { forward: true });
    meetingSubtitlesWindow.hide();
    sendToMeetingSubtitles('meeting-subtitles', { visible: false });
  }

  function sendToMeetingDetection(channel, payload) {
    if (meetingDetectionWindow && !meetingDetectionWindow.isDestroyed()) {
      meetingDetectionWindow.webContents.send(channel, payload);
    }
  }

  function clearMeetingDetectionHideTimer() {
    if (!meetingDetectionHideTimer) return;
    clearTimer(meetingDetectionHideTimer);
    meetingDetectionHideTimer = null;
  }

  function showMeetingDetectionNotification(payload = {}) {
    createMeetingDetectionWindow();
    if (!meetingDetectionWindow || meetingDetectionWindow.isDestroyed()) return;
    clearMeetingDetectionHideTimer();
    positionMeetingDetectionNotification();
    meetingDetectionWindow.setIgnoreMouseEvents(false);
    showWindowWithoutActivation(meetingDetectionWindow);
    keepFloatingWindowOnTop(meetingDetectionWindow, { forceRefresh: shouldRefreshFloatingWindowLayer });
    sendToMeetingDetection('meeting-detector:detected', { visible: true, ...payload });
    const visibleMs = Number(payload.visibleMs || 15000);
    meetingDetectionHideTimer = setTimer(() => {
      meetingDetectionHideTimer = null;
      hideMeetingDetectionNotification();
    }, Number.isFinite(visibleMs) && visibleMs > 0 ? visibleMs : 15000);
  }

  function hideMeetingDetectionNotification() {
    clearMeetingDetectionHideTimer();
    if (!meetingDetectionWindow || meetingDetectionWindow.isDestroyed()) return;
    meetingDetectionWindow.setIgnoreMouseEvents(true, { forward: true });
    meetingDetectionWindow.hide();
    sendToMeetingDetection('meeting-detector:detected', { visible: false });
  }

  function handleFloatingWindowsBringToFront() {
    keepFloatingWindowOnTop(floatingBar, { forceRefresh: true });
    keepFloatingWindowOnTop(floatingPanelWindow, { forceRefresh: true });
    keepFloatingWindowOnTop(meetingSubtitlesWindow, { forceRefresh: true });
    keepFloatingWindowOnTop(meetingDetectionWindow, { forceRefresh: true });
    return true;
  }

  function handleFloatingBarSetAlwaysOnTopForWindows() {
    return handleFloatingWindowsBringToFront();
  }

  function createMainWindow(options = {}) {
    const shouldShow = options?.show !== false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (shouldShow) {
        mainWindow.show();
        mainWindow.focus();
      }
      return mainWindow;
    }

    const mainSession = session.fromPartition('persist:no-proxy-session');
    configureDisplayMediaRequestHandler(mainSession);

    mainWindow = new BrowserWindow({
      ...buildMainWindowOptions({
        preloadPath: preloadPath(),
        iconPath: iconPath(),
        session: mainSession,
        show: shouldShow,
      }),
    });

    mainWindow.loadFile(mainRendererPath());
    mainWindow.on('close', (event) => {
      if (getAppIsQuitting()) return;
      if (!shouldHideMainWindowOnClose()) {
        event.preventDefault();
        requestAppQuit();
        return;
      }
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

  function configureDisplayMediaRequestHandler(targetSession) {
    if (!targetSession || typeof targetSession.setDisplayMediaRequestHandler !== 'function') return;
    if (!desktopCapturer || typeof desktopCapturer.getSources !== 'function') return;
    targetSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        .then((sources) => {
          const source = Array.isArray(sources) ? sources[0] : null;
          if (!source) {
            callback({});
            return;
          }
          callback(processPlatform === 'win32'
            ? { video: source, audio: 'loopback' }
            : { video: source });
        })
        .catch(() => callback({}));
    });
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
    keepFloatingWindowOnTop(floatingBar, { moveToTop: false });
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
    keepFloatingWindowOnTop(floatingPanelWindow, { moveToTop: false });
    floatingPanelWindow.setFullScreenable(false);
    floatingPanelWindow.on('closed', () => {
      floatingWindowController?.handleFloatingPanelClosed();
      floatingPanelWindow = null;
    });
    return floatingPanelWindow;
  }

  function createMeetingSubtitlesWindow() {
    if (meetingSubtitlesWindow && !meetingSubtitlesWindow.isDestroyed()) return meetingSubtitlesWindow;

    meetingSubtitlesWindow = new BrowserWindow({
      ...buildFloatingWindowOptions({
        bounds: resolveMeetingSubtitlesBounds(),
        preloadPath: preloadPath(),
      }),
      resizable: true,
    });

    meetingSubtitlesWindow.loadFile(meetingSubtitlesRendererPath());
    meetingSubtitlesWindow.setIgnoreMouseEvents(true, { forward: true });
    keepFloatingWindowOnTop(meetingSubtitlesWindow, { moveToTop: false });
    meetingSubtitlesWindow.setFullScreenable(false);
    meetingSubtitlesWindow.on('closed', () => {
      meetingSubtitlesWindow = null;
    });
    return meetingSubtitlesWindow;
  }

  function createMeetingDetectionWindow() {
    if (meetingDetectionWindow && !meetingDetectionWindow.isDestroyed()) return meetingDetectionWindow;

    meetingDetectionWindow = new BrowserWindow({
      ...buildFloatingWindowOptions({
        bounds: resolveMeetingDetectionBounds(),
        preloadPath: preloadPath(),
      }),
    });

    meetingDetectionWindow.loadFile(meetingDetectionRendererPath());
    meetingDetectionWindow.setIgnoreMouseEvents(true, { forward: true });
    keepFloatingWindowOnTop(meetingDetectionWindow, { moveToTop: false });
    meetingDetectionWindow.setFullScreenable(false);
    meetingDetectionWindow.on('closed', () => {
      clearMeetingDetectionHideTimer();
      meetingDetectionWindow = null;
    });
    return meetingDetectionWindow;
  }

  function createTray() {
    if (tray && typeof tray.isDestroyed === 'function' && !tray.isDestroyed()) return tray;
    if (tray && typeof tray.isDestroyed !== 'function') return tray;

    const preferredPath = trayIconPath();
    const fallbackPath = iconPath();
    let image = nativeImage.createFromPath(preferredPath);
    if (
      image
      && typeof image.isEmpty === 'function'
      && image.isEmpty()
      && fallbackPath
      && fallbackPath !== preferredPath
    ) {
      image = nativeImage.createFromPath(fallbackPath);
    }
    image = image.resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip('SpeakMore');
    tray.on('click', createMainWindow);
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
      createMainWindow,
      quit: () => app.quit(),
    })));
    return tray;
  }

  floatingWindowController = createFloatingWindowController({
    isActiveVoiceState,
    isErrorVoiceState,
    isTerminalVoiceState,
    isFloatingBarEnabled,
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
    hideMeetingSubtitles();
    hideMeetingDetectionNotification();
  }

  return {
    createMainWindow,
    createFloatingBar,
    createFloatingPanelWindow,
    createMeetingSubtitlesWindow,
    createMeetingDetectionWindow,
    createTray,
    showFloatingBar,
    hideFloatingBar,
    showFloatingPanel,
    hideFloatingPanel,
    showMeetingSubtitles,
    hideMeetingSubtitles,
    showMeetingDetectionNotification,
    hideMeetingDetectionNotification,
    positionFloatingBar,
    positionFloatingPanel,
    positionMeetingSubtitles,
    positionMeetingDetectionNotification,
    renderFloatingBarForVoiceState,
    updateFloatingBarVisibility,
    handleEscapeKeydown,
    handleFloatingPanelEvent,
    handleVoiceState,
    handleFloatingBarUpdatePositions,
    handleFloatingWindowsBringToFront,
    handleFloatingBarSetAlwaysOnTopForWindows,
    dispose,
    sendToMain,
    sendToFloatingBar,
    sendToFloatingPanel,
    getMainWindow: () => mainWindow,
    getFloatingBar: () => floatingBar,
    getFloatingPanelWindow: () => floatingPanelWindow,
    getMeetingSubtitlesWindow: () => meetingSubtitlesWindow,
    getMeetingDetectionWindow: () => meetingDetectionWindow,
    getTray: () => tray,
    getLastVoiceState: () => floatingWindowController?.getLastVoiceState() || null,
    getFloatingPanelType: () => floatingWindowController?.getFloatingPanelType() || null,
  };
}

module.exports = {
  FLOATING_BAR_COMPLETED_HIDE_DELAY_MS,
  FLOATING_BAR_SIZE,
  FLOATING_PANEL_SIZE,
  MEETING_SUBTITLES_SIZE,
  MEETING_DETECTION_MIN_SIZE,
  MEETING_DETECTION_MAX_SIZE,
  FLOATING_WINDOW_BOTTOM_GAP,
  resolveMeetingDetectionSize,
  createWindowManager,
};
