/**
 * Directory Cache
 *
 * LRU cache for directory contents with TTL support.
 * Improves performance for repeated directory access.
 */

const path = require('path');

// Cache configuration
const DEFAULT_MAX_SIZE = 100;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

class DirectoryCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || DEFAULT_MAX_SIZE;
    this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    this.cache = new Map();
    this.accessOrder = [];
  }

  /**
   * Generate cache key from path
   * @param {string} dirPath - Directory path
   * @returns {string} Cache key
   */
  _getKey(dirPath) {
    return path.resolve(dirPath).toLowerCase();
  }

  /**
   * Check if an entry is expired
   * @param {Object} entry - Cache entry
   * @returns {boolean} True if expired
   */
  _isExpired(entry) {
    return Date.now() - entry.timestamp > this.ttlMs;
  }

  /**
   * Update access order for LRU
   * @param {string} key - Cache key
   */
  _updateAccessOrder(key) {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * Evict least recently used entries if needed
   */
  _evictIfNeeded() {
    while (this.cache.size > this.maxSize && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift();
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Get cached directory contents
   * @param {string} dirPath - Directory path
   * @returns {Object|null} Cached contents or null if not found/expired
   */
  get(dirPath) {
    const key = this._getKey(dirPath);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (this._isExpired(entry)) {
      this.cache.delete(key);
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      return null;
    }

    this._updateAccessOrder(key);
    return entry.data;
  }

  /**
   * Set cached directory contents
   * @param {string} dirPath - Directory path
   * @param {Object} data - Directory contents to cache
   */
  set(dirPath, data) {
    const key = this._getKey(dirPath);

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });

    this._updateAccessOrder(key);
    this._evictIfNeeded();
  }

  /**
   * Invalidate cache for a specific path
   * @param {string} dirPath - Directory path to invalidate
   */
  invalidate(dirPath) {
    const key = this._getKey(dirPath);
    this.cache.delete(key);
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * Invalidate cache for a path and all its parents
   * @param {string} filePath - File or directory path
   */
  invalidateWithParents(filePath) {
    let currentPath = path.resolve(filePath);

    while (currentPath) {
      this.invalidate(currentPath);

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break; // Reached root
      }
      currentPath = parentPath;
    }
  }

  /**
   * Clear all cached data
   */
  clear() {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    let validEntries = 0;
    let expiredEntries = 0;

    for (const entry of this.cache.values()) {
      if (this._isExpired(entry)) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      validEntries,
      expiredEntries,
      ttlMs: this.ttlMs
    };
  }
}

// Singleton instance
let cacheInstance = null;

/**
 * Get or create the cache instance
 * @param {Object} options - Cache options
 * @returns {DirectoryCache} Cache instance
 */
function getCache(options = {}) {
  if (!cacheInstance) {
    cacheInstance = new DirectoryCache(options);
  }
  return cacheInstance;
}

/**
 * Reset the cache instance (for testing)
 */
function resetCache() {
  if (cacheInstance) {
    cacheInstance.clear();
  }
  cacheInstance = null;
}

module.exports = {
  DirectoryCache,
  getCache,
  resetCache
};
