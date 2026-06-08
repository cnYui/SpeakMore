import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  checkElectronDevPrereqs,
  checkDevServerPortOwnership,
  checkServerPythonPackages,
  getBundledHyMtLlamaServerPath,
  getBundledLlamaServerPath,
  resolveDevHyMtLlamaServerPath,
  resolveDevLlamaServerPath,
  resolveServerPython,
} from './dev-prereqs.mjs';

const existsFor = (...paths) => {
  const existing = new Set(paths.map((item) => path.normalize(item)));
  return (candidate) => existing.has(path.normalize(candidate));
};

test('开发后端缺少 server/.venv 时直接失败并提示准备命令', () => {
  const result = resolveServerPython({
    env: {},
    existsSync: () => false,
    platform: 'win32',
    rootDir: 'D:\\CodeWorkSpace\\SpeakMore',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'server_venv_missing');
  assert.match(result.message, /server[\\/]\.venv/);
  assert.match(result.message, /python -m venv \.venv/);
  assert.match(result.message, /SPEAKMORE_SERVER_PYTHON/);
});

test('开发后端允许显式指定 Python，避免误用系统默认解释器', () => {
  const result = resolveServerPython({
    env: { SPEAKMORE_SERVER_PYTHON: 'C:\\Python312\\python.exe' },
    existsSync: () => false,
    platform: 'win32',
    rootDir: 'D:\\CodeWorkSpace\\SpeakMore',
  });

  assert.equal(result.ok, true);
  assert.equal(result.pythonBin, 'C:\\Python312\\python.exe');
});

test('开发后端 venv 缺核心包时提示重新安装 requirements', () => {
  const result = checkServerPythonPackages({
    platform: 'win32',
    pythonBin: 'D:\\CodeWorkSpace\\SpeakMore\\server\\.venv\\Scripts\\python.exe',
    spawnSync: () => ({
      status: 1,
      stdout: JSON.stringify({
        missing: [
          { module: 'funasr', package: 'funasr' },
          { module: 'torch', package: 'torch' },
        ],
      }),
      stderr: '',
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'server_dependencies_missing');
  assert.match(result.message, /funasr/);
  assert.match(result.message, /torch/);
  assert.match(result.message, /pip install -r requirements\.txt/);
});

test('Electron 启动前检查根依赖和 renderer 构建产物', () => {
  const result = checkElectronDevPrereqs({
    existsSync: () => false,
    platform: 'win32',
    rootDir: 'D:\\CodeWorkSpace\\SpeakMore',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['root_electron', 'renderer_dist']);
  assert.match(result.message, /npm install/);
  assert.match(result.message, /npm run renderer:build/);
});

test('Electron 依赖已安装但缺 renderer dist 时只提示构建前端', () => {
  const rootDir = 'D:\\CodeWorkSpace\\SpeakMore';
  const electronBin = path.join(rootDir, 'node_modules', '.bin', 'electron.cmd');
  const result = checkElectronDevPrereqs({
    existsSync: existsFor(electronBin),
    platform: 'win32',
    rootDir,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['renderer_dist']);
  assert.doesNotMatch(result.message, /npm install/);
  assert.match(result.message, /npm run renderer:build/);
});

test('开发态后端优先使用 release-artifacts 中的 llama-server', () => {
  const rootDir = 'D:\\CodeWorkSpace\\SpeakMore';
  const llamaServer = getBundledLlamaServerPath({ rootDir, platform: 'win32' });

  const result = resolveDevLlamaServerPath({
    env: {},
    existsSync: existsFor(llamaServer),
    platform: 'win32',
    rootDir,
  });

  assert.equal(result, llamaServer);
});

test('开发态后端不覆盖用户显式指定的 llama-server', () => {
  const result = resolveDevLlamaServerPath({
    env: { SPEAKMORE_LLAMA_SERVER_PATH: 'E:\\llama\\llama-server.exe' },
    existsSync: () => true,
    platform: 'win32',
    rootDir: 'D:\\CodeWorkSpace\\SpeakMore',
  });

  assert.equal(result, 'E:\\llama\\llama-server.exe');
});

test('development backend can use prepared Hy-MT STQ runtime from release-artifacts', () => {
  const rootDir = 'D:\\CodeWorkSpace\\SpeakMore';
  const hyMtRuntime = getBundledHyMtLlamaServerPath({ rootDir, platform: 'win32' });

  const result = resolveDevHyMtLlamaServerPath({
    env: {},
    existsSync: existsFor(hyMtRuntime),
    platform: 'win32',
    rootDir,
  });

  assert.equal(result, hyMtRuntime);
});

test('development backend keeps explicit Hy-MT STQ runtime override', () => {
  const result = resolveDevHyMtLlamaServerPath({
    env: { SPEAKMORE_HYMT_LLAMA_SERVER_PATH: 'E:\\hymt\\llama-server.exe' },
    existsSync: () => true,
    platform: 'win32',
    rootDir: 'D:\\CodeWorkSpace\\SpeakMore',
  });

  assert.equal(result, 'E:\\hymt\\llama-server.exe');
});

test('development backend fails when port is owned by non-venv Python', () => {
  const result = checkDevServerPortOwnership({
    port: 8000,
    pythonBin: 'D:\\CodeWorkSpace\\SpeakMore\\server\\.venv\\Scripts\\python.exe',
    platform: 'win32',
    spawnSync: () => ({
      status: 0,
      stdout: JSON.stringify({
        ProcessId: 1234,
        ExecutablePath: 'C:\\Python312\\python.exe',
        CommandLine: '"C:\\Python312\\python.exe" main.py',
      }),
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'server_port_owned_by_unexpected_process');
  assert.match(result.message, /非当前项目 server\/.venv/);
  assert.match(result.message, /C:\\Python312\\python.exe/);
});

test('development backend refuses to spawn a duplicate venv backend on the same port', () => {
  const result = checkDevServerPortOwnership({
    port: 8000,
    pythonBin: 'D:\\CodeWorkSpace\\SpeakMore\\server\\.venv\\Scripts\\python.exe',
    platform: 'win32',
    spawnSync: () => ({
      status: 0,
      stdout: JSON.stringify({
        ProcessId: 5678,
        ExecutablePath: 'D:\\CodeWorkSpace\\SpeakMore\\server\\.venv\\Scripts\\python.exe',
        CommandLine: '"D:\\CodeWorkSpace\\SpeakMore\\server\\.venv\\Scripts\\python.exe" main.py',
      }),
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'server_port_already_running');
  assert.match(result.message, /已经被当前项目 server\/.venv 后端占用/);
});
