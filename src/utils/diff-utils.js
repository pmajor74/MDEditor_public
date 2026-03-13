/**
 * Diff Utilities for AI Changes Preview
 *
 * Provides utilities for computing and formatting diffs between
 * original and modified content using the 'diff' npm package.
 */

import * as Diff from 'diff';

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Edit distance
 */
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;

  // Create a 2D array to store distances
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Initialize base cases
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // Fill in the rest of the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity ratio between two strings (0-1)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity ratio (0 = completely different, 1 = identical)
 */
export function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;

  const distance = levenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);

  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

/**
 * Pair similar removed and added lines for side-by-side display
 * This version preserves proper interleaved order based on original positions.
 * @param {string[]} removedLines - Array of removed line contents
 * @param {string[]} addedLines - Array of added line contents
 * @param {number} threshold - Minimum similarity to consider a match (0-1)
 * @returns {Array<{removed: string|null, added: string|null, type: 'modified'|'removed'|'added'}>}
 */
export function pairSimilarLines(removedLines, addedLines, threshold = 0.4) {
  // Step 1: Build similarity matrix and find best matches
  const matches = new Map(); // removedIndex -> addedIndex
  const usedAdded = new Set();

  for (let ri = 0; ri < removedLines.length; ri++) {
    let bestAddedIndex = -1;
    let bestScore = threshold;

    for (let ai = 0; ai < addedLines.length; ai++) {
      if (usedAdded.has(ai)) continue;
      const score = calculateSimilarity(removedLines[ri], addedLines[ai]);
      if (score > bestScore) {
        bestScore = score;
        bestAddedIndex = ai;
      }
    }

    if (bestAddedIndex !== -1) {
      matches.set(ri, bestAddedIndex);
      usedAdded.add(bestAddedIndex);
    }
  }

  // Step 2: Build output preserving proper order
  // We need to interleave unmatched added lines at their correct positions
  const pairs = [];
  let ri = 0;
  let ai = 0;

  while (ri < removedLines.length || ai < addedLines.length) {
    // Check if current removed line has a match
    if (ri < removedLines.length && matches.has(ri)) {
      const matchedAi = matches.get(ri);

      // Output any unmatched added lines before the matched position
      while (ai < matchedAi) {
        if (!usedAdded.has(ai)) {
          pairs.push({ removed: null, added: addedLines[ai], type: 'added' });
        }
        ai++;
      }

      // Output the matched pair
      pairs.push({
        removed: removedLines[ri],
        added: addedLines[matchedAi],
        type: 'modified'
      });
      ri++;
      ai = matchedAi + 1;
    } else if (ri < removedLines.length) {
      // Unmatched removed line - output any pending unmatched added lines first
      // that come before the current position in terms of document flow
      while (ai < addedLines.length && ai <= ri && !usedAdded.has(ai)) {
        pairs.push({ removed: null, added: addedLines[ai], type: 'added' });
        ai++;
      }
      // Then output the unmatched removed line
      pairs.push({ removed: removedLines[ri], added: null, type: 'removed' });
      ri++;
    } else {
      // Remaining added lines at the end
      if (!usedAdded.has(ai)) {
        pairs.push({ removed: null, added: addedLines[ai], type: 'added' });
      }
      ai++;
    }
  }

  return pairs;
}

/**
 * Compute inline word diff for highlighting changes within a modified line
 * Returns HTML-safe strings with diff markers
 * @param {string} removed - Original line content
 * @param {string} added - Modified line content
 * @returns {{removedHtml: string, addedHtml: string}}
 */
export function computeInlineWordDiff(removed, added) {
  const changes = Diff.diffWords(removed, added);

  let removedParts = [];
  let addedParts = [];

  for (const change of changes) {
    if (change.added) {
      addedParts.push({ type: 'added', value: change.value });
    } else if (change.removed) {
      removedParts.push({ type: 'removed', value: change.value });
    } else {
      removedParts.push({ type: 'unchanged', value: change.value });
      addedParts.push({ type: 'unchanged', value: change.value });
    }
  }

  return { removedParts, addedParts };
}

/**
 * Normalize markdown for comparison purposes.
 * Removes unnecessary escape sequences that WYSIWYG editors add but don't change rendering.
 * This helps produce cleaner diffs by treating escaped and unescaped versions as equivalent.
 *
 * @param {string} text - Markdown text to normalize
 * @returns {string} - Normalized markdown
 */
