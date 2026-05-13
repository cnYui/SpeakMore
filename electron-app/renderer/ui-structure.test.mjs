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

  assert.match(main, /renderer[\s\S]*dist[\s\S]*floating-bar\.html/);
  assert.doesNotMatch(main, /loadExtractedPage\(floatingBar,\s*['"]floating-bar\.html['"]\)/);
  assert.match(main, /windowWidth\s*=\s*500/);
  assert.match(main, /windowHeight\s*=\s*500/);
  assert.match(main, /width:\s*windowWidth/);
  assert.match(main, /height:\s*windowHeight/);
  assert.match(main, /payload\?\.positions/);
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

test('前端按键事件按真实快捷键模式启动和停止语音流', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  const voiceTypes = await readProjectFile('src/services/voiceTypes.ts');

  assert.match(dashboard, /findKeyboardShortcutMode/);
  assert.match(dashboard, /keyName\s*===\s*['"]RightAlt['"]/);
  assert.match(dashboard, /keyName\s*===\s*['"]Space['"]/);
  assert.match(dashboard, /keyName\s*===\s*['"]RightShift['"]/);
  assert.match(dashboard, /rightAlt[\s\S]*isKeydown/);
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
  assert.match(dashboard, /getVoiceStatusLabel/);
  assert.match(dashboard, /toggleRecording/);
  assert.doesNotMatch(dashboard, /setTimeout\(\(\)\s*=>\s*setRecording/);
  assert.doesNotMatch(dashboard, /\(window\s+as\s+any\)\.ipcRenderer/);
});

test('P0 快捷键触发采用边沿检测，组合键释放不会二次切换录音', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');

  assert.match(dashboard, /useRef/);
  assert.match(dashboard, /stopRecording/);
  assert.match(dashboard, /previousShortcutMode/);
  assert.match(dashboard, /if\s*\(!previousShortcutMode\s*&&\s*shortcutMode\)/);
  assert.match(dashboard, /if\s*\(previousShortcutMode\s*&&\s*!shortcutMode\)[\s\S]*stopRecording\(\)/);
  assert.doesNotMatch(dashboard, /global-keyboard[\s\S]*if\s*\(!shortcutMode\)\s*return[\s\S]*handleKeyboardToggle\(shortcutMode\)/);
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

test('P0 悬浮条在成功后自动消失并在错误后保持可见', async () => {
  const main = await readProjectFile('../main.js');

  assert.match(main, /function\s+scheduleFloatingBarCompletedHide\(/);
  assert.match(main, /payload\.status\s*===\s*['"]completed['"][\s\S]*scheduleFloatingBarCompletedHide\(\)/);
  assert.match(main, /setTimeout\([\s\S]*hideFloatingBar\(\)/);
  assert.doesNotMatch(main, /payload\.status\s*===\s*['"]error['"][\s\S]*hideFloatingBar\(\)/);
});

test('P0 Dashboard 移除鼠标录音入口，只保留键盘触发', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');

  assert.doesNotMatch(dashboard, /MicIcon/);
  assert.doesNotMatch(dashboard, /onClick=\{\(\)\s*=>\s*handleToggle\(\)\}/);
  assert.match(dashboard, /global-keyboard/);
  assert.match(dashboard, /toggleRecording/);
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
  assert.match(navigation, /Diagnostics/);
  assert.match(uiTokens, /cardSx/);
  assert.match(uiTokens, /subtlePanelSx/);
});
