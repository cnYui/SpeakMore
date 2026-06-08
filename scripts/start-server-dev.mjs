import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkServerPythonPackages,
  checkDevServerPortOwnership,
  resolveDevHyMtLlamaServerPath,
  resolveDevLlamaServerPath,
  resolveServerPython,
} from './dev-prereqs.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const serverDir = path.join(rootDir, 'server');

const pythonResult = resolveServerPython({
  env: process.env,
  existsSync,
  platform: process.platform,
  rootDir,
});

if (!pythonResult.ok) {
  console.error(pythonResult.message);
  process.exit(1);
}

console.log(`使用后端 Python: ${pythonResult.pythonBin}`);

const dependencyResult = checkServerPythonPackages({
  platform: process.platform,
  pythonBin: pythonResult.pythonBin,
  spawnSync,
});

if (!dependencyResult.ok) {
  console.error(dependencyResult.message);
  process.exit(1);
}

const portOwnership = checkDevServerPortOwnership({
  port: Number(process.env.PORT || process.env.VOICE_SERVER_PORT || 8000),
  pythonBin: pythonResult.pythonBin,
  spawnSync,
  platform: process.platform,
});

if (!portOwnership.ok) {
  console.error(portOwnership.message);
  process.exit(1);
}

const serverEnv = { ...process.env };
const llamaServerPath = resolveDevLlamaServerPath({
  env: serverEnv,
  existsSync,
  platform: process.platform,
  rootDir,
});
if (llamaServerPath && !serverEnv.SPEAKMORE_BUNDLED_LLAMA_SERVER_PATH) {
  serverEnv.SPEAKMORE_BUNDLED_LLAMA_SERVER_PATH = llamaServerPath;
  console.log(`使用本地翻译运行时: ${llamaServerPath}`);
}

const hyMtLlamaServerPath = resolveDevHyMtLlamaServerPath({
  env: serverEnv,
  existsSync,
  platform: process.platform,
  rootDir,
});
if (hyMtLlamaServerPath && !serverEnv.SPEAKMORE_BUNDLED_HYMT_LLAMA_SERVER_PATH) {
  serverEnv.SPEAKMORE_BUNDLED_HYMT_LLAMA_SERVER_PATH = hyMtLlamaServerPath;
  console.log(`Hy-MT STQ runtime: ${hyMtLlamaServerPath}`);
}

const child = spawn(pythonResult.pythonBin, ['main.py'], {
  cwd: serverDir,
  env: serverEnv,
  stdio: 'inherit',
});

let exiting = false;

const exitFromChild = (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
  }
  process.exit(signal ? 1 : 0);
};

child.on('error', (error) => {
  console.error(`后端启动失败: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (!exiting) {
    exitFromChild(code, signal);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (exiting) {
      return;
    }
    exiting = true;
    child.once('exit', exitFromChild);
    child.kill(signal);
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