export function normalizeMarkdownForComparison(text) {
  if (!text) return '';

  // Remove unnecessary backslash escapes for common markdown characters
  // These escapes don't change rendering in most contexts
  let normalized = text
    // \* -> * (asterisks - but preserve \*\* sequences that might be intentional)
    .replace(/\\(\*)/g, '$1')
    // \- -> - (dashes)
    .replace(/\\(-)/g, '$1')
    // \_ -> _ (underscores)
    .replace(/\\_/g, '_')
    // \# -> # (but only when not at line start where it would become a heading)
    .replace(/([^\n])\\#/g, '$1#')
    // \[ and \] -> [ and ] (brackets)
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    // \( and \) -> ( and ) (parentheses)
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    // \! -> ! (exclamation)
    .replace(/\\!/g, '!')
    // \. -> . (period, often escaped in numbered lists incorrectly)
    .replace(/\\\./g, '.')
    // \` -> ` (backticks)
    .replace(/\\`/g, '`')
    // \| -> | (pipes in tables)
    .replace(/\\\|/g, '|')
    // \> -> > (blockquote, but only when not at line start)
    .replace(/([^\n])\\>/g, '$1>')
    // \~ -> ~ (tildes for strikethrough)
    .replace(/\\~/g, '~');

  // Normalize line endings
  normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Normalize multiple consecutive blank lines to a single blank line
  normalized = normalized.replace(/\n{3,}/g, '\n\n');

  // Trim trailing whitespace from lines (but preserve intentional trailing spaces for line breaks)
  // Only remove if there are more than 2 trailing spaces or if it's tabs
  normalized = normalized.split('\n').map(line => {
    // If line ends with 2+ spaces (markdown line break), keep exactly 2
    if (/  +$/.test(line)) {
      return line.replace(/  +$/, '  ');
    }
    // Otherwise remove trailing whitespace
    return line.replace(/[\t ]+$/, '');
  }).join('\n');

  return normalized;
}

/**
 * Compute a line-by-line diff between two strings
 * @param {string} original - Original content
 * @param {string} modified - Modified content
 * @returns {Array<{type: 'added'|'removed'|'unchanged', lines: string[]}>}
 */
export function computeLineDiff(original, modified) {
  const changes = Diff.diffLines(original, modified);
  const result = [];

  for (const change of changes) {
    const lines = change.value.split('\n');
    // Remove trailing empty line from split
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (lines.length === 0) continue;

    let type;
    if (change.added) {
      type = 'added';
    } else if (change.removed) {
      type = 'removed';
    } else {
      type = 'unchanged';
    }

    result.push({ type, lines });
  }

  return result;
}

/**
 * Format diff for unified view display
 * @param {string} original - Original content
 * @param {string} modified - Modified content
 * @returns {Array<{type: 'added'|'removed'|'unchanged', content: string, lineNumber: number|null}>}
 */
export function computeUnifiedDiff(original, modified) {
  const changes = Diff.diffLines(original, modified);
  const result = [];
  let originalLineNum = 1;
  let modifiedLineNum = 1;

  for (const change of changes) {
    const lines = change.value.split('\n');
    // Remove trailing empty line from split
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    for (const line of lines) {
      if (change.added) {
        result.push({
          type: 'added',
          content: line,
          originalLineNum: null,
          modifiedLineNum: modifiedLineNum++
        });
      } else if (change.removed) {
        result.push({
          type: 'removed',
          content: line,
          originalLineNum: originalLineNum++,
          modifiedLineNum: null
        });
      } else {
        result.push({
          type: 'unchanged',
          content: line,
          originalLineNum: originalLineNum++,
          modifiedLineNum: modifiedLineNum++
        });
      }
    }
  }

  return result;
}

/**
 * Find a nearby added chunk within a lookahead window
 * @param {Array} changes - The diff changes array
 * @param {number} startIndex - Index to start looking from
 * @param {number} maxLookahead - Maximum number of chunks to look ahead
 * @returns {{chunk: Object, offset: number}|null}
 */
function findNearbyAddedChunk(changes, startIndex, maxLookahead = 2) {
  for (let offset = 1; offset <= maxLookahead; offset++) {
    const nextChange = changes[startIndex + offset];
    if (!nextChange) break;
    if (nextChange.added) return { chunk: nextChange, offset };
    if (nextChange.removed) break; // Another removed block, stop looking
  }
  return null;
}

/**
 * Compute side-by-side diff for comparison view with line pairing
 * @param {string} original - Original content
 * @param {string} modified - Modified content
 * @returns {Array<{left: {type: string, content: string, lineNum: number|null}, right: {type: string, content: string, lineNum: number|null}}>}
 */
export function computeSideBySideDiff(original, modified) {
  const changes = Diff.diffLines(original, modified);
  const result = [];
  let originalLineNum = 1;
  let modifiedLineNum = 1;

  // Debug logging - can be enabled to diagnose diff issues
  const DEBUG = false;
  if (DEBUG) {
    console.log('[Diff Debug] Changes:', changes.map((c, idx) => ({
      index: idx,
      added: c.added,
      removed: c.removed,
      lineCount: c.value.split('\n').length - 1,
      preview: c.value.split('\n').slice(0, 3).map(l => l.substring(0, 40))
    })));
  }

  // Track which change indices have been processed (for lookahead pairing)
  const processedIndices = new Set();

  // Process changes and collect consecutive removed/added blocks for pairing
  let i = 0;
  while (i < changes.length) {
    // Skip if already processed via lookahead
    if (processedIndices.has(i)) {
      i++;
      continue;
    }

    const change = changes[i];
    const lines = change.value.split('\n');
    // Remove trailing empty line
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (change.removed) {
      // Collect all consecutive removed lines
      const removedLines = [...lines];
      const removedStartLineNum = originalLineNum;
      originalLineNum += lines.length;

      // Look for added chunk - check immediate next or within lookahead window
      const nearbyAdded = findNearbyAddedChunk(changes, i, 2);

      if (nearbyAdded) {
        const { chunk: addedChunk, offset } = nearbyAdded;

        // Process any unchanged chunks between removed and added
        for (let k = 1; k < offset; k++) {
          const intermediateChange = changes[i + k];
          if (intermediateChange && !intermediateChange.added && !intermediateChange.removed) {
            const intermediateLines = intermediateChange.value.split('\n');
            if (intermediateLines.length > 0 && intermediateLines[intermediateLines.length - 1] === '') {
              intermediateLines.pop();
            }
            for (const line of intermediateLines) {
              result.push({
                left: { type: 'unchanged', content: line, lineNum: originalLineNum++ },
                right: { type: 'unchanged', content: line, lineNum: modifiedLineNum++ }
              });
            }
          }
          processedIndices.add(i + k);
        }

        // Collect added lines
        const addedLines = addedChunk.value.split('\n');
        if (addedLines.length > 0 && addedLines[addedLines.length - 1] === '') {
          addedLines.pop();
        }
        const addedStartLineNum = modifiedLineNum;
        modifiedLineNum += addedLines.length;

        // Pair similar lines
        const pairs = pairSimilarLines(removedLines, addedLines);

        if (DEBUG) {
          console.log('[Diff Debug] Pairing:', {
            removedCount: removedLines.length,
            addedCount: addedLines.length,
            pairsCount: pairs.length,
            pairs: pairs.map(p => ({ type: p.type, removed: p.removed?.substring(0, 30), added: p.added?.substring(0, 30) }))
          });
        }

        // Track line numbers for each side
        let leftLineNum = removedStartLineNum;
        let rightLineNum = addedStartLineNum;

        for (const pair of pairs) {
          if (pair.type === 'modified') {
            // Modified line - show on both sides with modified type
            result.push({
              left: { type: 'modified', content: pair.removed, lineNum: leftLineNum++ },
              right: { type: 'modified', content: pair.added, lineNum: rightLineNum++ }
            });
          } else if (pair.type === 'removed') {
            // Pure removal - show on left only
            result.push({
              left: { type: 'removed', content: pair.removed, lineNum: leftLineNum++ },
              right: { type: 'empty', content: '', lineNum: null }
            });
          } else if (pair.type === 'added') {
            // Pure addition - show on right only
            result.push({
              left: { type: 'empty', content: '', lineNum: null },
              right: { type: 'added', content: pair.added, lineNum: rightLineNum++ }
            });
          }
        }

        // Mark the added chunk as processed and skip past it
        processedIndices.add(i + offset);
        i += offset + 1;
        continue;
      } else {
        // Just removals, no matching adds
        for (let j = 0; j < removedLines.length; j++) {
          result.push({
            left: { type: 'removed', content: removedLines[j], lineNum: removedStartLineNum + j },
            right: { type: 'empty', content: '', lineNum: null }
          });
        }
      }
    } else if (change.added) {
      // Pure additions (not following removals)
      for (const line of lines) {
        result.push({
          left: { type: 'empty', content: '', lineNum: null },
          right: { type: 'added', content: line, lineNum: modifiedLineNum++ }
        });
      }
    } else {
      // Unchanged lines - show on both sides
      for (const line of lines) {
        result.push({
          left: { type: 'unchanged', content: line, lineNum: originalLineNum++ },
          right: { type: 'unchanged', content: line, lineNum: modifiedLineNum++ }
        });
      }
    }

    i++;
  }

  return result;
}

/**
 * Calculate diff statistics
 * @param {string} original - Original content
 * @param {string} modified - Modified content
 * @returns {{added: number, removed: number, unchanged: number}}
 */
export function getDiffStats(original, modified) {
  const diff = computeUnifiedDiff(original, modified);
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const line of diff) {
    if (line.type === 'added') added++;
    else if (line.type === 'removed') removed++;
    else unchanged++;
  }

  return { added, removed, unchanged };
}

/**
 * Check if there are any actual changes between two strings
 * @param {string} original - Original content
 * @param {string} modified - Modified content
 * @returns {boolean}
 */
export function hasChanges(original, modified) {
  return original !== modified;
}

/**
 * Get word-level diff for a single line (for highlighting changes within a line)
 * @param {string} originalLine - Original line content
 * @param {string} modifiedLine - Modified line content
 * @returns {Array<{type: 'added'|'removed'|'unchanged', value: string}>}
 */
export function computeWordDiff(originalLine, modifiedLine) {
  const changes = Diff.diffWords(originalLine, modifiedLine);
  return changes.map(change => ({
    type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
    value: change.value
  }));
}

export default {
  normalizeMarkdownForComparison,
  computeLineDiff,
  computeUnifiedDiff,
  computeSideBySideDiff,
  getDiffStats,
  hasChanges,
  computeWordDiff,
  calculateSimilarity,
  pairSimilarLines,
  computeInlineWordDiff
};
