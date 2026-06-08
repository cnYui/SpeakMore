import path from 'node:path';

export const SERVER_REQUIRED_MODULES = [
  { module: 'fastapi', package: 'fastapi' },
  { module: 'uvicorn', package: 'uvicorn' },
  { module: 'funasr', package: 'funasr' },
  { module: 'torch', package: 'torch' },
  { module: 'torchaudio', package: 'torchaudio' },
  { module: 'transformers', package: 'transformers' },
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

export const getLlamaServerExecutableName = ({ platform = process.platform }) => (
  platform === 'win32' ? 'llama-server.exe' : 'llama-server'
);

export const getBundledLlamaServerPath = ({ rootDir, platform = process.platform }) => (
  path.join(rootDir, 'release-artifacts', 'llama', getLlamaServerExecutableName({ platform }))
);

export const getBundledHyMtLlamaServerPath = ({ rootDir, platform = process.platform }) => (
  path.join(rootDir, 'release-artifacts', 'llama-stq', getLlamaServerExecutableName({ platform }))
);

export const resolveDevLlamaServerPath = ({
  env = process.env,
  existsSync,
  platform = process.platform,
  rootDir,
}) => {
  const existingEnvPath = String(
    env.SPEAKMORE_LLAMA_SERVER_PATH
    || env.LLAMA_SERVER_PATH
    || env.SPEAKMORE_BUNDLED_LLAMA_SERVER_PATH
    || '',
  ).trim();
  if (existingEnvPath) return existingEnvPath;
  const bundledPath = getBundledLlamaServerPath({ rootDir, platform });
  return existsSync(bundledPath) ? bundledPath : '';
};

export const resolveDevHyMtLlamaServerPath = ({
  env = process.env,
  existsSync,
  platform = process.platform,
  rootDir,
}) => {
  const existingEnvPath = String(
    env.SPEAKMORE_HYMT_LLAMA_SERVER_PATH
    || env.SPEAKMORE_BUNDLED_HYMT_LLAMA_SERVER_PATH
    || '',
  ).trim();
  if (existingEnvPath) return existingEnvPath;
  const bundledPath = getBundledHyMtLlamaServerPath({ rootDir, platform });
  return existsSync(bundledPath) ? bundledPath : '';
};

const normalizeComparablePath = (value) => String(value || '')
  .trim()
  .replace(/^"|"$/g, '')
  .replace(/\\/g, '/')
  .toLowerCase();

const parseJsonObject = (value) => {
  try {
    const parsed = JSON.parse(String(value || '').trim() || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const getListeningProcessOnWindows = ({ port, spawnSync }) => {
  const command = [
    `$connection = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    'if ($connection) {',
    '  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"',
    '  if ($process) {',
    '    [PSCustomObject]@{ ProcessId = $process.ProcessId; ExecutablePath = $process.ExecutablePath; CommandLine = $process.CommandLine } | ConvertTo-Json -Compress',
    '  }',
    '}',
  ].join('; ');
  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return parseJsonObject(result.stdout);
};

const getListeningProcessOnUnix = ({ port, spawnSync }) => {
  const result = spawnSync('sh', ['-lc', `lsof -nP -iTCP:${Number(port)} -sTCP:LISTEN -Fpca 2>/dev/null | head -n 3`], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0 || !String(result.stdout || '').trim()) return null;
  const lines = String(result.stdout).split(/\r?\n/);
  const processId = lines.find((line) => line.startsWith('p'))?.slice(1) || '';
  const command = lines.find((line) => line.startsWith('c'))?.slice(1) || '';
  const commandLine = lines.find((line) => line.startsWith('a'))?.slice(1) || command;
  return { ProcessId: processId, ExecutablePath: command, CommandLine: commandLine };
};

export const checkDevServerPortOwnership = ({
  port = 8000,
  pythonBin,
  spawnSync,
  platform = process.platform,
}) => {
  const processInfo = platform === 'win32'
    ? getListeningProcessOnWindows({ port, spawnSync })
    : getListeningProcessOnUnix({ port, spawnSync });
  if (!processInfo) return { ok: true };

  const expectedPython = normalizeComparablePath(pythonBin);
  const executablePath = normalizeComparablePath(processInfo.ExecutablePath);
  const commandLine = normalizeComparablePath(processInfo.CommandLine);
  const isExpectedBackend = Boolean(
    expectedPython
    && (
      executablePath === expectedPython
      || commandLine.includes(expectedPython)
    )
    && commandLine.includes('main.py')
  );

  if (isExpectedBackend) {
    return {
      ok: false,
      reason: 'server_port_already_running',
      message: [
        `后端端口 ${port} 已经被当前项目 server/.venv 后端占用。`,
        '请先关闭已运行的开发后端，或直接复用当前后端后单独启动 Electron。',
        `进程：${processInfo.ProcessId || 'unknown'}`,
      ].join('\n'),
    };
  }

  return {
    ok: false,
    reason: 'server_port_owned_by_unexpected_process',
    message: [
      `后端端口 ${port} 已被非当前项目 server/.venv 的进程占用，开发后端未启动。`,
      '这会让客户端连到旧后端，出现“代码改了但行为没变”的问题。',
      '',
      `占用进程：${processInfo.ProcessId || 'unknown'}`,
      `可执行文件：${processInfo.ExecutablePath || '(unknown)'}`,
      `命令行：${processInfo.CommandLine || '(unknown)'}`,
      '',
      '请结束该进程后重新运行 npm run server。',
    ].join('\n'),
  };
};

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
