function registerPermissionIpcHandlers({
  ipcMain,
  app,
  processExecPath = process.execPath,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!app || typeof app.setLoginItemSettings !== 'function') {
    throw new Error('app.setLoginItemSettings is required');
  }

  ipcMain.handle('permission:request', () => true);
  ipcMain.handle('permission:check-with-child-process', () => true);
  ipcMain.handle('permission:reset-accessibility-permission', () => true);
  ipcMain.handle('permission:update-auto-launch', (_, payload = {}) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(payload.enable), path: processExecPath });
    return true;
  });
  ipcMain.handle('permission:update-show-app-in-dock', () => true);

  ipcMain.handle('updater:check-for-update', () => null);
  ipcMain.handle('updater:download-update', () => null);
  ipcMain.handle('updater:quit-and-install', () => null);
  ipcMain.handle('updater:check-update-and-download-silently', () => null);
}

module.exports = {
  registerPermissionIpcHandlers,
};
