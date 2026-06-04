function registerPageIpcHandlers({
  ipcMain,
  createMainWindow,
  createFloatingBar,
  getMainWindow,
  getFloatingBar,
  sendToMain = () => undefined,
  handleFloatingPanelEvent = () => undefined,
  handleVoiceState = () => undefined,
  handleFloatingBarUpdatePositions = () => true,
  handleFloatingBarSetAlwaysOnTopForWindows = () => true,
  handleFloatingWindowsBringToFront = handleFloatingBarSetAlwaysOnTopForWindows,
  openExternalUrl,
  shell,
  getInteractiveCardPayload = () => null,
  setInteractiveCardPayload = () => undefined,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.on !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (typeof createMainWindow !== 'function' || typeof createFloatingBar !== 'function') {
    throw new Error('createMainWindow and createFloatingBar are required');
  }
  if (typeof getMainWindow !== 'function' || typeof getFloatingBar !== 'function') {
    throw new Error('getMainWindow and getFloatingBar are required');
  }
  if (typeof openExternalUrl !== 'function') {
    throw new Error('openExternalUrl is required');
  }
  if (!shell || typeof shell.openPath !== 'function') {
    throw new Error('shell.openPath is required');
  }

  ipcMain.handle('page:open-url', (_, payload) => openExternalUrl(payload?.url || payload));
  ipcMain.handle('page:open-url-scheme', (_, payload) => openExternalUrl(payload?.url || payload));
  ipcMain.handle('page:open-hub', () => {
    createMainWindow();
    return true;
  });
  ipcMain.handle('page:open-typeless-bar', () => {
    createFloatingBar();
    return true;
  });
  ipcMain.handle('page:restart-typeless-bar', () => {
    const currentFloatingBar = getFloatingBar();
    if (currentFloatingBar && !currentFloatingBar.isDestroyed()) {
      currentFloatingBar.close();
    }
    createFloatingBar();
    return true;
  });
  ipcMain.handle('page:open-settings-modal', (_, payload = {}) => {
    createMainWindow();
    sendToMain('page-event--hub--open-settings-hub', payload);
    return true;
  });
  ipcMain.handle('page:change-hub-route', (_, payload = {}) => {
    createMainWindow();
    sendToMain('page-event--hub--change-route', payload);
    return true;
  });
  ipcMain.handle('page:open-devtools', (_, payload = {}) => {
    const target = payload?.target === 'floating-bar' ? getFloatingBar() : getMainWindow();
    if (target && !target.isDestroyed()) {
      target.webContents.openDevTools({ mode: payload?.mode || 'detach' });
      return true;
    }
    createMainWindow();
    getMainWindow()?.webContents.openDevTools({ mode: payload?.mode || 'detach' });
    return true;
  });
  ipcMain.handle('page:close-all-devtools', () => {
    for (const target of [getMainWindow(), getFloatingBar()]) {
      if (target && !target.isDestroyed() && target.webContents.isDevToolsOpened()) {
        target.webContents.closeDevTools();
      }
    }
    return true;
  });
  ipcMain.handle('page:open-sidebar', (_, payload = {}) => {
    createMainWindow();
    sendToMain('page-event--hub--open-sidebar', payload);
    return true;
  });
  ipcMain.handle('page:floating-bar-click', () => true);
  ipcMain.on('floating-panel', (_, payload = {}) => {
    handleFloatingPanelEvent(payload);
  });
  ipcMain.on('voice-state', (_, payload = {}) => {
    handleVoiceState(payload);
  });
  ipcMain.handle('page:floating-bar-update-positions', (_, payload = []) => (
    handleFloatingBarUpdatePositions(payload)
  ));
  ipcMain.handle('page:floating-windows-bring-to-front', () => (
    handleFloatingWindowsBringToFront()
  ));
  ipcMain.handle('page:floating-bar-set-always-on-top-for-windows', () => (
    handleFloatingWindowsBringToFront()
  ));
  ipcMain.handle('page:complete-onboarding', () => true);
  ipcMain.handle('page:open-interactive-card', (_, payload = {}) => {
    setInteractiveCardPayload(payload);
    sendToMain('interactive-card:update', payload);
    return true;
  });
  ipcMain.handle('page:close-interactive-card', () => {
    setInteractiveCardPayload(null);
    sendToMain('interactive-card:update', null);
    return true;
  });
  ipcMain.handle('page:get-interactive-card-payload', () => getInteractiveCardPayload());
  ipcMain.handle('page:update-interactive-card-bounds', () => true);
  ipcMain.handle('page:close-sidebar', () => true);
  ipcMain.handle('page:launch-application', async (_, payload = {}) => {
    const candidate = payload?.path || payload?.applicationPath || payload?.url || payload;
    if (typeof candidate !== 'string' || !candidate) return false;
    if (candidate.startsWith('http:') || candidate.startsWith('https:') || candidate.startsWith('ms-settings:')) {
      return openExternalUrl(candidate);
    }
    return shell.openPath(candidate).then((result) => result === '');
  });
  ipcMain.handle('page:set-debug-window-position', () => true);
}

module.exports = {
  registerPageIpcHandlers,
};
