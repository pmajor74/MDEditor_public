/**
 * Semantic Chunker
 *
 * Provides intelligent text splitting at semantic boundaries:
 * - Paragraphs (double newlines)
 * - Sentences (period + space/newline)
 * - List items (bullet points)
 */

const { estimateTokens, tokensToChars } = require('./tokenEstimator');

/**
 * Split text at paragraph boundaries (double newlines)
 * @param {string} text - Text to split
 * @returns {string[]} Array of paragraphs
 */
function splitAtParagraphs(text) {
  if (!text) return [];

  // Split on double newlines (with optional whitespace)
  const paragraphs = text.split(/\n\s*\n/);

  // Filter out empty paragraphs and trim whitespace
  return paragraphs
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Split text at sentence boundaries
 * @param {string} text - Text to split
 * @returns {string[]} Array of sentences
 */
function splitAtSentences(text) {
  if (!text) return [];

  // Regex for sentence boundaries:
  // - Period, exclamation, or question mark
  // - Followed by whitespace or end of string
  // - Avoid splitting on abbreviations (Mr., Dr., etc.)
  const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])$/g;

  const sentences = text.split(sentenceRegex);

  return sentences
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Keep list items together when splitting
 * @param {string} text - Text that may contain lists
 * @returns {string[]} Array of text chunks with lists preserved
 */
function splitPreservingLists(text) {
  if (!text) return [];

  const lines = text.split('\n');
  const chunks = [];
  let currentChunk = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if line is a list item
    const isListItem = /^[-*+]\s+/.test(trimmed) ||      // Unordered list
                       /^\d+[.)]\s+/.test(trimmed) ||    // Ordered list
                       /^\[[ x]\]\s+/.test(trimmed);     // Task list

    // Check for blank line
    const isBlank = trimmed.length === 0;

    if (isListItem) {
      if (!inList && currentChunk.length > 0) {
        // Start of new list, save previous chunk
        const chunkText = currentChunk.join('\n').trim();
        if (chunkText) chunks.push(chunkText);
        currentChunk = [];
      }
      inList = true;
      currentChunk.push(line);
    } else if (isBlank) {
      if (inList) {
        // End of list
        const chunkText = currentChunk.join('\n').trim();
        if (chunkText) chunks.push(chunkText);
        currentChunk = [];
        inList = false;
      } else if (currentChunk.length > 0) {
        // Paragraph break
        const chunkText = currentChunk.join('\n').trim();
        if (chunkText) chunks.push(chunkText);
        currentChunk = [];
      }
    } else {
      if (inList) {
        // Non-list line after list, end list
        const chunkText = currentChunk.join('\n').trim();
        if (chunkText) chunks.push(chunkText);
        currentChunk = [line];
        inList = false;
      } else {
        currentChunk.push(line);
      }
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join('\n').trim();
    if (chunkText) chunks.push(chunkText);
  }

  return chunks;
}

/**
 * Find the best split point within text to achieve target size
 * Prioritizes: paragraph > sentence > word boundary
 * @param {string} text - Text to find split point in
 * @param {number} targetTokens - Target size in tokens
 * @param {string} contentType - Content type for token estimation
 * @returns {number} Character index for best split point
 */
