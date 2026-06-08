const { spawn } = require('child_process');

function createAudioSessionService({
  isEnabled = () => true,
  getTypelessProcessIds = () => [],
  audioSessionControlPath = () => '',
  processEnv = process.env,
  platform = process.platform,
  workDir = __dirname,
  timeoutMs = 5000,
  spawnProcess = spawn,
  runAudioSessionControl: runAudioSessionControlOverride = null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger = console,
} = {}) {
  let mutedBackgroundSessions = [];
  let backgroundMuteActive = false;

  function minimalProcessEnv(extra = {}) {
    return {
      SystemRoot: processEnv.SystemRoot,
      PATH: processEnv.PATH,
      TEMP: processEnv.TEMP,
      TMP: processEnv.TMP,
      USERPROFILE: processEnv.USERPROFILE,
      APPDATA: processEnv.APPDATA,
      LOCALAPPDATA: processEnv.LOCALAPPDATA,
      ...extra,
    };
  }

  function shouldMuteBackgroundAudio() {
    return platform === 'win32' && isEnabled() !== false;
  }

  function shouldRunAudioSessionControl(action) {
    return platform === 'win32' && (action === 'list-active-sessions' || shouldMuteBackgroundAudio());
  }

  function runAudioSessionControl(action, payload = {}) {
    if (typeof runAudioSessionControlOverride === 'function') {
      return runAudioSessionControlOverride(action, payload);
    }

    return new Promise((resolve, reject) => {
      if (!shouldRunAudioSessionControl(action)) {
        resolve({ success: true, mutedSessions: [], restoredSessions: [], activeSessions: [] });
        return;
      }

      const child = spawnProcess('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        audioSessionControlPath(),
        '-Action',
        action,
        '-Payload',
        JSON.stringify(payload),
      ], {
        cwd: workDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: minimalProcessEnv(),
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimer(() => {
        child.kill();
        reject(new Error(`audio session control timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        clearTimer(timer);
        reject(error);
      });
      child.on('exit', (code) => {
        clearTimer(timer);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `audio session control exited with code ${code}`));
          return;
        }

        try {
          resolve(stdout.trim() ? JSON.parse(stdout) : {});
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async function restoreMutedBackgroundSessions() {
    if (!mutedBackgroundSessions.length) {
      backgroundMuteActive = false;
      return { success: true, restoredSessions: [] };
    }

    try {
      const result = await runAudioSessionControl('restore-sessions', {
        mutedSessions: mutedBackgroundSessions,
      });
      mutedBackgroundSessions = [];
      backgroundMuteActive = false;
      return {
        success: Boolean(result?.success),
        restoredSessions: Array.isArray(result?.restoredSessions) ? result.restoredSessions : [],
      };
    } catch (error) {
      logger.error?.('恢复后台音频会话失败:', error);
      mutedBackgroundSessions = [];
      backgroundMuteActive = false;
      return {
        success: false,
        restoredSessions: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function muteBackgroundSessionsForRecording() {
    if (!shouldMuteBackgroundAudio()) {
      mutedBackgroundSessions = [];
      backgroundMuteActive = false;
      return { success: true, mutedSessions: [] };
    }

    if (backgroundMuteActive || mutedBackgroundSessions.length) {
      await restoreMutedBackgroundSessions();
    }

    try {
      const result = await runAudioSessionControl('mute-active-sessions', {
        excludedProcessIds: getTypelessProcessIds(),
      });
      mutedBackgroundSessions = Array.isArray(result?.mutedSessions) ? result.mutedSessions : [];
      backgroundMuteActive = mutedBackgroundSessions.length > 0;
      return {
        success: Boolean(result?.success),
        mutedSessions: mutedBackgroundSessions,
      };
    } catch (error) {
      logger.error?.('静音后台音频会话失败:', error);
      mutedBackgroundSessions = [];
      backgroundMuteActive = false;
      return {
        success: false,
        mutedSessions: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function listActiveAudioSessions() {
    if (platform !== 'win32') {
      return { success: true, activeSessions: [] };
    }

    try {
      const result = await runAudioSessionControl('list-active-sessions');
      return {
        success: Boolean(result?.success),
        activeSessions: Array.isArray(result?.activeSessions) ? result.activeSessions : [],
      };
    } catch (error) {
      logger.warn?.('璇诲彇娲昏穬闊抽浼氳瘽澶辫触:', error);
      return {
        success: false,
        activeSessions: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function isMuted() {
    return backgroundMuteActive;
  }

  function hasMutedSessions() {
    return mutedBackgroundSessions.length > 0;
  }

  return {
    minimalProcessEnv,
    shouldMuteBackgroundAudio,
    runAudioSessionControl,
    listActiveAudioSessions,
    restoreMutedBackgroundSessions,
    muteBackgroundSessionsForRecording,
    restore: restoreMutedBackgroundSessions,
    muteForRecording: muteBackgroundSessionsForRecording,
    isMuted,
    hasMutedSessions,
  };
}

module.exports = {
  createAudioSessionService,
};
