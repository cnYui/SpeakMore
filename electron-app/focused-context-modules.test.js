const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const {
  normalizeFocusedInfo,
  normalizeFocusedTextTargetResult,
  normalizeUiaSelectionResult,
  isSameFocusedContext,
} = require('./focused-context/normalizers');
const { detectAppCompatTextTarget } = require('./focused-context/app-compat');
const {
  createClipboardSnapshot,
  restoreClipboardSnapshot,
  readSelectedTextByClipboard,
} = require('./focused-context/clipboard');
const {
  readFocusedInfo,
  readSelectedTextByUia,
  readFocusedTextTarget,
  readSelectionSnapshot,
} = require('./focused-context/readers');
const {
  FOCUSED_WINDOW_TREE_SCRIPT,
  FOCUSED_WINDOW_SCRIPT,
  UIA_SELECTION_SCRIPT,
  FOCUSED_TEXT_TARGET_SCRIPT,
  WIN32_CARET_TARGET_SCRIPT,
  VISIBLE_WINDOWS_SCRIPT,
} = require('./focused-context/scripts');
const { powershellJsonCommand } = require('./focused-context/powershell');

function createRichClipboard() {
  let data = {
    text: '旧文本',
    html: '<b>旧文本</b>',
    rtf: '{\\rtf1 old}',
    image: { isEmpty: () => false, id: 'image-1' },
  };

  return {
    readText: () => data.text || '',
    readHTML: () => data.html || '',
    readRTF: () => data.rtf || '',
    readImage: () => data.image || { isEmpty: () => true },
    writeText: (text) => {
      data = { text: String(text || '') };
    },
    write: (nextData) => {
      data = { ...nextData };
    },
    current: () => data,
  };
}

test('normalizers 模块归一化 UIA 选区和焦点上下文', () => {
  assert.deepEqual(normalizeUiaSelectionResult({
    success: true,
    text: ' selected ',
    source: 'uia',
    confidence: 'confirmed',
    selection_scope: 'foreground_descendant',
    scanned: 8,
  }), {
    success: true,
    text: 'selected',
    source: 'uia',
    confidence: 'confirmed',
    selectionScope: 'foreground_descendant',
    foregroundScanned: 8,
  });

  assert.equal(normalizeFocusedTextTargetResult({
    success: true,
    source: 'uia',
    confidence: 'confirmed',
    value_pattern: true,
    is_read_only: false,
  }).success, true);

  const first = normalizeFocusedInfo({ appInfo: { app_identifier: 'A', app_metadata: { hwnd: '1' } } });
  const second = normalizeFocusedInfo({ appInfo: { app_identifier: 'B', app_metadata: { hwnd: '1' } } });
  assert.equal(isSameFocusedContext(first, second), true);
});

test('normalizers 模块归一化 Win32 caret 和 app_compat 输入目标', () => {
  assert.equal(normalizeFocusedTextTargetResult({
    success: true,
    source: 'win32_caret',
    confidence: 'confirmed',
    reason: 'caret',
    foreground_hwnd: '100',
    focus_hwnd: '200',
    caret_hwnd: '201',
  }).success, true);

  assert.equal(normalizeFocusedTextTargetResult({
    success: true,
    source: 'app_compat',
    confidence: 'weak',
    reason: 'app_compat_match',
    app_family: 'wechat',
    matched_signals: ['process:wechat'],
  }).success, true);

  assert.equal(normalizeFocusedTextTargetResult({
    success: true,
    source: 'foreground_window',
    confidence: 'weak',
    reason: 'same_foreground_window',
    foreground_hwnd: '300',
    matched_signals: ['same_foreground_hwnd'],
  }).success, true);

  assert.equal(normalizeFocusedTextTargetResult({
    success: true,
    source: 'macos_ax',
    confidence: 'confirmed',
    reason: 'macos_focused_target_confirmed',
    text_pattern: true,
    control_type: 'AXTextField',
    app_family: 'com.apple.TextEdit',
    matched_signals: ['frontmost_app', 'role:AXTextField'],
  }).success, true);
});

test('app_compat 模块允许常见桌面文本应用族', () => {
  const result = detectAppCompatTextTarget({
    success: true,
    process_name: 'Cursor',
    foreground_hwnd: '900',
    window_title: 'Cursor',
    class_names: ['Chrome_WidgetWin_1'],
    start_foreground_hwnd: '900',
  });

  assert.equal(result.success, true);
  assert.equal(result.source, 'app_compat');
  assert.equal(result.app_family, 'cursor');
});

