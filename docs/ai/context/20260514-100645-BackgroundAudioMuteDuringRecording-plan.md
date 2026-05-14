# 录音期间后台音频静音 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保持现有点按式录音交互不变，在 Windows 上于录音期间自动静音除 Typeless 自己外的后台活跃音频会话，并在本轮录音结束后只恢复这次被 Typeless 主动静音的会话。

**Architecture:** 在 `electron-app/main.js` 中新增后台音频静音控制器，使用新脚本 `electron-app/audio-session-control.ps1` 通过 Windows Core Audio 会话接口枚举、静音和恢复后台音频会话。`renderer` 的 `recorder.ts` 只在录音生命周期节点调用新的主进程 IPC，不直接接触系统音频。

**Tech Stack:** Electron 主进程、PowerShell、内嵌 C# COM 互操作、TypeScript、`node:test`

---

## 文件职责

- `electron-app/audio-session-control.ps1`
  - 新增。封装 `mute-active-sessions` / `restore-sessions` 两个动作，输出 JSON。
- `electron-app/main.js`
  - 修改。维护本轮静音快照，调用 PowerShell 脚本，新增 `audio:mute-background-sessions` / `audio:restore-background-sessions` IPC，并在退出时兜底恢复。
- `electron-app/renderer/src/services/recorder.ts`
  - 修改。开始录音后调用静音 IPC；完成、失败、销毁时调用恢复 IPC。
- `electron-app/renderer/ui-structure.test.mjs`
  - 修改。先写失败结构测试，覆盖新脚本入口、新 IPC 和恢复路径。
- `docs/ai/context/20260514-100504-BackgroundAudioMuteDuringRecording-design.md`
  - 已存在，实现依据。

## Task 1: 先补失败结构测试

**Files:**
- Modify: `electron-app/renderer/ui-structure.test.mjs`

- [ ] **Step 1: 增加主进程后台音频控制结构断言**

在 `electron-app/renderer/ui-structure.test.mjs` 追加：

```js
test('主进程具备后台音频会话静音脚本入口和新 IPC', async () => {
  const main = await readProjectFile('../main.js')

  assert.match(main, /audio-session-control\.ps1/)
  assert.match(main, /audio:mute-background-sessions/)
  assert.match(main, /audio:restore-background-sessions/)
  assert.match(main, /backgroundMuteActive/)
  assert.match(main, /mutedBackgroundSessions/)
})
```

- [ ] **Step 2: 增加 recorder 生命周期接线断言**

继续追加：

```js
test('recorder 在录音生命周期内请求静音和恢复后台音频', async () => {
  const recorder = await readProjectFile('src/services/recorder.ts')

  assert.match(recorder, /ipcClient\.invoke\(['"]audio:mute-background-sessions['"]/)
  assert.match(recorder, /ipcClient\.invoke\(['"]audio:restore-background-sessions['"]/)
  assert.match(recorder, /completeSession[\s\S]*restoreBackgroundAudio/)
  assert.match(recorder, /failSession[\s\S]*restoreBackgroundAudio/)
  assert.match(recorder, /disposeRecorder[\s\S]*restoreBackgroundAudio/)
})
```

- [ ] **Step 3: 运行测试并确认先失败**

Run: `npm test`  
Workdir: `D:\CodeWorkSpace\typeless\electron-app\renderer`

Expected:

- 新增结构测试失败
- 失败原因应集中在：
  - `main.js` 还没有新脚本入口和 IPC
  - `recorder.ts` 还没有静音/恢复接线

- [ ] **Step 4: 如失败点偏移，只调整断言表达**

只允许改测试，不改生产代码。确保红灯精确落在这次需求上。

- [ ] **Step 5: 提交测试红灯检查点**

```bash
git add electron-app/renderer/ui-structure.test.mjs
git commit -m "test: cover background audio mute lifecycle"
```

## Task 2: 新增 Windows 音频会话控制脚本并接入主进程

**Files:**
- Create: `electron-app/audio-session-control.ps1`
- Modify: `electron-app/main.js`
- Test: `electron-app/renderer/ui-structure.test.mjs`

- [ ] **Step 1: 新建脚本入口和参数解析**

创建 `electron-app/audio-session-control.ps1`，先放入脚本入口：

