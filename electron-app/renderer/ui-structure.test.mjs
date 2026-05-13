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

test('Electron 悬浮条默认隐藏并在快捷键活动时显示', async () => {
  const main = await readProjectFile('../main.js');

  assert.match(main, /function\s+showFloatingBar\(/);
  assert.match(main, /function\s+hideFloatingBar\(/);
  assert.match(main, /show:\s*false/);
  assert.match(main, /setIgnoreMouseEvents\(\s*true/);
  assert.match(main, /setIgnoreMouseEvents\(\s*false/);
  assert.match(main, /floatingBar\.show\(\)/);
  assert.match(main, /floatingBar\.hide\(\)/);
  assert.match(main, /function\s+updateFloatingBarVisibility\(keys\)[\s\S]*keys\.some[\s\S]*isKeydown[\s\S]*showFloatingBar/);
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
  assert.match(main, /startRightAltListener/);
  assert.match(main, /spawn\(/);
  assert.match(main, /right-alt-listener\.ps1/);
  assert.match(listener, /VK_RMENU\s*=\s*165/);
  assert.match(listener, /VK_RSHIFT\s*=\s*161/);
  assert.doesNotMatch(main, /globalShortcut\.register\(['"]Alt\+Shift['"]/);
  assert.match(main, /keyName:\s*['"]RightAlt['"]/);
  assert.match(main, /enKeyName:\s*['"]RightAlt['"]/);
  assert.match(main, /keyCode:\s*165/);
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
  const recorder = await readProjectFile('src/services/recorder.ts');

  assert.match(dashboard, /findKeyboardShortcutMode/);
  assert.match(dashboard, /keyName\s*===\s*['"]RightAlt['"]/);
  assert.match(dashboard, /keyName\s*===\s*['"]Space['"]/);
  assert.match(dashboard, /keyName\s*===\s*['"]RightShift['"]/);
  assert.match(dashboard, /rightAlt[\s\S]*isKeydown/);
  assert.match(recorder, /toVoiceFlowMode/);
  assert.match(recorder, /ask_anything/);
  assert.match(recorder, /translation/);
  assert.match(recorder, /transcript/);
});
