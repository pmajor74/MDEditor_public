/**
 * File Watcher for Vector DB
 *
 * Watches indexed folders for file changes and triggers reindexing.
 * Uses chokidar for cross-platform file watching with debouncing.
 */

const chokidar = require('chokidar');
const path = require('path');
const indexManager = require('./indexManager');

// Active watchers by collection name
const watchers = new Map();

// Pending changes queue (for debouncing)
const pendingChanges = new Map();

// Debounce delay in ms
const DEBOUNCE_MS = 2000;

// Change callback
let onChangeCallback = null;

/**
 * Start watching a collection's root folder
 * @param {string} collectionName - Collection name
 * @param {Object} options - Watch options
 */
function watchCollection(collectionName, options = {}) {
  const meta = indexManager.getCollectionMeta(collectionName);
  if (!meta || !meta.rootPath) {
    console.error(`[File Watcher] Cannot watch "${collectionName}" - no root path`);
    return;
  }

  // Stop existing watcher if any
  unwatchCollection(collectionName);

  const extensions = meta.extensions || ['.md', '.txt'];
  const globPatterns = extensions.map(ext => `**/*${ext}`);

  const watchPath = meta.rootPath;

  console.log(`[File Watcher] Starting watch on ${watchPath} for ${collectionName}`);

  const watcher = chokidar.watch(globPatterns, {
    cwd: watchPath,
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.*'
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  watcher.on('add', (relativePath) => {
    const fullPath = path.join(watchPath, relativePath);
    queueChange(collectionName, 'add', fullPath);
  });

  watcher.on('change', (relativePath) => {
    const fullPath = path.join(watchPath, relativePath);
    queueChange(collectionName, 'change', fullPath);
  });

  watcher.on('unlink', (relativePath) => {
    const fullPath = path.join(watchPath, relativePath);
    queueChange(collectionName, 'delete', fullPath);
  });

  watcher.on('error', (error) => {
    console.error(`[File Watcher] Error in "${collectionName}":`, error.message);
  });

  watchers.set(collectionName, watcher);
}

/**
 * Stop watching a collection
 * @param {string} collectionName - Collection name
 */
async function unwatchCollection(collectionName) {
  const watcher = watchers.get(collectionName);
  if (watcher) {
    await watcher.close();
    watchers.delete(collectionName);
    console.log(`[File Watcher] Stopped watching "${collectionName}"`);
  }

  // Clear pending changes
  if (pendingChanges.has(collectionName)) {
    clearTimeout(pendingChanges.get(collectionName).timer);
    pendingChanges.delete(collectionName);
  }
}

/**
 * Queue a file change for debounced processing
 * @param {string} collectionName - Collection name
 * @param {string} type - Change type: 'add', 'change', 'delete'
 * @param {string} filePath - Full file path
 */
function queueChange(collectionName, type, filePath) {
  let pending = pendingChanges.get(collectionName);

  if (!pending) {
    pending = {
      changes: new Map(),
      timer: null
    };
    pendingChanges.set(collectionName, pending);
  }

  // Store change (later changes override earlier ones for same file)
  pending.changes.set(filePath, { type, timestamp: Date.now() });

  // Reset debounce timer
  if (pending.timer) {
    clearTimeout(pending.timer);
  }

  pending.timer = setTimeout(() => {
    processChanges(collectionName);
  }, DEBOUNCE_MS);
}

/**
 * Process queued changes for a collection
 * @param {string} collectionName - Collection name
 */
async function processChanges(collectionName) {
  const pending = pendingChanges.get(collectionName);
  if (!pending || pending.changes.size === 0) return;

  const changes = new Map(pending.changes);
  pending.changes.clear();
  pending.timer = null;

  console.log(`[File Watcher] Processing ${changes.size} changes for "${collectionName}"`);

  const added = [];
  const modified = [];
  const deleted = [];

  for (const [filePath, change] of changes) {
    switch (change.type) {
      case 'add':
        added.push(filePath);
        break;
      case 'change':
        modified.push(filePath);
        break;
      case 'delete':
        deleted.push(filePath);
        break;
    }
  }

  try {
    // Process deletions
    for (const filePath of deleted) {
      await indexManager.removeFile(collectionName, filePath);
    }

    // Process additions and modifications
    for (const filePath of [...added, ...modified]) {
      try {
        await indexManager.addFile(collectionName, filePath);
      } catch (error) {
        console.error(`[File Watcher] Failed to index ${filePath}:`, error.message);
      }
    }

    // Notify callback if set
    if (onChangeCallback) {
      onChangeCallback({
        collection: collectionName,
        added: added.length,
        modified: modified.length,
        deleted: deleted.length
      });
    }

  } catch (error) {
    console.error(`[File Watcher] Error processing changes:`, error.message);
  }
}

/**
 * Set callback for change notifications
 * @param {Function} callback - Callback function
 */
function setOnChangeCallback(callback) {
  onChangeCallback = callback;
}

/**
 * Start watching all configured collections
 */
async function watchAllCollections() {
  const collections = await indexManager.getCollections();

  for (const collection of collections) {
    if (collection.rootPath) {
      watchCollection(collection.name);
    }
  }
}

/**
 * Stop all watchers
 */
async function unwatchAll() {
  const names = Array.from(watchers.keys());

  for (const name of names) {
    await unwatchCollection(name);
  }

  console.log('[File Watcher] All watchers stopped');
}

/**
 * Get status of all active watchers
 * @returns {Object} Watcher status
 */
function getStatus() {
  return {
    activeWatchers: Array.from(watchers.keys()),
    pendingChanges: Array.from(pendingChanges.entries()).map(([name, pending]) => ({
      collection: name,
      changeCount: pending.changes.size
    }))
  };
}

module.exports = {
  watchCollection,
  unwatchCollection,
  watchAllCollections,
  unwatchAll,
  setOnChangeCallback,
  getStatus
};
