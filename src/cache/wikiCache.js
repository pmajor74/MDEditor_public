/**
 * Wiki Cache Manager
 *
 * Provides caching for Azure DevOps wiki tree data with configurable TTL.
 * Reduces API calls and improves performance for large wiki structures.
 * Persists cache to disk for session recovery.
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// Default TTL: 3 days
const DEFAULT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

// Cache storage
const cache = new Map();

// Persistence state
let saveTimeout = null;
const SAVE_DEBOUNCE_MS = 1000;  // Debounce disk writes by 1 second

/**
 * Get the path to the cache file in user data directory
 * @returns {string|null} Path to cache file, or null if running outside Electron
 */
function getCacheFilePath() {
  try {
    // app.getPath is only available after Electron's 'ready' event
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'wiki-tree-cache.json');
    }
  } catch (e) {
    // Running outside Electron context (e.g., unit tests)
  }
  return null;
}

/**
 * Save cache to disk (debounced)
 */
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveToStorage, SAVE_DEBOUNCE_MS);
}

/**
 * Persist cache to disk
 */
function saveToStorage() {
  const filePath = getCacheFilePath();
  if (!filePath) return;  // Not in Electron context

  try {
    const serialized = {};
    for (const [key, entry] of cache.entries()) {
      serialized[key] = entry;
    }
    fs.writeFileSync(filePath, JSON.stringify(serialized, null, 2), 'utf8');
    console.log('[WikiCache] Persisted', cache.size, 'entries to disk');
  } catch (e) {
    console.warn('[WikiCache] Failed to persist:', e.message);
  }
}

/**
 * Load cache from disk on startup
 */
function loadFromStorage() {
  const filePath = getCacheFilePath();
  if (!filePath) return;  // Not in Electron context

  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);
      let loadedCount = 0;
      let expiredCount = 0;

      for (const [key, entry] of Object.entries(parsed)) {
        if (isEntryValid(entry)) {
          cache.set(key, entry);
          loadedCount++;
        } else {
          expiredCount++;
        }
      }
      console.log('[WikiCache] Restored', loadedCount, 'entries from disk (' + expiredCount + ' expired)');
    }
  } catch (e) {
    console.warn('[WikiCache] Failed to load from disk:', e.message);
  }
}

/**
 * Generate a cache key for wiki tree data
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} wikiId - Wiki identifier
 * @param {string} path - Wiki path
 * @returns {string} Cache key
 */
function getCacheKey(org, project, wikiId, path = '/') {
  return `${org}/${project}/${wikiId}/${path}`;
}

/**
 * Check if a cache entry is still valid
 * @param {Object} entry - Cache entry
 * @returns {boolean} True if entry is valid
 */
function isEntryValid(entry) {
  if (!entry) return false;
  const now = Date.now();
  return now - entry.timestamp < entry.ttl;
}

/**
 * Get cached wiki tree data
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} wikiId - Wiki identifier
 * @param {string} path - Wiki path
 * @returns {Object|null} Cached data or null if not found/expired
 */
function get(org, project, wikiId, path = '/') {
  const key = getCacheKey(org, project, wikiId, path);
  const entry = cache.get(key);

  if (isEntryValid(entry)) {
    console.log('[WikiCache] Cache HIT for:', key);
    return entry.data;
  }

  // Clean up expired entry
  if (entry) {
    cache.delete(key);
    console.log('[WikiCache] Cache EXPIRED for:', key);
  } else {
    console.log('[WikiCache] Cache MISS for:', key);
  }

  return null;
}

/**
 * Store wiki tree data in cache
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} wikiId - Wiki identifier
 * @param {string} path - Wiki path
 * @param {Object} data - Data to cache
 * @param {number} ttl - Time to live in milliseconds (default: 5 minutes)
 */
