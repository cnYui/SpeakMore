import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const LLAMA_CPP_LATEST_RELEASE_API = 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest';

function parseArgs(argv) {
  const options = {
    source: '',
    destDir: path.join(rootDir, 'release-artifacts', 'llama'),
    platform: process.platform,
    optional: false,
    checkOnly: false,
    allowDownload: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--source') options.source = String(argv[index += 1] || '').trim();
    if (item === '--dest-dir') options.destDir = path.resolve(String(argv[index += 1] || '').trim());
    if (item === '--platform') options.platform = String(argv[index += 1] || '').trim();
    if (item === '--optional') options.optional = true;
    if (item === '--check') options.checkOnly = true;
    if (item === '--no-download') options.allowDownload = false;
  }

  return options;
}

function executableName(platform = process.platform) {
  return platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

function isExecutableFile(candidate) {
  if (!candidate) return false;
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pathEntries(envPath = '', delimiter = path.delimiter) {
  return String(envPath || '')
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findOnPath(name, envPath = process.env.PATH, delimiter = path.delimiter) {
  for (const entry of pathEntries(envPath, delimiter)) {
    const candidate = path.join(entry, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return '';
}

function getRuntimeAssetPatterns({ platform = process.platform, arch = process.arch } = {}) {
  if (platform === 'win32') {
    return arch === 'arm64'
      ? [/^llama-.*-bin-win-cpu-arm64\.zip$/i]
      : [/^llama-.*-bin-win-cpu-x64\.zip$/i];
  }
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? [/^llama-.*-bin-macos-arm64\.tar\.gz$/i]
      : [/^llama-.*-bin-macos-x64\.tar\.gz$/i];
  }
  return arch === 'arm64'
    ? [/^llama-.*-bin-ubuntu-arm64\.tar\.gz$/i]
    : [/^llama-.*-bin-ubuntu-x64\.tar\.gz$/i];
}

function selectReleaseAsset(assets = [], { platform = process.platform, arch = process.arch } = {}) {
  const patterns = getRuntimeAssetPatterns({ platform, arch });
  for (const pattern of patterns) {
    const asset = assets.find((item) => pattern.test(String(item?.name || '')));
    if (asset?.browser_download_url) return asset;
  }
  return null;
}

function isRuntimeDependencyFile(name, platform = process.platform) {
  if (platform === 'win32') return /\.dll$/i.test(name);
  if (platform === 'darwin') return /\.dylib$/i.test(name);
  return /\.so(\.\d+)*$/i.test(name);
}

function copyRuntimeFiles({ source, destDir, platform = process.platform }) {
  const name = executableName(platform);
  const sourceDir = path.dirname(source);
  const destination = path.join(destDir, name);

  mkdirSync(destDir, { recursive: true });
  if (path.resolve(source) !== path.resolve(destination)) {
    copyFileSync(source, destination);
  }
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !isRuntimeDependencyFile(entry.name, platform)) continue;
    const dependencySource = path.join(sourceDir, entry.name);
    const dependencyDestination = path.join(destDir, entry.name);
    if (path.resolve(dependencySource) !== path.resolve(dependencyDestination)) {
      copyFileSync(dependencySource, dependencyDestination);
    }
  }
  if (platform !== 'win32') {
    chmodSync(destination, 0o755);
  }
  return { copied: true, source, destination };
}

function findRuntimeExecutable(searchRoot, platform = process.platform) {
  const name = executableName(platform);
  const stack = [searchRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name === name) return fullPath;
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }
  return '';
}

function fetchTextWithSystemTool(url, platform = process.platform) {
  if (platform === 'win32') {
    return execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      [
        '$ProgressPreference = "SilentlyContinue";',
        `$response = Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'SpeakMore-llama-runtime-prepare' } -Uri ${quotePowerShell(url)};`,
        '$response.Content',
      ].join(' '),
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  }
  return execFileSync('curl', [
    '-L',
    '--fail',
    '--retry',
    '3',
    '-A',
    'SpeakMore-llama-runtime-prepare',
    url,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function downloadFileWithSystemTool(url, destination, platform = process.platform) {
  if (platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      [
        '$ProgressPreference = "SilentlyContinue";',
        `Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'SpeakMore-llama-runtime-prepare' } -Uri ${quotePowerShell(url)} -OutFile ${quotePowerShell(destination)}`,
      ].join(' '),
    ], { stdio: 'inherit' });
    return;
  }
  execFileSync('curl', [
    '-L',
    '--fail',
    '--retry',
    '3',
    '-A',
    'SpeakMore-llama-runtime-prepare',
    '-o',
    destination,
    url,
  ], { stdio: 'inherit' });
}

async function fetchLatestRelease() {
  const response = await fetch(LLAMA_CPP_LATEST_RELEASE_API, {
    headers: { 'User-Agent': 'SpeakMore-llama-runtime-prepare' },
  }).catch(() => null);
  if (response?.ok) {
    return response.json();
  }
  const text = fetchTextWithSystemTool(LLAMA_CPP_LATEST_RELEASE_API);
  return JSON.parse(text);
}

async function downloadFile(url, destination) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'SpeakMore-llama-runtime-prepare' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      writeFileSync(destination, bytes);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }
  console.warn(`Node download failed, falling back to system downloader: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  downloadFileWithSystemTool(url, destination);
}

function extractArchive(archivePath, destination, platform = process.platform) {
  mkdirSync(destination, { recursive: true });
  if (/\.zip$/i.test(archivePath)) {
    if (platform === 'win32') {
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(destination)} -Force`,
      ], { stdio: 'inherit' });
      return;
    }
    execFileSync('unzip', ['-q', archivePath, '-d', destination], { stdio: 'inherit' });
    return;
  }
  if (/\.tar\.gz$/i.test(archivePath)) {
    execFileSync('tar', ['-xzf', archivePath, '-C', destination], { stdio: 'inherit' });
    return;
  }
  throw new Error(`Unsupported llama runtime archive: ${archivePath}`);
}

