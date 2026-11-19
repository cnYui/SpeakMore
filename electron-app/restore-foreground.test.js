const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreForegroundWindow } = require('./focused-context/readers');
const { createRestoreForegroundWindowScript } = require('./focused-context/scripts');

test('切回前台脚本只接受纯数字窗口句柄，防止把任意文本拼进 PowerShell', () => {
  assert.ok(createRestoreForegroundWindowScript('3802206').includes('[long]3802206'));
  for (const bad of ['', 'abc', '12; calc', '1 2', '-5', '9'.repeat(25), null, undefined]) {
    assert.equal(createRestoreForegroundWindowScript(bad), null, String(bad));
  }
});

test('restoreForegroundWindow 把脚本结果整理成 { success, reason }，句柄不合法或脚本报错时不抛出', async () => {
  const ok = await restoreForegroundWindow('42', { runScript: async () => ({ success: true, reason: 'restored' }) });
  assert.deepEqual(ok, { success: true, reason: 'restored' });

  const denied = await restoreForegroundWindow('42', { runScript: async () => ({ success: false, reason: 'foreground_denied' }) });
  assert.deepEqual(denied, { success: false, reason: 'foreground_denied' });

  const invalid = await restoreForegroundWindow('x; y', { runScript: async () => { throw new Error('不该被调用'); } });
  assert.deepEqual(invalid, { success: false, reason: 'invalid_hwnd' });

  const broken = await restoreForegroundWindow('42', { runScript: async () => { throw new Error('boom'); } });
  assert.equal(broken.success, false);
  assert.equal(broken.reason, 'restore_failed');
});
