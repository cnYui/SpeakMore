function registerModelIpcHandlers({
  ipcMain,
  callModelBackend,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (typeof callModelBackend !== 'function') {
    throw new Error('callModelBackend is required');
  }

  ipcMain.handle('model:list', () => callModelBackend());
  ipcMain.handle('model:download', (_, modelId) => (
    callModelBackend(`/${encodeURIComponent(String(modelId))}/download`, { method: 'POST' })
  ));
  ipcMain.handle('model:cancel-download', (_, modelId) => (
    callModelBackend(`/${encodeURIComponent(String(modelId))}/cancel`, { method: 'POST' })
  ));
  ipcMain.handle('model:delete', (_, modelId) => (
    callModelBackend(`/${encodeURIComponent(String(modelId))}`, { method: 'DELETE' })
  ));
  ipcMain.handle('model:select', (_, modelId) => (
    callModelBackend(`/${encodeURIComponent(String(modelId))}/select`, { method: 'POST' })
  ));
}

module.exports = {
  registerModelIpcHandlers,
};
