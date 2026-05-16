const { spawn } = require('child_process');

const DEFAULT_SELECTION_MARKER = `__TYPELESS_SELECTION_MARKER_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
const COPY_WAIT_MS = 80;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSendKeysShortcut(shortcut) {
  return () => new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${shortcut}")`,
    ], {
      windowsHide: true,
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
    });

    ps.on('exit', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`SendKeys exited with code ${code}`));
    });
    ps.on('error', reject);
  });
}

function normalizeSelectedTextResult(value) {
  if (typeof value === 'string') {
    return { success: Boolean(value.trim()), text: value.trim(), source: 'legacy' };
  }

  if (!value || typeof value !== 'object') {
    return { success: false, text: '', source: 'unknown', reason: 'invalid_result' };
  }

  const text = typeof value.text === 'string' ? value.text.trim() : '';
  return {
    success: Boolean(value.success) && Boolean(text),
    text: Boolean(value.success) ? text : '',
    source: typeof value.source === 'string' ? value.source : 'unknown',
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
  };
}

function isNonEmptyClipboardImage(image) {
  if (!image) return false;
  return typeof image.isEmpty === 'function' ? !image.isEmpty() : true;
}

function createClipboardSnapshot(clipboard) {
  const data = {};

  const text = clipboard.readText();
  if (text) data.text = text;

  if (typeof clipboard.readHTML === 'function') {
    const html = clipboard.readHTML();
    if (html) data.html = html;
  }

  if (typeof clipboard.readRTF === 'function') {
    const rtf = clipboard.readRTF();
    if (rtf) data.rtf = rtf;
  }

  if (typeof clipboard.readImage === 'function') {
    const image = clipboard.readImage();
    if (isNonEmptyClipboardImage(image)) data.image = image;
  }

  return data;
}

function restoreClipboardSnapshot(clipboard, snapshot) {
  if (typeof clipboard.write === 'function') {
    clipboard.write(snapshot);
    return;
  }

  clipboard.writeText(snapshot.text || '');
}

async function readSelectedTextByClipboard({
  clipboard,
  sendCopyShortcut = createSendKeysShortcut('^c'),
  wait: waitForClipboard = wait,
  marker = DEFAULT_SELECTION_MARKER,
  copyWaitMs = COPY_WAIT_MS,
} = {}) {
  if (!clipboard || typeof clipboard.readText !== 'function' || typeof clipboard.writeText !== 'function') {
    return { success: false, text: '', source: 'clipboard', reason: 'clipboard_unavailable' };
  }

  const previousClipboard = createClipboardSnapshot(clipboard);
  let restoreFailed = false;

  try {
    clipboard.writeText(marker);
    await sendCopyShortcut();
    await waitForClipboard(copyWaitMs);

    const copiedText = clipboard.readText();
    const text = copiedText === marker ? '' : String(copiedText || '').trim();

    if (!text) {
      return { success: false, text: '', source: 'clipboard', reason: 'empty' };
    }

    return { success: true, text, source: 'clipboard' };
  } catch (error) {
    return {
      success: false,
      text: '',
      source: 'clipboard',
      reason: 'copy_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      restoreClipboardSnapshot(clipboard, previousClipboard);
    } catch {
      restoreFailed = true;
    }

    if (restoreFailed) {
      console.warn('恢复剪贴板文本失败');
    }
  }
}

module.exports = {
  readSelectedTextByClipboard,
  normalizeSelectedTextResult,
};
