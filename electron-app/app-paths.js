const path = require('path');

function createAppPaths({
  baseDir = __dirname,
  resourcesPath = path.join(baseDir, '..'),
  isPackaged = false,
  getUserDataPath = () => '',
  processPlatform = process.platform,
} = {}) {
  const pathApi = processPlatform === 'win32' ? path.win32 : path;

  function localDataDir() {
    return pathApi.join(getUserDataPath(), 'local-data');
  }

  function localDataPath(fileName) {
    return pathApi.join(localDataDir(), fileName);
  }

  function resourcePath(...segments) {
    if (isPackaged) return pathApi.join(resourcesPath, ...segments);
    return pathApi.join(baseDir, ...segments);
  }

  function packagedResourcePath(...segments) {
    return isPackaged
      ? pathApi.join(resourcesPath, ...segments)
      : pathApi.join(baseDir, '..', 'release-artifacts', ...segments);
  }

  function unpackedAppPath(...segments) {
    const unpackedBaseDir = isPackaged
      ? baseDir.replace(`${pathApi.sep}app.asar${pathApi.sep}`, `${pathApi.sep}app.asar.unpacked${pathApi.sep}`)
      : baseDir;
    return pathApi.join(unpackedBaseDir, ...segments);
  }

  function executableName(baseName) {
    return processPlatform === 'win32' ? `${baseName}.exe` : baseName;
  }

  return {
    localDataDir,
    localDataPath,
    logFilePath: () => localDataPath('recording.log'),
    recordingsDir: () => localDataPath('recordings'),
    preloadPath: () => pathApi.join(baseDir, 'preload.js'),
    iconPath: () => resourcePath('assets', 'app-icon.png'),
    // macOS 菜单栏用黑色 + 透明的模板图标，系统会按菜单栏明暗自动着色；Windows 托盘用彩色底板图标。
    trayIconPath: () => resourcePath('assets', processPlatform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon.png'),
    rightAltListenerPath: () => unpackedAppPath('right-alt-listener.ps1'),
    macosOptionListenerPath: () => unpackedAppPath('macos-option-listener.c'),
    macosPlatformHelperPath: () => unpackedAppPath('macos-platform-helper.m'),
    audioSessionControlPath: () => unpackedAppPath('audio-session-control.ps1'),
    backendExecutablePath: () => packagedResourcePath('backend', executableName('speakmore-backend')),
    ffmpegExecutablePath: () => packagedResourcePath('ffmpeg', 'bin', executableName('ffmpeg')),
    textObserverExecutablePath: () => packagedResourcePath('helper', executableName('WindowsTextObserver')),
    dotnetRootPath: () => packagedResourcePath('dotnet'),
    resourcePath,
    packagedResourcePath,
    unpackedAppPath,
  };
}

module.exports = {
  createAppPaths,
};
