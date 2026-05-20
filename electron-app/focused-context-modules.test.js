const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFocusedInfo,
  normalizeFocusedTextTargetResult,
  normalizeUiaSelectionResult,
  isSameFocusedContext,
} = require('./focused-context/normalizers');
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
  FOCUSED_WINDOW_SCRIPT,
  UIA_SELECTION_SCRIPT,
  FOCUSED_TEXT_TARGET_SCRIPT,
} = require('./focused-context/scripts');

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
  }), {
    success: true,
    text: 'selected',
    source: 'uia',
    confidence: 'confirmed',
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
});

test('scripts 模块导出三段 PowerShell 脚本', () => {
  assert.match(FOCUSED_WINDOW_SCRIPT, /GetForegroundWindow/);
  assert.match(UIA_SELECTION_SCRIPT, /TextPattern/);
  assert.match(FOCUSED_TEXT_TARGET_SCRIPT, /ValuePattern/);
});
