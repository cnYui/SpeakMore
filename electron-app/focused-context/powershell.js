const { spawn } = require('child_process');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPowershellEnv(processEnv = process.env) {
  return {
    SystemRoot: processEnv.SystemRoot,
    PATH: processEnv.PATH,
    TEMP: processEnv.TEMP,
    TMP: processEnv.TMP,
  };
}

function createSendKeysShortcut(shortcut, {
  spawnProcess = spawn,
  processEnv = process.env,
} = {}) {
  return () => new Promise((resolve, reject) => {
    const ps = spawnProcess('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${shortcut}")`,
    ], {
      windowsHide: true,
      env: createPowershellEnv(processEnv),
    });

    ps.on('exit', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`SendKeys exited with code ${code}`));
    });
    ps.on('error', reject);
  });
}

function powershellJsonCommand(script, {
  spawnProcess = spawn,
  processEnv = process.env,
} = {}) {
  return () => new Promise((resolve, reject) => {
    const ps = spawnProcess('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      env: createPowershellEnv(processEnv),
    });
    let stdout = '';
    let stderr = '';

    ps.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    ps.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    ps.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `PowerShell exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    ps.on('error', reject);
  });
}

module.exports = {
  createPowershellEnv,
  createSendKeysShortcut,
  powershellJsonCommand,
  wait,
};
