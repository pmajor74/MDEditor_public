/**
 * Vector DB Module
 *
 * Entry point for vector database functionality.
 * Provides unified access to embedding, storage, and indexing.
 *
 * Sub-module requires are wrapped in try-catch to prevent webpack module
 * caching from permanently breaking exports if a native module fails to load.
 */

let vectorStore, indexManager, embeddingProvider, fileWatcher;
let loadError = null;

try { vectorStore = require('./vectorStore'); }
catch (e) { loadError = e.message; console.error('[Vector DB] vectorStore load failed:', e.message); }

try { indexManager = require('./indexManager'); }
catch (e) { loadError = loadError || e.message; console.error('[Vector DB] indexManager load failed:', e.message); }

try { embeddingProvider = require('./embeddingProvider'); }
catch (e) { loadError = loadError || e.message; console.error('[Vector DB] embeddingProvider load failed:', e.message); }

try { fileWatcher = require('./fileWatcher'); }
catch (e) { loadError = loadError || e.message; console.error('[Vector DB] fileWatcher load failed:', e.message); }

// Initialization state
let initialized = false;
let initError = null;

/**
 * Initialize the vector DB module
 * @param {string} storagePath - Path to store data (typically app.getPath('userData'))
 */
async function initialize(storagePath) {
  if (initialized) {
    console.log('[Vector DB] Already initialized');
    return;
  }

  if (!vectorStore || !indexManager || !fileWatcher) {
    throw new Error('Vector DB sub-modules failed to load: ' + (loadError || 'unknown'));
  }

  console.log('[Vector DB] Initializing...');
  initError = null;

  try {
    // Connect to vector store
    await vectorStore.connect();

    // Initialize index manager
    await indexManager.initialize(storagePath);

    // Start watching indexed collections
    await fileWatcher.watchAllCollections();

    initialized = true;
    console.log('[Vector DB] Initialization complete');
  } catch (error) {
    initError = error.message;
    throw error;
  }
}

/**
 * Shutdown the vector DB module
 */
async function shutdown() {
  console.log('[Vector DB] Shutting down...');

  // Stop all file watchers
  if (fileWatcher) await fileWatcher.unwatchAll();

  // Close vector store connection
  if (vectorStore) await vectorStore.close();

  initialized = false;
  console.log('[Vector DB] Shutdown complete');
}

/**
 * Check if vector DB is available and configured
 */
function isAvailable() {
  return initialized && !!embeddingProvider?.isConfigured();
}

/**
 * Get the error message from the last failed initialization attempt
 * @returns {string|null} Error message or null if no error
 */
function getInitError() {
  return initError;
}

/**
 * Get the error message if sub-modules failed to load
 * @returns {string|null} Error message or null if all modules loaded
 */
function getLoadError() {
  return loadError;
}

/**
 * Check if the vector DB has been successfully initialized
 * @returns {boolean} Whether initialized
 */
function isInitialized() {
  return initialized;
}

module.exports = {
  // Lifecycle
  initialize,
  shutdown,
  isAvailable,
  isInitialized,
  getInitError,
  getLoadError,

  // Re-export submodules
  vectorStore,
  indexManager,
  embeddingProvider,
  fileWatcher
};
