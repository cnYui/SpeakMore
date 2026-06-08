const {
  createEmptyFocusedInfo,
  normalizeFocusedInfo,
  normalizeFocusedTextTargetResult,
  normalizeUiaSelectionResult,
} = require('./normalizers');
const { readSelectedTextByClipboard } = require('./clipboard');
const { detectAppCompatTextTarget } = require('./app-compat');
const {
  FOCUSED_TEXT_TARGET_SCRIPT,
  FOCUSED_WINDOW_SCRIPT,
  FOCUSED_WINDOW_TREE_SCRIPT,
  UIA_SELECTION_SCRIPT,
  VISIBLE_WINDOWS_SCRIPT,
  WIN32_CARET_TARGET_SCRIPT,
} = require('./scripts');
const { powershellJsonCommand } = require('./powershell');

function summarizeText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return {
    hasText: Boolean(text),
    length: text.length,
    preview: text ? text.replace(/\s+/g, ' ').slice(0, 80) : '',
  };
}

function summarizeSelectionResult(value = {}) {
  return {
    success: Boolean(value.success),
    source: typeof value.source === 'string' ? value.source : 'unknown',
    confidence: typeof value.confidence === 'string' ? value.confidence : 'unknown',
    reason: typeof value.reason === 'string' ? value.reason : '',
    selectionScope: typeof value.selectionScope === 'string' ? value.selectionScope : '',
    focusedReason: typeof value.focusedReason === 'string' ? value.focusedReason : '',
    foregroundScanned: Number.isFinite(Number(value.foregroundScanned)) ? Number(value.foregroundScanned) : null,
    ...summarizeText(value.text),
  };
}

function createSelectionLogger(logger) {
  return function logSelection(message, details = {}) {
    logger?.info?.(`[focused-context][selection] ${message}`, details);
  };
}

async function readFocusedInfo({
  readWindowInfo = powershellJsonCommand(FOCUSED_WINDOW_SCRIPT),
} = {}) {
  try {
    // 这里先拿窗口级信息，再统一整理成内部结构，避免上层关心 PowerShell 原始字段。
    const windowInfo = await readWindowInfo();
    const processName = typeof windowInfo.process_name === 'string' ? windowInfo.process_name : '';
    const windowTitle = typeof windowInfo.window_title === 'string' ? windowInfo.window_title : '';
    const hwnd = typeof windowInfo.hwnd === 'string' ? windowInfo.hwnd : '';
    const processId = Number(windowInfo.process_id || 0);

    return normalizeFocusedInfo({
      appInfo: {
        app_name: processName,
        app_identifier: processName ? `${processName}.exe` : '',
        window_title: windowTitle,
        app_type: 'native_app',
        app_metadata: { hwnd, process_id: processId },
        browser_context: null,
      },
      elementInfo: {
        role: '',
        focused: Boolean(hwnd),
        editable: true,
        selected: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      },
    });
  } catch {
    return createEmptyFocusedInfo();
  }
}

async function readVisibleWindows({
  readWindows = powershellJsonCommand(VISIBLE_WINDOWS_SCRIPT),
} = {}) {
  try {
    const result = await readWindows();
    return Array.isArray(result) ? result : (result ? [result] : []);
  } catch {
    return [];
  }
}

