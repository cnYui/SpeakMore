import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executableName,
  prepareHyMtRuntime,
  resolveSource,
} from './prepare-hy-mt-runtime.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'speakmore-hymt-runtime-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('resolveSource prefers explicit Hy-MT STQ runtime path', () => withTempDir((dir) => {
  const explicit = path.join(dir, 'custom-llama-server.exe');
  const envPath = path.join(dir, 'env-llama-server.exe');
  writeFileSync(explicit, 'runtime');
  writeFileSync(envPath, 'runtime');

  const result = resolveSource({
    source: explicit,
    platform: 'win32',
    env: { SPEAKMORE_HYMT_LLAMA_SERVER_PATH: envPath },
  });

  assert.equal(result, explicit);
}));

test('resolveSource can reuse prepared Hy-MT STQ runtime in destDir', () => withTempDir((dir) => {
  const destDir = path.join(dir, 'release-artifacts', 'llama-stq');
  mkdirSync(destDir, { recursive: true });
  writeFileSync(path.join(destDir, 'llama-server.exe'), 'runtime');

  const result = resolveSource({
    destDir,
    platform: 'win32',
    env: { PATH: '' },
  });

  assert.equal(result, path.join(destDir, 'llama-server.exe'));
}));

test('resolveSource does not treat PATH llama-server as Hy-MT STQ runtime', () => withTempDir((dir) => {
  const pathDir = path.join(dir, 'path-runtime');
  mkdirSync(pathDir);
  writeFileSync(path.join(pathDir, 'llama-server.exe'), 'standard runtime');

  const result = resolveSource({
    platform: 'win32',
    env: { PATH: pathDir },
    pathDelimiter: ';',
  });

  assert.equal(result, '');
}));

test('prepareHyMtRuntime copies STQ runtime and native dependencies', () => withTempDir((dir) => {
  const source = path.join(dir, 'llama-server.exe');
  const dll = path.join(dir, 'ggml-stq.dll');
  const destDir = path.join(dir, 'release-artifacts', 'llama-stq');
  writeFileSync(source, 'runtime');
  writeFileSync(dll, 'dll');

  const result = prepareHyMtRuntime({
    source,
    destDir,
    platform: 'win32',
    optional: false,
    checkOnly: false,
    allowBuild: false,
  });

  assert.equal(result.copied, true);
  assert.equal(result.destination, path.join(destDir, executableName('win32')));
  assert.equal(existsSync(path.join(destDir, 'ggml-stq.dll')), true);
}));

