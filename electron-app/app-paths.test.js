const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createAppPaths } = require('./app-paths');

test('createAppPaths 生成本地数据和辅助路径', () => {
  const appPaths = createAppPaths({
    baseDir: 'D:\\CodeWorkSpace\\typeless\\electron-app',
    getUserDataPath: () => 'C:\\Users\\yui\\AppData\\Roaming\\SpeakMore',
  });

  assert.equal(appPaths.localDataDir(), path.join('C:\\Users\\yui\\AppData\\Roaming\\SpeakMore', 'local-data'));
  assert.equal(appPaths.localDataPath('settings.json'), path.join('C:\\Users\\yui\\AppData\\Roaming\\SpeakMore', 'local-data', 'settings.json'));
  assert.equal(appPaths.logFilePath(), path.join('C:\\Users\\yui\\AppData\\Roaming\\SpeakMore', 'local-data', 'recording.log'));
  assert.equal(appPaths.recordingsDir(), path.join('C:\\Users\\yui\\AppData\\Roaming\\SpeakMore', 'local-data', 'recordings'));
  assert.equal(appPaths.preloadPath(), path.join('D:\\CodeWorkSpace\\typeless\\electron-app', 'preload.js'));
  assert.equal(appPaths.iconPath(), path.join('D:\\CodeWorkSpace\\typeless', 'app-extracted', 'build', 'icons', 'png', '32x32.png'));
  assert.equal(appPaths.trayIconPath(), path.join('D:\\CodeWorkSpace\\typeless', 'app-extracted', 'build', 'tray-win32.png'));
  assert.equal(appPaths.rightAltListenerPath(), path.join('D:\\CodeWorkSpace\\typeless\\electron-app', 'right-alt-listener.ps1'));
  assert.equal(appPaths.audioSessionControlPath(), path.join('D:\\CodeWorkSpace\\typeless\\electron-app', 'audio-session-control.ps1'));
  assert.equal(appPaths.textObserverExecutablePath(), path.join('D:\\CodeWorkSpace\\typeless\\electron-app', 'windows-text-observer', 'bin', 'Debug', 'net8.0-windows', 'WindowsTextObserver.exe'));
});
