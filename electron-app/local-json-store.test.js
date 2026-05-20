const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLocalJsonStore } = require('./local-json-store');

test('createLocalJsonStore 读取缺失文件时返回默认值', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typeless-local-json-'));
  const store = createLocalJsonStore({
    fs,
    localDataDir: () => root,
    localDataPath: (fileName) => path.join(root, fileName),
  });

  assert.deepEqual(store.readJsonFile('missing.json', { ok: true }), { ok: true });
});

test('createLocalJsonStore 写入并读取格式化 JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typeless-local-json-'));
  const store = createLocalJsonStore({
    fs,
    localDataDir: () => root,
    localDataPath: (fileName) => path.join(root, fileName),
  });

  const value = { name: 'SpeakMore', enabled: true };
  store.writeJsonFile('settings.json', value);

  assert.equal(
    fs.readFileSync(path.join(root, 'settings.json'), 'utf8'),
    JSON.stringify(value, null, 2),
  );
  assert.deepEqual(store.readJsonFile('settings.json', {}), value);
});

test('createLocalJsonStore 递归计算目录大小', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typeless-local-json-'));
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, 'a.txt'), '1234', 'utf8');
  fs.writeFileSync(path.join(nested, 'b.txt'), '12', 'utf8');

  const store = createLocalJsonStore({
    fs,
    localDataDir: () => root,
    localDataPath: (fileName) => path.join(root, fileName),
  });

  assert.equal(store.calculateDirectorySize(root), 6);
});