test('clipboard 模块快照和恢复富剪贴板内容', async () => {
  const clipboard = createRichClipboard();
  const snapshot = createClipboardSnapshot(clipboard);

  clipboard.writeText('临时文本');
  restoreClipboardSnapshot(clipboard, snapshot);

  assert.equal(clipboard.current().text, '旧文本');
  assert.equal(clipboard.current().html, '<b>旧文本</b>');
  assert.equal(clipboard.current().rtf, '{\\rtf1 old}');
  assert.equal(clipboard.current().image.id, 'image-1');

  const result = await readSelectedTextByClipboard({
    clipboard,
    sendCopyShortcut: async () => clipboard.writeText(' 新选区 '),
    wait: async () => undefined,
    marker: 'MARKER',
  });
  assert.deepEqual(result, {
    success: true,
    text: '新选区',
    source: 'clipboard',
  });
  assert.equal(clipboard.current().text, '旧文本');
});

test('readers 模块组合 PowerShell reader 和归一化函数', async () => {
  const focusedInfo = await readFocusedInfo({
    readWindowInfo: async () => ({
      process_name: 'Notepad',
      process_id: 123,
      hwnd: '99',
      window_title: 'note.txt',
    }),
  });
  assert.equal(focusedInfo.appInfo.app_identifier, 'Notepad.exe');
  assert.equal(focusedInfo.appInfo.app_metadata.hwnd, '99');

  assert.deepEqual(await readSelectedTextByUia({
    readUiaSelection: async () => ({
      success: true,
      text: 'uia text',
      source: 'uia',
      confidence: 'confirmed',
    }),
  }), {
    success: true,
    text: 'uia text',
    source: 'uia',
    confidence: 'confirmed',
  });

  assert.equal((await readFocusedTextTarget({
    readTextTarget: async () => ({
      success: true,
      source: 'uia',
      confidence: 'confirmed',
      text_pattern: true,
      control_type: 'ControlType.Edit',
    }),
  })).success, true);

  const snapshot = await readSelectionSnapshot({
    readFocusedInfo: async () => focusedInfo,
    readUiaSelection: async () => ({
      success: true,
      text: 'snapshot text',
      source: 'uia',
      confidence: 'confirmed',
    }),
  });
  assert.equal(snapshot.text, 'snapshot text');
  assert.equal(snapshot.focusInfo.appInfo.app_identifier, 'Notepad.exe');

  const clipboard = createRichClipboard();
  const fallbackSnapshot = await readSelectionSnapshot({
    clipboard,
    readFocusedInfo: async () => focusedInfo,
    readUiaSelection: async () => ({
      success: false,
      text: '',
      source: 'none',
      confidence: 'none',
      reason: 'empty',
    }),
    sendCopyShortcut: async () => clipboard.writeText(' 剪贴板兜底文本 '),
    wait: async () => undefined,
    marker: 'MARKER',
  });

  assert.equal(fallbackSnapshot.success, true);
  assert.equal(fallbackSnapshot.text, '剪贴板兜底文本');
  assert.equal(fallbackSnapshot.source, 'clipboard');
  assert.equal(fallbackSnapshot.confidence, 'fallback');
  assert.equal(fallbackSnapshot.focusInfo.appInfo.app_identifier, 'Notepad.exe');
});

test('powershellJsonCommand 超时时会终止子进程并返回错误', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  let timeoutCallback = null;
  let timeoutDelay = 0;
  let clearedTimer = null;

  const command = powershellJsonCommand('Start-Sleep -Seconds 30', {
    spawnProcess: () => child,
    timeoutMs: 25,
    setTimer: (callback, delay) => {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return 'timer-1';
    },
    clearTimer: (timer) => {
      clearedTimer = timer;
    },
  });

  const promise = command();
  assert.equal(timeoutDelay, 25);
  timeoutCallback();

  await assert.rejects(promise, /PowerShell command timeout after 25ms/);
  assert.equal(child.killed, true);
  assert.equal(clearedTimer, 'timer-1');
});

test('scripts 模块导出三段 PowerShell 脚本', () => {
  assert.match(FOCUSED_WINDOW_TREE_SCRIPT, /EnumChildWindows/);
  assert.match(FOCUSED_WINDOW_SCRIPT, /GetForegroundWindow/);
  assert.match(UIA_SELECTION_SCRIPT, /TextPattern/);
  assert.match(UIA_SELECTION_SCRIPT, /Find-ForegroundSelection/);
  assert.match(UIA_SELECTION_SCRIPT, /IsTextPatternAvailableProperty/);
  assert.match(UIA_SELECTION_SCRIPT, /foreground_descendant/);
  assert.match(FOCUSED_TEXT_TARGET_SCRIPT, /ValuePattern/);
  assert.match(WIN32_CARET_TARGET_SCRIPT, /GetGUIThreadInfo/);
  assert.match(VISIBLE_WINDOWS_SCRIPT, /MainWindowTitle/);
  assert.doesNotMatch(VISIBLE_WINDOWS_SCRIPT, /EnumWindows/);
});
