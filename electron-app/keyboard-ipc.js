/**
 * 键盘粘贴 IPC
 *
 * 需要理解语音结果如何自动粘贴、剪贴板如何恢复，以及自动学习观察何时启动时看这里。
 */
const { spawn } = require('child_process');

// Chromium / Electron 应用（VS Code、Codex、Chrome、Slack 等）和微信处理 Ctrl+V 时是异步读剪贴板的：
// SendKeys 进程退出时目标应用可能还没读到。实测在 Chromium 输入框里“发出 Ctrl+V 后立刻恢复剪贴板”
// 20/20 次粘贴的是用户原来的剪贴板，延迟 20ms 以上恢复则 20/20 正确。这里留足余量，并且不阻塞结果返回。
const CLIPBOARD_RESTORE_DELAY_MS = 600;

function registerKeyboardIpcHandlers({
  ipcMain,
  clipboard,
  spawnProcess = spawn,
  readFocusedTextTarget,
  restoreForegroundWindow = null,
  createClipboardSnapshot,
  restoreClipboardSnapshot,
  readFocusedInfo,
  textObservationManager,
  macosPlatformCapabilities = null,
  platform = process.platform,
  randomUUID = () => require('crypto').randomUUID(),
  processEnv = process.env,
  logger = console,
  clipboardRestoreDelayMs = CLIPBOARD_RESTORE_DELAY_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  function log(level, message, details = {}) {
    logger?.[level]?.(`[auto-learning][keyboard] ${message}`, details);
  }

  // 还没恢复的上一轮剪贴板快照。连续两次听写间隔很短时，第二轮必须沿用第一轮保存的“用户原始剪贴板”，
  // 不能把第一轮的听写结果当成原始内容快照下来。
  let pendingClipboardRestore = null;

  function takeClipboardSnapshot() {
    if (pendingClipboardRestore) {
      clearTimeoutImpl(pendingClipboardRestore.timer);
      const { snapshot } = pendingClipboardRestore;
      pendingClipboardRestore = null;
      return snapshot;
    }
    return createClipboardSnapshot(clipboard);
  }

  function restoreClipboardNow(snapshot, pastedText) {
    try {
      restoreClipboardSnapshot(clipboard, snapshot);
      log('info', '已恢复剪贴板', { pastedText });
    } catch {
      log('error', '恢复剪贴板失败', { pastedText });
      logger.warn?.('自动粘贴后恢复剪贴板失败');
    }
  }

  function scheduleClipboardRestore(snapshot, pastedText) {
    const entry = { snapshot, timer: null };
    pendingClipboardRestore = entry;
    entry.timer = setTimeoutImpl(() => {
      if (pendingClipboardRestore !== entry) return;
      pendingClipboardRestore = null;
      // 等待期间用户自己复制了别的内容，就不要再用旧快照覆盖。
      const currentText = typeof clipboard.readText === 'function' ? clipboard.readText() : pastedText;
      if (currentText !== pastedText) {
        log('info', '剪贴板已被用户改动，跳过恢复', { pastedText });
        return;
      }
      restoreClipboardNow(snapshot, pastedText);
    }, clipboardRestoreDelayMs);
    log('info', '已安排延迟恢复剪贴板', { pastedText, delayMs: clipboardRestoreDelayMs });
  }

  // 这些依赖都由 main.js 注入；启动期直接失败比运行到半截静默丢结果更容易定位接线问题。
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

  async function startTextObservation(pastedText) {
    const focusInfo = await readFocusedInfo();
    log('info', '读取当前焦点信息完成', {
      pastedText,
      focusInfo,
    });
    try {
      const observationResult = await textObservationManager.start({
        audioId: randomUUID(),
        pastedText,
        focusInfo,
      });
      log('info', '观察会话启动结果', {
        pastedText,
        observationResult,
      });
    } catch (error) {
      // 自动学习是粘贴后的后台能力；失败不能影响用户已经拿到的文本结果。
      log('info', '观察会话启动异常，已静默结束', {
        pastedText,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function pasteWithWindowsSendKeys(pastedText, startFocusInfo) {
    log('info', '开始检查焦点目标', { startFocusInfo });
    let textTarget = await readFocusedTextTarget({ startFocusInfo });
    log('info', '焦点目标检查结果', { textTarget });

    // 录音期间焦点可能漂走（别的应用弹窗、用户点了别处）。结果要贴回“录音开始时锁定的光标位置”，
    // 所以目标不可用时，先把当时的窗口切回前台（窗口会记住自己的光标位置），再检查一次。
    const lockedHwnd = startFocusInfo?.appInfo?.app_metadata?.hwnd;
    if (!textTarget.success && lockedHwnd && typeof restoreForegroundWindow === 'function') {
      const restored = await restoreForegroundWindow(lockedHwnd);
      log('info', '尝试切回录音开始时的窗口', { lockedHwnd, restored });
      if (restored?.success) {
        textTarget = await readFocusedTextTarget({ startFocusInfo });
        log('info', '切回窗口后重新检查焦点目标', { textTarget });
      }
    }

    if (!textTarget.success) {
      log('warn', '焦点目标不可用，终止自动粘贴', { textTarget, pastedText });
      return { success: false, reason: textTarget.reason || 'focused_text_target_unavailable' };
    }

    // 自动粘贴必须临时借用系统剪贴板；先做快照，才能在 finally 中安排恢复用户原本的剪贴板内容。
    const previousClipboard = takeClipboardSnapshot();
    log('info', '已创建剪贴板快照', {
      pastedText,
      target: textTarget,
    });

    try {
      clipboard.writeText(pastedText);
      log('info', '已写入系统剪贴板', { pastedText });
      // Electron 主进程不能直接把文本写进任意第三方输入框；这里使用系统 SendKeys 模拟 Ctrl+V。
      // 100ms 延迟给目标应用一点时间接收焦点，减少刚切回输入框时粘贴丢失的概率。
      log('info', '准备调用 SendKeys', {
        pastedText,
        processEnv: {
          hasSystemRoot: Boolean(processEnv.SystemRoot),
          hasPath: Boolean(processEnv.PATH),
          hasTemp: Boolean(processEnv.TEMP),
          hasTmp: Boolean(processEnv.TMP),
        },
      });
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
      // SendKeys 只能告诉我们命令是否执行完成，不能证明目标应用实际接收了全部文本；失败时直接返回给 renderer 走兜底展示。
      log('info', 'SendKeys 子进程已启动', { pastedText });
      const pasteSucceeded = await new Promise((resolve) => {
        ps.on('exit', (code, signal) => {
          log('info', 'SendKeys 子进程退出', { code, signal, pastedText });
          resolve(code === 0);
        });
        ps.on('error', (error) => {
          log('error', 'SendKeys 子进程错误', { error, pastedText });
          resolve(false);
        });
      });
      log('info', 'SendKeys 执行结果', { pasteSucceeded, pastedText });
      if (pasteSucceeded && pastedText.trim()) {
        await startTextObservation(pastedText);
      }
      return { success: pasteSucceeded };
    } finally {
      // 恢复剪贴板放在 finally，确保粘贴失败、观察启动失败或 PowerShell 异常时也不会长期占用用户剪贴板；
      // 但要延迟执行，给目标应用异步读取剪贴板留出时间。
      scheduleClipboardRestore(previousClipboard, pastedText);
    }
  }

  async function pasteWithMacos(pastedText, startFocusInfo) {
    if (!macosPlatformCapabilities || typeof macosPlatformCapabilities.pasteText !== 'function') {
      return { success: false, reason: 'macos_auto_paste_unavailable' };
    }

    const result = await macosPlatformCapabilities.pasteText(pastedText, { startFocusInfo });
    log(result?.success ? 'info' : 'warn', 'macOS 自动粘贴结果', {
      pastedText,
      result,
    });
    if (result?.success && pastedText.trim()) {
      await startTextObservation(pastedText);
    }
    return result;
  }

  // 自动粘贴的唯一主进程入口。renderer 只提交最终文本，是否真的能粘贴由主进程基于当前焦点环境判断。
  ipcMain.handle('keyboard:type-transcript', async (_, text, pasteContext = {}) => {
    const pastedText = String(text || '');
    log('info', '收到转写结果', {
      pastedText,
      length: pastedText.length,
      pasteContext,
    });
    if (!pastedText) return false;

    // 录音开始前记录的焦点信息用于防止焦点漂移；如果当前目标已经不是可信输入框，就不能误发粘贴快捷键。
    const startFocusInfo = pasteContext && typeof pasteContext === 'object'
      ? pasteContext.startFocusInfo || null
      : null;

    if (platform === 'darwin') {
      return pasteWithMacos(pastedText, startFocusInfo);
    }

    if (platform !== 'win32') {
      return { success: false, reason: 'auto_paste_unsupported_platform' };
    }

    return pasteWithWindowsSendKeys(pastedText, startFocusInfo);
  });
}

module.exports = {
  CLIPBOARD_RESTORE_DELAY_MS,
  registerKeyboardIpcHandlers,
};
