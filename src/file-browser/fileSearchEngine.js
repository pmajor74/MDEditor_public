/**
 * File Search Engine
 *
 * Searches file names and contents within allowed directories.
 * Supports regex, case-sensitive, and context lines.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { validatePath, getAllowedRoots } = require('./pathValidator');

// Search state
let currentSearchId = 0;
let cancelledSearches = new Set();

// Search configuration
const config = {
  maxResults: 500,
  maxFileSize: 5 * 1024 * 1024, // 5MB
  contextLines: 2,
  extensions: ['.md', '.txt', '.markdown', '.mdown', '.mkd'],
  ignorePatterns: [
    /node_modules/,
    /\.git/,
    /dist/,
    /build/,
    /\.cache/
  ]
};

/**
 * Start a new search
 * @param {Object} options - Search options
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Promise<Object>} Search results
 */
async function search(options, progressCallback) {
  const {
    query,
    searchPath,
    searchType = 'content', // 'filename', 'content', 'both'
    caseSensitive = false,
    useRegex = false,
    extensions = config.extensions,
    maxResults = config.maxResults
  } = options;

  // Validate search path
  const validation = validatePath(searchPath);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  // Create new search ID
  const searchId = ++currentSearchId;

  // Build regex
  let pattern;
  try {
    if (useRegex) {
      pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } else {
      // Escape special regex characters
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pattern = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
    }
  } catch (err) {
    return { success: false, error: `Invalid regex: ${err.message}` };
  }

  const results = [];
  let filesSearched = 0;
  let matchCount = 0;

  try {
    // Collect all files to search
    const files = await collectFiles(validation.resolvedPath, extensions, searchId);

    // Report initial progress
    if (progressCallback) {
      progressCallback({
        type: 'started',
        searchId,
        totalFiles: files.length
      });
    }

    // Search each file
    for (const filePath of files) {
      // Check if search was cancelled
      if (cancelledSearches.has(searchId)) {
        cancelledSearches.delete(searchId);
        return {
          success: true,
          cancelled: true,
          results,
          stats: { filesSearched, matchCount }
        };
      }

      // Check if we've hit max results
      if (results.length >= maxResults) {
        break;
      }

      filesSearched++;

      // Report progress periodically
      if (progressCallback && filesSearched % 10 === 0) {
        progressCallback({
          type: 'progress',
          searchId,
          filesSearched,
          totalFiles: files.length,
          matchCount
        });
      }

      const fileName = path.basename(filePath);

      // Filename search
      if (searchType === 'filename' || searchType === 'both') {
        if (pattern.test(fileName)) {
          results.push({
            type: 'filename',
            path: filePath,
            name: fileName,
            directory: path.dirname(filePath)
          });
          matchCount++;
          pattern.lastIndex = 0; // Reset regex
        }
      }

      // Content search
      if (searchType === 'content' || searchType === 'both') {
        try {
          const stats = await fs.stat(filePath);

          // Skip large files
          if (stats.size > config.maxFileSize) {
            continue;
          }

          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;

            if (pattern.test(lines[i])) {
              pattern.lastIndex = 0; // Reset regex

              // Get context lines
              const contextBefore = [];
              const contextAfter = [];

              for (let j = Math.max(0, i - config.contextLines); j < i; j++) {
                contextBefore.push({ line: j + 1, text: lines[j] });
              }

              for (let j = i + 1; j <= Math.min(lines.length - 1, i + config.contextLines); j++) {
                contextAfter.push({ line: j + 1, text: lines[j] });
              }

              results.push({
                type: 'content',
                path: filePath,
                name: fileName,
                directory: path.dirname(filePath),
                line: i + 1,
                text: lines[i],
                contextBefore,
                contextAfter
              });
              matchCount++;
            }
          }
        } catch (err) {
          // Skip files that can't be read
          continue;
        }
      }
    }

    // Report completion
    if (progressCallback) {
      progressCallback({
        type: 'completed',
        searchId,
        filesSearched,
        matchCount
      });
    }

    return {
      success: true,
      results,
      stats: {
        filesSearched,
        matchCount,
        maxResultsReached: results.length >= maxResults
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Collect all files to search
 * @param {string} rootPath - Root directory
 * @param {string[]} extensions - File extensions to include
 * @param {number} searchId - Current search ID
 * @returns {Promise<string[]>} Array of file paths
 */
async function collectFiles(rootPath, extensions, searchId) {
  const files = [];

  async function walk(dirPath) {
    // Check if cancelled
    if (cancelledSearches.has(searchId)) {
      return;
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (cancelledSearches.has(searchId)) {
          return;
        }

        const fullPath = path.join(dirPath, entry.name);

        // Skip ignored patterns
        if (shouldIgnore(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          // Check extension
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.length === 0 || extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }

  await walk(rootPath);
  return files;
}

/**
 * Check if path should be ignored
 * @param {string} filePath - Path to check
 * @returns {boolean}
 */
function shouldIgnore(filePath) {
  for (const pattern of config.ignorePatterns) {
    if (pattern.test(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Cancel a running search
 * @param {number} searchId - Search ID to cancel
 */
function cancelSearch(searchId) {
  if (searchId) {
    cancelledSearches.add(searchId);
  } else {
    // Cancel current search
    cancelledSearches.add(currentSearchId);
  }
}

/**
 * Get current search ID
 * @returns {number}
 */
function getCurrentSearchId() {
  return currentSearchId;
}

/**
 * Update search configuration
 * @param {Object} newConfig - New configuration
 */
function updateConfig(newConfig) {
  Object.assign(config, newConfig);
}

/**
 * Get current configuration
 * @returns {Object}
 */
function getConfig() {
  return { ...config };
}

module.exports = {
  search,
  cancelSearch,
  getCurrentSearchId,
  updateConfig,
  getConfig
};