async function readSelectedTextByUia({
  readUiaSelection = powershellJsonCommand(UIA_SELECTION_SCRIPT),
} = {}) {
  try {
    // UIA 是首选来源，优先走可信选区而不是依赖剪贴板副作用。
    return normalizeUiaSelectionResult(await readUiaSelection());
  } catch (error) {
    // UIA 失败不能抛给上层，必须给出可解释的失败结果，方便降级到其他路径。
    return {
      success: false,
      text: '',
      source: 'none',
      confidence: 'none',
      reason: 'uia_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readFocusedTextTarget({
  readTextTarget = powershellJsonCommand(FOCUSED_TEXT_TARGET_SCRIPT),
  readCaretTarget = powershellJsonCommand(WIN32_CARET_TARGET_SCRIPT),
  readWindowTree = powershellJsonCommand(FOCUSED_WINDOW_TREE_SCRIPT),
  startFocusInfo = null,
} = {}) {
  try {
    // 这个结果只描述当前焦点控件是否适合输入，不直接承诺一定能粘贴。
    const uiaTarget = normalizeFocusedTextTargetResult(await readTextTarget());
    if (uiaTarget.success) return uiaTarget;

    const caretTarget = normalizeFocusedTextTargetResult(await readCaretTarget());
    if (caretTarget.success) return caretTarget;

    if (typeof readWindowTree === 'function') {
      const windowTree = await readWindowTree();
      const startForegroundHwnd = String(startFocusInfo?.appInfo?.app_metadata?.hwnd || '');
      const compatTarget = normalizeFocusedTextTargetResult(detectAppCompatTextTarget({
        ...windowTree,
        start_foreground_hwnd: startForegroundHwnd,
      }));
      if (compatTarget.success) return compatTarget;

      const currentForegroundHwnd = String(windowTree?.foreground_hwnd || '');
      const startEditable = startFocusInfo?.elementInfo?.editable !== false;
      const sameForegroundWindow = Boolean(startForegroundHwnd)
        && Boolean(currentForegroundHwnd)
        && startForegroundHwnd === currentForegroundHwnd;

      if (sameForegroundWindow && startEditable) {
        return normalizeFocusedTextTargetResult({
          success: true,
          source: 'foreground_window',
          confidence: 'weak',
          reason: 'same_foreground_window',
          foreground_hwnd: currentForegroundHwnd,
          matched_signals: ['same_foreground_hwnd'],
        });
      }

      return {
        ...compatTarget,
        reason: compatTarget.reason || caretTarget.reason || uiaTarget.reason || 'text_target_unavailable',
      };
    }

    return {
      ...caretTarget,
      reason: caretTarget.reason || uiaTarget.reason || 'text_target_unavailable',
    };
  } catch (error) {
    // 这里也要返回结构化失败，避免调用方把异常当成“可以输入”。
    return {
      success: false,
      source: 'none',
      confidence: 'none',
      reason: 'text_target_failed',
      valuePattern: false,
      textPattern: false,
      isReadOnly: false,
      controlType: '',
      appFamily: '',
      foregroundHwnd: '',
      focusHwnd: '',
      caretHwnd: '',
      matchedSignals: [],
      detail: error instanceof Error ? error.message : String(error),
      startFocusInfo,
      readWindowTree: typeof readWindowTree === 'function',
    };
  }
}

async function readSelectionSnapshot({
  clipboard,
  readFocusedInfo: readFocus = readFocusedInfo,
  readUiaSelection,
  sendCopyShortcut,
  wait,
  marker,
  copyWaitMs,
  copyPollIntervalMs,
  readClipboardSelection = readSelectedTextByClipboard,
  logger = console,
} = {}) {
  const logSelection = createSelectionLogger(logger);
  // 快照要同时保留当前焦点和选区信息，供快捷键和语音任务解析使用。
  const focusInfo = normalizeFocusedInfo(await readFocus());
  logSelection('开始读取选区快照', {
    appIdentifier: focusInfo.appInfo.app_identifier,
    windowTitle: focusInfo.appInfo.window_title,
    hwnd: focusInfo.appInfo.app_metadata?.hwnd || '',
  });

  const selection = await readSelectedTextByUia({ readUiaSelection });
  logSelection('UIA 选区读取结果', summarizeSelectionResult(selection));

  if (selection.success) {
    logSelection('选区快照返回 UIA confirmed', summarizeSelectionResult(selection));
    return {
      ...selection,
      focusInfo,
    };
  }

  if (clipboard) {
    // UIA 无 confirmed 选区时才走剪贴板 fallback，避免低可信来源覆盖 UIA 结果。
    const clipboardSelection = await readClipboardSelection({
      clipboard,
      sendCopyShortcut,
      wait,
      marker,
      copyWaitMs,
      copyPollIntervalMs,
    });

    if (clipboardSelection.success) {
      logSelection('剪贴板 fallback 读取成功', summarizeSelectionResult(clipboardSelection));
      return {
        ...clipboardSelection,
        confidence: 'fallback',
        focusInfo,
      };
    }

    logSelection('剪贴板 fallback 读取失败', summarizeSelectionResult(clipboardSelection));
  }

  logSelection('选区快照返回空选区', summarizeSelectionResult(selection));
  return {
    ...selection,
    // 焦点信息和选区分开保存，避免上层把“当前焦点”误解成“当前有选区”。
    focusInfo,
  };
}

module.exports = {
  readFocusedInfo,
  readVisibleWindows,
  readFocusedTextTarget,
  readSelectedTextByUia,
  readSelectionSnapshot,
  summarizeSelectionResult,
};