function set(org, project, wikiId, path = '/', data, ttl = DEFAULT_TTL_MS) {
  const key = getCacheKey(org, project, wikiId, path);

  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  });

  console.log('[WikiCache] Cached data for:', key, `(TTL: ${Math.round(ttl / 1000 / 60 / 60)}h)`);
  scheduleSave();  // Persist to disk
}

/**
 * Invalidate a specific cache entry
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} wikiId - Wiki identifier
 * @param {string} path - Wiki path (optional, if not provided invalidates all paths for this wiki)
 */
function invalidate(org, project, wikiId, path = null) {
  let changed = false;

  if (path !== null) {
    // Invalidate specific path
    const key = getCacheKey(org, project, wikiId, path);
    if (cache.has(key)) {
      cache.delete(key);
      console.log('[WikiCache] Invalidated:', key);
      changed = true;
    }
  } else {
    // Invalidate all paths for this wiki
    const prefix = `${org}/${project}/${wikiId}/`;
    let count = 0;
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      console.log('[WikiCache] Invalidated', count, 'entries for wiki:', prefix);
      changed = true;
    }
  }

  if (changed) {
    scheduleSave();  // Persist cleared state
  }
}

/**
 * Clear all cache entries
 */
function clear() {
  const size = cache.size;
  cache.clear();
  console.log('[WikiCache] Cleared all', size, 'entries');
  if (size > 0) {
    scheduleSave();  // Persist cleared state
  }
}

/**
 * Clear cache for a specific organization (used on disconnect)
 * @param {string} org - Azure DevOps organization
 */
function clearOrg(org) {
  let count = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(`${org}/`)) {
      cache.delete(key);
      count++;
    }
  }
  console.log('[WikiCache] Cleared', count, 'entries for org:', org);
  if (count > 0) {
    scheduleSave();  // Persist cleared state
  }
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
function getStats() {
  let validCount = 0;
  let expiredCount = 0;

  for (const entry of cache.values()) {
    if (isEntryValid(entry)) {
      validCount++;
    } else {
      expiredCount++;
    }
  }

  return {
    totalEntries: cache.size,
    validEntries: validCount,
    expiredEntries: expiredCount
  };
}

/**
 * Prune expired entries (call periodically if needed)
 */
function pruneExpired() {
  let count = 0;
  for (const [key, entry] of cache.entries()) {
    if (!isEntryValid(entry)) {
      cache.delete(key);
      count++;
    }
  }
  if (count > 0) {
    console.log('[WikiCache] Pruned', count, 'expired entries');
  }
  return count;
}

// ============================================
// LRU Page Content Cache
// ============================================

// Page content cache configuration
const PAGE_CONTENT_MAX_SIZE = 20;  // Maximum cached pages
const PAGE_CONTENT_TTL_MS = 5 * 60 * 1000;  // 5 minutes

// LRU page content cache storage
const pageContentCache = new Map();

/**
 * Generate a cache key for page content
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} wikiId - Wiki identifier
 * @param {string} pagePath - Page path
 * @returns {string} Cache key
 */
function getPageContentKey(org, project, wikiId, pagePath) {
  return `page:${org}/${project}/${wikiId}/${pagePath}`;
}

/**
 * Evict least recently used entries if cache exceeds max size
 */
function evictLRU() {
  while (pageContentCache.size >= PAGE_CONTENT_MAX_SIZE) {
    // Map iteration order is insertion order, first item is least recently used
    const oldestKey = pageContentCache.keys().next().value;
    pageContentCache.delete(oldestKey);
    console.log('[PageCache] LRU evicted:', oldestKey);
  }
}

/**
 * Move entry to end of Map to mark as recently used
 * @param {string} key - Cache key
 */
function touchEntry(key) {
  const entry = pageContentCache.get(key);
  if (entry) {
    pageContentCache.delete(key);
    pageContentCache.set(key, entry);
  }
}

/**
 * Get cached page content
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} wikiId - Wiki identifier
 * @param {string} pagePath - Page path
 * @returns {Object|null} Cached data { content, eTag, timestamp } or null if not found/expired
 */
