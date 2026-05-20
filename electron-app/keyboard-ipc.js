const { spawn } = require('child_process');

function registerKeyboardIpcHandlers({
  ipcMain,
  clipboard,
  spawnProcess = spawn,
  readFocusedTextTarget,
  createClipboardSnapshot,
  restoreClipboardSnapshot,
  readFocusedInfo,
  textObservationManager,
  randomUUID = () => require('crypto').randomUUID(),
  processEnv = process.env,
  logger = console,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    throw new Error('clipboard.writeText is required');
  }
  if (typeof readFocusedTextTarget !== 'function' || typeof createClipboardSnapshot !== 'function' || typeof restoreClipboardSnapshot !== 'function' || typeof readFocusedInfo !== 'function') {
    throw new Error('keyboard dependencies are required');
  }
  if (!textObservationManager || typeof textObservationManager.start !== 'function') {
    throw new Error('textObservationManager.start is required');
  }

  ipcMain.handle('keyboard:start-keyboard-listener', () => true);
  ipcMain.handle('keyboard:stop-keyboard-listener', () => true);
  ipcMain.handle('keyboard:type-transcript', async (_, text) => {
    const pastedText = String(text || '');
    if (!pastedText) return false;

    const textTarget = await readFocusedTextTarget();
    if (!textTarget.success) {
      return { success: false, reason: textTarget.reason || 'focused_text_target_unavailable' };
    }

    const previousClipboard = createClipboardSnapshot(clipboard);
    let restoreFailed = false;

    try {
      clipboard.writeText(pastedText);
      const ps = spawnProcess('powershell.exe', [
        '-NoProfile', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 100; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ], {
        windowsHide: true,
        env: {
          SystemRoot: processEnv.SystemRoot,
          PATH: processEnv.PATH,
          TEMP: processEnv.TEMP,
          TMP: processEnv.TMP,
        },
      });
      const pasteSucceeded = await new Promise((resolve) => {
        ps.on('exit', (code) => resolve(code === 0));
        ps.on('error', () => resolve(false));
      });
      if (pasteSucceeded && pastedText.trim()) {
        await textObservationManager.start({
          audioId: randomUUID(),
          pastedText,
          focusInfo: await readFocusedInfo(),
        });
      }
      return { success: pasteSucceeded };
    } finally {
      try {
        restoreClipboardSnapshot(clipboard, previousClipboard);
      } catch {
        restoreFailed = true;
      }

      if (restoreFailed) {
        logger.warn?.('自动粘贴后恢复剪贴板失败');
      }
    }
  });
  ipcMain.handle('keyboard:set-watcher-interval', () => true);
  ipcMain.handle('keyboard-input:reload-keyboard-shortcuts', () => true);
}

module.exports = {
  registerKeyboardIpcHandlers,
};