function resolveSource({
  source = '',
  destDir = '',
  platform = process.platform,
  env = process.env,
  pathDelimiter = path.delimiter,
} = {}) {
  const name = executableName(platform);
  const candidates = [
    source,
    env.SPEAKMORE_LLAMA_SERVER_PATH,
    env.LLAMA_SERVER_PATH,
    env.SPEAKMORE_BUNDLED_LLAMA_SERVER_PATH,
    env.LLAMA_SERVER_DIR ? path.join(env.LLAMA_SERVER_DIR, name) : '',
    findOnPath(name, env.PATH, pathDelimiter),
    destDir ? path.join(destDir, name) : '',
  ];
  return candidates.map((item) => String(item || '').trim()).find(isExecutableFile) || '';
}

function formatMissingMessage({ platform = process.platform, destDir = '' } = {}) {
  const name = executableName(platform);
  return [
    `Missing ${name}.`,
    '',
    'Provide a local llama.cpp server binary before packaging:',
    '  npm run prepare:llama-runtime',
    `  npm run prepare:llama-runtime -- --source C:\\path\\to\\${name}`,
    `  or set SPEAKMORE_LLAMA_SERVER_PATH / LLAMA_SERVER_PATH / LLAMA_SERVER_DIR`,
    '',
    `The runtime will be copied to: ${path.join(destDir, name)}`,
    'Model weights are still downloaded by the user from the Settings page.',
  ].join('\n');
}

function prepareRuntime(options) {
  const name = executableName(options.platform);
  const source = resolveSource(options);
  const destination = path.join(options.destDir, name);

  if (!source) {
    if (options.optional) {
      console.warn(formatMissingMessage(options));
      return { copied: false, source: '', destination };
    }
    throw new Error(formatMissingMessage(options));
  }

  if (options.checkOnly) {
    console.log(`llama runtime found: ${source}`);
    return { copied: false, source, destination };
  }

  const result = copyRuntimeFiles({
    source,
    destDir: options.destDir,
    platform: options.platform,
  });
  console.log(`llama runtime prepared: ${result.destination}`);
  return result;
}

async function prepareRuntimeAsync(options) {
  const source = resolveSource(options);
  if (source || options.checkOnly || !options.allowDownload) {
    return prepareRuntime(options);
  }

  const release = await fetchLatestRelease();
  const asset = selectReleaseAsset(release.assets || [], {
    platform: options.platform,
    arch: process.arch,
  });
  if (!asset) {
    throw new Error(`No compatible llama.cpp runtime asset found for ${options.platform}/${process.arch}`);
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'speakmore-llama-runtime-'));
  try {
    const archivePath = path.join(tempDir, asset.name);
    const extractDir = path.join(tempDir, 'extract');
    console.log(`downloading llama runtime: ${asset.name}`);
    await downloadFile(asset.browser_download_url, archivePath);
    extractArchive(archivePath, extractDir, options.platform);
    const runtimeSource = findRuntimeExecutable(extractDir, options.platform);
    if (!runtimeSource) {
      throw new Error(`${executableName(options.platform)} was not found in ${asset.name}`);
    }
    const result = copyRuntimeFiles({
      source: runtimeSource,
      destDir: options.destDir,
      platform: options.platform,
    });
    console.log(`llama runtime prepared: ${result.destination}`);
    return {
      ...result,
      downloaded: true,
      releaseTag: release.tag_name || '',
      assetName: asset.name,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));

  try {
    await prepareRuntimeAsync(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export {
  executableName,
  findOnPath,
  findRuntimeExecutable,
  formatMissingMessage,
  prepareRuntime,
  prepareRuntimeAsync,
  resolveSource,
  selectReleaseAsset,
};
