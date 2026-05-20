function registerSettingsIpcHandlers({
  ipcMain,
  readLocalSettings,
  writeLocalSettings,
  reloadVoiceServerConfig,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (typeof readLocalSettings !== 'function' || typeof writeLocalSettings !== 'function') {
    throw new Error('readLocalSettings and writeLocalSettings are required');
  }
  if (typeof reloadVoiceServerConfig !== 'function') {
    throw new Error('reloadVoiceServerConfig is required');
  }

  ipcMain.handle('settings:get', () => readLocalSettings());
  ipcMain.handle('settings:update', (_, payload = {}) => writeLocalSettings({ ...readLocalSettings(), ...payload }));
  ipcMain.handle('settings:reload-llm-backend', async () => reloadVoiceServerConfig());
}

module.exports = {
  registerSettingsIpcHandlers,
};
