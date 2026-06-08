import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executableName,
  prepareRuntime,
  resolveSource,
  selectReleaseAsset,
} from './prepare-llama-runtime.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'speakmore-llama-runtime-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('resolveSource prefers explicit source path', () => withTempDir((dir) => {
  const explicit = path.join(dir, 'custom-llama-server.exe');
  const envPath = path.join(dir, 'env-llama-server.exe');
  writeFileSync(explicit, 'runtime');
  writeFileSync(envPath, 'runtime');

  const result = resolveSource({
    source: explicit,
    platform: 'win32',
    env: { SPEAKMORE_LLAMA_SERVER_PATH: envPath },
  });

  assert.equal(result, explicit);
}));

test('resolveSource can use LLAMA_SERVER_DIR and platform executable name', () => withTempDir((dir) => {
  const runtime = path.join(dir, executableName('darwin'));
  writeFileSync(runtime, 'runtime');

  const result = resolveSource({
    platform: 'darwin',
    env: { LLAMA_SERVER_DIR: dir },
  });

  assert.equal(result, runtime);
}));

test('resolveSource can reuse an already prepared runtime in destDir', () => withTempDir((dir) => {
  const destDir = path.join(dir, 'release-artifacts', 'llama');
  mkdirSync(destDir, { recursive: true });
  writeFileSync(path.join(destDir, 'llama-server.exe'), 'runtime');

  const result = resolveSource({
    destDir,
    platform: 'win32',
    env: { PATH: '' },
    pathDelimiter: ';',
  });

  assert.equal(result, path.join(destDir, 'llama-server.exe'));
}));

test('prepareRuntime copies runtime into release artifact directory', () => withTempDir((dir) => {
  const source = path.join(dir, 'llama-server.exe');
  const destDir = path.join(dir, 'release-artifacts', 'llama');
  writeFileSync(source, 'runtime');

  const result = prepareRuntime({
    source,
    destDir,
    platform: 'win32',
    optional: false,
    checkOnly: false,
  });

  assert.equal(result.copied, true);
  assert.equal(result.destination, path.join(destDir, 'llama-server.exe'));
}));

test('prepareRuntime copies Windows runtime DLL dependencies with llama-server', () => withTempDir((dir) => {
  const source = path.join(dir, 'llama-server.exe');
  const dll = path.join(dir, 'ggml.dll');
  const destDir = path.join(dir, 'release-artifacts', 'llama');
  writeFileSync(source, 'runtime');
  writeFileSync(dll, 'dll');

  prepareRuntime({
    source,
    destDir,
    platform: 'win32',
    optional: false,
    checkOnly: false,
  });

  assert.equal(existsSync(path.join(destDir, 'llama-server.exe')), true);
  assert.equal(existsSync(path.join(destDir, 'ggml.dll')), true);
}));

test('prepareRuntime check can use the prepared runtime in place', () => withTempDir((dir) => {
  const destDir = path.join(dir, 'release-artifacts', 'llama');
  mkdirSync(destDir, { recursive: true });
  writeFileSync(path.join(destDir, 'llama-server.exe'), 'runtime');

  const result = prepareRuntime({
    source: '',
    destDir,
    platform: 'win32',
    optional: false,
    checkOnly: true,
  });

  assert.equal(result.source, path.join(destDir, 'llama-server.exe'));
  assert.equal(result.copied, false);
}));

test('selectReleaseAsset chooses platform CPU runtime assets', () => {
  const assets = [
    { name: 'llama-b9553-bin-win-vulkan-x64.zip', browser_download_url: 'vulkan' },
    { name: 'llama-b9553-bin-win-cpu-x64.zip', browser_download_url: 'win-cpu' },
    { name: 'llama-b9553-bin-macos-arm64.tar.gz', browser_download_url: 'mac-arm' },
  ];

  assert.equal(selectReleaseAsset(assets, { platform: 'win32', arch: 'x64' })?.browser_download_url, 'win-cpu');
  assert.equal(selectReleaseAsset(assets, { platform: 'darwin', arch: 'arm64' })?.browser_download_url, 'mac-arm');
});
