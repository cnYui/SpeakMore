const {
  deleteShortcutCommand,
  mergeShortcutCommands,
  upsertShortcutCommand,
} = require('./shortcut-command-store');

function createShortcutCommandRepository({
  readJsonFile,
  writeJsonFile,
  fileName = 'shortcut-commands.json',
} = {}) {
  if (typeof readJsonFile !== 'function') {
    throw new Error('readJsonFile is required');
  }
  if (typeof writeJsonFile !== 'function') {
    throw new Error('writeJsonFile is required');
  }

  function readRawCommands() {
    const value = readJsonFile(fileName, []);
    return Array.isArray(value) ? value : [];
  }

  function readShortcutCommands() {
    return mergeShortcutCommands(readRawCommands());
  }

  function writeShortcutCommands(commands) {
    return writeJsonFile(fileName, mergeShortcutCommands(commands));
  }

  function upsertCommand(payload = {}) {
    const nextCommands = upsertShortcutCommand(readShortcutCommands(), payload);
    writeShortcutCommands(nextCommands);
    return nextCommands.find((command) => command.id === payload.id) || nextCommands[0] || null;
  }

  function deleteCommand(id) {
    const before = readShortcutCommands();
    const nextCommands = deleteShortcutCommand(before, id);
    writeShortcutCommands(nextCommands);
    return {
      success: nextCommands.length !== before.length,
      commands: nextCommands,
    };
  }

  return {
    readShortcutCommands,
    writeShortcutCommands,
    upsertCommand,
    deleteCommand,
  };
}

module.exports = {
  createShortcutCommandRepository,
};
