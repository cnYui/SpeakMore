import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const readProjectFile = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), 'utf8');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const readProjectFiles = async (relativePaths) => {
  const contents = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const content = await readProjectFile(relativePath);
      return `\n/* ${relativePath} */\n${content}`;
    }),
  );

  return contents.join('\n');
};
const readMainProcessSurface = () => readProjectFiles([
  '../main.js',
  '../app-paths.js',
  '../audio-ipc.js',
  '../audio-session-service.js',
  '../clipboard-user-ipc.js',
  '../compat-ipc.js',
  '../dictionary-ipc.js',
  '../dictionary-repository.js',
  '../file-ipc.js',
  '../floating-window-controller.js',
  '../focused-context-ipc.js',
  '../history-ipc.js',
  '../history-repository.js',
  '../keyboard-ipc.js',
  '../local-compat-state.js',
  '../main-ipc-registry.js',
  '../page-ipc.js',
  '../permission-ipc.js',
  '../right-alt-relay.js',
  '../right-alt-listener-service.js',
  '../shortcut-command-store.js',
  '../shortcut-command-repository.js',
  '../shortcut-command-registrar.js',
  '../shortcut-command-ipc.js',
  '../meeting-note-store.js',
  '../meeting-note-repository.js',
  '../meeting-note-ipc.js',
  '../voice-diagnostics-repository.js',
  '../voice-diagnostics-ipc.js',
  '../meeting-detector.js',
  '../settings-ipc.js',
  '../settings-store.js',
  '../text-observer-service.js',
  '../backend-http-utils.js',
  '../voice-backend-urls.js',
  '../voice-backend-client.js',
  '../voice-model-ipc.js',
  '../translation-model-ipc.js',
  '../voice-config-client.js',
  '../voice-flow-form-data.js',
  '../window-manager.js',
  '../window-manager-options.js',
]);
const readPreloadSurface = () => readProjectFiles([
  '../preload.js',
  '../preload-ipc-bridge.js',
  '../preload-mobile-surface-filter.js',
]);