function getPageContent(org, project, wikiId, pagePath) {
  const key = getPageContentKey(org, project, wikiId, pagePath);
  const entry = pageContentCache.get(key);

  if (!entry) {
    console.log('[PageCache] MISS for:', pagePath);
    return null;
  }

  // Check TTL
  const now = Date.now();
  if (now - entry.timestamp > PAGE_CONTENT_TTL_MS) {
    pageContentCache.delete(key);
    console.log('[PageCache] EXPIRED for:', pagePath);
    return null;
  }

  // Mark as recently used
  touchEntry(key);
  console.log('[PageCache] HIT for:', pagePath);

  return {
    content: entry.content,
    eTag: entry.eTag,
    timestamp: entry.timestamp,
    cached: true
  };
}

/**
 * Store page content in cache
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} wikiId - Wiki identifier
 * @param {string} pagePath - Page path
 * @param {string} content - Page content
 * @param {string} eTag - ETag for conditional requests
 */
function setPageContent(org, project, wikiId, pagePath, content, eTag) {
  const key = getPageContentKey(org, project, wikiId, pagePath);

  // Evict if cache is full
  if (!pageContentCache.has(key)) {
    evictLRU();
  } else {
    // Remove existing to update position in LRU
    pageContentCache.delete(key);
  }

  pageContentCache.set(key, {
    content,
    eTag,
    timestamp: Date.now()
  });

  console.log('[PageCache] Cached:', pagePath, `(${pageContentCache.size}/${PAGE_CONTENT_MAX_SIZE} pages)`);
}

/**
 * Invalidate a specific page from content cache
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} wikiId - Wiki identifier
 * @param {string} pagePath - Page path
 */
function invalidatePageContent(org, project, wikiId, pagePath) {
  const key = getPageContentKey(org, project, wikiId, pagePath);
  if (pageContentCache.has(key)) {
    pageContentCache.delete(key);
    console.log('[PageCache] Invalidated:', pagePath);
  }
}

/**
 * Clear all page content cache for a wiki
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} wikiId - Wiki identifier (optional, clears all if not provided)
 */
function clearPageContentCache(org = null, project = null, wikiId = null) {
  if (!org) {
    const size = pageContentCache.size;
    pageContentCache.clear();
    console.log('[PageCache] Cleared all', size, 'entries');
    return;
  }

  const prefix = wikiId
    ? `page:${org}/${project}/${wikiId}/`
    : project
      ? `page:${org}/${project}/`
      : `page:${org}/`;

  let count = 0;
  for (const key of pageContentCache.keys()) {
    if (key.startsWith(prefix)) {
      pageContentCache.delete(key);
      count++;
    }
  }
  console.log('[PageCache] Cleared', count, 'entries for:', prefix);
}

/**
 * Get page content cache statistics
 * @returns {Object} Cache statistics
 */
function getPageContentStats() {
  const now = Date.now();
  let validCount = 0;
  let expiredCount = 0;

  for (const entry of pageContentCache.values()) {
    if (now - entry.timestamp < PAGE_CONTENT_TTL_MS) {
      validCount++;
    } else {
      expiredCount++;
    }
  }

  return {
    totalEntries: pageContentCache.size,
    maxEntries: PAGE_CONTENT_MAX_SIZE,
    validEntries: validCount,
    expiredEntries: expiredCount
  };
}

// Initialize: load persisted cache on module load
loadFromStorage();

module.exports = {
  // Tree cache
  get,
  set,
  invalidate,
  clear,
  clearOrg,
  getStats,
  pruneExpired,
  DEFAULT_TTL_MS,
  loadFromStorage,  // Expose for manual reload if needed
  saveToStorage,    // Expose for forced save if needed

  // Page content cache (LRU)
  getPageContent,
  setPageContent,
  invalidatePageContent,
  clearPageContentCache,
  getPageContentStats,
  PAGE_CONTENT_MAX_SIZE,
  PAGE_CONTENT_TTL_MS
};
