import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
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

test('Electron 关闭主窗口时隐藏到后台并保留语音识别链路', async () => {
  const main = await readProjectFile('../main.js');

  assert.match(main, /let\s+appIsQuitting\s*=\s*false/);
  assert.match(main, /if\s*\(mainWindow\s*&&\s*!mainWindow\.isDestroyed\(\)\)[\s\S]*mainWindow\.show\(\)[\s\S]*mainWindow\.focus\(\)/);
  assert.match(main, /mainWindow\.on\(['"]close['"],\s*\(event\)\s*=>\s*\{[\s\S]*if\s*\(appIsQuitting\)\s*return[\s\S]*event\.preventDefault\(\)[\s\S]*mainWindow\.hide\(\)/);
  assert.match(main, /app\.on\(['"]before-quit['"],\s*\(event\)\s*=>\s*\{[\s\S]*appIsQuitting\s*=\s*true/);
});

test('Electron 悬浮条加载本地 renderer 构建产物', async () => {
  const main = await readProjectFile('../main.js');
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(main, /renderer[\s\S]*dist[\s\S]*floating-bar\.html/);
  assert.doesNotMatch(main, /loadExtractedPage\(floatingBar,\s*['"]floating-bar\.html['"]\)/);
  assert.match(main, /const\s+FLOATING_BAR_SIZE\s*=\s*\{\s*width:\s*400,\s*height:\s*360\s*\}/);
  assert.match(main, /const\s+FLOATING_WINDOW_BOTTOM_GAP\s*=\s*32/);
  assert.match(main, /resolveFloatingBarBounds/);
  assert.doesNotMatch(main, /defaultFloatingBarX\s*=\s*660/);
  assert.doesNotMatch(main, /defaultFloatingBarY\s*=\s*739/);
  assert.match(main, /payload\?\.positions/);
  assert.match(floatingBar, /gap:\s*9\.3px/);
  assert.match(floatingBar, /height:\s*44\.6px/);
  assert.match(floatingBar, /min-width:\s*230px/);
  assert.match(floatingBar, /padding:\s*0 18\.6px/);
  assert.match(floatingBar, /font-size:\s*13px/);
  assert.match(floatingBar, /width:\s*9\.3px;\s*height:\s*9\.3px/);
  assert.match(floatingBar, /const\s+BAR_COUNT\s*=\s*8/);
  assert.match(floatingBar, /gap:\s*3\.7px/);
  assert.match(floatingBar, /height:\s*22\.3px/);
  assert.match(floatingBar, /width:\s*3\.7px;\s*height:\s*9\.3px/);
  assert.match(floatingBar, /border-radius:\s*999px/);
  assert.doesNotMatch(floatingBar, /-webkit-app-region:\s*drag/);
  assert.doesNotMatch(floatingBar, /检测到长按快捷键/);
  assert.doesNotMatch(floatingBar, /shortcut-hint/);
  assert.doesNotMatch(floatingBar, /@keyframes\s+level/);
});

test('悬浮面板复用长按提示框位置，并支持快捷键提示和自由提问结果两种模式', async () => {
  const main = await readProjectFile('../main.js');
  const floatingPanel = await readProjectFile('public/floating-panel.html');

  assert.match(main, /let\s+floatingPanelWindow\s*=\s*null/);
  assert.match(main, /let\s+floatingPanelVisible\s*=\s*false/);
  assert.match(main, /let\s+floatingPanelType\s*=\s*null/);
  assert.match(main, /function\s+sendToFloatingPanel\(/);
  assert.match(main, /function\s+showFloatingPanel\(/);
  assert.match(main, /function\s+hideFloatingPanel\(/);
  assert.match(main, /renderer[\s\S]*dist[\s\S]*floating-panel\.html/);
  assert.match(main, /FLOATING_PANEL_SIZE\s*=\s*\{\s*width:\s*440,\s*height:\s*220\s*\}/);
  assert.match(main, /resolveFloatingPanelBounds/);
  assert.match(main, /ipcMain\.on\(['"]floating-panel['"]/);
  assert.match(main, /type:\s*['"]shortcut-hint['"]/);
  assert.match(main, /free-ask-result/);
  assert.match(main, /if\s*\(isActiveVoiceState\(lastVoiceState\)\)[\s\S]*sendToMain\(['"]voice-cancel-requested['"]/);
  assert.match(main, /if\s*\(floatingPanelVisible\)\s*\{[\s\S]*hideFloatingPanel\(\)/);
  assert.doesNotMatch(main, /shortcutHintWindow/);
  assert.doesNotMatch(main, /SHORTCUT_HINT_SIZE/);

  assert.match(floatingPanel, /检测到长按快捷键/);
  assert.match(floatingPanel, /free-ask-result/);
  assert.match(floatingPanel, /result-text/);
  assert.match(floatingPanel, /white-space:\s*pre-wrap/);
  assert.match(floatingPanel, /overflow:\s*auto/);
  assert.match(floatingPanel, /window\.ipcRenderer\.send\(['"]floating-panel['"],\s*\{\s*visible:\s*false\s*\}\)/);
  assert.doesNotMatch(floatingPanel, /原选区已失效/);
  assert.doesNotMatch(floatingPanel, /复制/);
  assert.doesNotMatch(floatingPanel, /-webkit-app-region:\s*drag/);
});

test('P0 长按提示低于语音状态优先级', async () => {
  const main = await readProjectFile('../main.js');
  const {
    isActiveVoiceState,
    isTerminalVoiceState,
    shouldShowShortcutHint,
  } = require('../floating-window-state.js');

  assert.equal(isActiveVoiceState({ status: 'recording' }), true);
  assert.equal(isActiveVoiceState({ status: 'transcribing' }), true);
  assert.equal(isTerminalVoiceState({ status: 'completed' }), true);
  assert.equal(isTerminalVoiceState({ status: 'cancelled' }), true);
  assert.equal(shouldShowShortcutHint(null), true);
  assert.equal(shouldShowShortcutHint({ status: 'recording', visible: true }), false);
  assert.equal(shouldShowShortcutHint({ status: 'completed', visible: true }), false);
  assert.equal(shouldShowShortcutHint({ status: 'error', visible: true }), false);
  assert.equal(shouldShowShortcutHint({ status: 'idle', visible: false }), true);

  assert.match(main, /let\s+lastVoiceState\s*=\s*null/);
  assert.match(main, /function\s+renderFloatingBarForVoiceState\(/);
  assert.match(main, /shouldShowShortcutHint\(lastVoiceState\)/);
  assert.match(main, /if\s*\(floatingPanelVisible\s*&&\s*isActiveVoiceState\(payload\)\)\s*hideFloatingPanel\(\)/);
  assert.doesNotMatch(main, /ipcMain\.on\(['"]voice-state['"][\s\S]*if\s*\(floatingPanelVisible\)\s*\{[\s\S]*hideFloatingBar\(\)[\s\S]*return/);
});

test('P0 悬浮窗口不再记录拖动坐标', async () => {
  const main = await readProjectFile('../main.js');

  assert.doesNotMatch(main, /FLOATING_BAR_POSITION_FILE_NAME/);
  assert.doesNotMatch(main, /SHORTCUT_HINT_POSITION_FILE_NAME/);
  assert.doesNotMatch(main, /writeFloatingBarPositionSnapshot/);
  assert.doesNotMatch(main, /writeShortcutHintPositionSnapshot/);
  assert.doesNotMatch(main, /\.on\(['"]move['"]/);
  assert.doesNotMatch(main, /\.on\(['"]moved['"]/);
});

test('P1 悬浮窗口基于 workArea 动态定位并限制在屏幕内', async () => {
  const main = await readProjectFile('../main.js');
  const {
    clampBoundsToWorkArea,
    resolveBottomCenterBounds,
  } = require('../floating-window-layout.js');

  assert.deepEqual(
    resolveBottomCenterBounds({ x: 0, y: 0, width: 1920, height: 1080 }, { width: 400, height: 360 }, 32),
    { x: 760, y: 688, width: 400, height: 360 },
  );
  assert.deepEqual(
    resolveBottomCenterBounds({ x: -1920, y: 0, width: 1920, height: 1040 }, { width: 440, height: 220 }, 32),
    { x: -1180, y: 788, width: 440, height: 220 },
  );
  assert.deepEqual(
    clampBoundsToWorkArea({ x: 900, y: 700, width: 400, height: 360 }, { x: 0, y: 0, width: 1000, height: 800 }),
    { x: 600, y: 440, width: 400, height: 360 },
  );

  assert.match(main, /resolveBottomCenterBounds/);
  assert.match(main, /getDisplayNearestPoint/);
  assert.match(main, /getCursorScreenPoint/);
  assert.doesNotMatch(main, /defaultFloatingBarX/);
  assert.doesNotMatch(main, /defaultFloatingBarY/);
  assert.doesNotMatch(main, /defaultShortcutHintWindowX/);
  assert.doesNotMatch(main, /defaultShortcutHintWindowY/);
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
    'user:login',
    'user:logout',
    'db:history-get',
    'db:history-latest',
    'db:history-list',
    'i18n:reset-to-system-language',
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
    'file:open-log',
    'file:clear-log',
    'file:open-recordings',
    'file:read-recordings-size',
    'store:use',
    'test:get-latest-history',
    'test:generate-test-records',
    'test:clear-test-records',
    'clipboard:write-text',
    'focused-context:get-last-focused-info',
    'focused-context:get-selected-text',
    'page:restart-typeless-bar',
    'page:open-devtools',
    'page:close-all-devtools',
    'page:open-sidebar',
    'page:open-interactive-card',
    'page:launch-application',
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
  assert.match(main, /sendToMain\(['"]global-keyboard['"],\s*keys\)/);
  assert.doesNotMatch(main, /sendToFloatingBar\(['"]global-keyboard['"]/);
});

test('P1 悬浮条不再接收无效 global-keyboard，快捷键守卫无未使用关闭 API', async () => {
  const main = await readProjectFile('../main.js');
  const guard = await readProjectFile('src/services/shortcutGuard.ts');

  assert.match(main, /sendToMain\(['"]global-keyboard['"],\s*keys\)/);
  assert.doesNotMatch(main, /sendToFloatingBar\(['"]global-keyboard['"]/);
  assert.doesNotMatch(guard, /function\s+closeShortcutHint/);
  assert.doesNotMatch(guard, /export\s+function\s+closeShortcutHint/);
});

test('全局 Escape 通过 Windows 低级键盘监听器转发取消事件', async () => {
  const main = await readProjectFile('../main.js');
  const listener = await readProjectFile('../right-alt-listener.ps1');
  const appShell = await readProjectFile('src/components/AppShell.tsx');

  assert.match(listener, /VK_ESCAPE\s*=\s*27/);
  assert.match(main, /payload\.key\s*===\s*['"]Escape['"]/);
  assert.match(main, /sendToMain\(['"]voice-cancel-requested['"]/);
  assert.match(appShell, /ipcClient\.on\(['"]voice-cancel-requested['"]/);
  assert.match(appShell, /cancelRecording/);
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
  assert.match(main, /checkVoiceServerReady/);
  assert.match(main, /\/ready/);
  assert.match(main, /\/ai\/voice_flow/);
  assert.match(main, /FormData/);
  assert.match(main, /fetch\(/);
  assert.doesNotMatch(main, /audio:ai-voice-flow['"],\s*\(\)\s*=>\s*\(\{\s*success:\s*false[\s\S]*not_implemented/);
  assert.match(main, /keyboard:type-transcript['"][\s\S]*clipboard\.writeText/);
  assert.match(main, /System\.Windows\.Forms\.SendKeys/);
});

test('audio:ai-voice-flow 会补齐逆向请求字段并保留关键返回字段', async () => {
  const main = await readProjectFile('../main.js');

  assert.match(main, /formData\.append\(['"]user_over_time['"]/);
  assert.match(main, /detail:/);
  assert.match(main, /code:/);
  assert.match(main, /paywall:/);
  assert.match(main, /web_metadata/);
  assert.match(main, /external_action/);
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
  const diagnostics = await readProjectFile('src/services/diagnostics.ts');
  const voiceServer = await readProjectFile('src/services/voiceServer.ts');

  assert.match(main, /ipcMain\.handle\(['"]audio:check-voice-server-ready['"]/);
  assert.match(main, /audio:ensure-voice-server['"][\s\S]*checkVoiceServerReady/);
  assert.match(recorder, /ipcClient\.invoke\(['"]audio:check-voice-server-ready['"]/);
  assert.match(recorder, /from ['"]\.\/voiceServer['"]/);
  assert.match(diagnostics, /from ['"]\.\/voiceServer['"]/);
  assert.match(voiceServer, /VOICE_SERVER_HTTP_BASE_URL/);
  assert.match(voiceServer, /VOICE_SERVER_READY_URL/);
  assert.match(voiceServer, /VOICE_SERVER_WS_URL/);
  assert.doesNotMatch(recorder, /ws:\/\/localhost:8000\/ws\/rt_voice_flow/);
  assert.match(recorder, /await\s+ensureVoiceServerReady\(\)[\s\S]*ensureOpenWebSocket\(\)/);
});

test('Electron 不再负责拉起或关闭语音后端进程', async () => {
  const main = await readProjectFile('../main.js');

  assert.doesNotMatch(main, /voiceServerProcess/);
  assert.doesNotMatch(main, /voiceServerStartPromise/);
  assert.doesNotMatch(main, /function ensureVoiceServer/);
  assert.doesNotMatch(main, /function stopVoiceServer/);
  assert.doesNotMatch(main, /spawn\(process\.env\.PYTHON \|\| ['"]python['"], \['main\.py'\]/);
  assert.doesNotMatch(main, /ensureVoiceServer\(\)\.catch/);
  assert.doesNotMatch(main, /stopVoiceServer\(\)/);
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
  assert.match(guard, /toggle-recording/);
  assert.match(voiceTypes, /toVoiceFlowMode/);
  assert.match(voiceTypes, /ask_anything/);
  assert.match(voiceTypes, /translation/);
  assert.match(voiceTypes, /transcript/);
});

test('P0 语音状态模型和 IPC client 已收口', async () => {
  const voiceTypes = await readProjectFile('src/services/voiceTypes.ts');
  const ipc = await readProjectFile('src/services/ipc.ts');
  const viteEnv = await readProjectFile('src/vite-env.d.ts');

  for (const status of ['idle', 'connecting', 'recording', 'stopping', 'transcribing', 'cancelled', 'completed', 'error']) {
    assert.match(voiceTypes, new RegExp(`['"]${status}['"]`));
  }

  for (const errorCode of ['backend_unavailable', 'websocket_timeout', 'microphone_permission_denied', 'paste_failed']) {
    assert.match(voiceTypes, new RegExp(`['"]${errorCode}['"]`));
  }

  assert.match(voiceTypes, /当前转录已取消/);
  assert.match(ipc, /export\s+const\s+ipcClient/);
  assert.match(ipc, /invoke/);
  assert.match(ipc, /on/);
  assert.match(ipc, /send/);
  assert.match(viteEnv, /interface\s+Window/);
  assert.match(viteEnv, /ipcRenderer/);
});

test('P0 recorder 暴露可订阅状态机并支持主动取消', async () => {
  const recorder = await readProjectFile('src/services/recorder.ts');

  assert.match(recorder, /subscribeVoiceSession/);
  assert.match(recorder, /getVoiceSession/);
  assert.match(recorder, /toggleRecording/);
  assert.match(recorder, /cancelRecording/);
  assert.match(recorder, /disposeRecorder/);
  assert.match(recorder, /audio_processing_completed/);
  assert.match(recorder, /audio_id/);
  assert.match(recorder, /activeSessionId/);
  assert.match(recorder, /ignoredAudioIds/);
  assert.doesNotMatch(recorder, /export\s+function\s+getIsRecording/);
});

test('Dashboard 最近结果只展示最终结果，不再展示实时语音状态和中间转写', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');

  assert.match(dashboard, /subscribeVoiceSession/);
  assert.match(dashboard, /status\s*===\s*['"]completed['"]/);
  assert.match(dashboard, /voiceSession\.mode\s*!==\s*['"]Ask['"]/);
  assert.match(dashboard, /refinedText\s*\|\|\s*rawText/);
  assert.match(dashboard, /最近结果/);
  assert.doesNotMatch(dashboard, /getVoiceStatusLabel/);
  assert.doesNotMatch(dashboard, /voiceStatusLabel/);
  assert.doesNotMatch(dashboard, /ContentCopyIcon/);
  assert.doesNotMatch(dashboard, /IconButton/);
  assert.doesNotMatch(dashboard, /clipboard:write-text/);
  assert.doesNotMatch(dashboard, /voiceSession\.rawText\s*\|\|\s*['"]-['"]/);
  assert.doesNotMatch(dashboard, /voiceSession\.status\s*===\s*['"]idle['"]/);
  assert.doesNotMatch(dashboard, /saveVoiceHistory/);
  assert.doesNotMatch(dashboard, /global-keyboard/);
  assert.doesNotMatch(dashboard, /findKeyboardShortcutMode/);
  assert.doesNotMatch(dashboard, /toggleRecording\(/);
  assert.doesNotMatch(dashboard, /setTimeout\(\(\)\s*=>\s*setRecording/);
  assert.doesNotMatch(dashboard, /\(window\s+as\s+any\)\.ipcRenderer/);
});

test('AppShell 接管全局快捷键，允许 Escape 取消未完成会话，并把长按提示交给悬浮条', async () => {
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const guard = await readProjectFile('src/services/shortcutGuard.ts');

  assert.match(appShell, /ipcClient\.on\(['"]global-keyboard['"]/);
  assert.match(appShell, /toggleRecording/);
  assert.match(appShell, /ipcClient\.on\(['"]voice-cancel-requested['"]/);
  assert.match(appShell, /cancelRecording/);
  assert.match(appShell, /getVoiceSession/);
  assert.match(appShell, /getVoiceSession\(\)\.status/);
  assert.match(appShell, /showShortcutHintPanel/);
  assert.match(appShell, /hideFloatingPanel/);
  assert.doesNotMatch(appShell, /ipcClient\.send\(['"]shortcut-hint['"]/);
  assert.doesNotMatch(appShell, /检测到长按快捷键/);
  assert.doesNotMatch(appShell, /handleCloseShortcutHint/);
  assert.match(guard, /LONG_PRESS_MS\s*=\s*500/);
  assert.match(guard, /voiceStatus/);
  assert.match(guard, /isBlocked/);
  assert.match(guard, /modalVisible/);
});

test('P0 快捷键守卫在释放边沿单次触发录音，并在长按时阻断', async () => {
  const guard = await readProjectFile('src/services/shortcutGuard.ts');

  assert.match(guard, /if\s*\(!rightAltDown\)/);
  assert.match(guard, /state\.isRightAltDown\s*&&\s*!state\.isBlocked\s*&&\s*state\.activeIntent/);
  assert.match(guard, /type:\s*['"]toggle-recording['"]/);
  assert.match(guard, /intent:\s*state\.activeIntent/);
  assert.doesNotMatch(guard, /type:\s*['"]start-recording['"]/);
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

test('自由提问录音文案由 voice-state.displayText 覆盖胶囊默认 recording 文案', async () => {
  const voiceTypes = await readProjectFile('src/services/voiceTypes.ts');
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(voiceTypes, /mode:\s*session\.mode/);
  assert.match(voiceTypes, /session\.status\s*===\s*['"]recording['"][\s\S]*session\.mode\s*===\s*['"]Ask['"]/);
  assert.match(voiceTypes, /displayText:\s*['"]请随意提出问题['"]/);
  assert.match(floatingBar, /if\s*\(displayText\)\s*\{[\s\S]*text\.textContent\s*=\s*displayText[\s\S]*return;/);
  assert.match(floatingBar, /if\s*\(status\s*===\s*['"]recording['"]\)\s*\{[\s\S]*text\.textContent\s*=\s*['"]正在监听\.\.\.['"]/);
});

test('P0 长按提示通过通用悬浮面板独立显示在悬浮条位置', async () => {
  const main = await readProjectFile('../main.js');
  const floatingPanel = await readProjectFile('public/floating-panel.html');
  const appShell = await readProjectFile('src/components/AppShell.tsx');

  assert.match(main, /floating-panel/);
  assert.match(main, /sendToFloatingPanel\(['"]floating-panel['"]/);
  assert.match(floatingPanel, /floating-panel/);
  assert.match(floatingPanel, /检测到长按快捷键/);
  assert.match(floatingPanel, /Right Alt/);
  assert.match(appShell, /showShortcutHintPanel/);
  assert.doesNotMatch(appShell, /检测到长按快捷键/);
  assert.doesNotMatch(appShell, /ipcClient\.send\(['"]shortcut-hint['"]/);
});

test('P0 悬浮条提示卡依赖完整视口尺寸，避免定位容器塌陷', async () => {
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(floatingBar, /html,\s*body\s*\{[^}]*height:\s*100%;[^}]*\}/);
  assert.match(floatingBar, /#scene\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*\}/);
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
  assert.match(floatingBar, /width:\s*3\.7px/);
  assert.match(floatingBar, /gap:\s*3\.7px/);
});

test('P0 悬浮条在完成或取消后自动消失，并在错误后保持可见', async () => {
  const main = await readProjectFile('../main.js');
  const floatingBar = await readProjectFile('public/floating-bar.html');
  const voiceTypes = await readProjectFile('src/services/voiceTypes.ts');

  assert.match(main, /function\s+scheduleFloatingBarCompletedHide\(/);
  assert.match(main, /function\s+renderFloatingBarForVoiceState\(/);
  assert.match(main, /isTerminalVoiceState\(payload\)[\s\S]*scheduleFloatingBarCompletedHide\(\)/);
  assert.match(main, /setTimeout\([\s\S]*hideFloatingBar\(\)/);
  assert.doesNotMatch(main, /payload\.status\s*===\s*['"]error['"][\s\S]*hideFloatingBar\(\)/);
  assert.match(floatingBar, /当前转录已取消/);
  assert.match(floatingBar, /displayText/);
  assert.match(voiceTypes, /audio_empty:\s*['"]没有识别到声音['"]/);
  assert.match(voiceTypes, /session\.error\?\.code\s*===\s*['"]audio_empty['"][\s\S]*status:\s*['"]cancelled['"]/);
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

test('P1 历史页面与历史 store 统一走主进程 JSON 数据源', async () => {
  const historyStore = await readProjectFile('src/services/historyStore.ts');
  const historyPage = await readProjectFile('src/pages/History.tsx');
  const main = await readProjectFile('../main.js');

  assert.match(main, /HISTORY_FILE_NAME\s*=\s*['"]history\.json['"]/);
  assert.match(main, /function\s+readHistoryItems\(/);
  assert.match(main, /function\s+writeHistoryItems\(/);
  assert.match(main, /ipcMain\.handle\(['"]db:history-stats['"]/);
  assert.match(historyStore, /db:history-list/);
  assert.match(historyStore, /db:history-upsert/);
  assert.match(historyStore, /db:history-clear/);
  assert.match(historyStore, /db:history-stats/);
  assert.match(historyStore, /saveVoiceHistory/);
  assert.match(historyStore, /clearVoiceHistory/);
  assert.match(historyStore, /loadVoiceStats/);
  assert.doesNotMatch(historyStore, /localStorage/);
  assert.match(historyPage, /listVoiceHistory/);
  assert.match(historyPage, /clearVoiceHistory/);
  assert.match(historyPage, /clipboard:write-text/);
});

test('P1 设置页与设置 store 统一走主进程 JSON 数据源', async () => {
  const settingsStore = await readProjectFile('src/services/settingsStore.ts');
  const settingsPage = await readProjectFile('src/pages/Settings.tsx');
  const main = await readProjectFile('../main.js');

  assert.match(main, /SETTINGS_FILE_NAME\s*=\s*['"]settings\.json['"]/);
  assert.match(main, /function\s+readLocalSettings\(/);
  assert.match(main, /function\s+writeLocalSettings\(/);
  assert.match(main, /ipcMain\.handle\(['"]settings:get['"]/);
  assert.match(main, /ipcMain\.handle\(['"]settings:update['"]/);
  assert.match(settingsStore, /loadSettings/);
  assert.match(settingsStore, /saveSettings/);
  assert.match(settingsStore, /getSelectedAudioDeviceId/);
  assert.match(settingsStore, /getTranslationTargetLanguage/);
  assert.match(settingsStore, /settings:get/);
  assert.match(settingsStore, /settings:update/);
  assert.doesNotMatch(settingsStore, /localStorage/);
  assert.doesNotMatch(settingsStore, /deepseekApiKey/);
  assert.match(main, /DEFAULT_TRANSLATION_TARGET_LANGUAGE\s*=\s*['"]en['"]/);
  assert.match(main, /translationTargetLanguage:\s*DEFAULT_TRANSLATION_TARGET_LANGUAGE/);
  assert.match(settingsPage, /permission:update-auto-launch/);
  assert.match(settingsPage, /navigator\.mediaDevices\.enumerateDevices/);
  assert.match(settingsPage, /selectedAudioDeviceId/);
  assert.match(settingsPage, /preferredLanguage/);
  assert.match(settingsPage, /translationTargetLanguage/);
  assert.match(settingsPage, /MenuItem value="zh-CN"/);
  assert.match(settingsPage, /MenuItem value="en"/);
  assert.match(settingsPage, /翻译目标语言/);
  assert.match(settingsPage, /英文 \(en\)/);
  assert.doesNotMatch(settingsPage, /显示悬浮条/);
  assert.doesNotMatch(settingsPage, /enableSoundEffects/);
  assert.doesNotMatch(settingsPage, /声音效果/);
  assert.match(settingsPage, /版本 0\.1（本地版）/);
  assert.match(settingsPage, /检查更新/);
  assert.doesNotMatch(settingsPage, /disabled>/);
  assert.match(settingsPage, /大模型/);
  assert.match(settingsPage, /DeepSeek API Key/);
  assert.match(settingsPage, /type="password"/);
  assert.match(settingsPage, /placeholder="请输入 DeepSeek API Key"/);
});

test('P1 设置页不再暴露悬浮条开关，语言固定为简体中文', async () => {
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const settingsPage = await readProjectFile('src/pages/Settings.tsx');
  const main = await readProjectFile('../main.js');

  assert.doesNotMatch(main, /ipcMain\.handle\(['"]page:set-floating-bar-enabled['"]/);
  assert.doesNotMatch(main, /showFloatingBar: true/);
  assert.doesNotMatch(settingsPage, /page:set-floating-bar-enabled/);
  assert.doesNotMatch(settingsPage, /显示悬浮条/);
  assert.match(settingsPage, /Select/);
  assert.match(settingsPage, /简体中文 \(zh-CN\)/);
  assert.match(settingsPage, /英文 \(en\)/);
  assert.doesNotMatch(appShell, /page:set-floating-bar-enabled/);
  assert.doesNotMatch(appShell, /loadSettings/);
});

test('P1 首页四项统计来自真实历史统计，不再展示硬编码指标', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  const historyStore = await readProjectFile('src/services/historyStore.ts');

  assert.match(historyStore, /HAND_TYPED_CHARS_PER_MINUTE\s*=\s*60/);
  assert.match(historyStore, /formatDurationMinutes/);
  assert.match(historyStore, /formatAverageSpeed/);
  assert.match(historyStore, /formatSavedMinutes/);
  assert.match(dashboard, /loadVoiceStats/);
  assert.match(dashboard, /stats\.totalDurationMs/);
  assert.match(dashboard, /stats\.totalTextLength/);
  assert.match(dashboard, /stats\.savedMs/);
  assert.match(dashboard, /stats\.averageCharsPerMinute/);
  assert.match(dashboard, /总听写时长/);
  assert.match(dashboard, /累计听写字数/);
  assert.match(dashboard, /节省时间/);
  assert.match(dashboard, /平均速度/);
  assert.match(dashboard, /暂未启用/);
  assert.doesNotMatch(dashboard, /23\.4%/);
  assert.doesNotMatch(dashboard, /conic-gradient\(#44bedf 0% 23\.4%/);
});

test('P1 首页累计统计来自独立 stats 文件，不受最近 200 条历史裁剪影响', async () => {
  const main = await readProjectFile('../main.js');
  const statsStore = await readProjectFile('../history-stats-store.js');

  assert.match(main, /HISTORY_STATS_FILE_NAME\s*=\s*['"]history-stats\.json['"]/);
  assert.match(main, /function\s+readHistoryStats\(/);
  assert.match(main, /function\s+writeHistoryStats\(/);
  assert.match(main, /upsertHistoryItemWithStats/);
  assert.match(main, /ipcMain\.handle\(['"]db:history-stats['"],\s*\(\)\s*=>\s*readHistoryStatsForDashboard\(\)\)/);
  assert.doesNotMatch(main, /ipcMain\.handle\(['"]db:history-stats['"],\s*\(\)\s*=>\s*calculateHistoryStats\(\)\)/);
  assert.match(main, /ipcMain\.handle\(['"]db:history-clear['"],\s*\(\)\s*=>\s*\{[\s\S]*readHistoryStats\(\)[\s\S]*writeHistoryItems\(\[\]\)/);
  assert.match(main, /ipcMain\.handle\(['"]db:history-delete['"],\s*\(_,\s*id\)\s*=>\s*\{[\s\S]*readHistoryStats\(\)[\s\S]*writeHistoryItems\(readHistoryItems\(\)\.filter/);
  assert.match(statsStore, /function\s+updateHistoryStatsForItem\(/);
  assert.match(statsStore, /countedHistoryIds/);
});

test('P1 听写历史保存由全局常驻组件负责，不依赖首页挂载', async () => {
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');

  assert.match(appShell, /subscribeVoiceSession/);
  assert.match(appShell, /saveVoiceHistory/);
  assert.match(appShell, /savedAudioIds/);
  assert.match(appShell, /voiceSession\.status\s*!==\s*['"]completed['"][\s\S]*voiceSession\.status\s*!==\s*['"]error['"]/);
  assert.match(appShell, /id:\s*voiceSession\.audioId/);
  assert.match(appShell, /durationMs:\s*voiceSession\.durationMs/);
  assert.match(appShell, /textLength:\s*voiceSession\.textLength/);
  assert.doesNotMatch(dashboard, /saveVoiceHistory/);
  assert.doesNotMatch(dashboard, /savedAudioIds/);
});

test('P1 录音链路使用设置页选择的真实麦克风设备', async () => {
  const recorder = await readProjectFile('src/services/recorder.ts');

  assert.match(recorder, /getSelectedAudioDeviceId/);
  assert.match(recorder, /getTranslationTargetLanguage/);
  assert.match(recorder, /selectedAudioDeviceId/);
  assert.match(recorder, /output_language/);
  assert.match(recorder, /deviceId:\s*\{\s*exact:\s*selectedAudioDeviceId\s*\}/);
  assert.match(recorder, /recordingStartedAt/);
  assert.match(recorder, /durationMs/);
  assert.match(recorder, /textLength/);
});

test('P1 诊断页与导航配置已从静态展示切到真实服务', async () => {
  const diagnosticsService = await readProjectFile('src/services/diagnostics.ts');
  const diagnosticsPage = await readProjectFile('src/pages/Diagnostics.tsx');
  const navigation = await readProjectFile('src/navigation.ts');
  const uiTokens = await readProjectFile('src/uiTokens.ts');
  const voiceServer = await readProjectFile('src/services/voiceServer.ts');

  assert.match(diagnosticsService, /runDiagnostics/);
  assert.match(diagnosticsService, /probeVoiceServerHealth/);
  assert.match(diagnosticsService, /probeVoiceServerReady/);
  assert.match(diagnosticsService, /VOICE_SERVER_HEALTH_URL/);
  assert.match(diagnosticsService, /VOICE_SERVER_READY_URL/);
  assert.match(voiceServer, /http:\/\/127\.0\.0\.1:8000/);
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