```powershell
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('mute-active-sessions', 'restore-sessions')]
  [string]$Action,

  [string]$Payload = ''
)

$ErrorActionPreference = 'Stop'

function Write-JsonResult($value) {
  $value | ConvertTo-Json -Depth 8 -Compress
}
```

- [ ] **Step 2: 在脚本中加入 Core Audio 会话枚举与静音能力**

在同文件加入内嵌 C# COM 互操作类型定义与包装器，核心结构保持下面语义：

```powershell
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public sealed class AudioSessionSnapshot {
    public string SessionKey { get; set; }
    public int ProcessId { get; set; }
    public bool WasMuted { get; set; }
    public string DisplayName { get; set; }
}

public static class AudioSessionController {
    public static List<AudioSessionSnapshot> MuteActiveSessions(int[] excludedProcessIds) {
        var snapshots = new List<AudioSessionSnapshot>();
        // 枚举默认渲染设备上的 Active 会话
        // 跳过 excludedProcessIds
        // 跳过本来已静音的会话
        // 对剩余会话调用 SetMute(true, Guid.Empty)
        // 记录 SessionKey / ProcessId / WasMuted / DisplayName
        return snapshots;
    }

    public static List<AudioSessionSnapshot> RestoreSessions(AudioSessionSnapshot[] snapshots) {
        var restored = new List<AudioSessionSnapshot>();
        // 重新枚举当前会话
        // 通过 SessionKey + ProcessId 匹配
        // 调用 SetMute(snapshot.WasMuted, Guid.Empty)
        return restored;
    }
}
"@
```

实现时不要引入 `NAudio` 或其他外部依赖；直接在脚本里声明所需的 COM 接口和枚举：

- `IMMDeviceEnumerator`
- `IMMDevice`
- `IAudioSessionManager2`
- `IAudioSessionEnumerator`
- `IAudioSessionControl`
- `IAudioSessionControl2`
- `ISimpleAudioVolume`
- `AudioSessionState`

- [ ] **Step 3: 完成脚本动作分发**

在脚本末尾加入动作分发，约定输入输出格式：

```powershell
$inputPayload = if ([string]::IsNullOrWhiteSpace($Payload)) { @{} } else { $Payload | ConvertFrom-Json -Depth 8 }

switch ($Action) {
  'mute-active-sessions' {
    $excluded = @()
    if ($inputPayload.excludedProcessIds) {
      $excluded = @($inputPayload.excludedProcessIds | ForEach-Object { [int]$_ })
    }

    Write-JsonResult @{
      success = $true
      mutedSessions = [AudioSessionController]::MuteActiveSessions($excluded)
    }
  }
  'restore-sessions' {
    $snapshots = @()
    if ($inputPayload.mutedSessions) {
      $snapshots = @($inputPayload.mutedSessions)
    }

    Write-JsonResult @{
      success = $true
      restoredSessions = [AudioSessionController]::RestoreSessions($snapshots)
    }
  }
}
```

- [ ] **Step 4: 在主进程添加脚本路径和运行时状态**

在 `electron-app/main.js` 顶部变量区补：

```js
let backgroundMuteActive = false;
let mutedBackgroundSessions = [];

function audioSessionControlPath() {
  return path.join(__dirname, 'audio-session-control.ps1');
}
```

- [ ] **Step 5: 在主进程实现脚本调用与快照管理**

在 `electron-app/main.js` 增加这些函数：

```js
function getTypelessProcessIds() {
  return [process.pid];
}

function runAudioSessionControl(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
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
      cwd: __dirname,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    ps.stdout.on('data', (chunk) => { stdout += String(chunk); });
    ps.stderr.on('data', (chunk) => { stderr += String(chunk); });
    ps.on('error', reject);
    ps.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `audio session control exited with code ${code}`));
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
    return result;
  } catch (error) {
    console.error('恢复后台音频会话失败:', error);
    mutedBackgroundSessions = [];
    backgroundMuteActive = false;
    return { success: false, restoredSessions: [], error: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 6: 在主进程实现新的静音入口并替换空壳 IPC**

继续在 `main.js` 中加入：

```js
async function muteBackgroundSessionsForRecording() {
  if (backgroundMuteActive && mutedBackgroundSessions.length) {
    await restoreMutedBackgroundSessions();
  }

  try {
    const result = await runAudioSessionControl('mute-active-sessions', {
      excludedProcessIds: getTypelessProcessIds(),
    });

    mutedBackgroundSessions = Array.isArray(result.mutedSessions) ? result.mutedSessions : [];
    backgroundMuteActive = mutedBackgroundSessions.length > 0;
    return { success: true, mutedSessions: mutedBackgroundSessions };
  } catch (error) {
    console.error('静音后台音频会话失败:', error);
    mutedBackgroundSessions = [];
    backgroundMuteActive = false;
    return { success: false, mutedSessions: [], error: error instanceof Error ? error.message : String(error) };
  }
}

