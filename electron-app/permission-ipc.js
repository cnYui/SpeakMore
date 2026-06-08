function registerPermissionIpcHandlers({
  app = null,
  ipcMain,
  macosPlatformCapabilities = null,
  processExecPath = process.execPath,
  processPlatform = process.platform,
  systemPreferences = null,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }

  function isMacOS() {
    return processPlatform === 'darwin';
  }

  function macosCapabilityUnavailable() {
    return {
      success: false,
      source: 'macos_platform',
      confidence: 'none',
      reason: isMacOS() ? 'macos_capability_unavailable' : 'not_macos',
    };
  }

  function isPackagedApp() {
    return Boolean(app?.isPackaged);
  }

  function getAutoLaunchOptions() {
    return {
      path: processExecPath,
      args: ['--hidden'],
    };
  }

  function readAutoLaunchStatus() {
    if (!app || typeof app.getLoginItemSettings !== 'function') {
      return { success: false, enabled: false, code: 'auto_launch_unavailable' };
    }

    try {
      const status = app.getLoginItemSettings(getAutoLaunchOptions());
      return {
        success: true,
        enabled: Boolean(status?.openAtLogin),
        openAsHidden: Boolean(status?.openAsHidden),
      };
    } catch (error) {
      return {
        success: false,
        enabled: false,
        code: 'auto_launch_status_failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function readMacOSAppAccessibilityStatus() {
    if (!isMacOS() || typeof systemPreferences?.isTrustedAccessibilityClient !== 'function') {
      return null;
    }

    try {
      const trusted = systemPreferences.isTrustedAccessibilityClient(false);
      return {
        success: true,
        source: 'electron_system_preferences',
        confidence: trusted ? 'confirmed' : 'none',
        trusted,
        reason: trusted ? 'accessibility_trusted' : 'macos_accessibility_permission_missing',
      };
    } catch (error) {
      return {
        success: false,
        source: 'electron_system_preferences',
        confidence: 'none',
        trusted: false,
        reason: 'macos_accessibility_status_failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  ipcMain.handle('permission:request', () => true);
  ipcMain.handle('permission:check-with-child-process', () => true);
  ipcMain.handle('permission:reset-accessibility-permission', () => true);
  ipcMain.handle('permission:macos-accessibility-status', () => {
    const appStatus = readMacOSAppAccessibilityStatus();
    if (appStatus?.success) return appStatus;

    if (!isMacOS() || !macosPlatformCapabilities?.getAccessibilityStatus) {
      return appStatus || macosCapabilityUnavailable();
    }
    return macosPlatformCapabilities.getAccessibilityStatus();
  });
  ipcMain.handle('permission:open-macos-accessibility-settings', () => {
    if (!isMacOS() || !macosPlatformCapabilities?.openAccessibilitySettings) {
      return macosCapabilityUnavailable();
    }
    return macosPlatformCapabilities.openAccessibilitySettings();
  });
  ipcMain.handle('permission:macos-platform-diagnostics', (_, payload = {}) => {
    if (!isMacOS() || !macosPlatformCapabilities?.getDiagnostics) {
      return macosCapabilityUnavailable();
    }
    return macosPlatformCapabilities.getDiagnostics({
      includeClipboard: Boolean(payload?.includeClipboard),
      includeEventInjection: Boolean(payload?.includeEventInjection),
    });
  });
  ipcMain.handle('permission:get-auto-launch-status', () => readAutoLaunchStatus());
  ipcMain.handle('permission:update-auto-launch', (_, payload = {}) => {
    const enable = Boolean(payload?.enable);

    if (!isPackagedApp()) {
      return {
        success: true,
        skipped: true,
        enabled: enable,
        code: 'auto_launch_dev_skipped',
      };
    }

    if (!app || typeof app.setLoginItemSettings !== 'function') {
      return {
        success: false,
        skipped: false,
        enabled: false,
        code: 'auto_launch_unavailable',
      };
    }

    try {
      app.setLoginItemSettings({
        openAtLogin: enable,
        ...getAutoLaunchOptions(),
      });
      const status = readAutoLaunchStatus();
      if (!status.success) return status;
      return {
        success: status.enabled === enable,
        skipped: false,
        enabled: status.enabled,
        code: status.enabled === enable ? undefined : 'auto_launch_status_mismatch',
      };
    } catch (error) {
      return {
        success: false,
        skipped: false,
        enabled: false,
        code: 'auto_launch_update_failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle('permission:update-show-app-in-dock', () => true);

  ipcMain.handle('updater:check-for-update', () => null);
  ipcMain.handle('updater:download-update', () => null);
  ipcMain.handle('updater:quit-and-install', () => null);
  ipcMain.handle('updater:check-update-and-download-silently', () => null);
}

module.exports = {
  registerPermissionIpcHandlers,
};
