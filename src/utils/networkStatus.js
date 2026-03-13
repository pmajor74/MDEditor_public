/**
 * Network Status Monitor
 *
 * Monitors network connectivity and manages a save queue for offline support.
 * Persists queue to localStorage for recovery across app restarts.
 */

// Network status state
let isOnline = true;
let listeners = [];

// Save queue for failed saves when offline
const SAVE_QUEUE_KEY = 'azure-save-queue';
let saveQueue = [];

/**
 * Initialize network monitoring
 */
function init() {
  // Set initial status
  isOnline = navigator.onLine;

  // Load persisted queue
  loadQueue();

  // Listen for network status changes
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  console.log('[NetworkStatus] Initialized, online:', isOnline, 'queue size:', saveQueue.length);

  return {
    isOnline,
    queueSize: saveQueue.length
  };
}

/**
 * Clean up event listeners
 */
function destroy() {
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
  listeners = [];
}

/**
 * Handle coming back online
 */
function handleOnline() {
  console.log('[NetworkStatus] Network online');
  isOnline = true;
  notifyListeners('online');

  // Process any queued saves
  processQueue();
}

/**
 * Handle going offline
 */
function handleOffline() {
  console.log('[NetworkStatus] Network offline');
  isOnline = false;
  notifyListeners('offline');
}

/**
 * Register a listener for network status changes
 * @param {Function} callback - Called with (status: 'online'|'offline'|'syncing'|'synced')
 * @returns {Function} Unsubscribe function
 */
function subscribe(callback) {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter(l => l !== callback);
  };
}

/**
 * Notify all listeners of status change
 * @param {string} status - New status
 */
function notifyListeners(status) {
  listeners.forEach(callback => {
    try {
      callback(status, { queueSize: saveQueue.length });
    } catch (err) {
      console.error('[NetworkStatus] Listener error:', err);
    }
  });
}

/**
 * Load save queue from localStorage
 */
function loadQueue() {
  try {
    const stored = localStorage.getItem(SAVE_QUEUE_KEY);
    if (stored) {
      saveQueue = JSON.parse(stored);
      console.log('[NetworkStatus] Loaded', saveQueue.length, 'queued saves');
    }
  } catch (err) {
    console.error('[NetworkStatus] Failed to load queue:', err);
    saveQueue = [];
  }
}

/**
 * Save queue to localStorage
 */
function persistQueue() {
  try {
    localStorage.setItem(SAVE_QUEUE_KEY, JSON.stringify(saveQueue));
  } catch (err) {
    console.error('[NetworkStatus] Failed to persist queue:', err);
  }
}

/**
 * Add a failed save to the queue
 * @param {Object} saveData - { wikiId, pagePath, content, timestamp }
 */
function queueSave(saveData) {
  // Check if already queued for this page (update instead of duplicate)
  const existingIndex = saveQueue.findIndex(
    item => item.wikiId === saveData.wikiId && item.pagePath === saveData.pagePath
  );

  if (existingIndex >= 0) {
    // Update existing entry
    saveQueue[existingIndex] = {
      ...saveData,
      timestamp: Date.now()
    };
    console.log('[NetworkStatus] Updated queued save for:', saveData.pagePath);
  } else {
    // Add new entry
    saveQueue.push({
      ...saveData,
      timestamp: Date.now()
    });
    console.log('[NetworkStatus] Queued save for:', saveData.pagePath);
  }

  persistQueue();
  notifyListeners('queued');

  return saveQueue.length;
}

/**
 * Get the current save queue
 * @returns {Array} Queued saves
 */
function getQueue() {
  return [...saveQueue];
}

/**
 * Get queue size
 * @returns {number} Number of items in queue
 */
function getQueueSize() {
  return saveQueue.length;
}

/**
 * Clear the save queue
 */
function clearQueue() {
  saveQueue = [];
  persistQueue();
  console.log('[NetworkStatus] Queue cleared');
}

/**
 * Remove an item from the queue after successful save
 * @param {string} wikiId - Wiki ID
 * @param {string} pagePath - Page path
 */
function removeFromQueue(wikiId, pagePath) {
  const sizeBefore = saveQueue.length;
  saveQueue = saveQueue.filter(
    item => !(item.wikiId === wikiId && item.pagePath === pagePath)
  );

  if (saveQueue.length !== sizeBefore) {
    persistQueue();
    console.log('[NetworkStatus] Removed from queue:', pagePath);
    notifyListeners(saveQueue.length === 0 ? 'synced' : 'syncing');
  }
}

/**
 * Process the save queue (called when coming back online)
 */
async function processQueue() {
  if (saveQueue.length === 0) {
    console.log('[NetworkStatus] No queued saves to process');
    return;
  }

  console.log('[NetworkStatus] Processing', saveQueue.length, 'queued saves...');
  notifyListeners('syncing');

  // We'll need to use IPC to save - this will be handled by the caller
  // Emit event for renderer to pick up
  window.dispatchEvent(new CustomEvent('network:processQueue', {
    detail: { queue: [...saveQueue] }
  }));
}

/**
 * Get current network status
 * @returns {boolean} True if online
 */
function getIsOnline() {
  return isOnline;
}

/**
 * Get full network status
 * @returns {Object} { isOnline, queueSize }
 */
function getStatus() {
  return {
    isOnline,
    queueSize: saveQueue.length
  };
}

// Export module
export {
  init,
  destroy,
  subscribe,
  getIsOnline,
  getStatus,
  queueSave,
  getQueue,
  getQueueSize,
  removeFromQueue,
  clearQueue,
  processQueue
};