ipcMain.handle('audio:mute-background-sessions', async () => muteBackgroundSessionsForRecording());
ipcMain.handle('audio:restore-background-sessions', async () => restoreMutedBackgroundSessions());
ipcMain.handle('audio:is-muted', () => ({ success: true, isMuted: backgroundMuteActive }));
ipcMain.handle('audio:mute', async () => muteBackgroundSessionsForRecording());
ipcMain.handle('audio:unmute', async () => restoreMutedBackgroundSessions());
```

保留 `audio:mute` / `audio:unmute` 的兼容入口，但语义收口到新实现，不再返回空壳成功。

- [ ] **Step 7: 在退出路径补最终兜底恢复**

在 `main.js` 的退出清理逻辑中加入：

```js
app.on('before-quit', () => {
  void restoreMutedBackgroundSessions();
});
```

- [ ] **Step 8: 运行结构测试，确认主进程部分转绿**

Run: `npm test`  
Workdir: `D:\CodeWorkSpace\typeless\electron-app\renderer`

Expected:

- 主进程相关结构测试通过
- 如仍失败，应主要落在 `recorder.ts` 尚未接线

- [ ] **Step 9: 提交主进程与脚本检查点**

```bash
git add electron-app/audio-session-control.ps1 electron-app/main.js electron-app/renderer/ui-structure.test.mjs
git commit -m "feat: add windows background audio session controller"
```

## Task 3: 把静音/恢复接到录音生命周期

**Files:**
- Modify: `electron-app/renderer/src/services/recorder.ts`
- Test: `electron-app/renderer/ui-structure.test.mjs`

- [ ] **Step 1: 在 recorder 中加入独立的静音辅助函数**

在 `recorder.ts` 顶部变量区附近加入：

```ts
let backgroundAudioRestorePending = false

async function muteBackgroundAudio() {
  try {
    const result = await ipcClient.invoke<{ success?: boolean; mutedSessions?: unknown[] }>('audio:mute-background-sessions')
    backgroundAudioRestorePending = Boolean(result?.success)
  } catch {
    backgroundAudioRestorePending = false
  }
}

async function restoreBackgroundAudio() {
  if (!backgroundAudioRestorePending) return

  try {
    await ipcClient.invoke('audio:restore-background-sessions')
  } finally {
    backgroundAudioRestorePending = false
  }
}
```

- [ ] **Step 2: 在开始录音成功后异步静音后台音频**

修改 `startRecording()`，在 `setSessionStatus('recording')` 后补：

```ts
setSessionStatus('recording')
void muteBackgroundAudio()
```

要求：

- 不要在 `setSessionStatus('recording')` 前 `await`
- 录音主链路不能被静音操作阻塞

- [ ] **Step 3: 在完成路径恢复后台音频**

修改 `completeSession()`：

```ts
async function completeSession(refinedText: string) {
  clearTranscribeTimeout()
  setSession({ ...session, status: 'completed', refinedText, error: null })
  await restoreBackgroundAudio()
  if (!refinedText) return

  ipcClient.invoke('keyboard:type-transcript', refinedText).catch((error) => {
    void restoreBackgroundAudio()
    setSession({
      ...session,
      status: 'error',
      error: createVoiceError('paste_failed', error instanceof Error ? error.message : String(error)),
    })
  })
}
```

实现时注意保留现有粘贴错误语义；恢复后台音频应在 `completed` 和转入 `paste_failed` 时都成立。

- [ ] **Step 4: 在失败路径和销毁路径恢复后台音频**

分别修改：

```ts
function failSession(error: VoiceError) {
  clearTranscribeTimeout()
  cleanupRecording()
  void restoreBackgroundAudio()
  setSession({ ...session, status: 'error', error })
}

