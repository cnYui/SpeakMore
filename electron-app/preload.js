const { contextBridge, ipcRenderer } = require('electron');
const {
  exposeElectronApi,
  exposeIpcBridge,
} = require('./preload-ipc-bridge');
const {
  installMobileAppSurfaceRemoval,
} = require('./preload-mobile-surface-filter');

installMobileAppSurfaceRemoval();

exposeIpcBridge({
  contextBridge,
  ipcRenderer,
  processEnv: process.env,
  processPlatform: process.platform,
});
exposeElectronApi({ contextBridge, ipcRenderer });
