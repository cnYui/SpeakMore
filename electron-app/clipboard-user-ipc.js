function registerClipboardUserIpcHandlers({
  ipcMain,
  clipboard,
  getLocalUser,
  setLocalUser,
  emitUserStateChange = () => undefined,
  emitUserRoleChange = () => undefined,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    throw new Error('clipboard.writeText is required');
  }
  if (typeof getLocalUser !== 'function' || typeof setLocalUser !== 'function') {
    throw new Error('getLocalUser and setLocalUser are required');
  }

  ipcMain.handle('clipboard-write', (_, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  ipcMain.handle('clipboard:write-text', (_, text) => {
    clipboard.writeText(String(text || ''));
    return { success: true };
  });

  ipcMain.handle('user:get-current', () => getLocalUser());
  ipcMain.handle('user:is-logged-in', () => true);
  ipcMain.handle('user:login', (_, payload = {}) => {
    const currentUser = getLocalUser();
    const nextUser = {
      ...currentUser,
      ...(payload || {}),
      subscription: {
        ...(currentUser?.subscription || {}),
        ...(payload?.subscription || {}),
      },
    };
    setLocalUser(nextUser);
    emitUserStateChange(nextUser);
    emitUserRoleChange(nextUser);
    return true;
  });
  ipcMain.handle('user:logout', () => {
    emitUserStateChange(getLocalUser());
    return true;
  });
}

module.exports = {
  registerClipboardUserIpcHandlers,
};
