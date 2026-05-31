function registerFileIpcHandlers({
  ipcMain,
  fs,
  shell,
  dialog,
  localDataDir,
  logFilePath,
  recordingsDir,
  calculateDirectorySize,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!fs || typeof fs.mkdirSync !== 'function' || typeof fs.existsSync !== 'function' || typeof fs.writeFileSync !== 'function') {
    throw new Error('fs helpers are required');
  }
  if (!shell || typeof shell.openPath !== 'function') {
    throw new Error('shell.openPath is required');
  }
  if (dialog && typeof dialog.showOpenDialog !== 'function') {
    throw new Error('dialog.showOpenDialog must be a function');
  }
  if (typeof localDataDir !== 'function' || typeof logFilePath !== 'function' || typeof recordingsDir !== 'function' || typeof calculateDirectorySize !== 'function') {
    throw new Error('path helpers are required');
  }

  ipcMain.handle('file:save-recording-log', (_, payload = {}) => {
    fs.mkdirSync(localDataDir(), { recursive: true });
    const content = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    fs.writeFileSync(logFilePath(), `${content}\n`, 'utf8');
    return true;
  });
  ipcMain.handle('file:open-log', async () => {
    fs.mkdirSync(localDataDir(), { recursive: true });
    if (!fs.existsSync(logFilePath())) {
      fs.writeFileSync(logFilePath(), '', 'utf8');
    }
    return (await shell.openPath(logFilePath())) === '';
  });
  ipcMain.handle('file:clear-log', () => {
    fs.mkdirSync(localDataDir(), { recursive: true });
    fs.writeFileSync(logFilePath(), '', 'utf8');
    return true;
  });
  ipcMain.handle('file:open-recordings', async () => {
    fs.mkdirSync(recordingsDir(), { recursive: true });
    return (await shell.openPath(recordingsDir())) === '';
  });
  ipcMain.handle('file:read-recordings-size', async () => ({
    success: true,
    size: calculateDirectorySize(recordingsDir()),
  }));
  ipcMain.handle('file:choose-directory', async (event, payload = {}) => {
    if (!dialog) return { success: false, canceled: true };
    const ownerWindow = event?.sender?.getOwnerBrowserWindow?.();
    const defaultPath = typeof payload.defaultPath === 'string' && payload.defaultPath.trim()
      ? payload.defaultPath.trim()
      : undefined;
    const options = {
      title: '选择模型保存路径',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths?.[0]) return { success: true, canceled: true, path: '' };
    return { success: true, canceled: false, path: result.filePaths[0] };
  });
  ipcMain.handle('file:save-audio-with-dialog', () => ({ success: false, canceled: true }));
}

module.exports = {
  registerFileIpcHandlers,
};
