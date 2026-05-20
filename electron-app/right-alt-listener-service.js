const { spawn } = require('child_process');
const { createRightAltRelay } = require('./right-alt-relay');

function createRightAltListenerService({
  emitKeyboardState,
  handleEscapeKeydown = () => undefined,
  createRelay = createRightAltRelay,
  rightAltListenerPath = () => '',
  processPlatform = process.platform,
  processEnv = process.env,
  spawnProcess = spawn,
  debugLog = () => undefined,
} = {}) {
  let rightAltRelay = null;
  let rightAltListener = null;
  let rightAltListenerStdout = '';

  function getRightAltRelay() {
    if (rightAltRelay) return rightAltRelay;

    rightAltRelay = createRelay({
      emitKeyboardState,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      now: () => Date.now(),
      debugLog,
    });

    return rightAltRelay;
  }

  function handleListenerLine(line) {
    if (!line.trim()) return;

    try {
      const payload = JSON.parse(line);
      debugLog('right-alt-listener:payload', payload);
      if (payload.key === 'Escape') {
        if (payload.isKeydown) {
          handleEscapeKeydown(payload);
        }
        return;
      }
      getRightAltRelay().handlePayload(payload);
    } catch (error) {
      console.error('Right Alt 监听器输出解析失败:', error);
    }
  }

  function start() {
    if (processPlatform !== 'win32') return false;
    if (rightAltListener && !rightAltListener.killed) return true;

    rightAltListener = spawnProcess('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      rightAltListenerPath(),
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        SystemRoot: processEnv.SystemRoot,
        PATH: processEnv.PATH,
        TEMP: processEnv.TEMP,
        TMP: processEnv.TMP,
        USERPROFILE: processEnv.USERPROFILE,
        APPDATA: processEnv.APPDATA,
      },
    });

    rightAltListener.stdout.on('data', (chunk) => {
      rightAltListenerStdout += chunk.toString('utf8');
      const lines = rightAltListenerStdout.split(/\r?\n/);
      rightAltListenerStdout = lines.pop() || '';
      lines.forEach(handleListenerLine);
    });

    rightAltListener.stderr.on('data', (chunk) => {
      console.error(`Right Alt 监听器错误: ${chunk.toString('utf8').trim()}`);
    });

    rightAltListener.on('exit', () => {
      rightAltListener = null;
      rightAltListenerStdout = '';
    });

    return true;
  }

  function stop() {
    if (!rightAltListener || rightAltListener.killed) return;
    rightAltListener.kill();
    rightAltListener = null;
  }

  function dispose() {
    if (rightAltRelay) {
      rightAltRelay.dispose();
      rightAltRelay = null;
    }
    stop();
  }

  return {
    getRightAltRelay,
    handleListenerLine,
    start,
    stop,
    dispose,
  };
}

module.exports = {
  createRightAltListenerService,
};
