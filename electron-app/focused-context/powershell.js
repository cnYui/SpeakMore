const { spawn } = require('child_process');

// 这里的等待不是业务延迟，而是给系统事件、剪贴板写入和 UIA 状态一点缓冲时间。
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// PowerShell 子进程只保留最小可运行环境，避免把主进程的完整环境原样带过去。
function createPowershellEnv(processEnv = process.env) {
  return {
    SystemRoot: processEnv.SystemRoot,
    PATH: processEnv.PATH,
    TEMP: processEnv.TEMP,
    TMP: processEnv.TMP,
  };
}

// 用 PowerShell 的 SendKeys 模拟按键，集中处理 Windows 的按键语义和系统派发。
function createSendKeysShortcut(shortcut, {
  spawnProcess = spawn,
  processEnv = process.env,
} = {}) {
  return () => new Promise((resolve, reject) => {
    // 让 PowerShell 代发按键，比在 Node 里直接拼字符串更容易统一处理 Windows 语义。
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

// 执行 PowerShell 脚本并把标准输出解析成 JSON，供 focused-context 读取原生信息。
function powershellJsonCommand(script, {
  spawnProcess = spawn,
  processEnv = process.env,
  timeoutMs = 8000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  return () => new Promise((resolve, reject) => {
    const command = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$OutputEncoding = [System.Text.Encoding]::UTF8',
      script,
    ].join('\n');
    // 这里只跑无界面、无配置文件模式，避免用户自己的 PowerShell 配置污染脚本结果。
    const ps = spawnProcess('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      env: createPowershellEnv(processEnv),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      if (timer) clearTimer(timer);
      callback(value);
    }

    const timer = timeoutMs > 0
      ? setTimer(() => {
        try {
          ps.kill();
        } catch {}
        finish(reject, new Error(`PowerShell command timeout after ${timeoutMs}ms`));
      }, timeoutMs)
      : null;

    ps.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    ps.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    ps.on('exit', (code) => {
      if (code !== 0) {
        finish(reject, new Error(stderr || `PowerShell exited with code ${code}`));
        return;
      }
      try {
        finish(resolve, JSON.parse(stdout || '{}'));
      } catch (error) {
        finish(reject, error);
      }
    });
    ps.on('error', (error) => finish(reject, error));
  });
}

module.exports = {
  createPowershellEnv,
  createSendKeysShortcut,
  powershellJsonCommand,
  wait,
};
