function registerTranslationModelIpcHandlers({
  ipcMain,
  ensureVoiceBackendStarted,
  getTranslationModelStatus,
  startTranslationModelDownload,
  loadTranslationModel,
  unloadTranslationModel,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (typeof ensureVoiceBackendStarted !== 'function') {
    throw new Error('ensureVoiceBackendStarted is required');
  }
  if (
    typeof getTranslationModelStatus !== 'function'
    || typeof startTranslationModelDownload !== 'function'
    || typeof loadTranslationModel !== 'function'
    || typeof unloadTranslationModel !== 'function'
  ) {
    throw new Error('translation model client methods are required');
  }

  async function withBackendStarted(handler, payload = {}) {
    const startResult = await ensureVoiceBackendStarted();
    if (startResult?.success === false) return startResult;
    return handler(payload);
  }

  ipcMain.handle('translation-model:get-status', async (_, payload = {}) => (
    withBackendStarted(getTranslationModelStatus, payload)
  ));

  ipcMain.handle('translation-model:start-download', async (_, payload = {}) => (
    withBackendStarted(startTranslationModelDownload, payload)
  ));

  ipcMain.handle('translation-model:load', async (_, payload = {}) => (
    withBackendStarted(loadTranslationModel, payload)
  ));

  ipcMain.handle('translation-model:unload', async (_, payload = {}) => (
    withBackendStarted(unloadTranslationModel, payload)
  ));
}

module.exports = {
  registerTranslationModelIpcHandlers,
};
