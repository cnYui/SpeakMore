import path from 'node:path';

export const SERVER_REQUIRED_MODULES = [
  { module: 'fastapi', package: 'fastapi' },
  { module: 'uvicorn', package: 'uvicorn' },
  { module: 'funasr', package: 'funasr' },
  { module: 'torch', package: 'torch' },
  { module: 'torchaudio', package: 'torchaudio' },
  { module: 'transformers', package: 'transformers' },
  { module: 'sherpa_onnx', package: 'sherpa-onnx' },
];

export const getServerVenvPythonPath = ({ rootDir, platform = process.platform }) => (
  platform === 'win32'
    ? path.join(rootDir, 'server', '.venv', 'Scripts', 'python.exe')
    : path.join(rootDir, 'server', '.venv', 'bin', 'python')
);

export const getElectronBinPath = ({ rootDir, platform = process.platform }) => (
  path.join(rootDir, 'node_modules', '.bin', platform === 'win32' ? 'electron.cmd' : 'electron')
);

export const getRendererIndexPath = ({ rootDir }) => (
  path.join(rootDir, 'electron-app', 'renderer', 'dist', 'index.html')
);

const serverInstallCommand = ({ platform = process.platform }) => (
  platform === 'win32'
    ? '.\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt'
    : './.venv/bin/python -m pip install -r requirements.txt'
);

const formatServerDependencyInstallHelp = ({ platform = process.platform }) => [
  '处理命令：',
  '  cd server',
  `  ${serverInstallCommand({ platform })}`,
].join('\n');

const formatServerVenvMissingMessage = ({ rootDir, platform = process.platform }) => [
  '开发后端未启动：缺少 server/.venv。',
  '',
  '原因：直接回退系统 Python 容易误用 Conda 或系统环境，导致 FunASR、Torch 等 ASR 依赖不一致。',
  '',
  '准备命令：',
  '  cd server',
  '  python -m venv .venv',
  `  ${serverInstallCommand({ platform })}`,
  '',
  `检查路径：${getServerVenvPythonPath({ rootDir, platform })}`,
  '如需临时使用其它 Python，请显式设置 SPEAKMORE_SERVER_PYTHON。',
].join('\n');

export const resolveServerPython = ({
  env = process.env,
  existsSync,
  platform = process.platform,
  rootDir,
}) => {
  const explicitPython = String(env.SPEAKMORE_SERVER_PYTHON || '').trim();
  if (explicitPython) {
    return {
      ok: true,
      pythonBin: explicitPython,
      source: 'explicit',
    };
  }

  const venvPython = getServerVenvPythonPath({ rootDir, platform });
  if (existsSync(venvPython)) {
    return {
      ok: true,
      pythonBin: venvPython,
      source: 'server_venv',
    };
  }

  return {
    ok: false,
    reason: 'server_venv_missing',
    message: formatServerVenvMissingMessage({ rootDir, platform }),
  };
};

const parseDependencyProbeOutput = (stdout) => {
  try {
    const parsed = JSON.parse(String(stdout || '').trim() || '{}');
    return Array.isArray(parsed.missing) ? parsed.missing : [];
  } catch {
    return [];
  }
};

const dependencyProbeCode = () => [
  'import importlib.util, json, sys',
  `required = ${JSON.stringify(SERVER_REQUIRED_MODULES)}`,
  'missing = [item for item in required if importlib.util.find_spec(item["module"]) is None]',
  'print(json.dumps({"missing": missing}, ensure_ascii=False))',
  'sys.exit(1 if missing else 0)',
].join('\n');

export const checkServerPythonPackages = ({
  platform = process.platform,
  pythonBin,
  spawnSync,
}) => {
  const probe = spawnSync(pythonBin, ['-c', dependencyProbeCode()], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (probe.error) {
    return {
      ok: false,
      reason: 'server_dependency_probe_failed',
      message: [
        `后端依赖检查失败：${probe.error.message}`,
        formatServerDependencyInstallHelp({ platform }),
      ].join('\n\n'),
    };
  }

  if (probe.status === 0) {
    return { ok: true };
  }

  const missing = parseDependencyProbeOutput(probe.stdout);
  const missingNames = missing
    .map((item) => item.package || item.module)
    .filter(Boolean);
  const details = missingNames.length > 0
    ? `缺少核心包：${missingNames.join(', ')}`
    : '依赖探针返回失败，可能是 venv 半安装或 Python 环境损坏。';

  return {
    ok: false,
    reason: 'server_dependencies_missing',
    message: [
      `开发后端未启动：${details}`,
      '',
      formatServerDependencyInstallHelp({ platform }),
    ].join('\n'),
  };
};

const formatElectronMissingMessage = ({ missing, rootDir, platform = process.platform }) => {
  const missingLines = [];
  const commandLines = [];

  if (missing.includes('root_electron')) {
    missingLines.push(`- 根目录 Electron 依赖：${getElectronBinPath({ rootDir, platform })}`);
    commandLines.push('  npm install');
  }

  if (missing.includes('renderer_dist')) {
    missingLines.push(`- renderer 构建产物：${getRendererIndexPath({ rootDir })}`);
    commandLines.push('  npm run renderer:build');
  }

  return [
    'Electron 未启动：本地开发前置条件不完整。',
    '',
    '缺少：',
    ...missingLines,
    '',
    '处理命令：',
    ...commandLines,
  ].join('\n');
};

export const checkElectronDevPrereqs = ({
  existsSync,
  platform = process.platform,
  rootDir,
}) => {
  const missing = [];

  if (!existsSync(getElectronBinPath({ rootDir, platform }))) {
    missing.push('root_electron');
  }

  if (!existsSync(getRendererIndexPath({ rootDir }))) {
    missing.push('renderer_dist');
  }

  if (missing.length === 0) {
    return { ok: true, missing };
  }

  return {
    ok: false,
    missing,
    message: formatElectronMissingMessage({ missing, rootDir, platform }),
  };
};
