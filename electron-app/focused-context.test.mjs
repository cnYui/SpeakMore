import test from 'node:test';
import assert from 'node:assert/strict';
import { readSelectedTextByClipboard, normalizeSelectedTextResult } from './focused-context.js';

function createFakeClipboard(initialText = 'old clipboard') {
  let text = initialText;
  return {
    readText: () => text,
    writeText: (nextText) => {
      text = String(nextText || '');
    },
    current: () => text,
  };
}

test('readSelectedTextByClipboard 读取选区后恢复原剪贴板文本', async () => {
  const clipboard = createFakeClipboard('old clipboard');
  const result = await readSelectedTextByClipboard({
    clipboard,
    sendCopyShortcut: async () => clipboard.writeText('selected text'),
    wait: async () => undefined,
    marker: 'TYPELESS_SELECTION_MARKER',
  });

  assert.deepEqual(result, {
    success: true,
    text: 'selected text',
    source: 'clipboard',
  });
  assert.equal(clipboard.current(), 'old clipboard');
});

test('readSelectedTextByClipboard 在复制后仍是 marker 时返回 empty', async () => {
  const clipboard = createFakeClipboard('old clipboard');
  const result = await readSelectedTextByClipboard({
    clipboard,
    sendCopyShortcut: async () => undefined,
    wait: async () => undefined,
    marker: 'TYPELESS_SELECTION_MARKER',
  });

  assert.deepEqual(result, {
    success: false,
    text: '',
    source: 'clipboard',
    reason: 'empty',
  });
  assert.equal(clipboard.current(), 'old clipboard');
});

test('readSelectedTextByClipboard 在复制异常时恢复剪贴板并返回 copy_failed', async () => {
  const clipboard = createFakeClipboard('old clipboard');
  const result = await readSelectedTextByClipboard({
    clipboard,
    sendCopyShortcut: async () => {
      throw new Error('copy boom');
    },
    wait: async () => undefined,
    marker: 'TYPELESS_SELECTION_MARKER',
  });

  assert.equal(result.success, false);
  assert.equal(result.text, '');
  assert.equal(result.reason, 'copy_failed');
  assert.equal(clipboard.current(), 'old clipboard');
});

test('normalizeSelectedTextResult 同时兼容字符串和对象返回值', () => {
  assert.equal(normalizeSelectedTextResult(' abc ').text, 'abc');
  assert.equal(normalizeSelectedTextResult({ success: true, text: ' def ' }).text, 'def');
  assert.equal(normalizeSelectedTextResult({ success: false, text: 'ignored' }).text, '');
});