export function disposeRecorder() {
  clearTranscribeTimeout()
  cleanupRecording()
  void restoreBackgroundAudio()
  if (ws) {
    ws.onopen = null
    ws.onclose = null
    ws.onerror = null
    ws.onmessage = null
    ws.close()
    ws = null
  }
  listeners.clear()
}
```

- [ ] **Step 5: 避免新一轮录音继承旧恢复状态**

在 `startRecording()` 开头重置：

```ts
backgroundAudioRestorePending = false
```

这样可以防止异常录音周期遗留旧标记。

- [ ] **Step 6: 运行结构测试确认全部转绿**

Run: `npm test`  
Workdir: `D:\CodeWorkSpace\typeless\electron-app\renderer`

Expected:

- `ui-structure.test.mjs` 全部通过

- [ ] **Step 7: 提交 recorder 生命周期检查点**

```bash
git add electron-app/renderer/src/services/recorder.ts electron-app/renderer/ui-structure.test.mjs
git commit -m "feat: mute background audio during recording lifecycle"
```

## Task 4: 构建与人工验证

**Files:**
- Verify: `electron-app/main.js`
- Verify: `electron-app/audio-session-control.ps1`
- Verify: `electron-app/renderer/src/services/recorder.ts`
- Verify: `electron-app/renderer/dist/**`
- Create: `docs/ai/context/20260514-*-BackgroundAudioMuteDuringRecording-verification.md`

- [ ] **Step 1: 运行 renderer 测试**

Run: `npm test`  
Workdir: `D:\CodeWorkSpace\typeless\electron-app\renderer`

Expected: 全部 PASS

- [ ] **Step 2: 构建 renderer**

Run: `npm run build`  
Workdir: `D:\CodeWorkSpace\typeless\electron-app\renderer`

Expected:

- `tsc -b && vite build` 成功
- 生成新的 `dist/assets/index-*.js`

- [ ] **Step 3: 重启 Electron 并观察启动日志**

Run:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process powershell.exe -WorkingDirectory 'D:\CodeWorkSpace\typeless' -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','npm start *> electron-app/out.log 2> electron-app/err.log'
```

Expected:

- 应用可正常启动
- `electron-app/err.log` 没有新的未处理异常

- [ ] **Step 4: 做 5 轮人工验证**

验证顺序：

1. 浏览器或播放器持续播放音频，开始录音
   - 后台音频立即静音
2. 再次点按结束录音并等待完成
   - 后台音频恢复
3. 手动制造后端失败或断开 WebSocket
   - 进入错误态后后台音频仍恢复
4. 录音前先手动把某个后台应用静音
   - 录音结束后该应用保持静音
5. 快速连续开始第二轮录音
   - 不出现旧快照残留导致的错误恢复

- [ ] **Step 5: 写验证记录文档**

创建 `docs/ai/context/20260514-<time>-BackgroundAudioMuteDuringRecording-verification.md`，记录：

- 测试命令
- build 结果
- Electron 启动结果
- 5 轮人工验证结果
- 若有已知边界，明确写出

- [ ] **Step 6: 提交最终实现**

```bash
git add electron-app/audio-session-control.ps1 electron-app/main.js electron-app/renderer/src/services/recorder.ts electron-app/renderer/ui-structure.test.mjs docs/ai/context/*.md AGENTS.md
git commit -m "feat: mute background audio while recording"
```

## 自检

- 设计中的核心约束“保持点按式录音，不改成 PTT”已覆盖。
- 只恢复本轮主动静音的会话，且本来已静音的应用保持原样，已覆盖。
- 主进程作为单一真相源，renderer 只做生命周期接线，已覆盖。
- 任意结束路径恢复后台音频，已覆盖。
- 测试先行、再实现、再构建验证，已覆盖。

## 执行交接

Plan complete and saved to `docs/ai/context/20260514-100645-BackgroundAudioMuteDuringRecording-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 我分任务执行并在任务间检查

**2. Inline Execution** - 我在当前会话里直接按这个 plan 连续实现

回复 `1` 或 `2` 即可。
