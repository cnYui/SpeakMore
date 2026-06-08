function createShortcutCommandRegistrar({
  globalShortcut,
  readShortcutCommands,
  emitTriggered = () => undefined,
  logger = console,
} = {}) {
  if (!globalShortcut || typeof globalShortcut.register !== 'function') {
    throw new Error('globalShortcut is required');
  }
  if (typeof readShortcutCommands !== 'function') {
    throw new Error('readShortcutCommands is required');
  }

  const registeredAccelerators = new Set();
  let registrationStatus = {};

  function unregisterOwnedAccelerators() {
    for (const accelerator of registeredAccelerators) {
      try {
        globalShortcut.unregister?.(accelerator);
      } catch (error) {
        logger.warn?.('[shortcut-command] failed to unregister accelerator', {
          accelerator,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    registeredAccelerators.clear();
  }

  function createStatus(command, status, detail = '') {
    return {
      id: command.id,
      name: command.name,
      shortcut: command.shortcut,
      status,
      detail,
      updatedAt: new Date().toISOString(),
    };
  }

  function registerAll() {
    unregisterOwnedAccelerators();
    const nextStatus = {};
    const usedAccelerators = new Set();
    const commands = readShortcutCommands();

    for (const command of commands) {
      const accelerator = command.shortcut?.accelerator || '';
      if (!command.enabled) {
        nextStatus[command.id] = createStatus(command, 'disabled');
        continue;
      }
      if (!accelerator || command.shortcut?.fixed) {
        nextStatus[command.id] = createStatus(command, command.shortcut?.fixed ? 'fixed' : 'unassigned');
        continue;
      }
      if (usedAccelerators.has(accelerator)) {
        nextStatus[command.id] = createStatus(command, 'conflict', 'duplicate_accelerator');
        continue;
      }

      try {
        const registered = globalShortcut.register(accelerator, () => {
          emitTriggered(command);
        });
        if (!registered) {
          nextStatus[command.id] = createStatus(command, 'failed', 'accelerator_unavailable');
          continue;
        }
        usedAccelerators.add(accelerator);
        registeredAccelerators.add(accelerator);
        nextStatus[command.id] = createStatus(command, 'registered');
      } catch (error) {
        nextStatus[command.id] = createStatus(
          command,
          'invalid',
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    registrationStatus = nextStatus;
    return registrationStatus;
  }

  function getRegistrationStatus() {
    return registrationStatus;
  }

  function dispose() {
    unregisterOwnedAccelerators();
    registrationStatus = {};
  }

  return {
    registerAll,
    getRegistrationStatus,
    dispose,
  };
}

module.exports = {
  createShortcutCommandRegistrar,
};
