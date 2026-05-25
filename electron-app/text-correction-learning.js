function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripPunctuation(value) {
  return normalizeText(value).replace(/[，。！？、,.!?;；:：'"“”‘’（）()\[\]{}<>《》]/g, '');
}

function normalizeComparableText(value) {
  return stripPunctuation(value).toLowerCase();
}

function hasAsciiToken(value) {
  return /[A-Za-z0-9]/.test(value);
}

function commonPrefixLength(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left, right, prefixLength) {
  let length = 0;
  while (
    length + prefixLength < left.length
    && length + prefixLength < right.length
    && left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

function createWordSegmenter() {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  try {
    return new Intl.Segmenter('zh-CN', { granularity: 'word' });
  } catch {
    return null;
  }
}

function tokenizeComparableWords(text) {
  const segmenter = createWordSegmenter();
  if (!segmenter) return null;

  return Array.from(segmenter.segment(text))
    .map((part) => {
      const raw = part.segment;
      const comparable = normalizeComparableText(raw);
      return {
        raw,
        comparable,
        start: part.index,
        end: part.index + raw.length,
        isWordLike: part.isWordLike !== false,
      };
    })
    .filter((token) => token.isWordLike && token.comparable);
}

function commonTokenPrefixLength(left, right) {
  let index = 0;
  while (
    index < left.length
    && index < right.length
    && left[index].comparable === right[index].comparable
  ) {
    index += 1;
  }
  return index;
}

function commonTokenSuffixLength(left, right, prefixLength) {
  let length = 0;
  while (
    length + prefixLength < left.length
    && length + prefixLength < right.length
    && left[left.length - 1 - length].comparable === right[right.length - 1 - length].comparable
  ) {
    length += 1;
  }
  return length;
}

function hasSharedComparableToken(leftTokens, rightTokens) {
  const rightValues = new Set(rightTokens.map((token) => token.comparable));
  return leftTokens.some((token) => rightValues.has(token.comparable));
}

function extractTokenCorrectionCandidate(original, edited) {
  const originalTokens = tokenizeComparableWords(original);
  const editedTokens = tokenizeComparableWords(edited);
  if (!originalTokens || !editedTokens || originalTokens.length === 0 || editedTokens.length === 0) {
    return { status: 'unavailable' };
  }

  const prefix = commonTokenPrefixLength(originalTokens, editedTokens);
  const suffix = commonTokenSuffixLength(originalTokens, editedTokens, prefix);

  const originalEndIndex = originalTokens.length - suffix;
  const editedEndIndex = editedTokens.length - suffix;
  if (prefix >= originalEndIndex && prefix >= editedEndIndex) return { status: 'rejected' };

  const originalDiffTokens = originalTokens.slice(prefix, originalEndIndex);
  const editedDiffTokens = editedTokens.slice(prefix, editedEndIndex);
  if (originalDiffTokens.length === 0 || editedDiffTokens.length === 0) return { status: 'rejected' };
  if (hasSharedComparableToken(originalDiffTokens, editedDiffTokens)) return { status: 'rejected' };

  const wrongStart = originalDiffTokens[0].start;
  const wrongEnd = originalDiffTokens[originalDiffTokens.length - 1].end;
  const correctStart = editedDiffTokens[0].start;
  const correctEnd = editedDiffTokens[editedDiffTokens.length - 1].end;

  return {
    status: 'candidate',
    candidate: {
      wrong: normalizeText(original.slice(wrongStart, wrongEnd)),
      correct: normalizeText(edited.slice(correctStart, correctEnd)),
    },
  };
}

function isBoundary(char) {
  return !char || /[\s，。！？、,.!?;；:：'"“”‘’（）()\[\]{}<>《》]/.test(char);
}

function expandToWordBoundary(text, start, end) {
  let nextStart = start;
  let nextEnd = end;

  while (nextStart > 0 && !isBoundary(text[nextStart - 1])) nextStart -= 1;
  while (nextEnd < text.length && !isBoundary(text[nextEnd])) nextEnd += 1;

  return [nextStart, nextEnd];
}

function isLearnableCorrection(candidate) {
  const wrong = normalizeText(candidate?.wrong);
  const correct = normalizeText(candidate?.correct);
  if (!wrong || !correct) return false;
  if (wrong.toLowerCase() === correct.toLowerCase()) return false;
  if (normalizeComparableText(wrong) === normalizeComparableText(correct)) return false;
  if (wrong.length > 40 || correct.length > 40) return false;
  if (wrong.length < 2 || correct.length < 2) return false;

  const tokenLike = hasAsciiToken(wrong + correct);
  if (tokenLike) return true;

  return Math.max(wrong.length, correct.length) <= 8;
}

function extractCorrectionCandidates(originalText, editedText) {
  const original = normalizeText(originalText);
  const edited = normalizeText(editedText);
  if (!original || !edited || original === edited) return [];
  if (normalizeComparableText(original) === normalizeComparableText(edited)) return [];

  const tokenResult = extractTokenCorrectionCandidate(original, edited);
  if (tokenResult.status === 'candidate') {
    return isLearnableCorrection(tokenResult.candidate) ? [tokenResult.candidate] : [];
  }
  if (tokenResult.status === 'rejected') return [];

  const prefix = commonPrefixLength(original, edited);
  const suffix = commonSuffixLength(original, edited, prefix);
  const originalRange = expandToWordBoundary(original, prefix, original.length - suffix);
  const editedRange = expandToWordBoundary(edited, prefix, edited.length - suffix);

  const candidate = {
    wrong: normalizeText(original.slice(originalRange[0], originalRange[1])),
    correct: normalizeText(edited.slice(editedRange[0], editedRange[1])),
  };

  return isLearnableCorrection(candidate) ? [candidate] : [];
}

module.exports = {
  extractCorrectionCandidates,
  isLearnableCorrection,
};
