function registerCompatIpcHandlers({
  ipcMain,
  localStores,
  defaultLanguage,
  handleStoreUse,
  sendToMain = () => undefined,
  sendToFloatingBar = () => undefined,
  getSystemInfo = () => ({}),
  app,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!localStores || !localStores['app-settings']) {
    throw new Error('localStores app-settings is required');
  }
  if (typeof handleStoreUse !== 'function') {
    throw new Error('handleStoreUse is required');
  }
  if (!app || typeof app.relaunch !== 'function' || typeof app.exit !== 'function') {
    throw new Error('app relaunch/exit are required');
  }

  function setLanguageToDefault() {
    localStores['app-settings'].preferredLanguage = defaultLanguage;
    sendToMain('i18n:language-changed', { lng: localStores['app-settings'].preferredLanguage });
    sendToFloatingBar('i18n:language-changed', { lng: localStores['app-settings'].preferredLanguage });
    return true;
  }

  ipcMain.handle('store:use', handleStoreUse);
  ipcMain.handle('i18n:get-language', () => localStores['app-settings'].preferredLanguage);
  ipcMain.handle('i18n:set-language', setLanguageToDefault);
  ipcMain.handle('i18n:reset-to-system-language', setLanguageToDefault);
  ipcMain.handle('mixpanel:track-event', () => ({ success: true }));
  ipcMain.handle('release-notes:prefetch', () => true);
  ipcMain.handle('release-notes:clear-cache', () => true);
  ipcMain.handle('context:get-app-icon', () => null);
  ipcMain.handle('device:is-lid-open', () => true);
  ipcMain.handle('rsa:set-config', () => true);
  ipcMain.handle('rsa:get-config', () => ({ publicKey: '', enabled: false }));
  ipcMain.handle('rsa:is-enabled', () => false);
  ipcMain.handle('rsa:clear', () => true);
  ipcMain.handle('rsa:encrypt', (_, payload = {}) => payload.value || '');
  ipcMain.handle('troubleshooting:get-system-info', () => ({
    success: true,
    data: {
      basic: getSystemInfo(),
    },
  }));
  ipcMain.handle('app:restart', () => {
    app.relaunch();
    app.exit();
  });
}

module.exports = {
  registerCompatIpcHandlers,
};
