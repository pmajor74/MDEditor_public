/**
 * Directory Watcher
 *
 * File system watching using chokidar for real-time updates.
 * Debounces changes and notifies renderer of file modifications.
 */

const chokidar = require('chokidar');
const path = require('path');

// Active watchers by root path
const watchers = new Map();

// Debounce configuration
const DEBOUNCE_MS = 300;
let debounceTimers = new Map();
let pendingChanges = new Map();

// Callback for notifying renderer
let changeCallback = null;

/**
 * Set the callback for file changes
 * @param {Function} callback - Function to call with changes
 */
function setChangeCallback(callback) {
  changeCallback = callback;
}

/**
 * Start watching a directory
 * @param {string} rootPath - Directory to watch
 * @returns {boolean} Success
 */
function watch(rootPath) {
  const normalizedPath = path.resolve(rootPath);

  // Check if already watching
  if (watchers.has(normalizedPath)) {
    console.log('[Directory Watcher] Already watching:', normalizedPath);
    return true;
  }

  try {
    const watcher = chokidar.watch(normalizedPath, {
      ignored: [
        /(^|[\/\\])\../, // Hidden files
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**'
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    });

    // Handle events
    watcher
      .on('add', (filePath) => queueChange('add', filePath, normalizedPath))
      .on('change', (filePath) => queueChange('change', filePath, normalizedPath))
      .on('unlink', (filePath) => queueChange('unlink', filePath, normalizedPath))
      .on('addDir', (dirPath) => queueChange('addDir', dirPath, normalizedPath))
      .on('unlinkDir', (dirPath) => queueChange('unlinkDir', dirPath, normalizedPath))
      .on('error', (error) => console.error('[Directory Watcher] Error:', error));

    watchers.set(normalizedPath, watcher);
    console.log('[Directory Watcher] Started watching:', normalizedPath);
    return true;
  } catch (err) {
    console.error('[Directory Watcher] Failed to start watching:', err);
    return false;
  }
}

/**
 * Stop watching a directory
 * @param {string} rootPath - Directory to stop watching
 */
async function unwatch(rootPath) {
  const normalizedPath = path.resolve(rootPath);
  const watcher = watchers.get(normalizedPath);

  if (watcher) {
    await watcher.close();
    watchers.delete(normalizedPath);
    debounceTimers.delete(normalizedPath);
    pendingChanges.delete(normalizedPath);
    console.log('[Directory Watcher] Stopped watching:', normalizedPath);
  }
}

/**
 * Stop all watchers
 */
async function unwatchAll() {
  for (const [rootPath, watcher] of watchers) {
    await watcher.close();
    console.log('[Directory Watcher] Stopped watching:', rootPath);
  }
  watchers.clear();
  debounceTimers.clear();
  pendingChanges.clear();
}

/**
 * Queue a change for debouncing
 * @param {string} type - Change type (add, change, unlink, addDir, unlinkDir)
 * @param {string} filePath - Path that changed
 * @param {string} rootPath - Root path being watched
 */
function queueChange(type, filePath, rootPath) {
  // Get or create pending changes for this root
  if (!pendingChanges.has(rootPath)) {
    pendingChanges.set(rootPath, []);
  }

  const changes = pendingChanges.get(rootPath);

  // Add to pending changes
  changes.push({
    type,
    path: filePath,
    directory: path.dirname(filePath),
    name: path.basename(filePath),
    timestamp: Date.now()
  });

  // Clear existing timer
  if (debounceTimers.has(rootPath)) {
    clearTimeout(debounceTimers.get(rootPath));
  }

  // Set new debounce timer
  debounceTimers.set(rootPath, setTimeout(() => {
    flushChanges(rootPath);
  }, DEBOUNCE_MS));
}

/**
 * Flush pending changes and notify callback
 * @param {string} rootPath - Root path to flush changes for
 */
function flushChanges(rootPath) {
  const changes = pendingChanges.get(rootPath);
  if (!changes || changes.length === 0) return;

  // Deduplicate changes (keep latest for each path)
  const uniqueChanges = new Map();
  for (const change of changes) {
    uniqueChanges.set(change.path, change);
  }

  const finalChanges = Array.from(uniqueChanges.values());

  // Clear pending
  pendingChanges.set(rootPath, []);
  debounceTimers.delete(rootPath);

  // Notify callback
  if (changeCallback) {
    changeCallback({
      rootPath,
      changes: finalChanges,
      // Group by affected directories for efficient refresh
      affectedDirectories: [...new Set(finalChanges.map(c => c.directory))]
    });
  }
}

/**
 * Check if a path is being watched
 * @param {string} rootPath - Path to check
 * @returns {boolean}
 */
function isWatching(rootPath) {
  return watchers.has(path.resolve(rootPath));
}

/**
 * Get all watched paths
 * @returns {string[]}
 */
function getWatchedPaths() {
  return Array.from(watchers.keys());
}

module.exports = {
  setChangeCallback,
  watch,
  unwatch,
  unwatchAll,
  isWatching,
  getWatchedPaths
};