function findBestSplitPoint(text, targetTokens, contentType = 'default') {
  if (!text) return 0;

  const targetChars = tokensToChars(targetTokens, contentType);

  // If text is shorter than target, return end
  if (text.length <= targetChars) {
    return text.length;
  }

  // Look for split points in a window around target
  const windowStart = Math.max(0, Math.floor(targetChars * 0.8));
  const windowEnd = Math.min(text.length, Math.ceil(targetChars * 1.2));
  const searchWindow = text.substring(windowStart, windowEnd);

  // Priority 1: Find paragraph break (double newline)
  const paragraphBreak = searchWindow.lastIndexOf('\n\n');
  if (paragraphBreak !== -1) {
    return windowStart + paragraphBreak + 2; // After the double newline
  }

  // Priority 2: Find sentence boundary
  const sentenceMatch = searchWindow.match(/[.!?]\s+(?=[A-Z])/g);
  if (sentenceMatch) {
    // Find the last sentence boundary in window
    let lastSentenceEnd = -1;
    let searchPos = 0;
    for (const match of sentenceMatch) {
      const idx = searchWindow.indexOf(match, searchPos);
      if (idx !== -1) {
        lastSentenceEnd = idx + match.length;
        searchPos = lastSentenceEnd;
      }
    }
    if (lastSentenceEnd !== -1) {
      return windowStart + lastSentenceEnd;
    }
  }

  // Priority 3: Find single newline
  const newlineBreak = searchWindow.lastIndexOf('\n');
  if (newlineBreak !== -1) {
    return windowStart + newlineBreak + 1;
  }

  // Priority 4: Find word boundary (space)
  const spaceBreak = searchWindow.lastIndexOf(' ');
  if (spaceBreak !== -1) {
    return windowStart + spaceBreak + 1;
  }

  // Fallback: Just use target position
  return targetChars;
}

/**
 * Split text into chunks of target token size using semantic boundaries
 * @param {string} text - Text to split
 * @param {number} targetTokens - Target tokens per chunk
 * @param {number} maxTokens - Maximum tokens per chunk (force split)
 * @param {string} contentType - Content type for token estimation
 * @returns {string[]} Array of text chunks
 */
function splitToTargetSize(text, targetTokens = 512, maxTokens = 1024, contentType = 'default') {
  if (!text) return [];

  const textTokens = estimateTokens(text, contentType);

  // If text is small enough, return as single chunk
  if (textTokens <= maxTokens) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    const remainingTokens = estimateTokens(remaining, contentType);

    // If remaining fits in one chunk, we're done
    if (remainingTokens <= maxTokens) {
      chunks.push(remaining.trim());
      break;
    }

    // Find best split point
    const splitPoint = findBestSplitPoint(remaining, targetTokens, contentType);

    if (splitPoint <= 0 || splitPoint >= remaining.length) {
      // Couldn't find good split, force at max size
      const forceChars = tokensToChars(maxTokens, contentType);
      chunks.push(remaining.substring(0, forceChars).trim());
      remaining = remaining.substring(forceChars);
    } else {
      chunks.push(remaining.substring(0, splitPoint).trim());
      remaining = remaining.substring(splitPoint);
    }
  }

  return chunks.filter(c => c.length > 0);
}

/**
 * Merge small chunks together to reach minimum size
 * @param {string[]} chunks - Array of text chunks
 * @param {number} minTokens - Minimum tokens per chunk
 * @param {string} contentType - Content type for token estimation
 * @returns {string[]} Array of merged chunks
 */
function mergeSmallChunks(chunks, minTokens = 50, contentType = 'default') {
  if (!chunks || chunks.length === 0) return [];
  if (chunks.length === 1) return chunks;

  const merged = [];
  let current = '';

  for (const chunk of chunks) {
    const currentTokens = estimateTokens(current, contentType);
    const chunkTokens = estimateTokens(chunk, contentType);

    if (currentTokens === 0) {
      current = chunk;
    } else if (currentTokens < minTokens) {
      // Current is too small, merge with next
      current = current + '\n\n' + chunk;
    } else {
      // Current is big enough, save and start new
      merged.push(current);
      current = chunk;
    }
  }

  // Don't forget the last one
  if (current.length > 0) {
    // If last chunk is tiny, try to merge with previous
    if (merged.length > 0 && estimateTokens(current, contentType) < minTokens) {
      merged[merged.length - 1] += '\n\n' + current;
    } else {
      merged.push(current);
    }
  }

  return merged;
}

module.exports = {
  splitAtParagraphs,
  splitAtSentences,
  splitPreservingLists,
  findBestSplitPoint,
  splitToTargetSize,
  mergeSmallChunks
};
