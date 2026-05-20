function createIpcBridge({
  ipcRenderer,
  processEnv = {},
  processPlatform = process.platform,
}) {
  const keyListeners = {};

  return {
    on(channel, listener) {
      return ipcRenderer.on(channel, listener);
    },
    off(channel, listener) {
      return ipcRenderer.off(channel, listener);
    },
    addKeyListener(channel, key, listener) {
      keyListeners[key] = listener;
      return ipcRenderer.addListener(channel, listener);
    },
    removeKeyListener(channel, key, listener) {
      const savedListener = keyListeners[key];
      return ipcRenderer.removeListener(channel, savedListener || listener);
    },
    send(channel, ...args) {
      return ipcRenderer.send(channel, ...args);
    },
    invoke(channel, ...args) {
      return ipcRenderer.invoke(channel, ...args);
    },
    platform: processEnv.__TYPELESS_CLIENT__RUNTIME_PLATFORM__ || processPlatform,
  };
}

function createElectronApi({ ipcRenderer }) {
  return {
    onToggleRecording: (cb) => ipcRenderer.on('toggle-recording', cb),
    clipboardWrite: (text) => ipcRenderer.invoke('clipboard-write', text),
  };
}

function exposeIpcBridge({
  contextBridge,
  ipcRenderer,
  processEnv = {},
  processPlatform = process.platform,
}) {
  contextBridge.exposeInMainWorld('ipcRenderer', createIpcBridge({
    ipcRenderer,
    processEnv,
    processPlatform,
  }));
}

function exposeElectronApi({ contextBridge, ipcRenderer }) {
  contextBridge.exposeInMainWorld('electronAPI', createElectronApi({ ipcRenderer }));
}

module.exports = {
  createElectronApi,
  createIpcBridge,
  exposeElectronApi,
  exposeIpcBridge,
};
