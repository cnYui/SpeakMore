const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createAppPaths } = require('./app-paths');

test('createAppPaths 生成本地数据和辅助路径', () => {
  const winPath = path.win32;
  const appPaths = createAppPaths({
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    getUserDataPath: () => 'C:\\Users\\tester\\AppData\\Roaming\\SpeakMore',
    processPlatform: 'win32',
  });

  assert.equal(appPaths.localDataDir(), winPath.join('C:\\Users\\tester\\AppData\\Roaming\\SpeakMore', 'local-data'));
  assert.equal(appPaths.localDataPath('settings.json'), winPath.join('C:\\Users\\tester\\AppData\\Roaming\\SpeakMore', 'local-data', 'settings.json'));
  assert.equal(appPaths.logFilePath(), winPath.join('C:\\Users\\tester\\AppData\\Roaming\\SpeakMore', 'local-data', 'recording.log'));
  assert.equal(appPaths.recordingsDir(), winPath.join('C:\\Users\\tester\\AppData\\Roaming\\SpeakMore', 'local-data', 'recordings'));
  assert.equal(appPaths.preloadPath(), winPath.join('C:\\repo\\SpeakMore\\electron-app', 'preload.js'));
  assert.equal(appPaths.iconPath(), winPath.join('C:\\repo\\SpeakMore\\electron-app', 'assets', 'tray-placeholder.png'));
  assert.equal(appPaths.trayIconPath(), winPath.join('C:\\repo\\SpeakMore\\electron-app', 'assets', 'tray-placeholder.png'));
  assert.equal(appPaths.rightAltListenerPath(), winPath.join('C:\\repo\\SpeakMore\\electron-app', 'right-alt-listener.ps1'));
  assert.equal(appPaths.macosOptionListenerPath(), winPath.join('C:\\repo\\SpeakMore\\electron-app', 'macos-option-listener.c'));
  assert.equal(appPaths.macosPlatformHelperPath(), winPath.join('C:\\repo\\SpeakMore\\electron-app', 'macos-platform-helper.m'));
  assert.equal(appPaths.audioSessionControlPath(), winPath.join('C:\\repo\\SpeakMore\\electron-app', 'audio-session-control.ps1'));
  assert.equal(appPaths.llamaServerPath(), winPath.join('C:\\repo\\SpeakMore\\release-artifacts', 'llama', 'llama-server.exe'));
  assert.equal(appPaths.hyMtLlamaServerPath(), winPath.join('C:\\repo\\SpeakMore\\release-artifacts', 'llama-stq', 'llama-server.exe'));
  assert.equal(appPaths.textObserverExecutablePath(), winPath.join('C:\\repo\\SpeakMore\\release-artifacts', 'helper', 'WindowsTextObserver.exe'));
  assert.equal(appPaths.dotnetRootPath(), winPath.join('C:\\repo\\SpeakMore\\release-artifacts', 'dotnet'));
});

test('createAppPaths 在打包态使用 resources 目录中的发布资源', () => {
  const winPath = path.win32;
  const appPaths = createAppPaths({
    baseDir: 'C:\\Program Files\\SpeakMore\\resources\\app.asar\\electron-app',
    resourcesPath: 'C:\\Program Files\\SpeakMore\\resources',
    isPackaged: true,
    getUserDataPath: () => 'C:\\Users\\tester\\AppData\\Roaming\\SpeakMore',
    processPlatform: 'win32',
  });

  assert.equal(appPaths.iconPath(), winPath.join('C:\\Program Files\\SpeakMore\\resources', 'assets', 'tray-placeholder.png'));
  assert.equal(appPaths.trayIconPath(), winPath.join('C:\\Program Files\\SpeakMore\\resources', 'assets', 'tray-placeholder.png'));
  assert.equal(appPaths.backendExecutablePath(), winPath.join('C:\\Program Files\\SpeakMore\\resources', 'backend', 'speakmore-backend.exe'));
  assert.equal(appPaths.llamaServerPath(), winPath.join('C:\\Program Files\\SpeakMore\\resources', 'llama', 'llama-server.exe'));
  assert.equal(appPaths.hyMtLlamaServerPath(), winPath.join('C:\\Program Files\\SpeakMore\\resources', 'llama-stq', 'llama-server.exe'));
  assert.equal(appPaths.ffmpegExecutablePath(), winPath.join('C:\\Program Files\\SpeakMore\\resources', 'ffmpeg', 'bin', 'ffmpeg.exe'));
  assert.equal(appPaths.textObserverExecutablePath(), winPath.join('C:\\Program Files\\SpeakMore\\resources', 'helper', 'WindowsTextObserver.exe'));
  assert.equal(appPaths.rightAltListenerPath(), winPath.join('C:\\Program Files\\SpeakMore\\resources\\app.asar.unpacked\\electron-app', 'right-alt-listener.ps1'));
  assert.equal(appPaths.audioSessionControlPath(), winPath.join('C:\\Program Files\\SpeakMore\\resources\\app.asar.unpacked\\electron-app', 'audio-session-control.ps1'));
});

test('createAppPaths 在 macOS 使用无 exe 后缀的本地可执行资源', () => {
  const posixPath = path.posix;
  const appPaths = createAppPaths({
    baseDir: '/Applications/SpeakMore.app/Contents/Resources/app.asar/electron-app',
    resourcesPath: '/Applications/SpeakMore.app/Contents/Resources',
    isPackaged: true,
    getUserDataPath: () => '/Users/tester/Library/Application Support/SpeakMore',
    processPlatform: 'darwin',
  });

  assert.equal(appPaths.backendExecutablePath(), posixPath.join('/Applications/SpeakMore.app/Contents/Resources', 'backend', 'speakmore-backend'));
  assert.equal(appPaths.llamaServerPath(), posixPath.join('/Applications/SpeakMore.app/Contents/Resources', 'llama', 'llama-server'));
  assert.equal(appPaths.hyMtLlamaServerPath(), posixPath.join('/Applications/SpeakMore.app/Contents/Resources', 'llama-stq', 'llama-server'));
  assert.equal(appPaths.ffmpegExecutablePath(), posixPath.join('/Applications/SpeakMore.app/Contents/Resources', 'ffmpeg', 'bin', 'ffmpeg'));
  assert.equal(appPaths.textObserverExecutablePath(), posixPath.join('/Applications/SpeakMore.app/Contents/Resources', 'helper', 'WindowsTextObserver'));
  assert.equal(appPaths.macosOptionListenerPath(), posixPath.join('/Applications/SpeakMore.app/Contents/Resources/app.asar.unpacked/electron-app', 'macos-option-listener.c'));
  assert.equal(appPaths.macosPlatformHelperPath(), posixPath.join('/Applications/SpeakMore.app/Contents/Resources/app.asar.unpacked/electron-app', 'macos-platform-helper.m'));
});
