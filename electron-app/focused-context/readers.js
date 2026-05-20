const {
  createEmptyFocusedInfo,
  normalizeFocusedInfo,
  normalizeFocusedTextTargetResult,
  normalizeUiaSelectionResult,
} = require('./normalizers');
const { readSelectedTextByClipboard } = require('./clipboard');
const {
  FOCUSED_TEXT_TARGET_SCRIPT,
  FOCUSED_WINDOW_SCRIPT,
  UIA_SELECTION_SCRIPT,
} = require('./scripts');
const { powershellJsonCommand } = require('./powershell');

async function readFocusedInfo({
  readWindowInfo = powershellJsonCommand(FOCUSED_WINDOW_SCRIPT),
} = {}) {
  try {
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

async function readSelectedTextByUia({
  readUiaSelection = powershellJsonCommand(UIA_SELECTION_SCRIPT),
} = {}) {
  try {
    return normalizeUiaSelectionResult(await readUiaSelection());
  } catch (error) {
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
} = {}) {
  try {
    return normalizeFocusedTextTargetResult(await readTextTarget());
  } catch (error) {
    return {
      success: false,
      source: 'none',
      confidence: 'none',
      reason: 'text_target_failed',
      valuePattern: false,
      textPattern: false,
      isReadOnly: false,
      controlType: '',
      detail: error instanceof Error ? error.message : String(error),
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
} = {}) {
  const focusInfo = normalizeFocusedInfo(await readFocus());
  const selection = await readSelectedTextByUia({ readUiaSelection });

  if (clipboard && sendCopyShortcut) {
    await readSelectedTextByClipboard({
      clipboard,
      sendCopyShortcut,
      wait,
      marker,
      copyWaitMs,
    });
  }

  return {
    ...selection,
    focusInfo,
  };
}

module.exports = {
  readFocusedInfo,
  readFocusedTextTarget,
  readSelectedTextByUia,
  readSelectionSnapshot,
};
