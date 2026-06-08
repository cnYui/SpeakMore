import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const DEFAULT_STQ_REPO = 'https://github.com/sjl623/llama.cpp.git';
const DEFAULT_STQ_REF = 'f8b355a9eab32a23df26ae61ff1aacf2bb44ca38';

function parseArgs(argv) {
  const options = {
    source: '',
    destDir: path.join(rootDir, 'release-artifacts', 'llama-stq'),
    platform: process.platform,
    optional: false,
    checkOnly: false,
    allowBuild: true,
    repo: process.env.SPEAKMORE_HYMT_LLAMA_CPP_REPO || DEFAULT_STQ_REPO,
    ref: process.env.SPEAKMORE_HYMT_LLAMA_CPP_REF || DEFAULT_STQ_REF,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--source') options.source = String(argv[index += 1] || '').trim();
    if (item === '--dest-dir') options.destDir = path.resolve(String(argv[index += 1] || '').trim());
    if (item === '--platform') options.platform = String(argv[index += 1] || '').trim();
    if (item === '--optional') options.optional = true;
    if (item === '--check') options.checkOnly = true;
    if (item === '--no-build') options.allowBuild = false;
    if (item === '--repo') options.repo = String(argv[index += 1] || '').trim();
    if (item === '--ref') options.ref = String(argv[index += 1] || '').trim();
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

function isRuntimeDependencyFile(name, platform = process.platform) {
  if (platform === 'win32') return /\.dll$/i.test(name);
  if (platform === 'darwin') return /\.dylib$/i.test(name);
  return /\.so(\.\d+)*$/i.test(name);
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
    env.SPEAKMORE_HYMT_LLAMA_SERVER_PATH,
    env.SPEAKMORE_BUNDLED_HYMT_LLAMA_SERVER_PATH,
    env.SPEAKMORE_HYMT_LLAMA_SERVER_DIR ? path.join(env.SPEAKMORE_HYMT_LLAMA_SERVER_DIR, name) : '',
    destDir ? path.join(destDir, name) : '',
  ];
  return candidates.map((item) => String(item || '').trim()).find(isExecutableFile) || '';
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function cloneAndBuildRuntime(options) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'speakmore-hymt-runtime-'));
  try {
    const sourceDir = path.join(tempDir, 'llama.cpp');
    const buildDir = path.join(tempDir, 'build');
    run('git', ['clone', '--filter=blob:none', options.repo, sourceDir]);
    run('git', ['checkout', options.ref], { cwd: sourceDir });
    run('cmake', [
      '-S',
      sourceDir,
      '-B',
      buildDir,
      '-DLLAMA_BUILD_TESTS=OFF',
      '-DLLAMA_BUILD_EXAMPLES=OFF',
      '-DGGML_NATIVE=ON',
    ]);
    run('cmake', ['--build', buildDir, '--config', 'Release', '--target', 'llama-server', '-j', String(Math.max(2, Math.min(8, os.cpus().length || 4)))]);
    const runtimeSource = findRuntimeExecutable(buildDir, options.platform);
    if (!runtimeSource) {
      throw new Error(`${executableName(options.platform)} was not found after STQ build`);
    }
    return copyRuntimeFiles({
      source: runtimeSource,
      destDir: options.destDir,
      platform: options.platform,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function formatMissingMessage({ platform = process.platform, destDir = '' } = {}) {
  const name = executableName(platform);
  return [
    `Missing Hy-MT STQ ${name}.`,
    '',
    'Provide or build the Hy-MT STQ llama.cpp server runtime:',
    '  npm run prepare:hy-mt-runtime',
    `  npm run prepare:hy-mt-runtime -- --source C:\\path\\to\\${name}`,
    '  or set SPEAKMORE_HYMT_LLAMA_SERVER_PATH / SPEAKMORE_BUNDLED_HYMT_LLAMA_SERVER_PATH',
    '',
    `The runtime will be copied to: ${path.join(destDir, name)}`,
  ].join('\n');
}

function prepareHyMtRuntime(options) {
  const name = executableName(options.platform);
  const source = resolveSource(options);
  const destination = path.join(options.destDir, name);

  if (source) {
    if (options.checkOnly) {
      console.log(`Hy-MT STQ runtime found: ${source}`);
      return { copied: false, source, destination };
    }
    const result = copyRuntimeFiles({
      source,
      destDir: options.destDir,
      platform: options.platform,
    });
    console.log(`Hy-MT STQ runtime prepared: ${result.destination}`);
    return result;
  }

  if (options.checkOnly || !options.allowBuild) {
    if (options.optional) {
      mkdirSync(options.destDir, { recursive: true });
      console.warn(formatMissingMessage(options));
      return { copied: false, source: '', destination };
    }
    throw new Error(formatMissingMessage(options));
  }

  return cloneAndBuildRuntime(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  try {
    prepareHyMtRuntime(options);
  } catch (error) {
    if (options.optional) {
      mkdirSync(options.destDir, { recursive: true });
      console.warn(error instanceof Error ? error.message : String(error));
      process.exit(0);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export {
  DEFAULT_STQ_REF,
  DEFAULT_STQ_REPO,
  executableName,
  findRuntimeExecutable,
  formatMissingMessage,
  prepareHyMtRuntime,
  resolveSource,
};
