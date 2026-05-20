const {
  normalizeDictionaryEntry,
  normalizeDictionaryCandidate,
  upsertDictionaryEntry,
  buildPromptDictionaryTerms,
  learnDictionaryCandidate,
} = require('./dictionary-store');
const {
  createDictionaryEntryResult,
  updateDictionaryEntryResult,
} = require('./dictionary-actions');

function createDictionaryRepository({
  readJsonFile,
  writeJsonFile,
  dictionaryFileName = 'dictionary.json',
  candidatesFileName = 'dictionary-candidates.json',
} = {}) {
  if (typeof readJsonFile !== 'function') {
    throw new Error('readJsonFile is required');
  }
  if (typeof writeJsonFile !== 'function') {
    throw new Error('writeJsonFile is required');
  }

  function readDictionaryEntries() {
    const value = readJsonFile(dictionaryFileName, []);
    if (!Array.isArray(value)) return [];
    return value.map(normalizeDictionaryEntry).filter((entry) => entry.phrase);
  }

  function writeDictionaryEntries(entries) {
    return writeJsonFile(
      dictionaryFileName,
      entries.map(normalizeDictionaryEntry).filter((entry) => entry.phrase),
    );
  }

  function readDictionaryCandidates() {
    const value = readJsonFile(candidatesFileName, []);
    if (!Array.isArray(value)) return [];
    return value.map(normalizeDictionaryCandidate).filter((candidate) => candidate.wrong && candidate.correct);
  }

  function writeDictionaryCandidates(candidates) {
    return writeJsonFile(
      candidatesFileName,
      candidates.map(normalizeDictionaryCandidate).filter((candidate) => candidate.wrong && candidate.correct),
    );
  }

  function readPromptDictionaryTerms() {
    return buildPromptDictionaryTerms(readDictionaryEntries());
  }

  function learnDictionaryCorrection(candidate) {
    const result = learnDictionaryCandidate(readDictionaryCandidates(), candidate);
    writeDictionaryCandidates(result.candidates);
    if (result.promotedEntry) {
      writeDictionaryEntries(upsertDictionaryEntry(readDictionaryEntries(), result.promotedEntry));
    }
    return result;
  }

  function createEntry(payload = {}, now = new Date().toISOString()) {
    const result = createDictionaryEntryResult(readDictionaryEntries(), payload, now);
    if (result.success) writeDictionaryEntries(result.entries);
    return { success: result.success, code: result.code, data: result.data };
  }

  function updateEntry(payload = {}, now = new Date().toISOString()) {
    const result = updateDictionaryEntryResult(readDictionaryEntries(), payload, now);
    if (result.success) writeDictionaryEntries(result.entries);
    return { success: result.success, code: result.code, data: result.data };
  }

  function deleteEntry(id) {
    writeDictionaryEntries(readDictionaryEntries().filter((entry) => entry.id !== id));
    return { success: true };
  }

  function promoteCandidate(id, now = new Date().toISOString()) {
    const candidates = readDictionaryCandidates();
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate) return { success: false, code: 'dictionary_candidate_not_found' };

    const entries = upsertDictionaryEntry(readDictionaryEntries(), {
      phrase: candidate.correct,
      aliases: [candidate.wrong],
      source: 'auto',
      status: 'active',
      hitCount: candidate.count,
      lastLearnedAt: now,
    }, now);
    const nextCandidates = candidates.map((item) => (
      item.id === id ? normalizeDictionaryCandidate({ ...item, status: 'promoted', lastSeenAt: now }) : item
    ));
    writeDictionaryEntries(entries);
    writeDictionaryCandidates(nextCandidates);
    const promoted = entries.find((entry) => entry.phrase.toLowerCase() === candidate.correct.toLowerCase()) || entries[0] || null;
    return { success: Boolean(promoted), data: promoted };
  }

  function ignoreCandidate(id) {
    writeDictionaryCandidates(readDictionaryCandidates().map((item) => (
      item.id === id ? normalizeDictionaryCandidate({ ...item, status: 'ignored' }) : item
    )));
    return { success: true };
  }

  return {
    readDictionaryEntries,
    writeDictionaryEntries,
    readDictionaryCandidates,
    writeDictionaryCandidates,
    readPromptDictionaryTerms,
    learnDictionaryCorrection,
    createEntry,
    updateEntry,
    deleteEntry,
    promoteCandidate,
    ignoreCandidate,
  };
}

module.exports = {
  createDictionaryRepository,
};
