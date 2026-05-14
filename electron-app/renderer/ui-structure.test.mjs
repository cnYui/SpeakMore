import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const readProjectFile = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), 'utf8');

test('Electron 主窗口加载本地 renderer 构建产物', async () => {
  const main = await readProjectFile('../main.js');

  assert.match(main, /renderer[\s\S]*dist[\s\S]*index\.html/);
  assert.doesNotMatch(main, /loadExtractedPage\(mainWindow,\s*['"]hub\.html['"]\)/);
  assert.match(main, /width:\s*1080/);
  assert.match(main, /height:\s*750/);
  assert.match(main, /minWidth:\s*988/);
});

test('Electron 悬浮条加载本地 renderer 构建产物', async () => {
  const main = await readProjectFile('../main.js');
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(main, /renderer[\s\S]*dist[\s\S]*floating-bar\.html/);
  assert.doesNotMatch(main, /loadExtractedPage\(floatingBar,\s*['"]floating-bar\.html['"]\)/);
  assert.match(main, /windowWidth\s*=\s*250/);
  assert.match(main, /windowHeight\s*=\s*250/);
  assert.match(main, /capsuleHeight\s*=\s*24/);
  assert.match(main, /capsuleBottomGap\s*=\s*16/);
  assert.match(main, /width:\s*windowWidth/);
  assert.match(main, /height:\s*windowHeight/);
  assert.match(main, /payload\?\.positions/);
  assert.match(floatingBar, /gap:\s*5px/);
  assert.match(floatingBar, /height:\s*24px/);
  assert.match(floatingBar, /min-width:\s*124px/);
  assert.match(floatingBar, /padding:\s*0 10px/);
  assert.match(floatingBar, /font-size:\s*7px/);
  assert.match(floatingBar, /width:\s*5px;\s*height:\s*5px/);
  assert.match(floatingBar, /const\s+BAR_COUNT\s*=\s*8/);
  assert.match(floatingBar, /gap:\s*2px/);
  assert.match(floatingBar, /height:\s*12px/);
  assert.match(floatingBar, /width:\s*2px;\s*height:\s*5px/);
  assert.match(floatingBar, /border-radius:\s*999px/);
  assert.doesNotMatch(floatingBar, /@keyframes\s+level/);
});

test('Electron 悬浮条默认隐藏且不会在松开快捷键后提前消失', async () => {
  const main = await readProjectFile('../main.js');

  assert.match(main, /function\s+showFloatingBar\(/);
  assert.match(main, /function\s+hideFloatingBar\(/);
  assert.match(main, /show:\s*false/);
  assert.match(main, /setIgnoreMouseEvents\(\s*true/);
  assert.match(main, /setIgnoreMouseEvents\(\s*false/);
  assert.match(main, /floatingBar\.show\(\)/);
  assert.match(main, /floatingBar\.hide\(\)/);
  assert.match(main, /function\s+updateFloatingBarVisibility\(keys\)[\s\S]*keys\.some[\s\S]*isKeydown[\s\S]*showFloatingBar/);
  assert.doesNotMatch(main, /function\s+updateFloatingBarVisibility\(keys\)[\s\S]*else\s+hideFloatingBar\(\)/);
  assert.match(main, /function\s+emitKeyboardState\(keys\)[\s\S]*updateFloatingBarVisibility\(keys\)/);
});

test('preload 暴露真实 bundle 依赖的 ipcRenderer 接口', async () => {
  const preload = await readProjectFile('../preload.js');

  assert.match(preload, /exposeInMainWorld\(['"]ipcRenderer['"]/);
  for (const api of ['on', 'off', 'send', 'invoke', 'addKeyListener', 'removeKeyListener', 'platform']) {
    assert.match(preload, new RegExp(`${api}\\s*[:(]`));
  }
});

test('主进程注册真实 bundle 首屏所需的 IPC shim', async () => {
  const main = await readProjectFile('../main.js');
  const channels = [
    'user:get-current',
    'user:logout',
    'db:history-get',
    'db:history-latest',
    'db:history-list',
    'keyboard:start-keyboard-listener',
    'keyboard:stop-keyboard-listener',
    'keyboard-input:reload-keyboard-shortcuts',
    'permission:request',
    'permission:update-auto-launch',
    'updater:check-for-update',
    'page:open-url',
    'page:floating-bar-update-positions',
    'page:floating-bar-set-always-on-top-for-windows',
    'audio:opus-compress-by-buffer',
    'audio:clean-opus-audio-file',
    'store:use',
    'clipboard:write-text',
    'focused-context:get-last-focused-info',
    'focused-context:get-selected-text',
  ];

  for (const channel of channels) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\(['"]${channel.replaceAll(':', '\\:')}['"]`));
  }
});

test('项目根启动脚本指向本地 Electron 壳而不是逆向资料目录', async () => {
  const rootPackage = JSON.parse(await readProjectFile('../../package.json'));

  assert.equal(rootPackage.scripts.start, 'electron ./electron-app');
});

test('本地壳默认使用简体中文作为唯一应用语言', async () => {
  const main = await readProjectFile('../main.js');

  assert.match(main, /DEFAULT_LANGUAGE\s*=\s*['"]zh-CN['"]/);
  assert.match(main, /preferredLanguage:\s*DEFAULT_LANGUAGE/);
  assert.doesNotMatch(main, /preferredLanguage:\s*['"]en['"]/);
  assert.doesNotMatch(main, /language\s*\|\|\s*['"]en['"]/);
});

test('preload 会移除移动应用下载入口和二维码弹窗', async () => {
  const preload = await readProjectFile('../preload.js');

  assert.match(preload, /removeMobileAppSurfaces/);
  assert.match(preload, /MutationObserver/);
  assert.match(preload, /获取移动应用/);
  assert.match(preload, /获取Typeless移动应用/);
  assert.match(preload, /Google Play/);
  assert.match(preload, /App Store/);
});

test('Right Alt 通过 Windows 低级键盘监听器转发真实 bundle 需要的 global-keyboard 事件', async () => {
  const main = await readProjectFile('../main.js');
  const listener = await readProjectFile('../right-alt-listener.ps1');

  assert.doesNotMatch(main, /globalShortcut\.register\(['"]Alt['"]/);
  assert.doesNotMatch(main, /globalShortcut\.register\(['"]Alt\+Space['"]/);
  assert.match(main, /startRightAltListener/);
  assert.match(main, /spawn\(/);
  assert.match(main, /right-alt-listener\.ps1/);
  assert.match(listener, /VK_RMENU\s*=\s*165/);
  assert.match(listener, /VK_RSHIFT\s*=\s*161/);
  assert.match(listener, /VK_SPACE\s*=\s*32/);
  assert.doesNotMatch(main, /globalShortcut\.register\(['"]Alt\+Shift['"]/);
  assert.match(main, /keyName:\s*['"]RightAlt['"]/);
  assert.match(main, /keyName:\s*['"]Space['"]/);
  assert.match(main, /enKeyName:\s*['"]RightAlt['"]/);
  assert.match(main, /keyCode:\s*165/);
  assert.match(main, /keyCode:\s*32/);
  assert.match(main, /isKeydown:\s*true/);
  assert.match(main, /isKeydown:\s*false/);
  assert.match(main, /sendToFloatingBar\(['"]global-keyboard['"]/);
});

test('Right Alt 主进程转发链路不再依赖 90ms 延迟聚合', async () => {
  const main = await readProjectFile('../main.js');
  const relay = await readProjectFile('../right-alt-relay.js');

  assert.match(main, /createRightAltRelay/);
  assert.doesNotMatch(main, /scheduleActiveKeyboardStateEmit/);
  assert.doesNotMatch(main, /keyboardStateEmitTimer/);
  assert.doesNotMatch(main, /setTimeout\(emitActiveKeyboardState,\s*90\)/);
  assert.match(relay, /emit\(Array\.from\(keyboardStateByName\.values\(\)\)\)/);
});

test('语音输入 IPC 会调用本地后端并把结果粘贴到焦点应用', async () => {
  const main = await readProjectFile('../main.js');

  assert.match(main, /VOICE_SERVER_URL\s*=\s*['"]http:\/\/127\.0\.0\.1:8000['"]/);
  assert.match(main, /ensureVoiceServer/);
  assert.match(main, /\/ai\/voice_flow/);
  assert.match(main, /FormData/);
  assert.match(main, /fetch\(/);
  assert.doesNotMatch(main, /audio:ai-voice-flow['"],\s*\(\)\s*=>\s*\(\{\s*success:\s*false[\s\S]*not_implemented/);
  assert.match(main, /keyboard:type-transcript['"][\s\S]*clipboard\.writeText/);
  assert.match(main, /System\.Windows\.Forms\.SendKeys/);
});

test('主进程具备后台音频会话静音脚本入口和新 IPC', async () => {
  const main = await readProjectFile('../main.js');

  assert.match(main, /audio-session-control\.ps1/);
  assert.match(main, /audio:mute-background-sessions/);
  assert.match(main, /audio:restore-background-sessions/);
  assert.match(main, /backgroundMuteActive/);
  assert.match(main, /mutedBackgroundSessions/);
});

test('recorder 在录音生命周期内请求静音和恢复后台音频', async () => {
  const recorder = await readProjectFile('src/services/recorder.ts');

  assert.match(recorder, /ipcClient\.invoke\(['"]audio:mute-background-sessions['"]/);
  assert.match(recorder, /ipcClient\.invoke\(['"]audio:restore-background-sessions['"]/);
  assert.match(recorder, /completeSession[\s\S]*restoreBackgroundAudio/);
  assert.match(recorder, /failSession[\s\S]*restoreBackgroundAudio/);
  assert.match(recorder, /disposeRecorder[\s\S]*restoreBackgroundAudio/);
});

test('recorder 在录音期间分析真实麦克风音量并同步 inputLevel', async () => {
  const recorder = await readProjectFile('src/services/recorder.ts');

  assert.match(recorder, /AudioContext/);
  assert.match(recorder, /AnalyserNode/);
  assert.match(recorder, /requestAnimationFrame/);
  assert.match(recorder, /inputLevel:/);
  assert.match(recorder, /setSession\(\{\s*\.\.\.session,\s*inputLevel:/);
  assert.match(recorder, /cleanupAudioLevelMonitoring/);
  assert.match(recorder, /cancelAnimationFrame/);
  assert.match(recorder, /audioContext\.close/);
});

test('WebSocket 录音入口会先等待主进程确认语音后端 ready', async () => {
  const main = await readProjectFile('../main.js');
  const recorder = await readProjectFile('src/services/recorder.ts');

  assert.match(main, /ipcMain\.handle\(['"]audio:ensure-voice-server['"]/);
  assert.match(main, /audio:ensure-voice-server['"][\s\S]*ensureVoiceServer/);
  assert.match(recorder, /ipcClient\.invoke\(['"]audio:ensure-voice-server['"]/);
  assert.match(recorder, /await\s+ensureVoiceServerReady\(\)[\s\S]*ensureOpenWebSocket\(\)/);
});

test('前端按键事件按真实快捷键模式启动和停止语音流', async () => {
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const guard = await readProjectFile('src/services/shortcutGuard.ts');
  const voiceTypes = await readProjectFile('src/services/voiceTypes.ts');

  assert.match(appShell, /global-keyboard/);
  assert.match(appShell, /toggleRecording/);
  assert.match(guard, /keyName\s*===\s*['"]RightAlt['"]/);
  assert.match(guard, /keyName\s*===\s*['"]Space['"]/);
  assert.match(guard, /keyName\s*===\s*['"]RightShift['"]/);
  assert.match(guard, /start-recording/);
  assert.match(voiceTypes, /toVoiceFlowMode/);
  assert.match(voiceTypes, /ask_anything/);
  assert.match(voiceTypes, /translation/);
  assert.match(voiceTypes, /transcript/);
});

test('P0 语音状态模型和 IPC client 已收口', async () => {
  const voiceTypes = await readProjectFile('src/services/voiceTypes.ts');
  const ipc = await readProjectFile('src/services/ipc.ts');
  const viteEnv = await readProjectFile('src/vite-env.d.ts');

  for (const status of ['idle', 'connecting', 'recording', 'stopping', 'transcribing', 'completed', 'error']) {
    assert.match(voiceTypes, new RegExp(`['"]${status}['"]`));
  }

  for (const errorCode of ['backend_unavailable', 'websocket_timeout', 'microphone_permission_denied', 'paste_failed']) {
    assert.match(voiceTypes, new RegExp(`['"]${errorCode}['"]`));
  }

  assert.match(ipc, /export\s+const\s+ipcClient/);
  assert.match(ipc, /invoke/);
  assert.match(ipc, /on/);
  assert.match(ipc, /send/);
  assert.match(viteEnv, /interface\s+Window/);
  assert.match(viteEnv, /ipcRenderer/);
});

test('P0 recorder 暴露可订阅状态机并移除猜状态接口', async () => {
  const recorder = await readProjectFile('src/services/recorder.ts');

  assert.match(recorder, /subscribeVoiceSession/);
  assert.match(recorder, /getVoiceSession/);
  assert.match(recorder, /toggleRecording/);
  assert.match(recorder, /disposeRecorder/);
  assert.match(recorder, /audio_processing_completed/);
  assert.match(recorder, /audio_id/);
  assert.doesNotMatch(recorder, /export\s+function\s+getIsRecording/);
});

test('P0 Dashboard 消费语音状态机而不是 setTimeout 猜录音状态', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');

  assert.match(dashboard, /subscribeVoiceSession/);
  assert.match(dashboard, /voiceSession\.status/);
  assert.match(dashboard, /saveVoiceHistory/);
  assert.doesNotMatch(dashboard, /global-keyboard/);
  assert.doesNotMatch(dashboard, /findKeyboardShortcutMode/);
  assert.doesNotMatch(dashboard, /toggleRecording\(/);
  assert.doesNotMatch(dashboard, /setTimeout\(\(\)\s*=>\s*setRecording/);
  assert.doesNotMatch(dashboard, /\(window\s+as\s+any\)\.ipcRenderer/);
});

test('AppShell 接管全局快捷键并渲染 RightAlt 长按提示浮层', async () => {
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const guard = await readProjectFile('src/services/shortcutGuard.ts');

  assert.match(appShell, /ipcClient\.on\(['"]global-keyboard['"]/);
  assert.match(appShell, /toggleRecording/);
  assert.match(appShell, /检测到长按快捷键/);
  assert.match(appShell, /handleCloseShortcutHint/);
  assert.match(guard, /LONG_PRESS_MS\s*=\s*500/);
  assert.match(guard, /isBlocked/);
  assert.match(guard, /modalVisible/);
});

test('P0 快捷键守卫在释放边沿单次触发录音，并在长按时阻断', async () => {
  const guard = await readProjectFile('src/services/shortcutGuard.ts');

  assert.match(guard, /if\s*\(!rightAltDown\)/);
  assert.match(guard, /state\.isRightAltDown\s*&&\s*!state\.isBlocked\s*&&\s*state\.activeMode/);
  assert.match(guard, /type:\s*['"]start-recording['"]/);
  assert.match(guard, /blockByLongPress/);
  assert.match(guard, /modalVisible:\s*true/);
  assert.match(guard, /isBlocked:\s*true/);
});

test('P0 悬浮条消费 voice-state 而不是自行 toggle 快捷键状态', async () => {
  const main = await readProjectFile('../main.js');
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(main, /voice-state/);
  assert.match(main, /sendToFloatingBar\(['"]voice-state['"]/);
  assert.match(floatingBar, /voice-state/);
  assert.match(floatingBar, /applyVoiceState/);
  assert.doesNotMatch(floatingBar, /function\s+toggle\(/);
  assert.doesNotMatch(floatingBar, /global-keyboard[\s\S]*toggle\(\)/);
});

test('P0 悬浮条消费 voice-state.inputLevel 并渲染 8 根真实音量柱', async () => {
  const voiceTypes = await readProjectFile('src/services/voiceTypes.ts');
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(voiceTypes, /inputLevel:\s*number/);
  assert.match(voiceTypes, /inputLevel:\s*0/);
  assert.match(voiceTypes, /inputLevel:\s*session\.inputLevel/);
  assert.match(floatingBar, /const\s+BAR_COUNT\s*=\s*8/);
  assert.match(floatingBar, /voice-state/);
  assert.match(floatingBar, /inputLevel/);
  assert.match(floatingBar, /renderLevels/);
  assert.doesNotMatch(floatingBar, /@keyframes\s+level/);
  assert.doesNotMatch(floatingBar, /animation:\s*level/);
});

test('P0 悬浮条在非 recording 状态归零，并按权重渲染 8 根细柱', async () => {
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(floatingBar, /BAR_WEIGHTS\s*=\s*\[0\.72,\s*0\.84,\s*0\.94,\s*1,\s*1,\s*0\.94,\s*0\.84,\s*0\.72\]/);
  assert.match(floatingBar, /MIN_BAR_HEIGHT/);
  assert.match(floatingBar, /MAX_BAR_HEIGHT/);
  assert.match(floatingBar, /renderLevels\(stateLevel,\s*status\s*===\s*['"]recording['"]\)/);
  assert.match(floatingBar, /const\s+stateLevel\s*=\s*state\s*&&\s*typeof\s+state\.inputLevel\s*===\s*['"]number['"]/);
  assert.match(floatingBar, /width:\s*2px/);
  assert.match(floatingBar, /gap:\s*2px/);
});

test('P0 悬浮条在成功后自动消失并在错误后保持可见', async () => {
  const main = await readProjectFile('../main.js');

  assert.match(main, /function\s+scheduleFloatingBarCompletedHide\(/);
  assert.match(main, /payload\.status\s*===\s*['"]completed['"][\s\S]*scheduleFloatingBarCompletedHide\(\)/);
  assert.match(main, /setTimeout\([\s\S]*hideFloatingBar\(\)/);
  assert.doesNotMatch(main, /payload\.status\s*===\s*['"]error['"][\s\S]*hideFloatingBar\(\)/);
});

test('P0 Dashboard 移除鼠标录音入口，只保留键盘触发', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  const appShell = await readProjectFile('src/components/AppShell.tsx');

  assert.doesNotMatch(dashboard, /MicIcon/);
  assert.doesNotMatch(dashboard, /onClick=\{\(\)\s*=>\s*handleToggle\(\)\}/);
  assert.doesNotMatch(dashboard, /global-keyboard/);
  assert.doesNotMatch(dashboard, /toggleRecording/);
  assert.match(appShell, /global-keyboard/);
  assert.match(appShell, /toggleRecording/);
});

test('P1 历史页面与历史 store 已接入真实本地数据', async () => {
  const historyStore = await readProjectFile('src/services/historyStore.ts');
  const historyPage = await readProjectFile('src/pages/History.tsx');

  assert.match(historyStore, /HISTORY_KEY/);
  assert.match(historyStore, /saveVoiceHistory/);
  assert.match(historyStore, /clearVoiceHistory/);
  assert.match(historyPage, /listVoiceHistory/);
  assert.match(historyPage, /clearVoiceHistory/);
  assert.match(historyPage, /clipboard:write-text/);
});

test('P1 设置页与设置 store 已接入真实 IPC 和本地持久化', async () => {
  const settingsStore = await readProjectFile('src/services/settingsStore.ts');
  const settingsPage = await readProjectFile('src/pages/Settings.tsx');

  assert.match(settingsStore, /SETTINGS_KEY/);
  assert.match(settingsStore, /loadSettings/);
  assert.match(settingsStore, /saveSettings/);
  assert.match(settingsPage, /permission:update-auto-launch/);
  assert.match(settingsPage, /audio:get-devices-async/);
  assert.match(settingsPage, /showFloatingBar/);
});

test('P1 显示悬浮条设置会同步到主进程并在启动时回放', async () => {
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const settingsPage = await readProjectFile('src/pages/Settings.tsx');
  const main = await readProjectFile('../main.js');

  assert.match(main, /let\s+floatingBarEnabled\s*=\s*true/);
  assert.match(main, /ipcMain\.handle\(['"]page:set-floating-bar-enabled['"]/);
  assert.match(main, /if\s*\(!floatingBarEnabled\)\s*\{\s*hideFloatingBar\(\)/);
  assert.match(settingsPage, /page:set-floating-bar-enabled/);
  assert.match(appShell, /loadSettings/);
  assert.match(appShell, /page:set-floating-bar-enabled/);
});

test('P1 诊断页与导航配置已从静态展示切到真实服务', async () => {
  const diagnosticsService = await readProjectFile('src/services/diagnostics.ts');
  const diagnosticsPage = await readProjectFile('src/pages/Diagnostics.tsx');
  const navigation = await readProjectFile('src/navigation.ts');
  const uiTokens = await readProjectFile('src/uiTokens.ts');

  assert.match(diagnosticsService, /runDiagnostics/);
  assert.match(diagnosticsService, /http:\/\/127\.0\.0\.1:8000\/health/);
  assert.match(diagnosticsPage, /runDiagnostics/);
  assert.match(diagnosticsPage, /诊断中/);
  assert.match(navigation, /export\s+type\s+Page/);
  assert.match(navigation, /诊断/);
  assert.doesNotMatch(navigation, /Diagnostics/);
  assert.match(uiTokens, /cardSx/);
  assert.match(uiTokens, /subtlePanelSx/);
});

test('首页壳层和用户可见文案符合 SpeakMore 中文化要求', async () => {
  const navigation = await readProjectFile('src/navigation.ts');
  const sidebar = await readProjectFile('src/components/Sidebar.tsx');
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  const floatingBar = await readProjectFile('public/floating-bar.html');
  const main = await readProjectFile('../main.js');

  assert.match(navigation, /首页/);
  assert.match(navigation, /历史记录/);
  assert.match(navigation, /设置/);
  assert.match(navigation, /诊断/);
  assert.match(sidebar, /SpeakMore/);
  assert.doesNotMatch(sidebar, /bgcolor:\s*['"]#000['"]/);
  assert.doesNotMatch(sidebar, /Voice dictation/);
  assert.doesNotMatch(appShell, /Typeless Local/);
  assert.match(dashboard, /首页/);
  assert.match(dashboard, /最近结果/);
  assert.match(floatingBar, /正在监听/);
  assert.doesNotMatch(floatingBar, /Listening\.\.\./);
  assert.match(main, /title:\s*['"]SpeakMore['"]/);
  assert.match(main, /tray\.setToolTip\(['"]SpeakMore['"]\)/);
});