test('Electron 主窗口加载本地 renderer 构建产物', async () => {
  const main = await readMainProcessSurface();

  assert.match(main, /renderer[\s\S]*dist[\s\S]*index\.html/);
  assert.doesNotMatch(main, /loadExtractedPage\(mainWindow,\s*['"]hub\.html['"]\)/);
  assert.match(main, /width:\s*1080/);
  assert.match(main, /height:\s*750/);
  assert.match(main, /minWidth:\s*988/);
});

test('Electron 关闭主窗口时隐藏到后台并保留语音识别链路', async () => {
  const main = await readMainProcessSurface();

  assert.match(main, /let\s+appIsQuitting\s*=\s*false/);
  assert.match(main, /if\s*\(mainWindow\s*&&\s*!mainWindow\.isDestroyed\(\)\)[\s\S]*mainWindow\.show\(\)[\s\S]*mainWindow\.focus\(\)/);
  assert.match(main, /mainWindow\.on\(['"]close['"],\s*\(event\)\s*=>\s*\{[\s\S]*if\s*\(getAppIsQuitting\(\)\)\s*return[\s\S]*event\.preventDefault\(\)[\s\S]*mainWindow\.hide\(\)/);
  assert.match(main, /backgroundThrottling:\s*false/);
  assert.match(main, /app\.on\(['"]before-quit['"],\s*\(event\)\s*=>\s*\{[\s\S]*appIsQuitting\s*=\s*true/);
});

test('Electron 悬浮条加载本地 renderer 构建产物', async () => {
  const main = await readMainProcessSurface();
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(main, /renderer[\s\S]*dist[\s\S]*floating-bar\.html/);
  assert.doesNotMatch(main, /loadExtractedPage\(floatingBar,\s*['"]floating-bar\.html['"]\)/);
  assert.match(main, /const\s+FLOATING_BAR_SIZE\s*=\s*\{\s*width:\s*220,\s*height:\s*224\s*\}/);
  assert.match(main, /const\s+FLOATING_WINDOW_BOTTOM_GAP\s*=\s*32/);
  assert.match(main, /resolveFloatingBarBounds/);
  assert.doesNotMatch(main, /defaultFloatingBarX\s*=\s*660/);
  assert.doesNotMatch(main, /defaultFloatingBarY\s*=\s*739/);
  assert.match(main, /function\s+handleFloatingBarUpdatePositions\(payload\s*=\s*\[\]\)/);
  assert.match(main, /floatingBar\.setIgnoreMouseEvents\(true,\s*\{\s*forward:\s*true\s*\}\)/);
  assert.match(floatingBar, /src=["']\.\/lib\/three\.min\.js["']/);
  assert.match(floatingBar, /id=["']particle-sphere-container["']/);
  assert.match(floatingBar, /id=["']particle-canvas["']/);
  assert.match(floatingBar, /id=["']hint-text["']/);
  assert.match(floatingBar, /class\s+ParticleSphere/);
  assert.match(floatingBar, /particleCount\s*=\s*800/);
  assert.match(floatingBar, /LONG_PROCESSING_TEXT\s*=\s*['"]正在努力处理中\.\.\.['"]/);
  assert.match(floatingBar, /LONG_PROCESSING_DELAY_MS\s*=\s*3000/);
  assert.match(floatingBar, /setRecording\(isRecording/);
  assert.match(floatingBar, /setProcessing\(isProcessing/);
  assert.match(floatingBar, /#particle-sphere-container\s*\{[^}]*width:\s*120px;[^}]*height:\s*120px/);
  assert.doesNotMatch(floatingBar, /id=["']bar["']/);
  assert.doesNotMatch(floatingBar, /id=["']levels["']/);
  assert.doesNotMatch(floatingBar, /-webkit-app-region:\s*drag/);
  assert.doesNotMatch(floatingBar, /检测到长按快捷键/);
  assert.doesNotMatch(floatingBar, /shortcut-hint/);
  assert.doesNotMatch(floatingBar, /@keyframes\s+level/);
  assert.doesNotMatch(floatingBar, /#particle-sphere-container::before/);
  assert.doesNotMatch(floatingBar, /#particle-sphere-container::after/);
  assert.doesNotMatch(floatingBar, /borderRadius\s*=\s*['"]50%['"]/);
  assert.doesNotMatch(floatingBar, /border\s*=\s*['"][^'"]*rgba\(255,255,255,0\.12\)/);
  assert.doesNotMatch(floatingBar, /listening-ring/);
  assert.doesNotMatch(floatingBar, /processing-ring/);
});

test('悬浮面板复用长按提示框位置，并支持快捷键提示和自由提问结果两种模式', async () => {
  const main = await readMainProcessSurface();
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
  assert.match(main, /payload\.type\s*\|\|\s*['"]shortcut-hint['"]/);
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
  assert.match(floatingPanel, /id=["']copy-result["']/);
  assert.match(floatingPanel, /aria-label=["']复制结果["']/);
  assert.match(floatingPanel, /clipboard:write-text/);
  assert.match(floatingPanel, /class=["']copy-icon["']/);
  assert.doesNotMatch(floatingPanel, /原选区已失效/);
  assert.doesNotMatch(floatingPanel, /-webkit-app-region:\s*drag/);
});

test('悬浮结果面板复制成功后自动关闭', async () => {
  const floatingPanel = await readProjectFile('public/floating-panel.html');
  const script = floatingPanel.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);

  const createElement = () => ({
    classList: {
      add() {},
      remove() {},
    },
    disabled: false,
    textContent: '',
    listeners: {},
    addEventListener(eventName, listener) {
      this.listeners[eventName] = listener;
    },
  });
  const elements = {
    'shortcut-view': createElement(),
    'result-view': createElement(),
    'result-text': createElement(),
    'copy-result': createElement(),
  };
  const dismissButtons = [createElement(), createElement()];
  const sentMessages = [];
  const clipboardWrites = [];
  let panelListener = null;

  runInNewContext(script, {
    window: {
      ipcRenderer: {
        send(channel, payload) {
          sentMessages.push({ channel, payload });
        },
        invoke(channel, text) {
          clipboardWrites.push({ channel, text });
          return Promise.resolve({ success: true });
        },
        on(channel, listener) {
          if (channel === 'floating-panel') panelListener = listener;
        },
      },
    },
    document: {
      getElementById(id) {
        return elements[id];
      },
      querySelectorAll(selector) {
        return selector === '.dismiss' ? dismissButtons : [];
      },
    },
    navigator: {},
    Promise,
    Array,
  }, { filename: 'floating-panel.html' });

  assert.equal(typeof panelListener, 'function');
  panelListener(null, { visible: true, type: 'free-ask-result', text: '复制内容' });

  assert.deepEqual(sentMessages, []);

  await elements['copy-result'].listeners.click();
  await Promise.resolve();

  assert.deepEqual(clipboardWrites, [
    { channel: 'clipboard:write-text', text: '复制内容' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(sentMessages)), [
    { channel: 'floating-panel', payload: { visible: false } },
  ]);
});

test('P0 长按提示低于语音状态优先级', async () => {
  const main = await readMainProcessSurface();
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
  assert.match(main, /if\s*\(floatingPanelVisible\s*&&\s*isActiveVoiceState\(payload\)\)\s*markFloatingPanelHidden\(\)/);
  assert.doesNotMatch(main, /ipcMain\.on\(['"]voice-state['"][\s\S]*if\s*\(floatingPanelVisible\)\s*\{[\s\S]*hideFloatingBar\(\)[\s\S]*return/);
});

test('P0 悬浮窗口不再记录拖动坐标', async () => {
  const main = await readMainProcessSurface();

  assert.doesNotMatch(main, /FLOATING_BAR_POSITION_FILE_NAME/);
  assert.doesNotMatch(main, /SHORTCUT_HINT_POSITION_FILE_NAME/);
  assert.doesNotMatch(main, /writeFloatingBarPositionSnapshot/);
  assert.doesNotMatch(main, /writeShortcutHintPositionSnapshot/);
  assert.doesNotMatch(main, /\.on\(['"]move['"]/);
  assert.doesNotMatch(main, /\.on\(['"]moved['"]/);
});

test('P1 悬浮窗口基于 workArea 动态定位并限制在屏幕内', async () => {
  const main = await readMainProcessSurface();
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
  const main = await readMainProcessSurface();

  assert.match(main, /function\s+showFloatingBar\(/);
  assert.match(main, /function\s+hideFloatingBar\(/);
  assert.match(main, /show:\s*false/);
  assert.match(main, /setIgnoreMouseEvents\(\s*true/);
  assert.match(main, /setIgnoreMouseEvents\(\s*false/);
  assert.match(main, /function\s+showWindowWithoutActivation\(/);
  assert.match(main, /showWindowWithoutActivation\(floatingBar\)/);
  assert.match(main, /floatingBar\.hide\(\)/);
  assert.match(main, /function\s+updateFloatingBarVisibility\(keys\)[\s\S]*keys\.some[\s\S]*isKeydown[\s\S]*showFloatingBar/);
  assert.doesNotMatch(main, /function\s+updateFloatingBarVisibility\(keys\)[\s\S]*else\s+hideFloatingBar\(\)/);
  assert.match(main, /function\s+emitKeyboardState\(keys\)[\s\S]*updateFloatingBarVisibility\(keys\)/);
});

test('preload 暴露真实 bundle 依赖的 ipcRenderer 接口', async () => {
  const preload = await readPreloadSurface();

  assert.match(preload, /exposeInMainWorld\(['"]ipcRenderer['"]/);
  for (const api of ['on', 'off', 'send', 'invoke', 'addKeyListener', 'removeKeyListener', 'platform']) {
    assert.match(preload, new RegExp(`${api}\\s*[:(]`));
  }
});

test('主进程注册真实 bundle 首屏所需的 IPC shim', async () => {
  const main = await readMainProcessSurface();
  const channels = [
    'user:get-current',
    'user:login',
    'user:logout',
    'db:history-get',
    'db:history-latest',
    'db:history-list',
    'db:history-delete',
    'db:history-save-audio',
    'db:history-retry',
    'i18n:reset-to-system-language',
    'permission:request',
    'updater:check-for-update',
    'page:open-url',
    'page:floating-bar-update-positions',
    'page:floating-windows-bring-to-front',
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
    'shortcut-command:list',
    'shortcut-command:upsert',
    'shortcut-command:delete',
    'shortcut-command:registration-status',
    'meeting-note:list',
    'meeting-note:get',
    'meeting-note:upsert',
    'meeting-note:delete',
    'voice-diagnostics:list',
    'voice-diagnostics:save',
    'voice-diagnostics:clear',
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

test('旧模型管理能力已删除，语音模型初始化并入设置页', async () => {
  const main = await readMainProcessSurface();
  const navigation = await readProjectFile('src/navigation.ts');
  const sidebar = await readProjectFile('src/components/Sidebar.tsx');
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const settingsPage = await readProjectFile('src/pages/Settings.tsx');
  const voiceModelSection = await readProjectFile('src/pages/settings/VoiceModelSettingsSection.tsx');
  const translationModelSection = await readProjectFile('src/pages/settings/TranslationModelSettingsSection.tsx');
  const translationModelStore = await readProjectFile('src/services/translationModelStore.ts');
  const i18n = await readProjectFile('src/i18n.tsx');

  await assert.rejects(
    () => readProjectFile('src/pages/Models.tsx'),
    /ENOENT/,
  );
  await assert.rejects(
    () => readProjectFile('src/pages/models/useModelsPageState.ts'),
    /ENOENT/,
  );
  await assert.rejects(
    () => readProjectFile('src/pages/models/ModelCard.tsx'),
    /ENOENT/,
  );
  await assert.rejects(
    () => readProjectFile('src/services/modelStore.ts'),
    /ENOENT/,
  );
  await assert.rejects(
    () => readProjectFile('src/pages/Setup.tsx'),
    /ENOENT/,
  );

  assert.doesNotMatch(navigation, /'models'/);
  assert.doesNotMatch(sidebar, /MemoryIcon|StorageIcon|HubIcon/);
  assert.doesNotMatch(appShell, /Models/);
  assert.doesNotMatch(main, /ipcMain\.handle\(['"]model:/);
  assert.doesNotMatch(main, /modelsUrl:/);
  assert.doesNotMatch(main, /callModelBackend/);
  assert.doesNotMatch(main, /snapshot_download/);
  assert.doesNotMatch(navigation, /'setup'|nav\.setup/);
  assert.doesNotMatch(appShell, /<Setup|pages\/Setup/);
  assert.match(appShell, /useState<Page>\(['"]home['"]\)/);
  assert.match(settingsPage, /VoiceModelSettingsSection/);
  assert.match(settingsPage, /TranslationModelSettingsSection/);
  assert.match(voiceModelSection, /getVoiceModelStatus/);
  assert.match(voiceModelSection, /startVoiceModelDownload/);
  assert.match(voiceModelSection, /chooseModelCacheDirectory/);
  assert.match(translationModelSection, /getTranslationModelStatus/);
  assert.match(translationModelSection, /startTranslationModelDownload/);
  assert.match(translationModelSection, /loadTranslationModel/);
  assert.match(translationModelSection, /chooseModelCacheDirectory/);
  assert.match(translationModelSection, /Hy-MT2/);
  assert.match(translationModelSection, /downloadInterruptedDetail/);
  assert.match(translationModelSection, /translation_model_download_failed/);
  assert.doesNotMatch(translationModelSection, /runtimeMode|runtimeProfile|fallbackReason/);
  assert.doesNotMatch(translationModelSection, /AngelSlim|Hy-MT1\.5/);
  assert.doesNotMatch(translationModelSection, /unloadTranslationModel/);
  assert.doesNotMatch(translationModelSection, /translationEnginePreference|localTranslationModelEnabled/);
  assert.match(i18n, /settings\.translationModel\.downloadInterruptedDetail/);
  assert.match(i18n, /settings\.translationModel\.downloadFailedDetail/);
  assert.doesNotMatch(i18n, /settings\.translationModel\.(runtimeMode|runtimeProfile|fallbackReason|readyDetail)/);
  assert.match(translationModelStore, /translation-model:get-status/);
  assert.match(translationModelStore, /translation-model:start-download/);
  assert.match(translationModelStore, /translation-model:load/);
  assert.match(translationModelStore, /translation-model:unload/);
});

test('项目根启动脚本指向本地 Electron 壳而不是逆向资料目录', async () => {
  const rootPackage = JSON.parse(await readProjectFile('../../package.json'));
  const startElectronDev = await readProjectFile('../../scripts/start-electron-dev.mjs');

  assert.equal(rootPackage.scripts.start, 'node scripts/start-electron-dev.mjs');
  assert.equal(rootPackage.scripts['start:electron'], 'node scripts/start-electron-dev.mjs');
  assert.match(startElectronDev, /\['\.\/electron-app'\]/);
  assert.doesNotMatch(startElectronDev, /app-extracted|reverse/i);
});

test('本地壳默认使用简体中文并从共享元数据接受截图界面语言', async () => {
  const main = await readMainProcessSurface();
  const interfaceLanguages = JSON.parse(await readProjectFile('../../shared/interface-languages.json'));

  assert.match(main, /DEFAULT_LANGUAGE\s*=\s*['"]zh-CN['"]/);
  assert.match(main, /preferredLanguage:\s*DEFAULT_LANGUAGE/);
  assert.match(main, /interface-languages\.json/);
  assert.match(main, /SUPPORTED_INTERFACE_LANGUAGES/);
  assert.match(main, /INTERFACE_LANGUAGES\.map\(\(language\)\s*=>\s*language\.id\)/);
  assert.deepEqual(
    interfaceLanguages.map((language) => language.id),
    [
      'en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'es-ES', 'pt-BR',
      'fr-FR', 'de-DE', 'it-IT', 'ru-RU', 'ar-SA', 'he-IL', 'hi-IN',
      'id-ID', 'ms-MY', 'nl-NL', 'pl-PL', 'th-TH',
    ],
  );
  assert.doesNotMatch(main, /preferredLanguage:\s*['"]en['"]/);
  assert.doesNotMatch(main, /language\s*\|\|\s*['"]en['"]/);
});

test('主窗口页面和侧边栏通过轻量 i18n 切换多语言', async () => {
  const i18n = await readProjectFile('src/i18n.tsx');
  const interfaceLanguages = JSON.parse(await readProjectFile('../../shared/interface-languages.json'));
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const sidebar = await readProjectFile('src/components/Sidebar.tsx');
  const dashboardPage = await readProjectFile('src/pages/Dashboard.tsx');
  const shortcutsPage = await readProjectFile('src/pages/Shortcuts.tsx');
  const shortcutSettingsSection = await readProjectFile('src/pages/settings/ShortcutSettingsSection.tsx');
  const shortcutBindingDialog = await readProjectFile('src/components/ShortcutBindingDialog.tsx');
  const voiceShortcutHook = await readProjectFile('src/components/useVoiceShortcutDisplay.ts');
  const globalShortcutBridge = await readProjectFile('src/components/useGlobalShortcutBridge.ts');
  const pages = await readProjectFiles([
    'src/pages/Dashboard.tsx',
    'src/pages/dashboard/HistoryResultsPanel.tsx',
    'src/pages/Dictionary.tsx',
    'src/pages/Shortcuts.tsx',
    'src/pages/MeetingNotes.tsx',
    'src/pages/Settings.tsx',
  ]);

  assert.match(i18n, /zh-CN/);
  assert.match(i18n, /en-US/);
  for (const language of interfaceLanguages) {
    assert.match(i18n, new RegExp(`['"]${escapeRegExp(language.id)}['"]`));
    assert.match(i18n, new RegExp(escapeRegExp(language.labelKey)));
  }
  assert.match(i18n, /baseTranslations/);
  assert.match(i18n, /withBase/);
  assert.match(i18n, /export\s+function\s+I18nProvider/);
  assert.match(i18n, /export\s+function\s+useI18n/);
  assert.doesNotMatch(i18n, /nav\.setup|setup\./);
  assert.match(i18n, /Dashboard/);
  assert.match(i18n, /History/);
  assert.match(i18n, /Dictionary/);
  assert.match(i18n, /Shortcuts/);
  assert.match(i18n, /Meeting Notes/);
  assert.match(i18n, /Settings/);
  assert.match(i18n, /settings\.voiceModel\.title/);
  assert.match(i18n, /Voice model/);
  assert.match(i18n, /互联网黑话/);
  assert.match(i18n, /Internet Jargon/);
  assert.doesNotMatch(i18n, /互联网黑化/);
  assert.match(i18n, /英文翻译快捷指令/);
  assert.match(i18n, /绑定翻译快捷键/);
  assert.doesNotMatch(i18n, /内置语音翻译/);
  assert.match(i18n, /English Translation Command/);
  assert.doesNotMatch(i18n, /shortcuts\.command\.translate_to_english\.name['"]:\s*['"]翻译成英文['"]/);
  assert.match(shortcutsPage, /AutoFixHighIcon/);
  assert.match(shortcutsPage, /BubbleChartIcon/);
  assert.match(shortcutsPage, /TagIcon/);
  assert.match(shortcutsPage, /translate_to_english:\s*['"]English Translation Command['"]/);
  assert.match(shortcutsPage, /translate_to_english:\s*\[['"]Translate to English['"]\]/);
  assert.doesNotMatch(shortcutsPage, /professional_polish:\s*<KeyboardIcon/);
  assert.doesNotMatch(shortcutsPage, /abstract_mode:\s*<KeyboardIcon/);
  assert.doesNotMatch(shortcutsPage, /internet_dark:\s*<KeyboardIcon/);
  assert.match(shortcutsPage, /ShortcutBindingDialog/);
  assert.match(shortcutBindingDialog, /export\s+function\s+ShortcutBindingDialog/);
  assert.match(shortcutBindingDialog, /export\s+function\s+ShortcutDisplayButtons/);
  assert.match(shortcutBindingDialog, /export\s+function\s+shortcutFromKeyboardEvent/);
  assert.match(shortcutBindingDialog, /recordShortcutTitle/);
  assert.match(shortcutBindingDialog, /recordShortcutPlaceholder/);
  assert.match(shortcutBindingDialog, /AltRight[\s\S]*Right Alt/);
  assert.match(voiceShortcutHook, /listShortcutCommands/);
  assert.match(voiceShortcutHook, /subscribeShortcutCommandChanges/);
  assert.match(voiceShortcutHook, /export\s+function\s+useVoiceShortcutDisplay/);
  assert.match(voiceShortcutHook, /smartAssistantDisplay:\s*`\$\{voiceShortcutDisplay\} x 2`/);
  assert.match(voiceShortcutHook, /TRANSLATE_TO_ENGLISH_COMMAND_ID\s*=\s*['"]translate_to_english['"]/);
  assert.match(voiceShortcutHook, /translateCommand\s*=\s*findCommand/);
  assert.match(voiceShortcutHook, /translateShortcutDisplay:\s*shortcutDisplay\(translateCommand,\s*['"]Tab['"]\)/);
  assert.doesNotMatch(voiceShortcutHook, /fixedTranslateShortcutDisplay|Right Alt \+ Right Shift|Option \+ Shift/);
  assert.doesNotMatch(dashboardPage, /shortcutLabels|getShortcutLabelSet/);
  assert.match(dashboardPage, /useVoiceShortcutDisplay/);
  assert.match(dashboardPage, /ShortcutDisplayButtons/);
  assert.match(dashboardPage, /ShortcutBindingDialog/);
  assert.match(dashboardPage, /dashboard\.shortcut\.hold/);
  assert.match(dashboardPage, /dashboard\.shortcut\.doubleTap/);
  assert.doesNotMatch(shortcutSettingsSection, /shortcutLabels|getShortcutLabelSet/);
  assert.match(shortcutSettingsSection, /useVoiceShortcutDisplay/);
  assert.match(shortcutSettingsSection, /ShortcutDisplayButtons/);
  assert.match(shortcutSettingsSection, /ShortcutBindingDialog/);
  assert.match(shortcutSettingsSection, /settings\.shortcut\.voicePrefix/);
  assert.match(shortcutSettingsSection, /settings\.shortcut\.smartPrefix/);
  assert.match(shortcutSettingsSection, /settings\.shortcut\.translateSuffix/);
  assert.match(shortcutSettingsSection, /openTranslateShortcutBinding/);
  assert.match(shortcutSettingsSection, /settings\.shortcut\.bindTranslate/);
  assert.match(shortcutsPage, /const\s+canRecordShortcut\s*=\s*command\.id\s*===\s*['"]voice_input['"]\s*\|\|\s*!command\.shortcut\?\.fixed/);
  assert.match(shortcutsPage, /const\s+canEditCommand\s*=\s*command\.kind\s*===\s*['"]custom['"]/);
  assert.match(shortcutsPage, /voiceInputEnabled/);
  assert.match(shortcutsPage, /command\.id\s*===\s*['"]smart_assistant['"]\s*&&\s*!voiceInputEnabled/);
  assert.match(globalShortcutBridge, /RIGHT_ALT_DOUBLE_TAP_MS\s*=\s*280/);
  assert.match(globalShortcutBridge, /pendingDictateTimerRef/);
  assert.match(globalShortcutBridge, /isVoiceInputHandledByRightAlt/);
  assert.match(globalShortcutBridge, /command\.id\s*===\s*['"]voice_input['"][\s\S]*triggerShortcutIntent\(['"]DictateShortcut['"]\)/);
  assert.match(globalShortcutBridge, /command\.id\s*===\s*['"]smart_assistant['"][\s\S]*triggerShortcutIntent\(['"]AskShortcut['"]\)/);
  assert.match(globalShortcutBridge, /isSmartAssistantAvailable/);
  assert.match(globalShortcutBridge, /isCommandEnabled\(['"]voice_input['"]\)\s*&&\s*isCommandEnabled\(['"]smart_assistant['"]\)/);
  assert.match(globalShortcutBridge, /isSmartAssistantAvailable\(\)[\s\S]*toggleRecordingByShortcut\(['"]AskShortcut['"]\)/);
  assert.match(globalShortcutBridge, /isCommandEnabled\(['"]voice_input['"]\)[\s\S]*toggleRecordingByShortcut\(['"]DictateShortcut['"]\)/);
  assert.match(appShell, /I18nProvider/);
  assert.match(appShell, /loadSettings/);
  assert.match(appShell, /setLanguage/);
  assert.match(sidebar, /useI18n/);
  assert.match(pages, /useI18n/);
});

test('preload 会移除移动应用下载入口和二维码弹窗', async () => {
  const preload = await readPreloadSurface();

  assert.match(preload, /removeMobileAppSurfaces/);
  assert.match(preload, /MutationObserver/);
  assert.match(preload, /获取移动应用/);
  assert.match(preload, /获取Typeless移动应用/);
  assert.match(preload, /Google Play/);
  assert.match(preload, /App Store/);
});

test('Right Alt 通过 Windows 低级键盘监听器转发真实 bundle 需要的 global-keyboard 事件', async () => {
  const main = await readMainProcessSurface();
  const listener = await readProjectFile('../right-alt-listener.ps1');

  assert.doesNotMatch(main, /globalShortcut\.register\(['"]Alt['"]/);
  assert.doesNotMatch(main, /globalShortcut\.register\(['"]Alt\+Space['"]/);
  assert.match(main, /startRightAltListener/);
  assert.match(main, /spawnProcess\(/);
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
  const main = await readMainProcessSurface();
  const guard = await readProjectFile('src/services/shortcutGuard.ts');

  assert.match(main, /sendToMain\(['"]global-keyboard['"],\s*keys\)/);
  assert.doesNotMatch(main, /sendToFloatingBar\(['"]global-keyboard['"]/);
  assert.doesNotMatch(guard, /function\s+closeShortcutHint/);
  assert.doesNotMatch(guard, /export\s+function\s+closeShortcutHint/);
});

test('全局 Escape 通过 Windows 低级键盘监听器转发取消事件', async () => {
  const main = await readMainProcessSurface();
  const listener = await readProjectFile('../right-alt-listener.ps1');
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const shortcutBridge = await readProjectFile('src/components/useGlobalShortcutBridge.ts');

  assert.match(listener, /VK_ESCAPE\s*=\s*27/);
  assert.match(main, /payload\.key\s*===\s*['"]Escape['"]/);
  assert.match(main, /sendToMain\(['"]voice-cancel-requested['"]/);
  assert.match(appShell, /useGlobalShortcutBridge/);
  assert.match(shortcutBridge, /ipcClient\.on\(['"]voice-cancel-requested['"]/);
  assert.match(shortcutBridge, /cancelRecording/);
});

test('Right Alt 主进程转发链路不再依赖 90ms 延迟聚合', async () => {
  const main = await readMainProcessSurface();
  const relay = await readProjectFile('../right-alt-relay.js');

  assert.match(main, /createRightAltRelay/);
  assert.doesNotMatch(main, /scheduleActiveKeyboardStateEmit/);
  assert.doesNotMatch(main, /keyboardStateEmitTimer/);
  assert.doesNotMatch(main, /setTimeout\(emitActiveKeyboardState,\s*90\)/);
  assert.match(relay, /emit\(Array\.from\(keyboardStateByName\.values\(\)\)\)/);
});

test('语音输入 IPC 会调用本地后端并把结果粘贴到焦点应用', async () => {
  const main = await readMainProcessSurface();

  assert.match(main, /VOICE_SERVER_URL\s*=\s*['"]http:\/\/127\.0\.0\.1:8000['"]/);
  assert.match(main, /checkVoiceServerReady/);
  assert.match(main, /\/ready/);
  assert.match(main, /\/ai\/voice_flow/);
  assert.match(main, /FormData/);
  assert.match(main, /fetchImpl\(/);
  assert.doesNotMatch(main, /audio:ai-voice-flow['"],\s*\(\)\s*=>\s*\(\{\s*success:\s*false[\s\S]*not_implemented/);
  assert.match(main, /keyboard:type-transcript/);
  assert.match(main, /clipboard\.writeText\(pastedText\)/);
  assert.match(main, /macosPlatformCapabilities\.pasteText/);
  assert.match(main, /System\.Windows\.Forms\.SendKeys/);
});

test('自动粘贴子进程非零退出码不会被当作粘贴成功', async () => {
  const main = await readMainProcessSurface();

  assert.match(main, /ps\.on\(['"]exit['"],\s*\(code,\s*signal\)\s*=>[\s\S]*resolve\(code\s*===\s*0\)/);
});

test('audio:ai-voice-flow 会补齐逆向请求字段并保留关键返回字段', async () => {
  const main = await readMainProcessSurface();

  assert.match(main, /formData\.append\(['"]user_over_time['"]/);
  assert.match(main, /detail:/);
  assert.match(main, /code:/);
  assert.match(main, /paywall:/);
  assert.match(main, /web_metadata/);
  assert.match(main, /external_action/);
});

test('主进程具备后台音频会话静音脚本入口和新 IPC', async () => {
  const main = await readMainProcessSurface();

  assert.match(main, /audio-session-control\.ps1/);
  assert.match(main, /audio:mute-background-sessions/);
  assert.match(main, /audio:restore-background-sessions/);
  assert.match(main, /backgroundMuteActive/);
  assert.match(main, /mutedBackgroundSessions/);
});

test('recorder 在录音生命周期内请求静音和恢复后台音频', async () => {
  const recorder = await readProjectFile('src/services/recorder.ts');
  const backgroundAudio = await readProjectFile('src/services/voice/backgroundAudio.ts');

  assert.match(recorder, /from ['"]\.\/voice\/backgroundAudio['"]/);
  assert.match(backgroundAudio, /ipcClient\.invoke\(['"]audio:mute-background-sessions['"]/);
  assert.match(backgroundAudio, /ipcClient\.invoke\(['"]audio:restore-background-sessions['"]/);
  assert.match(recorder, /completeSession[\s\S]*restoreBackgroundAudio/);
  assert.match(recorder, /failSession[\s\S]*restoreBackgroundAudio/);
  assert.match(recorder, /disposeRecorder[\s\S]*restoreBackgroundAudio/);
});

test('recorder 在录音期间分析真实麦克风音量并同步 inputLevel', async () => {
  const recorder = await readProjectFile('src/services/recorder.ts');
  const recordingTransportRuntime = await readProjectFile('src/services/voice/recordingTransportRuntime.ts');
  const audioLevelMonitor = await readProjectFile('src/services/voice/audioLevelMonitor.ts');

  assert.match(recorder, /from ['"]\.\/voice\/recordingTransportRuntime['"]/);
  assert.match(recorder, /transportRuntime\.attach\(prepared,\s*updateSessionInputLevel/);
  assert.match(recordingTransportRuntime, /from ['"]\.\/audioLevelMonitor['"]/);
  assert.match(recordingTransportRuntime, /startAudioLevelMonitoring\(stream,\s*onInputLevel\)/);
  assert.match(audioLevelMonitor, /AudioContext/);
  assert.match(audioLevelMonitor, /AnalyserNode/);
  assert.match(audioLevelMonitor, /setInterval\(tick,\s*50\)/);
  assert.match(recordingTransportRuntime, /resetInputLevel/);
  assert.match(recordingTransportRuntime, /cleanupAudioLevelMonitoring/);
  assert.match(audioLevelMonitor, /clearInterval/);
  assert.match(audioLevelMonitor, /audioContext\.close/);
});

test('WebSocket 录音入口会等待主进程确保语音后端 ready', async () => {
  const main = await readMainProcessSurface();
  const recorder = await readProjectFile('src/services/recorder.ts');
  const recordingStartup = await readProjectFile('src/services/voice/recordingStartup.ts');
  const voiceSocket = await readProjectFile('src/services/voice/voiceSocket.ts');
  const voiceServer = await readProjectFile('src/services/voice/voiceServer.ts');
  const recorderSurface = `${recorder}\n${recordingStartup}\n${voiceSocket}`;

  assert.match(main, /ipcMain\.handle\(['"]audio:check-voice-server-ready['"]/);
  assert.match(main, /ensureVoiceServer\s*=\s*checkVoiceServerReady/);
  assert.match(main, /audio:ensure-voice-server['"][\s\S]*ensureVoiceServer/);
  assert.match(recordingStartup, /ipcClient\.invoke\(['"]audio:ensure-voice-server['"]/);
  assert.match(voiceSocket, /from ['"]\.\/voiceServer['"]/);
  assert.match(voiceServer, /VOICE_SERVER_HTTP_BASE_URL/);
  assert.match(voiceServer, /VOICE_SERVER_WS_URL/);
  assert.doesNotMatch(recorderSurface, /ws:\/\/localhost:8000\/ws\/rt_voice_flow/);
  assert.match(recordingStartup, /const\s+readyPromise\s*=\s*(?:measurePromise\([^)]*ensureVoiceServerReady\(\)\)|ensureVoiceServerReady\(\))/);
  assert.match(recordingStartup, /Promise\.all\(\[[\s\S]*readyPromise[\s\S]*\]\)/);
});

test('renderer 不再保留旧文字请求链路', async () => {
  const voiceServer = await readProjectFile('src/services/voice/voiceServer.ts');

  await assert.rejects(
    () => readProjectFile('src/services/textFlow.ts'),
    /ENOENT/,
  );
  assert.doesNotMatch(voiceServer, /VOICE_SERVER_TEXT_FLOW_URL/);
  assert.doesNotMatch(voiceServer, /\/ai\/text_flow/);
});

test('Electron 只通过打包后端服务管理语音后端进程', async () => {
  const main = await readMainProcessSurface();
  const packagingConfig = await readProjectFile('../../packaging/electron-builder.yml');

  assert.doesNotMatch(main, /voiceServerProcess/);
  assert.doesNotMatch(main, /voiceServerStartPromise/);
  assert.doesNotMatch(main, /function stopVoiceServer/);
  assert.doesNotMatch(main, /spawn\(process\.env\.PYTHON \|\| ['"]python['"], \['main\.py'\]/);
  assert.doesNotMatch(main, /stopVoiceServer\(\)/);
  assert.match(main, /createVoiceBackendService/);
  assert.match(main, /backendExecutablePath:\s*\(\)\s*=>\s*appPaths\.backendExecutablePath\(\)/);
  assert.match(main, /llamaServerPath:\s*\(\)\s*=>\s*appPaths\.llamaServerPath\(\)/);
  assert.match(main, /hyMtLlamaServerPath:\s*\(\)\s*=>\s*appPaths\.hyMtLlamaServerPath\(\)/);
  assert.match(packagingConfig, /from:\s*release-artifacts\/llama[\s\S]*to:\s*llama/);
  assert.match(packagingConfig, /from:\s*release-artifacts\/llama-stq[\s\S]*to:\s*llama-stq/);
  assert.match(main, /voiceBackendService\.stop\(\)/);
});

test('前端按键事件按真实快捷键模式启动和停止语音流', async () => {
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const shortcutBridge = await readProjectFile('src/components/useGlobalShortcutBridge.ts');
  const guard = await readProjectFile('src/services/shortcutGuard.ts');
  const voiceTypes = await readProjectFile('src/services/voice/voiceTypes.ts');

  assert.match(appShell, /useGlobalShortcutBridge/);
  assert.match(shortcutBridge, /global-keyboard/);
  assert.match(shortcutBridge, /toggleRecording/);
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
  const voiceTypes = await readProjectFile('src/services/voice/voiceTypes.ts');
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
  const voiceSocket = await readProjectFile('src/services/voice/voiceSocket.ts');
  const voiceSessionLifecycle = await readProjectFile('src/services/voice/voiceSessionLifecycle.ts');
  const voiceSessionStore = await readProjectFile('src/services/voice/voiceSessionStore.ts');
  const recorderSurface = `${recorder}\n${voiceSocket}`;

  assert.match(recorder, /subscribeVoiceSession/);
  assert.match(recorder, /getVoiceSession/);
  assert.match(recorder, /toggleRecording/);
  assert.match(recorder, /cancelRecording/);
  assert.match(recorder, /disposeRecorder/);
  assert.match(recorder, /createVoiceSessionStore/);
  assert.match(recorder, /createVoiceSessionLifecycle/);
  assert.match(voiceSessionStore, /clearListeners/);
  assert.match(voiceSessionLifecycle, /isSessionActive/);
  assert.match(voiceSessionLifecycle, /ignoredAudioIds/);
  assert.match(voiceSocket, /audio_processing_completed/);
  assert.match(recorderSurface, /audio_id/);
  assert.match(recorder, /lifecycle\.ignoreAudioId/);
  assert.match(recorder, /lifecycle\.clearTranscribeTimeout/);
  assert.doesNotMatch(recorder, /export\s+function\s+getIsRecording/);
});

test('Dashboard 最近结果只展示最终结果，不再展示实时语音状态和中间转写', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  const i18n = await readProjectFile('src/i18n.tsx');

  const historyPanel = await readProjectFile('src/pages/dashboard/HistoryResultsPanel.tsx');
  const recentResults = await readProjectFile('src/services/recentDashboardResults.ts');
  assert.match(dashboard, /listVoiceHistory/);
  assert.match(dashboard, /selectRecentDashboardResults/);
  assert.match(dashboard, /HistoryResultsPanel/);
  assert.match(dashboard, /deleteVoiceHistory/);
  assert.match(dashboard, /retryVoiceHistory/);
  assert.match(recentResults, /item\.status\s*===\s*['"]error['"]/);
  assert.match(recentResults, /item\.mode\s*===\s*['"]Ask['"]/);
  assert.match(recentResults, /item\.mode\s*===\s*['"]MeetingNotes['"]/);
  assert.match(historyPanel, /t\(['"]dashboard\.recentResults['"]\)/);
  assert.match(i18n, /['"]dashboard\.recentResults['"]:\s*['"]最近结果['"]/);
  assert.match(historyPanel, /Dialog/);
  assert.match(historyPanel, /TextField/);
  assert.match(historyPanel, /SearchIcon/);
  assert.match(historyPanel, /RefreshIcon/);
  assert.match(historyPanel, /ContentCopyIcon/);
  assert.match(historyPanel, /DeleteIcon/);
  assert.match(historyPanel, /MoreVertIcon/);
  assert.match(historyPanel, /dashboard\.history\.viewMore/);
  assert.match(historyPanel, /dashboard\.history\.searchPlaceholder/);
  assert.match(historyPanel, /dashboard\.history\.retry/);
  assert.match(dashboard, /clipboard:write-text/);
  assert.doesNotMatch(historyPanel, /Flag|OutlinedFlag|Feedback/);
  assert.match(i18n, /['"]dashboard\.history\.viewMore['"]:\s*['"]查看更多['"]/);
  assert.match(i18n, /['"]dashboard\.history\.retry['"]:\s*['"]重试['"]/);
  assert.doesNotMatch(dashboard, /getVoiceStatusLabel/);
  assert.doesNotMatch(dashboard, /voiceStatusLabel/);
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
  const shortcutBridge = await readProjectFile('src/components/useGlobalShortcutBridge.ts');
  const guard = await readProjectFile('src/services/shortcutGuard.ts');

  assert.match(appShell, /useGlobalShortcutBridge/);
  assert.match(shortcutBridge, /ipcClient\.on\(['"]global-keyboard['"]/);
  assert.match(shortcutBridge, /toggleRecording/);
  assert.match(shortcutBridge, /ipcClient\.on\(['"]voice-cancel-requested['"]/);
  assert.match(shortcutBridge, /cancelRecording/);
  assert.match(shortcutBridge, /getVoiceSession/);
  assert.match(shortcutBridge, /getVoiceSession\(\)\.status/);
  assert.match(shortcutBridge, /showShortcutHintPanel/);
  assert.match(shortcutBridge, /hideFloatingPanel/);
  assert.doesNotMatch(shortcutBridge, /ipcClient\.send\(['"]shortcut-hint['"]/);
  assert.doesNotMatch(shortcutBridge, /检测到长按快捷键/);
  assert.doesNotMatch(shortcutBridge, /handleCloseShortcutHint/);
  assert.match(guard, /LONG_PRESS_MS\s*=\s*350/);
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
  const main = await readMainProcessSurface();
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(main, /voice-state/);
  assert.match(main, /sendToFloatingBar\(['"]voice-state['"]/);
  assert.match(floatingBar, /voice-state/);
  assert.match(floatingBar, /applyVoiceState/);
  assert.doesNotMatch(floatingBar, /function\s+toggle\(/);
  assert.doesNotMatch(floatingBar, /global-keyboard[\s\S]*toggle\(\)/);
  assert.doesNotMatch(floatingBar, /getUserMedia/);
  assert.doesNotMatch(floatingBar, /MediaRecorder/);
  assert.doesNotMatch(floatingBar, /addEventListener\(['"]mousedown['"]/);
  assert.doesNotMatch(floatingBar, /addEventListener\(['"]touchstart['"]/);
});

test('三种语音方式在粒子 UI 中使用模式化录音和处理文案', async () => {
  const voiceTypes = await readProjectFile('src/services/voice/voiceTypes.ts');
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(voiceTypes, /mode:\s*session\.mode/);
  assert.match(voiceTypes, /session\.status\s*===\s*['"]recording['"][\s\S]*session\.mode\s*===\s*['"]Ask['"]/);
  assert.match(voiceTypes, /displayText:\s*['"]请随意提出问题['"]/);
  assert.match(floatingBar, /if\s*\(displayText\)\s*\{[\s\S]*setHintText\(displayText\)[\s\S]*return;/);
  assert.match(floatingBar, /function\s+getRecordingText\(mode\)/);
  assert.match(floatingBar, /if\s*\(mode\s*===\s*['"]Ask['"]\)\s*return\s*['"]请随意提出问题['"]/);
  assert.match(floatingBar, /if\s*\(mode\s*===\s*['"]Translate['"]\)\s*return\s*['"]正在听取翻译内容\.\.\.['"]/);
  assert.match(floatingBar, /return\s*['"]正在听写\.\.\.['"]/);
  assert.match(floatingBar, /function\s+getProcessingText\(mode\)/);
  assert.match(floatingBar, /if\s*\(mode\s*===\s*['"]Ask['"]\)\s*return\s*['"]正在处理\.\.\.['"]/);
  assert.match(floatingBar, /if\s*\(mode\s*===\s*['"]Translate['"]\)\s*return\s*['"]正在翻译\.\.\.['"]/);
  assert.match(floatingBar, /return\s*['"]正在转写\.\.\.['"]/);
  assert.doesNotMatch(floatingBar, /setHintText\(['"]正在监听\.\.\.['"]\)/);
});

test('P0 长按提示通过通用悬浮面板独立显示在悬浮条位置', async () => {
  const main = await readMainProcessSurface();
  const floatingPanel = await readProjectFile('public/floating-panel.html');
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const shortcutBridge = await readProjectFile('src/components/useGlobalShortcutBridge.ts');

  assert.match(main, /floating-panel/);
  assert.match(main, /sendToFloatingPanel\(['"]floating-panel['"]/);
  assert.match(floatingPanel, /floating-panel/);
  assert.match(floatingPanel, /检测到长按快捷键/);
  assert.match(floatingPanel, /Right Alt/);
  assert.match(appShell, /useGlobalShortcutBridge/);
  assert.match(shortcutBridge, /showShortcutHintPanel/);
  assert.doesNotMatch(shortcutBridge, /检测到长按快捷键/);
  assert.doesNotMatch(shortcutBridge, /ipcClient\.send\(['"]shortcut-hint['"]/);
});

test('P0 悬浮条提示卡依赖完整视口尺寸，避免定位容器塌陷', async () => {
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(floatingBar, /html,\s*body\s*\{[^}]*height:\s*100%;[^}]*\}/);
  assert.match(floatingBar, /#scene\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*\}/);
});

test('P0 悬浮条消费 voice-state.inputLevel 并驱动粒子球听写动态', async () => {
  const main = await readMainProcessSurface();
  const recorder = await readProjectFile('src/services/recorder.ts');
  const voiceTypes = await readProjectFile('src/services/voice/voiceTypes.ts');
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.doesNotMatch(main, /voice-input-level-debug/);
  assert.doesNotMatch(main, /voice-level-debug/);
  assert.doesNotMatch(recorder, /voice-level-debug/);
  assert.match(voiceTypes, /inputLevel:\s*number/);
  assert.match(voiceTypes, /inputLevel:\s*0/);
  assert.match(voiceTypes, /inputLevel:\s*session\.inputLevel/);
  assert.match(floatingBar, /voice-state/);
  assert.match(floatingBar, /inputLevel/);
  assert.match(floatingBar, /setInputLevel\(stateLevel\)/);
  assert.match(floatingBar, /audioLevel/);
  assert.match(floatingBar, /this\.state\s*===\s*['"]recording['"]/);
  assert.match(floatingBar, /responsiveLevel\s*=\s*Math\.sqrt\(this\.audioLevel\)/);
  assert.match(floatingBar, /recordingPulse\s*=\s*0\.08\s*\+\s*responsiveLevel\s*\*\s*1\.15/);
  assert.match(floatingBar, /noise\s*=\s*Math\.sin\(time\s*\*\s*3\s*\+\s*i\s*\*\s*0\.1\)\s*\*\s*recordingPulse/);
  assert.match(floatingBar, /this\.state\s*===\s*['"]processing['"]/);
  assert.doesNotMatch(floatingBar, /renderLevels/);
  assert.doesNotMatch(floatingBar, /@keyframes\s+level/);
  assert.doesNotMatch(floatingBar, /animation:\s*level/);
});

test('P0 悬浮条把语音状态映射到粒子球视觉态', async () => {
  const floatingBar = await readProjectFile('public/floating-bar.html');

  assert.match(floatingBar, /const\s+stateLevel\s*=\s*state\s*&&\s*typeof\s+state\.inputLevel\s*===\s*['"]number['"]/);
  assert.match(floatingBar, /particleSphere\.setInputLevel\(stateLevel\)/);
  assert.match(floatingBar, /particleSphere\.setRecording\(status\s*===\s*['"]recording['"]\)/);
  assert.match(floatingBar, /particleSphere\.setProcessing\(status\s*===\s*['"]stopping['"]\s*\|\|\s*status\s*===\s*['"]transcribing['"]\)/);
  assert.match(floatingBar, /particleSphere\.cancel\(\)/);
  assert.match(floatingBar, /particleSphere\.complete\(\)/);
  assert.doesNotMatch(floatingBar, /BAR_WEIGHTS/);
});

test('P0 悬浮条在完成或取消后自动消失，并在错误后保持可见', async () => {
  const main = await readMainProcessSurface();
  const floatingBar = await readProjectFile('public/floating-bar.html');
  const voiceTypes = await readProjectFile('src/services/voice/voiceTypes.ts');

  assert.match(main, /function\s+scheduleFloatingBarCompletedHide\(/);
  assert.match(main, /function\s+renderFloatingBarForVoiceState\(/);
  assert.match(main, /isTerminalVoiceState\(payload\)[\s\S]*scheduleFloatingBarCompletedHide\(\)/);
  assert.match(main, /setTimeout\([\s\S]*hideFloatingBar\(\)/);
  assert.doesNotMatch(main, /payload\.status\s*===\s*['"]error['"][\s\S]*hideFloatingBar\(\)/);
  assert.match(floatingBar, /当前转录已取消/);
  assert.match(floatingBar, /displayText/);
  assert.match(floatingBar, /if\s*\(status\s*===\s*['"]cancelled['"]\)\s*\{[\s\S]*particleSphere\.cancel\(\)[\s\S]*\}[\s\S]*if\s*\(displayText\)/);
  assert.match(voiceTypes, /audio_empty:\s*['"]没有识别到声音['"]/);
  assert.match(voiceTypes, /session\.error\?\.code\s*===\s*['"]audio_empty['"][\s\S]*status:\s*['"]cancelled['"]/);
});

test('P0 Dashboard 移除鼠标录音入口，只保留键盘触发', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const shortcutBridge = await readProjectFile('src/components/useGlobalShortcutBridge.ts');

  assert.doesNotMatch(dashboard, /MicIcon/);
  assert.doesNotMatch(dashboard, /onClick=\{\(\)\s*=>\s*handleToggle\(\)\}/);
  assert.doesNotMatch(dashboard, /global-keyboard/);
  assert.doesNotMatch(dashboard, /toggleRecording/);
  assert.match(appShell, /useGlobalShortcutBridge/);
  assert.match(shortcutBridge, /global-keyboard/);
  assert.match(shortcutBridge, /toggleRecording/);
});

test('P1 历史页面与历史 store 统一走主进程 JSON 数据源', async () => {
  const historyStore = await readProjectFile('src/services/historyStore.ts');
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  const historyPanel = await readProjectFile('src/pages/dashboard/HistoryResultsPanel.tsx');
  const main = await readMainProcessSurface();

  assert.match(main, /HISTORY_FILE_NAME\s*=\s*['"]history\.json['"]/);
  assert.match(main, /function\s+readHistoryItems\(/);
  assert.match(main, /function\s+writeHistoryItems\(/);
  assert.match(main, /ipcMain\.handle\(['"]db:history-stats['"]/);
  assert.match(historyStore, /db:history-list/);
  assert.match(historyStore, /db:history-upsert/);
  assert.match(historyStore, /db:history-clear/);
  assert.match(historyStore, /db:history-delete/);
  assert.match(historyStore, /db:history-save-audio/);
  assert.match(historyStore, /db:history-retry/);
  assert.match(historyStore, /db:history-stats/);
  assert.match(historyStore, /saveVoiceHistory/);
  assert.match(historyStore, /clearVoiceHistory/);
  assert.match(historyStore, /deleteVoiceHistory/);
  assert.match(historyStore, /retryVoiceHistory/);
  assert.match(historyStore, /saveVoiceHistoryRetryAudio/);
  assert.match(historyStore, /loadVoiceStats/);
  assert.doesNotMatch(historyStore, /localStorage/);
  assert.match(main, /ipcMain\.handle\(['"]db:history-save-audio['"]/);
  assert.match(main, /ipcMain\.handle\(['"]db:history-retry['"]/);
  assert.match(dashboard, /listVoiceHistory/);
  assert.match(dashboard, /deleteVoiceHistory/);
  assert.match(dashboard, /retryVoiceHistory/);
  assert.match(historyPanel, /onCopy/);
});

test('P1 词典数据统一走主进程 JSON 数据源', async () => {
  const main = await readMainProcessSurface();

  assert.match(main, /DICTIONARY_FILE_NAME\s*=\s*['"]dictionary\.json['"]/);
  assert.match(main, /DICTIONARY_CANDIDATES_FILE_NAME\s*=\s*['"]dictionary-candidates\.json['"]/);
  assert.match(main, /function\s+readDictionaryEntries\(/);
  assert.match(main, /function\s+writeDictionaryEntries\(/);
  assert.match(main, /function\s+readDictionaryCandidates\(/);
  assert.match(main, /function\s+writeDictionaryCandidates\(/);
  assert.match(main, /ipcMain\.handle\(['"]dictionary:list['"]/);
  assert.match(main, /ipcMain\.handle\(['"]dictionary:create['"]/);
  assert.match(main, /ipcMain\.handle\(['"]dictionary:update['"]/);
  assert.match(main, /ipcMain\.handle\(['"]dictionary:delete['"]/);
  assert.match(main, /ipcMain\.handle\(['"]dictionary:candidates-list['"]/);
  assert.match(main, /ipcMain\.handle\(['"]dictionary:candidate-promote['"]/);
  assert.match(main, /ipcMain\.handle\(['"]dictionary:candidate-ignore['"]/);
  assert.match(main, /ipcMain\.handle\(['"]dictionary:prompt-terms['"]/);
});

test('P1 主进程在粘贴成功后启动词典自动学习观察', async () => {
  const main = await readMainProcessSurface();

  assert.match(main, /createTextObservationSessionManager/);
  assert.match(main, /function\s+emitDictionaryChanged\(/);
  assert.match(main, /sendToMain\(['"]dictionary:changed['"]/);
  assert.match(main, /function\s+learnDictionaryCorrection\(/);
  assert.match(main, /learnDictionaryCandidate\(readDictionaryCandidates\(\),\s*candidate/);
  assert.match(main, /textObservationManager\.start\(\{[\s\S]*pastedText/);
  assert.match(main, /readFocusedInfo\(\)/);
});

test('P1 Windows 文本观察 helper 通过 stdio 接入主进程', async () => {
  const main = await readMainProcessSurface();
  const project = await readProjectFile('../windows-text-observer/WindowsTextObserver.csproj');
  const program = await readProjectFile('../windows-text-observer/Program.cs');
  const observer = await readProjectFile('../windows-text-observer/TextObserver.cs');

  assert.match(project, /net8\.0-windows/);
  assert.match(program, /observe-start/);
  assert.match(program, /observe-stop/);
  assert.match(observer, /TextPattern\.TextChangedEvent/);
  assert.match(observer, /DocumentRange\.GetText\(4000\)/);
  assert.match(main, /textObserverExecutablePath:\s*\(\)\s*=>/);
  assert.match(main, /function\s+ensureTextObserverProcess\(/);
  assert.match(main, /sendTextObserverMessage\(\{[\s\S]*type:\s*['"]observe-start['"]/);
  assert.match(main, /sendTextObserverMessage\(\{[\s\S]*type:\s*['"]observe-stop['"]/);
  assert.match(main, /handleObservedText\(message\)/);
});

test('P1 词典页面接入导航和主进程 IPC', async () => {
  const navigation = await readProjectFile('src/navigation.ts');
  const sidebar = await readProjectFile('src/components/Sidebar.tsx');
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const dictionaryPage = await readProjectFile('src/pages/Dictionary.tsx');
  const dictionaryStore = await readProjectFile('src/services/dictionaryStore.ts');
  const i18n = await readProjectFile('src/i18n.tsx');

  assert.match(navigation, /'dictionary'/);
  assert.match(navigation, /labelKey:\s*['"]nav\.dictionary['"]/);
  assert.match(i18n, /['"]nav\.dictionary['"]:\s*['"]词典['"]/);
  assert.match(sidebar, /AutoAwesomeIcon|MenuBookIcon|LibraryBooksIcon/);
  assert.match(appShell, /Dictionary/);
  assert.match(dictionaryPage, /t\(['"]dictionary\.autoAdded['"]\)/);
  assert.match(dictionaryPage, /t\(['"]dictionary\.manualAdded['"]\)/);
  assert.match(dictionaryPage, /t\(['"]dictionary\.candidate['"]\)/);
  assert.match(dictionaryPage, /t\(['"]dictionary\.enabled['"]\)/);
  assert.match(dictionaryPage, /function\s+DictionaryAddDialog/);
  assert.match(dictionaryPage, /searchOpen/);
  assert.match(dictionaryPage, /addOpen/);
  assert.match(dictionaryPage, /dictionary\.addNewEntry/);
  assert.match(dictionaryPage, /dictionary\.addPlaceholder/);
  assert.match(dictionaryPage, /dictionary\.searchAria/);
  assert.match(dictionaryPage, /dictionary\.emptyAutoTitle/);
  assert.match(dictionaryPage, /filter\s*===\s*['"]manual['"]/);
  assert.match(i18n, /['"]dictionary\.autoAdded['"]:\s*['"]自动添加['"]/);
  assert.match(i18n, /['"]dictionary\.manualAdded['"]:\s*['"]手动添加['"]/);
  assert.match(i18n, /['"]dictionary\.candidate['"]:\s*['"]候选['"]/);
  assert.match(i18n, /['"]dictionary\.enabled['"]:/);
  assert.match(i18n, /['"]dictionary\.addNewEntry['"]:/);
  assert.match(i18n, /['"]dictionary\.searchPlaceholder['"]:/);
  assert.doesNotMatch(dictionaryPage, />新增词条</);
  assert.match(dictionaryStore, /dictionary:list/);
  assert.match(dictionaryStore, /dictionary:create/);
  assert.match(dictionaryStore, /dictionary:update/);
  assert.match(dictionaryStore, /dictionary:delete/);
  assert.match(dictionaryStore, /dictionary:candidates-list/);
  assert.match(dictionaryStore, /dictionary:candidate-promote/);
  assert.match(dictionaryStore, /dictionary:candidate-ignore/);
  assert.match(dictionaryStore, /dictionary:prompt-terms/);
  assert.match(dictionaryStore, /dictionary:changed/);
  assert.match(dictionaryStore, /subscribeDictionaryChanges/);
  assert.match(dictionaryPage, /subscribeDictionaryChanges/);
  assert.doesNotMatch(dictionaryStore, /localStorage/);
});

test('P1 旧模型管理能力已删除，语音模型初始化并入设置页', async () => {
  const main = await readMainProcessSurface();
  const navigation = await readProjectFile('src/navigation.ts');
  const sidebar = await readProjectFile('src/components/Sidebar.tsx');
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const settingsPage = await readProjectFile('src/pages/Settings.tsx');
  const voiceModelSection = await readProjectFile('src/pages/settings/VoiceModelSettingsSection.tsx');

  await assert.rejects(() => readProjectFile('src/pages/Models.tsx'), /ENOENT/);
  await assert.rejects(() => readProjectFile('src/pages/models/useModelsPageState.ts'), /ENOENT/);
  await assert.rejects(() => readProjectFile('src/pages/models/ModelCard.tsx'), /ENOENT/);
  await assert.rejects(() => readProjectFile('src/services/modelStore.ts'), /ENOENT/);
  await assert.rejects(() => readProjectFile('src/pages/Setup.tsx'), /ENOENT/);

  assert.doesNotMatch(navigation, /'models'/);
  assert.doesNotMatch(sidebar, /MemoryIcon|StorageIcon|HubIcon/);
  assert.doesNotMatch(appShell, /Models/);
  assert.doesNotMatch(main, /ipcMain\.handle\(['"]model:/);
  assert.doesNotMatch(main, /modelsUrl:/);
  assert.doesNotMatch(main, /callModelBackend/);
  assert.doesNotMatch(main, /snapshot_download/);
  assert.doesNotMatch(navigation, /'setup'|nav\.setup/);
  assert.doesNotMatch(appShell, /<Setup|pages\/Setup/);
  assert.match(appShell, /useState<Page>\(['"]home['"]\)/);
  assert.match(settingsPage, /VoiceModelSettingsSection/);
  assert.match(voiceModelSection, /getVoiceModelStatus/);
  assert.match(voiceModelSection, /startVoiceModelDownload/);
  assert.match(voiceModelSection, /chooseModelCacheDirectory/);
});

test('设置页语音模型只在模型未下载且空闲时允许选择模型保存路径', async () => {
  const voiceModelSection = await readProjectFile('src/pages/settings/VoiceModelSettingsSection.tsx');

  assert.match(voiceModelSection, /const\s+isDownloaded\s*=\s*Boolean\(modelStatus\?\.cached\)/);
  assert.match(voiceModelSection, /const\s+isReady\s*=\s*Boolean\(modelStatus\?\.ready\s*\|\|\s*modelStatus\?\.status\s*===\s*['"]ready['"]\)/);
  assert.match(voiceModelSection, /const\s+canChooseCacheDir\s*=\s*!isDownloaded\s*&&\s*!isReady\s*&&\s*!busy/);
  assert.match(voiceModelSection, /\{canChooseCacheDir\s*\?\s*\(\s*<Button[\s\S]*settings\.voiceModel\.chooseCacheDir[\s\S]*<\/Button>\s*\)\s*:\s*null\}/);
});

test('设置页语音模型下载时显示真实百分比进度', async () => {
  const setupStore = await readProjectFile('src/services/modelSetupStore.ts');
  const voiceModelSection = await readProjectFile('src/pages/settings/VoiceModelSettingsSection.tsx');
  const i18n = await readProjectFile('src/i18n.tsx');

  assert.match(setupStore, /downloaded_bytes\?:\s*number/);
  assert.match(setupStore, /total_bytes\?:\s*number/);
  assert.match(setupStore, /progress_percent\?:\s*number\s*\|\s*null/);
  assert.match(setupStore, /downloaded_files\?:\s*number/);
  assert.match(setupStore, /total_files\?:\s*number/);
  assert.match(setupStore, /file_progress_percent\?:\s*number\s*\|\s*null/);
  assert.doesNotMatch(voiceModelSection, /setup\.elapsed/);
  assert.doesNotMatch(voiceModelSection, /formatElapsed/);
  assert.doesNotMatch(i18n, /setup\.elapsed/);
  assert.match(voiceModelSection, /variant=\{hasDownloadProgress\s*\?\s*['"]determinate['"]\s*:\s*['"]indeterminate['"]\}/);
  assert.match(voiceModelSection, /value=\{hasDownloadProgress\s*\?\s*downloadProgressPercent\s*:\s*undefined\}/);
  assert.match(voiceModelSection, /formatBytes\(modelStatus\?\.downloaded_bytes\)/);
  assert.match(voiceModelSection, /formatBytes\(modelStatus\?\.total_bytes\)/);
  assert.match(voiceModelSection, /hasFileProgress/);
  assert.match(voiceModelSection, /settings\.voiceModel\.modelFilesProgress/);
  assert.match(voiceModelSection, /settings\.voiceModel\.modelFilesProgressHint/);
  assert.match(i18n, /settings\.voiceModel\.modelFilesProgressHint/);
});

test('P1 设置页与设置 store 统一走主进程 JSON 数据源', async () => {
  const settingsStore = await readProjectFile('src/services/settingsStore.ts');
  const settingsPage = await readProjectFile('src/pages/Settings.tsx');
  const settingsState = await readProjectFile('src/pages/settings/useSettingsPageState.ts');
  const audioSection = await readProjectFile('src/pages/settings/AudioSettingsSection.tsx');
  const applicationBehaviorSection = await readProjectFile('src/pages/settings/ApplicationBehaviorSettingsSection.tsx');
  const asrRuntimeSection = await readProjectFile('src/pages/settings/AsrRuntimeSettingsSection.tsx');
  const voiceModelSection = await readProjectFile('src/pages/settings/VoiceModelSettingsSection.tsx');
  const translationModelSection = await readProjectFile('src/pages/settings/TranslationModelSettingsSection.tsx');
  const translationModelStore = await readProjectFile('src/services/translationModelStore.ts');
  const voiceDiagnosticsSection = await readProjectFile('src/pages/settings/VoiceDiagnosticsSettingsSection.tsx');
  const voiceDiagnosticsStore = await readProjectFile('src/services/voiceDiagnosticsStore.ts');
  const languageSection = await readProjectFile('src/pages/settings/LanguageSettingsSection.tsx');
  const llmSection = await readProjectFile('src/pages/settings/LlmSettingsSection.tsx');
  const shortcutSection = await readProjectFile('src/pages/settings/ShortcutSettingsSection.tsx');
  const i18n = await readProjectFile('src/i18n.tsx');
  const settingsSurface = [
    settingsPage,
    settingsState,
    audioSection,
    applicationBehaviorSection,
    asrRuntimeSection,
    voiceModelSection,
    translationModelSection,
    voiceDiagnosticsSection,
    languageSection,
    llmSection,
    shortcutSection,
  ].join('\n');
  const main = await readMainProcessSurface();
  const translationLanguages = JSON.parse(await readProjectFile('../../shared/translation-target-languages.json'));
  const interfaceLanguages = JSON.parse(await readProjectFile('../../shared/interface-languages.json'));
  const meetingLiveLanguages = JSON.parse(await readProjectFile('../../shared/meeting-live-target-languages.json'));
  const meetingNoteLanguages = JSON.parse(await readProjectFile('../../shared/meeting-note-target-languages.json'));
  const llmProviders = JSON.parse(await readProjectFile('../../shared/llm-providers.json'));

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
  assert.match(settingsStore, /subscribeSettingsChanges/);
  assert.match(settingsStore, /permission:update-auto-launch/);
  assert.doesNotMatch(settingsStore, /localStorage/);
  assert.doesNotMatch(settingsStore, /deepseekApiKey/);
  assert.match(settingsStore, /DEFAULT_LLM_PROVIDERS/);
  assert.match(settingsStore, /getCurrentLlmConfig/);
  assert.deepEqual(
    translationLanguages.map((language) => language.id),
    [
      'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'pt', 'pt-BR', 'fr', 'de',
      'it', 'ru', 'uk', 'ar', 'he', 'fa', 'hi', 'bn', 'ur', 'th',
      'vi', 'id', 'ms', 'fil', 'my', 'km', 'lo', 'nl', 'pl', 'tr',
      'el', 'cs', 'ro', 'hu', 'sv', 'da', 'no', 'fi', 'sw',
    ],
  );
  assert.equal(translationLanguages.some((language) => language.id === 'yue'), false);
  assert.deepEqual(meetingLiveLanguages.map((language) => language.id), ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de']);
  assert.deepEqual(meetingNoteLanguages.map((language) => language.id), ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt']);
  assert.match(settingsStore, /TRANSLATION_TARGET_LANGUAGES/);
  assert.match(settingsStore, /MEETING_LIVE_TARGET_LANGUAGES/);
  assert.match(settingsStore, /MEETING_NOTE_TARGET_LANGUAGES/);
  assert.match(settingsStore, /DEFAULT_TRANSLATION_TARGET_LANGUAGE/);
  assert.match(main, /translation-target-languages\.json/);
  assert.match(main, /meeting-live-target-languages\.json/);
  assert.match(main, /interface-languages\.json/);
  assert.match(settingsStore, /interface-languages\.json/);
  assert.match(settingsStore, /INTERFACE_LANGUAGES/);
  assert.deepEqual(
    interfaceLanguages.map((language) => language.id),
    [
      'en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'es-ES', 'pt-BR',
      'fr-FR', 'de-DE', 'it-IT', 'ru-RU', 'ar-SA', 'he-IL', 'hi-IN',
      'id-ID', 'ms-MY', 'nl-NL', 'pl-PL', 'th-TH',
    ],
  );
  assert.equal(interfaceLanguages.every((language) => language.labelKey === `settings.interfaceLanguage.${language.id}`), true);
  assert.match(settingsStore, /llm-providers\.json/);
  assert.match(main, /llm-providers\.json/);
  assert.match(main, /DEFAULT_LLM_PROVIDERS/);
  assert.match(main, /buildCurrentLlmRequestConfig/);
  assert.match(main, /translationTargetLanguage:\s*DEFAULT_TRANSLATION_TARGET_LANGUAGE/);
  assert.match(settingsPage, /useSettingsPageState/);
  assert.match(settingsPage, /ShortcutSettingsSection/);
  assert.match(settingsPage, /AudioSettingsSection/);
  assert.match(settingsPage, /VoiceModelSettingsSection/);
  assert.match(settingsPage, /TranslationModelSettingsSection/);
  assert.match(settingsPage, /ApplicationBehaviorSettingsSection/);
  assert.match(settingsPage, /VoiceDiagnosticsSettingsSection/);
  assert.match(settingsPage, /AsrRuntimeSettingsSection/);
  assert.match(settingsPage, /LanguageSettingsSection/);
  assert.match(settingsPage, /LlmSettingsSection/);
  assert.match(settingsState, /updateAutoLaunchPreference/);
  assert.match(settingsState, /navigator\.mediaDevices\.enumerateDevices/);
  assert.match(settingsState, /devicechange/);
  assert.match(settingsState, /reloadLlmBackendConfig/);
  assert.match(audioSection, /selectedAudioDeviceId/);
  assert.match(audioSection, /getAudioStreamForDevice/);
  assert.match(audioSection, /startAudioLevelMonitoring/);
  assert.match(audioSection, /interactionSoundsEnabled/);
  assert.match(audioSection, /muteBackgroundAudioDuringRecording/);
  assert.match(audioSection, /showActiveMicrophoneHint/);
  assert.match(audioSection, /remindOnNewAudioDevice/);
  assert.match(settingsPage, /<AudioSettingsSection[\s\S]*<VoiceModelSettingsSection[\s\S]*<TranslationModelSettingsSection[\s\S]*<AsrRuntimeSettingsSection/);
  assert.match(voiceModelSection, /settings\.modelCacheDir/);
  assert.match(voiceModelSection, /getVoiceModelStatus/);
  assert.match(voiceModelSection, /startVoiceModelDownload/);
  assert.match(voiceModelSection, /chooseModelCacheDirectory/);
  assert.match(voiceModelSection, /settings\.voiceModel\.title/);
  assert.match(voiceModelSection, /settings\.voiceModel\.modelFilesProgress/);
  assert.match(settingsStore, /translationModelCacheDir:\s*string/);
  assert.match(settingsStore, /translationEnginePreference/);
  assert.match(settingsStore, /localTranslationModelEnabled/);
  assert.match(translationModelSection, /getTranslationModelStatus/);
  assert.match(translationModelSection, /startTranslationModelDownload/);
  assert.match(translationModelSection, /loadTranslationModel/);
  assert.match(translationModelSection, /chooseModelCacheDirectory/);
  assert.match(translationModelSection, /settings\.translationModel\.title/);
  assert.match(translationModelSection, /settings\.translationModel\.cacheDir/);
  assert.match(translationModelSection, /settings\.translationModel\.modelReady/);
  assert.match(translationModelSection, /settings\.translationModel\.modelLoadFailedDetail/);
  assert.match(translationModelSection, /settings\.translationModel\.runtimeStartFailedDetail/);
  assert.match(translationModelSection, /settings\.translationModel\.modelFilesProgress/);
  assert.doesNotMatch(translationModelSection, /settings\.translationModel\.(runtimeMode|runtimeProfile|fallbackReason|readyDetail)/);
  assert.doesNotMatch(translationModelSection, /AngelSlim|Hy-MT1\.5/);
  assert.match(i18n, /settings\.translationModel\.modelLoadFailedDetail/);
  assert.match(i18n, /settings\.translationModel\.runtimeStartFailedDetail/);
  assert.match(i18n, /Hy-MT2/);
  assert.doesNotMatch(translationModelSection, /unloadTranslationModel/);
  assert.doesNotMatch(translationModelSection, /translationEnginePreference|localTranslationModelEnabled/);
  assert.match(translationModelStore, /translation-model:get-status/);
  assert.match(translationModelStore, /translation-model:start-download/);
  assert.match(translationModelStore, /translation-model:load/);
  assert.match(translationModelStore, /translation-model:unload/);
  assert.match(applicationBehaviorSection, /launchAtSystemStartup/);
  assert.match(applicationBehaviorSection, /meetingDetectionEnabled/);
  assert.match(applicationBehaviorSection, /showFloatingBar/);
  assert.match(applicationBehaviorSection, /hideMainWindowOnClose/);
  assert.match(voiceDiagnosticsStore, /voice-diagnostics:list/);
  assert.match(voiceDiagnosticsStore, /voice-diagnostics:save/);
  assert.match(voiceDiagnosticsStore, /voice-diagnostics:clear/);
  assert.match(voiceDiagnosticsStore, /voice-diagnostics:changed/);
  assert.match(voiceDiagnosticsSection, /listVoiceDiagnostics/);
  assert.match(voiceDiagnosticsSection, /clearVoiceDiagnostics/);
  assert.match(voiceDiagnosticsSection, /settings\.voiceDiagnostics\.privacyHint/);
  assert.match(settingsSurface, /settings\.voiceDiagnostics\.title/);
  assert.match(asrRuntimeSection, /ipcClient\.platform/);
  assert.match(asrRuntimeSection, /asrDeviceMode/);
  assert.match(asrRuntimeSection, /platform === 'win32'/);
  assert.match(asrRuntimeSection, /value:\s*'cuda'/);
  assert.match(asrRuntimeSection, /getVoiceModelStatus/);
  assert.match(asrRuntimeSection, /settings\.asrRuntime\.title/);
  assert.match(asrRuntimeSection, /fallback_reason/);
  assert.doesNotMatch(audioSection, /settings\.other/);
  assert.match(languageSection, /preferredLanguage/);
  assert.match(languageSection, /translationTargetLanguage/);
  assert.match(languageSection, /INTERFACE_LANGUAGES\.map/);
  assert.match(languageSection, /language\.labelKey/);
  assert.match(languageSection, /TranslationKey/);
  assert.doesNotMatch(languageSection, /MenuItem value="zh-CN"/);
  assert.doesNotMatch(languageSection, /MenuItem value="en-US"/);
  assert.match(languageSection, /TRANSLATION_TARGET_LANGUAGES\.map/);
  assert.match(languageSection, /language\.displayName\s*\|\|\s*language\.label/);
  assert.match(languageSection, /language\.secondaryLabel\s*\|\|\s*language\.label/);
  assert.match(languageSection, /settings\.translationTargetSelectHint/);
  assert.match(languageSection, /settings\.translationTargetLanguage/);
  assert.doesNotMatch(settingsSurface, /MenuItem value="en">英文 \(en\)<\/MenuItem>/);
  assert.match(settingsSurface, /settings\.audio\.interactionSounds/);
  assert.match(settingsSurface, /settings\.appBehavior\.meetingDetection/);
  assert.match(settingsSurface, /settings\.appBehavior\.floatingBar/);
  assert.doesNotMatch(settingsSurface, /版本 0\.1（本地版）/);
  assert.doesNotMatch(settingsSurface, /检查更新/);
  assert.doesNotMatch(settingsSurface, /disabled>/);
  assert.match(llmSection, /settings\.llm/);
  assert.match(llmSection, /settings\.provider/);
  assert.match(llmSection, /API Key/);
  assert.match(llmSection, /settings\.model/);
  assert.match(llmSection, /Base URL/);
  assert.match(llmSection, /settings\.edit/);
  assert.match(llmSection, /settings\.save/);
  assert.match(llmSection, /settings\.cancel/);
  assert.deepEqual(
    llmProviders.map((provider) => provider.label),
    ['DeepSeek', 'OpenAI', 'Z.AI', 'OpenRouter', 'Anthropic', 'Groq', 'Cerebras', 'Custom'],
  );
  assert.match(llmSection, /type="password"/);
  assert.match(llmSection, /settings\.apiKeyPlaceholder/);
});

test('P1 设置页通过本地设置暴露悬浮条开关，界面语言由本地设置加载', async () => {
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const settingsSurface = await readProjectFiles([
    'src/pages/Settings.tsx',
    'src/pages/settings/AudioSettingsSection.tsx',
    'src/pages/settings/ApplicationBehaviorSettingsSection.tsx',
    'src/pages/settings/AsrRuntimeSettingsSection.tsx',
    'src/pages/settings/LanguageSettingsSection.tsx',
    'src/pages/settings/LlmSettingsSection.tsx',
    'src/pages/settings/ShortcutSettingsSection.tsx',
  ]);
  const languageSection = await readProjectFile('src/pages/settings/LanguageSettingsSection.tsx');
  const main = await readMainProcessSurface();

  assert.doesNotMatch(main, /ipcMain\.handle\(['"]page:set-floating-bar-enabled['"]/);
  assert.match(main, /showFloatingBar/);
  assert.doesNotMatch(settingsSurface, /page:set-floating-bar-enabled/);
  assert.match(settingsSurface, /showFloatingBar/);
  assert.match(languageSection, /Select/);
  assert.match(languageSection, /INTERFACE_LANGUAGES\.map/);
  assert.match(languageSection, /language\.labelKey/);
  assert.doesNotMatch(languageSection, /settings\.zhCn/);
  assert.doesNotMatch(languageSection, /settings\.enUs/);
  assert.match(languageSection, /TRANSLATION_TARGET_LANGUAGES/);
  assert.doesNotMatch(appShell, /page:set-floating-bar-enabled/);
  assert.match(appShell, /loadSettings/);
  assert.match(appShell, /subscribeSettingsChanges/);
  assert.match(appShell, /setLanguage\(settings\.preferredLanguage\)/);
});

test('会议检测提醒会打开会议笔记并默认使用麦克风加系统音频录制', async () => {
  const main = await readMainProcessSurface();
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const meetingNotes = await readProjectFile('src/pages/MeetingNotes.tsx');
  const notification = await readProjectFile('public/meeting-detection.html');
  const notificationI18n = JSON.parse(await readProjectFile('../../shared/meeting-detection-notification-i18n.json'));
  const interfaceLanguages = JSON.parse(await readProjectFile('../../shared/interface-languages.json'));

  assert.match(main, /createMeetingDetectorService/);
  assert.match(main, /meetingDetectorService\?\.start\(\)/);
  assert.match(main, /meeting-detector:start-recording/);
  assert.match(main, /meeting:auto-start-recording/);
  assert.match(main, /readVisibleWindows/);
  assert.match(main, /listActiveAudioSessions/);
  assert.match(main, /showMeetingDetectionNotification/);
  assert.match(main, /meetingDetectionEnabled/);

  assert.match(appShell, /meeting:auto-start-recording/);
  assert.match(appShell, /setPage\(['"]meetingNotes['"]\)/);
  assert.match(appShell, /autoStartRequest=\{meetingAutoStartRequest\}/);

  assert.match(meetingNotes, /MeetingAutoStartRequest/);
  assert.match(meetingNotes, /autoStartRequest/);
  assert.match(meetingNotes, /audioSource:\s*autoStartRequest\?\.audioSource\s*\|\|\s*['"]microphone_system['"]/);
  assert.match(meetingNotes, /targetLanguage:\s*autoStartRequest\?\.targetLanguage\s*\|\|\s*['"]off['"]/);
  assert.match(meetingNotes, /deleteMeetingNote\(saved\.id\)/);

  assert.deepEqual(Object.keys(notificationI18n), interfaceLanguages.map((language) => language.id));
  assert.match(main, /meeting-detection-notification-i18n\.json/);
  assert.match(main, /preferredLanguage/);
  assert.match(main, /labels/);
  assert.match(notification, /readLabels/);
  assert.match(notification, /labels\.title/);
  assert.match(notification, /labels\.start/);
  assert.match(notification, /labels\.open/);
  assert.match(notification, /labels\.close/);
  assert.match(notification, /clamp\(/);
  assert.match(notification, /display:\s*flex/);
  assert.match(notification, /flex:\s*0 0 clamp\(4px, 1vw, 5px\)/);
  assert.match(notification, /0 12px 28px rgba\(0, 0, 0, 0\.22\)/);
  assert.doesNotMatch(notification, /minmax\(112px,\s*32%,\s*150px\)/);
  assert.doesNotMatch(notification, /\.accent\s*\{[\s\S]*?width:\s*100%/);
  assert.doesNotMatch(notification, /Meeting Detected/);
  assert.doesNotMatch(notification, /Start Recording/);
  assert.doesNotMatch(notification, /&amp; open SpeakMore/);
  assert.match(notification, /meeting-detector:start-recording/);
  assert.match(notification, /meeting-detector:dismiss/);
});

test('会议笔记实时翻译先进入设置页并使用专属实时页', async () => {
  const meetingNotes = await readProjectFile('src/pages/MeetingNotes.tsx');
  const settingsStore = await readProjectFile('src/services/settingsStore.ts');
  const voiceSocket = await readProjectFile('src/services/voice/voiceSocket.ts');
  const recorder = await readProjectFile('src/services/recorder.ts');
  const i18n = await readProjectFile('src/i18n.tsx');

  assert.match(settingsStore, /meetingLiveAudioSource/);
  assert.match(settingsStore, /meetingLiveTargetLanguage/);
  assert.match(settingsStore, /meetingLiveAudioSource:\s*['"]microphone['"]/);
  assert.match(settingsStore, /meetingLiveTargetLanguage:\s*['"]off['"]/);

  assert.match(meetingNotes, /type\s+MeetingView\s*=\s*['"]list['"][\s\S]*['"]liveSetup['"]/);
  assert.match(meetingNotes, /onClick=\{openLiveSetup\}/);
  assert.match(meetingNotes, /const\s+renderLiveSetupView\s*=/);
  assert.match(meetingNotes, /meeting\.liveSetupTitle/);
  assert.match(meetingNotes, /meetingLiveAudioSource/);
  assert.match(meetingNotes, /meetingLiveTargetLanguage/);
  assert.match(meetingNotes, /MEETING_NOTE_TARGET_LANGUAGES/);
  assert.match(meetingNotes, /languages=\{MEETING_NOTE_TARGET_LANGUAGES\}/);
  assert.match(meetingNotes, /languages=\{MEETING_LIVE_TARGET_LANGUAGES\}/);
  assert.match(meetingNotes, /handleNoteRecordingTargetLanguageChange/);
  assert.match(meetingNotes, /startLiveTranslationFlow/);
  assert.match(meetingNotes, /startRecordingFlow\(['"]live['"]/);

  assert.match(meetingNotes, /const\s+renderLiveRecordingView\s*=/);
  assert.match(meetingNotes, /renderLiveSettingsSheet/);
  assert.match(meetingNotes, /renderNoteTranscriptionPanel/);
  assert.match(meetingNotes, /showTranscriptPanel/);
  assert.match(meetingNotes, /setLiveSettingsOpen\(true\)/);
  assert.match(meetingNotes, /meetingLiveSegments/);
  assert.match(meetingNotes, /sourceText/);
  assert.match(meetingNotes, /translationText/);
  assert.match(meetingNotes, /meeting\.realtime/);
  assert.match(meetingNotes, /meeting\.startSpeaking/);
  assert.match(meetingNotes, /LiveToolbarButton/);
  assert.match(meetingNotes, /updateMeetingNotesRecordingOptions/);
  assert.match(meetingNotes, /inputLevel/);
  assert.match(meetingNotes, /Waveform[\s\S]*level/);
  assert.match(meetingNotes, /size=\{?["']hero["']\}?/);
  assert.match(meetingNotes, /size=\{?["']inline["']\}?/);
  assert.match(meetingNotes, /meeting-subtitles:show/);

  assert.match(voiceSocket, /meeting_translation/);
  assert.match(voiceSocket, /meeting_translation_error/);
  assert.match(recorder, /handleMeetingTranslation/);
  assert.match(recorder, /meetingLiveSegments/);
  assert.match(recorder, /source_text/);
  assert.match(recorder, /set_mode_config/);
  assert.match(i18n, /meeting\.showAiTranslation/);
  assert.match(i18n, /meeting\.systemAudioToast/);
  assert.match(i18n, /meeting\.liveSettingsHint/);
});

test('P1 首页四项统计来自真实历史统计，不再展示硬编码指标', async () => {
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  const historyStore = await readProjectFile('src/services/historyStore.ts');
  const personalizationStore = await readProjectFile('src/services/dashboardPersonalization.ts');
  const i18n = await readProjectFile('src/i18n.tsx');

  assert.match(historyStore, /HAND_TYPED_CHARS_PER_MINUTE\s*=\s*60/);
  assert.match(historyStore, /formatDurationMinutes/);
  assert.match(historyStore, /formatAverageSpeed/);
  assert.match(historyStore, /formatSavedMinutes/);
  assert.match(dashboard, /loadVoiceStats/);
  assert.match(dashboard, /stats\.totalDurationMs/);
  assert.match(dashboard, /stats\.totalTextLength/);
  assert.match(dashboard, /stats\.savedMs/);
  assert.match(dashboard, /stats\.averageCharsPerMinute/);
  assert.match(dashboard, /calculateDashboardPersonalization/);
  assert.match(dashboard, /listDictionaryEntries/);
  assert.match(dashboard, /subscribeDictionaryChanges/);
  assert.match(dashboard, /entry\.status\s*===\s*['"]active['"]/);
  assert.match(dashboard, /\$\{personalization\}%/);
  assert.match(dashboard, /PERSONALIZATION_BLUE/);
  assert.match(personalizationStore, /durationMinutes:\s*60000/);
  assert.match(personalizationStore, /textLength:\s*10000000/);
  assert.match(personalizationStore, /dictionaryCount:\s*2000/);
  assert.match(personalizationStore, /Math\.pow\(ratio,\s*0\.55\)/);
  assert.match(dashboard, /t\(['"]dashboard\.stats\.totalDuration['"]\)/);
  assert.match(dashboard, /t\(['"]dashboard\.stats\.totalTextLength['"]\)/);
  assert.match(dashboard, /t\(['"]dashboard\.stats\.savedTime['"]\)/);
  assert.match(dashboard, /t\(['"]dashboard\.stats\.averageSpeed['"]\)/);
  assert.match(dashboard, /t\(['"]dashboard\.personalization\.label['"]\)/);
  assert.match(i18n, /['"]dashboard\.stats\.totalDuration['"]:\s*['"]总听写时长['"]/);
  assert.match(i18n, /['"]dashboard\.stats\.totalTextLength['"]:\s*['"]累计听写字数['"]/);
  assert.match(i18n, /['"]dashboard\.stats\.savedTime['"]:\s*['"]节省时间['"]/);
  assert.match(i18n, /['"]dashboard\.stats\.averageSpeed['"]:\s*['"]平均速度['"]/);
  assert.match(i18n, /['"]dashboard\.personalization\.label['"]:\s*['"]整体个性化['"]/);
  assert.doesNotMatch(dashboard, /dashboard\.personalization\.value/);
  assert.doesNotMatch(i18n, /dashboard\.personalization\.value/);
  assert.doesNotMatch(dashboard, /23\.4%/);
  assert.doesNotMatch(dashboard, /conic-gradient\(#44bedf 0% 23\.4%/);
});

test('P1 首页累计统计来自独立 stats 文件，不受最近 200 条历史裁剪影响', async () => {
  const main = await readMainProcessSurface();
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
  const historyPersistence = await readProjectFile('src/components/useVoiceHistoryPersistence.ts');
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');

  assert.match(appShell, /useVoiceHistoryPersistence/);
  assert.match(historyPersistence, /subscribeVoiceSession/);
  assert.match(historyPersistence, /saveVoiceHistory/);
  assert.match(historyPersistence, /saveVoiceHistoryRetryAudio/);
  assert.match(historyPersistence, /retryAudioWavBase64/);
  assert.match(historyPersistence, /savedAudioIds/);
  assert.match(historyPersistence, /voiceSession\.status\s*!==\s*['"]completed['"][\s\S]*voiceSession\.status\s*!==\s*['"]error['"]/);
  assert.match(historyPersistence, /id:\s*audioId/);
  assert.match(historyPersistence, /durationMs:\s*voiceSession\.durationMs/);
  assert.match(historyPersistence, /textLength:\s*voiceSession\.textLength/);
  assert.doesNotMatch(dashboard, /saveVoiceHistory/);
  assert.doesNotMatch(dashboard, /savedAudioIds/);
});

test('P1 录音链路使用设置页选择的真实麦克风设备', async () => {
  const recorder = await readProjectFile('src/services/recorder.ts');
  const audioCapture = await readProjectFile('src/services/voice/audioCapture.ts');
  const recordingStartup = await readProjectFile('src/services/voice/recordingStartup.ts');

  assert.match(recorder, /from ['"]\.\/voice\/recordingTransportRuntime['"]/);
  assert.match(recorder, /from ['"]\.\/voice\/voiceSessionLifecycle['"]/);
  assert.match(recordingStartup, /from ['"]\.\/audioCapture['"]/);
  assert.match(audioCapture, /getSelectedAudioDeviceId/);
  assert.match(recordingStartup, /getTranslationTargetLanguage/);
  assert.match(audioCapture, /selectedAudioDeviceId/);
  assert.match(recordingStartup, /output_language/);
  assert.match(audioCapture, /deviceId:\s*\{\s*exact:\s*selectedAudioDeviceId\s*\}/);
  assert.doesNotMatch(recorder, /recordingStartedAt/);
  assert.match(recorder, /durationMs/);
  assert.match(recorder, /textLength/);
});

test('主窗口不再包含诊断页和诊断专用服务', async () => {
  const navigation = await readProjectFile('src/navigation.ts');
  const sidebar = await readProjectFile('src/components/Sidebar.tsx');
  const appShell = await readProjectFile('src/components/AppShell.tsx');

  await assert.rejects(
    () => readProjectFile('src/services/diagnostics.ts'),
    /ENOENT/,
  );
  await assert.rejects(
    () => readProjectFile('src/pages/Diagnostics.tsx'),
    /ENOENT/,
  );
  assert.match(navigation, /export\s+type\s+Page/);
  assert.doesNotMatch(navigation, /Diagnostics/);
  assert.doesNotMatch(navigation, /diagnostics/);
  assert.doesNotMatch(navigation, /诊断/);
  assert.doesNotMatch(sidebar, /BugReportIcon/);
  assert.doesNotMatch(appShell, /Diagnostics/);
});

test('首页壳层和用户可见文案符合 SpeakMore 中文化要求', async () => {
  const navigation = await readProjectFile('src/navigation.ts');
  const sidebar = await readProjectFile('src/components/Sidebar.tsx');
  const appShell = await readProjectFile('src/components/AppShell.tsx');
  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  const historyPanel = await readProjectFile('src/pages/dashboard/HistoryResultsPanel.tsx');
  const floatingBar = await readProjectFile('public/floating-bar.html');
  const i18n = await readProjectFile('src/i18n.tsx');
  const main = await readMainProcessSurface();

  assert.match(navigation, /labelKey:\s*['"]nav\.home['"]/);
  assert.match(navigation, /labelKey:\s*['"]nav\.settings['"]/);
  assert.match(i18n, /['"]nav\.home['"]:\s*['"]首页['"]/);
  assert.match(i18n, /['"]nav\.settings['"]:\s*['"]设置['"]/);
  assert.doesNotMatch(navigation, /['"]history['"]|nav\.history/);
  assert.doesNotMatch(appShell, /pages\/History|<History/);
  assert.doesNotMatch(i18n, /nav\.history/);
  assert.match(sidebar, /SpeakMore/);
  assert.doesNotMatch(sidebar, /bgcolor:\s*['"]#000['"]/);
  assert.doesNotMatch(sidebar, /Voice dictation/);
  assert.doesNotMatch(appShell, /Typeless Local/);
  assert.match(dashboard, /t\(['"]dashboard\.title['"]\)/);
  assert.match(historyPanel, /t\(['"]dashboard\.recentResults['"]\)/);
  assert.match(i18n, /['"]dashboard\.title['"]:\s*['"]首页['"]/);
  assert.match(i18n, /['"]dashboard\.recentResults['"]:\s*['"]最近结果['"]/);
  assert.match(floatingBar, /正在听写/);
  assert.doesNotMatch(floatingBar, /Listening\.\.\./);
  assert.match(main, /title:\s*['"]SpeakMore['"]/);
  assert.match(main, /tray\.setToolTip\(['"]SpeakMore['"]\)/);
  assert.doesNotMatch(main, /显示悬浮条/);
});

test('主页面一级标题复用设置页的左上基准和字号', async () => {
  const uiTokens = await readProjectFile('src/uiTokens.ts');
  const pageFiles = [
    'src/pages/Dashboard.tsx',
    'src/pages/Dictionary.tsx',
    'src/pages/Shortcuts.tsx',
    'src/pages/MeetingNotes.tsx',
    'src/pages/Settings.tsx',
  ];

  assert.match(uiTokens, /export\s+const\s+pageSx\s*=\s*\{/);
  assert.match(uiTokens, /p:\s*3/);
  assert.doesNotMatch(uiTokens, /mx:\s*['"]auto['"]/);
  assert.match(uiTokens, /export\s+const\s+adaptivePageSx\s*=\s*\{/);
  assert.match(uiTokens, /maxWidth:\s*['"]none['"]/);
  assert.match(uiTokens, /export\s+const\s+adaptiveAutoGridSx\s*=\s*\{/);
  assert.match(uiTokens, /repeat\(auto-fit,\s*minmax\(min\(420px,\s*100%\),\s*1fr\)\)/);
  assert.match(uiTokens, /export\s+const\s+pageTitleSx\s*=\s*\{/);
  assert.match(uiTokens, /fontSize:\s*24/);
  assert.match(uiTokens, /fontWeight:\s*500/);
  assert.match(uiTokens, /export\s+const\s+pageDescriptionSx\s*=\s*\{/);
  assert.match(uiTokens, /fontSize:\s*14/);
  assert.match(uiTokens, /export\s+const\s+sectionTitleSx\s*=\s*\{/);
  assert.match(uiTokens, /fontSize:\s*16/);
  assert.match(uiTokens, /export\s+const\s+itemTitleSx\s*=\s*\{/);
  assert.match(uiTokens, /fontSize:\s*15/);
  assert.match(uiTokens, /export\s+const\s+helperTextSx\s*=\s*\{/);
  assert.match(uiTokens, /fontSize:\s*13/);
  assert.match(uiTokens, /export\s+const\s+captionTextSx\s*=\s*\{/);
  assert.match(uiTokens, /fontSize:\s*12/);

  for (const pageFile of pageFiles) {
    const page = await readProjectFile(pageFile);
    assert.match(page, /adaptivePageSx/);
    assert.match(page, /pageTitleSx/);
    assert.doesNotMatch(page, /mx:\s*['"]auto['"]/);
  }

  const adaptiveMainPages = [
    'src/pages/Dashboard.tsx',
    'src/pages/Dictionary.tsx',
    'src/pages/Shortcuts.tsx',
    'src/pages/Settings.tsx',
  ];
  for (const pageFile of adaptiveMainPages) {
    const page = await readProjectFile(pageFile);
    assert.doesNotMatch(page, /maxWidth:\s*(680|920|980)/);
  }

  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  const settings = await readProjectFile('src/pages/Settings.tsx');
  assert.doesNotMatch(dashboard, /gridTemplateColumns:\s*['"]1fr 1fr['"]/);
  assert.doesNotMatch(settings, /adaptiveAutoGridSx/);
  assert.match(settings, /const\s+settingsContentSx\s*=\s*\{/);
  assert.match(settings, /maxWidth:\s*1080/);
  assert.match(settings, /flexDirection:\s*['"]column['"]/);

  const meetingNotes = await readProjectFile('src/pages/MeetingNotes.tsx');
  assert.doesNotMatch(meetingNotes, /fontSize:\s*(30|38|42|58)/);
  assert.match(meetingNotes, /<Typography\s+sx=\{pageTitleSx\}>\s*\{t\(['"]meeting\.title['"]\)\}/);
  assert.match(meetingNotes, /gridTemplateColumns:\s*\{\s*xs:\s*['"]1fr['"],\s*sm:\s*['"]repeat\(2, minmax\(0, 1fr\)\)['"],\s*md:\s*['"]repeat\(3, minmax\(0, 1fr\)\)['"]\s*\}/);
  assert.match(meetingNotes, /maxWidth:\s*['"]none['"]/);
});

test('除首页个性化进度和悬浮粒子外主前端页面不使用蓝色状态色', async () => {
  const files = [
    'src/theme.ts',
    'src/pages/Dictionary.tsx',
    'src/pages/Shortcuts.tsx',
    'src/pages/MeetingNotes.tsx',
    'src/pages/Settings.tsx',
    'src/uiTokens.ts',
    'public/floating-panel.html',
  ];
  const forbiddenPatterns = [
    /#44bedf/i,
    /color=["']info["']/,
    /rgba\(125,\s*211,\s*252/i,
    /rgba\(56,\s*189,\s*248/i,
    /\bgreen\b/i,
    /#b7791f/i,
  ];

  const dashboard = await readProjectFile('src/pages/Dashboard.tsx');
  assert.match(dashboard, /PERSONALIZATION_BLUE\s*=\s*['"]#2563eb['"]/);
  assert.doesNotMatch(dashboard, /#44bedf/i);

  for (const file of files) {
    const content = await readProjectFile(file);
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(content, pattern, `${file} 不应包含 ${pattern}`);
    }
  }
});
