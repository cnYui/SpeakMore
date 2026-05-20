function registerDictionaryIpcHandlers({
  ipcMain,
  dictionaryRepository,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!dictionaryRepository) {
    throw new Error('dictionaryRepository is required');
  }

  ipcMain.handle('dictionary:list', () => dictionaryRepository.readDictionaryEntries());
  ipcMain.handle('dictionary:create', (_, payload = {}) => dictionaryRepository.createEntry(payload));
  ipcMain.handle('dictionary:update', (_, payload = {}) => dictionaryRepository.updateEntry(payload));
  ipcMain.handle('dictionary:delete', (_, id) => dictionaryRepository.deleteEntry(id));
  ipcMain.handle('dictionary:candidates-list', () => dictionaryRepository.readDictionaryCandidates());
  ipcMain.handle('dictionary:candidate-promote', (_, id) => dictionaryRepository.promoteCandidate(id));
  ipcMain.handle('dictionary:candidate-ignore', (_, id) => dictionaryRepository.ignoreCandidate(id));
  ipcMain.handle('dictionary:prompt-terms', () => dictionaryRepository.readPromptDictionaryTerms());
}

module.exports = {
  registerDictionaryIpcHandlers,
};
