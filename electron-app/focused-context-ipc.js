function registerFocusedContextIpcHandlers({
  ipcMain,
  clipboard,
  readFocusedInfo,
  readSelectedTextByClipboard,
  readSelectionSnapshot,
  isSameFocusedContext,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (typeof readFocusedInfo !== 'function' || typeof readSelectedTextByClipboard !== 'function' || typeof readSelectionSnapshot !== 'function') {
    throw new Error('focused context readers are required');
  }
  if (typeof isSameFocusedContext !== 'function') {
    throw new Error('isSameFocusedContext is required');
  }

  ipcMain.handle('focused-context:get-last-focused-info', () => readFocusedInfo());
  ipcMain.handle('focused-context:get-selected-text', () => readSelectedTextByClipboard({ clipboard }));
  ipcMain.handle('focused-context:get-selection-snapshot', () => readSelectionSnapshot({ clipboard }));
  ipcMain.handle('focused-context:is-current-focus', async (_, previousFocusInfo) => {
    const currentFocusInfo = await readFocusedInfo();
    return {
      success: true,
      same: isSameFocusedContext(previousFocusInfo, currentFocusInfo),
      currentFocusInfo,
    };
  });
  ipcMain.handle('focused-context:get-full-context', () => ({ success: true, data: null }));
}

module.exports = {
  registerFocusedContextIpcHandlers,
};
