/**
 * Tab Session Store
 *
 * Handles persistence of tab session state to disk.
 * Uses per-tab cache files for easy browsing and recovery.
 *
 * New folder structure:
 *   userData/tab-cache/
 *     session.json          - Metadata only (tab order, active tab, tab info without content)
 *     tabs/
 *       2024-01-15_README-a1b2.md   - Per-tab content files
 */

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

// Debounce timers - one per tab for content saves
const tabContentTimers = new Map();
const CONTENT_SAVE_DEBOUNCE_MS = 2000;

// Metadata save timer (single, for session.json)
let metadataSaveTimer = null;
const METADATA_SAVE_DEBOUNCE_MS = 1000;

// Session format version
const SESSION_VERSION = 2;

// ============================================
// Directory and Path Helpers
// ============================================

/**
 * Get the path to the cache directory
 */
function getCacheDir() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'tab-cache');
}

/**
 * Get the path to the tabs content directory
 */
function getTabsDir() {
  return path.join(getCacheDir(), 'tabs');
}

/**
 * Get the path to the session metadata file
 */
function getSessionPath() {
  return path.join(getCacheDir(), 'session.json');
}

/**
 * Get the old session file path (for migration)
 */
function getOldSessionPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'tab-session.json');
}

/**
 * Ensure cache directories exist
 */
async function ensureCacheDir() {
  const cacheDir = getCacheDir();
  const tabsDir = getTabsDir();

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(tabsDir, { recursive: true });
  } catch (error) {
    console.error('[TabSession] Failed to create cache directories:', error.message);
  }
}

// ============================================
// Filename Generation
// ============================================

/**
 * Sanitize a title for use in filename
 * - Max 40 chars
 * - Replace invalid chars with dashes
 * - Trim leading/trailing dashes
 */
function sanitizeTitle(title) {
  if (!title) return 'Untitled';

  // Replace invalid filename chars with dashes
  let safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');

  // Replace multiple dashes with single dash
  safe = safe.replace(/-+/g, '-');

  // Trim to 40 chars
  if (safe.length > 40) {
    safe = safe.substring(0, 40);
  }

  // Trim leading/trailing dashes and spaces
  safe = safe.replace(/^[-\s]+|[-\s]+$/g, '');

  return safe || 'Untitled';
}

/**
 * Generate a cache filename for a tab
 * Format: {YYYY-MM-DD}_{SafeTitle}-{shortUUID}.md
 */
function generateTabFilename(tab) {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const safeTitle = sanitizeTitle(tab.title);
  const shortId = tab.id.slice(-4); // Last 4 chars of UUID

  return `${date}_${safeTitle}-${shortId}.md`;
}

// ============================================
// Per-Tab Content File Operations
// ============================================

/**
 * Save tab content to its cache file
 */
async function saveTabContent(tab) {
  if (!tab.cacheFile) {
    console.warn('[TabSession] Tab has no cacheFile:', tab.id);
    return;
  }

  try {
    await ensureCacheDir();
    const filePath = path.join(getTabsDir(), tab.cacheFile);
    await fs.writeFile(filePath, tab.content || '', 'utf8');
    console.log(`[TabSession] Saved content to ${tab.cacheFile}`);
  } catch (error) {
    console.error('[TabSession] Failed to save tab content:', error.message);
  }
}

/**
 * Load tab content from its cache file
 */
async function loadTabContent(cacheFile) {
  if (!cacheFile) return '';

  try {
    const filePath = path.join(getTabsDir(), cacheFile);
    const content = await fs.readFile(filePath, 'utf8');
    return content;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[TabSession] Failed to load tab content:', error.message);
    }
    return '';
  }
}

/**
 * Delete a tab's cache file
 */
async function deleteTabCacheFile(cacheFile) {
  if (!cacheFile) return;

  try {
    const filePath = path.join(getTabsDir(), cacheFile);
    await fs.unlink(filePath);
    console.log(`[TabSession] Deleted cache file: ${cacheFile}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[TabSession] Failed to delete cache file:', error.message);
    }
  }

  // Clear any pending save timer for this tab
  if (tabContentTimers.has(cacheFile)) {
    clearTimeout(tabContentTimers.get(cacheFile));
    tabContentTimers.delete(cacheFile);
  }
}

/**
 * Save tab content (debounced per-tab)
 */
function saveTabContentDebounced(tab) {
  if (!tab.cacheFile) return;

  // Clear existing timer for this tab
  if (tabContentTimers.has(tab.cacheFile)) {
    clearTimeout(tabContentTimers.get(tab.cacheFile));
  }

  // Set new timer
  const timer = setTimeout(() => {
    saveTabContent(tab);
    tabContentTimers.delete(tab.cacheFile);
  }, CONTENT_SAVE_DEBOUNCE_MS);

  tabContentTimers.set(tab.cacheFile, timer);
}

// ============================================
// Session Metadata Operations
// ============================================

/**
 * Default empty session structure
 */
function getDefaultSession() {
  return {
    version: SESSION_VERSION,
    tabs: [],
    activeTabId: null,
    tabOrder: []
  };
}

/**
 * Convert tabs array to tabs map for storage
 */
function tabsArrayToMap(tabs) {
  const tabsMap = {};
  for (const tab of tabs) {
    // Store tab without content (content is in separate files)
    const { content, ...tabMeta } = tab;
    tabsMap[tab.id] = tabMeta;
  }
  return tabsMap;
}

/**
 * Convert tabs map to tabs array
 */
function tabsMapToArray(tabsMap) {
  return Object.values(tabsMap);
}

/**
 * Check if old format session exists and needs migration
 */
async function needsMigration() {
  const oldPath = getOldSessionPath();
  const newPath = getSessionPath();

  try {
    // Check if old file exists
    await fs.access(oldPath);

    // Check if new file doesn't exist
    try {
      await fs.access(newPath);
      return false; // New format already exists
    } catch {
      return true; // Old exists, new doesn't - need migration
    }
  } catch {
    return false; // Old file doesn't exist
  }
}

/**
 * Migrate from old tab-session.json format to new per-tab format
 */
async function migrateFromOldFormat() {
  console.log('[TabSession] Starting migration from old format...');
  const oldPath = getOldSessionPath();

  try {
    const data = await fs.readFile(oldPath, 'utf8');
    const oldSession = JSON.parse(data);

    if (!oldSession || !Array.isArray(oldSession.tabs)) {
      console.warn('[TabSession] Invalid old session, skipping migration');
      return null;
    }

    await ensureCacheDir();

    // Create new session structure
    const newSession = {
      version: SESSION_VERSION,
      activeTabId: oldSession.activeTabId,
      tabOrder: oldSession.tabOrder || [],
      tabs: []
    };

    // Migrate each tab
    for (const oldTab of oldSession.tabs) {
      // Generate cache filename
      const cacheFile = generateTabFilename(oldTab);

      // Save content to separate file
      if (oldTab.content) {
        const contentPath = path.join(getTabsDir(), cacheFile);
        await fs.writeFile(contentPath, oldTab.content, 'utf8');
      }

      // Create new tab object (without content, with cacheFile)
      const newTab = {
        ...oldTab,
        cacheFile
      };
      delete newTab.content; // Remove content from metadata

      newSession.tabs.push(newTab);
    }

    // Save new session metadata
    await saveSessionImmediate(newSession);

    // Rename old file as backup
    const backupPath = oldPath + '.backup';
    await fs.rename(oldPath, backupPath);
    console.log(`[TabSession] Migration complete. Old file backed up to ${backupPath}`);

    return newSession;
  } catch (error) {
    console.error('[TabSession] Migration failed:', error.message);
    return null;
  }
}

/**
 * Clean up orphaned cache files (files not referenced by any tab)
 */
async function cleanupOrphanedCacheFiles(session) {
  try {
    const tabsDir = getTabsDir();
    const files = await fs.readdir(tabsDir);

    // Get all referenced cache files
    const referencedFiles = new Set(
      session.tabs.map(t => t.cacheFile).filter(Boolean)
    );

    // Delete orphaned files
    let deletedCount = 0;
    for (const file of files) {
      if (file.endsWith('.md') && !referencedFiles.has(file)) {
        try {
          await fs.unlink(path.join(tabsDir, file));
          deletedCount++;
        } catch (e) {
          // Ignore errors
        }
      }
    }

    if (deletedCount > 0) {
      console.log(`[TabSession] Cleaned up ${deletedCount} orphaned cache file(s)`);
    }
  } catch (error) {
    // Directory might not exist yet
    if (error.code !== 'ENOENT') {
      console.warn('[TabSession] Failed to cleanup orphaned files:', error.message);
    }
  }
}

/**
 * Load tab session from disk
 * Returns default session if file doesn't exist or is corrupted
 */
async function loadSession() {
  try {
    // Check for migration need first
    if (await needsMigration()) {
      const migratedSession = await migrateFromOldFormat();
      if (migratedSession) {
        // Load content for each tab
        for (const tab of migratedSession.tabs) {
          tab.content = await loadTabContent(tab.cacheFile);
        }
        await cleanupOrphanedCacheFiles(migratedSession);
        return migratedSession;
      }
    }

    const sessionPath = getSessionPath();
    const data = await fs.readFile(sessionPath, 'utf8');
    const session = JSON.parse(data);

    // Handle old format (version 1 or no version)
    if (!session.version || session.version < SESSION_VERSION) {
      console.log('[TabSession] Old session format detected, will migrate');
      // Old format had tabs as array with content embedded
      // Just start fresh - the old content is preserved in the file
      return getDefaultSession();
    }

    // Convert tabs map back to array if needed
    if (session.tabs && !Array.isArray(session.tabs)) {
      session.tabs = tabsMapToArray(session.tabs);
    }

    // Validate session structure
    if (!session || !Array.isArray(session.tabs)) {
      console.warn('[TabSession] Invalid session structure, using default');
      return getDefaultSession();
    }

    // Validate each tab has required fields
    session.tabs = session.tabs.filter(tab => {
      if (!tab.id || typeof tab.id !== 'string') return false;
      if (!tab.type || !['local', 'azure', 'untitled'].includes(tab.type)) return false;
      if (typeof tab.title !== 'string') return false;
      return true;
    });

    // Load content from cache files for each tab
    for (const tab of session.tabs) {
      if (tab.cacheFile) {
        tab.content = await loadTabContent(tab.cacheFile);
      } else {
        tab.content = '';
      }
    }

    // Ensure tabOrder contains only valid tab IDs
    const validIds = new Set(session.tabs.map(t => t.id));
    session.tabOrder = (session.tabOrder || []).filter(id => validIds.has(id));

    // Add any tabs not in tabOrder
    for (const tab of session.tabs) {
      if (!session.tabOrder.includes(tab.id)) {
        session.tabOrder.push(tab.id);
      }
    }

    // Validate activeTabId
    if (session.activeTabId && !validIds.has(session.activeTabId)) {
      session.activeTabId = session.tabs.length > 0 ? session.tabs[0].id : null;
    }

    // Clean up orphaned cache files
    await cleanupOrphanedCacheFiles(session);

    console.log(`[TabSession] Loaded ${session.tabs.length} tabs from session`);
    return session;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('[TabSession] No session file found, starting fresh');
    } else {
      console.warn('[TabSession] Failed to load session:', error.message);
    }
    return getDefaultSession();
  }
}

/**
 * Save session metadata to disk (immediate, without content)
 */
async function saveSessionImmediate(session) {
  try {
    await ensureCacheDir();
    const sessionPath = getSessionPath();

    // Create metadata-only session object
    const metadataSession = {
      version: SESSION_VERSION,
      activeTabId: session.activeTabId,
      tabOrder: session.tabOrder,
      tabs: tabsArrayToMap(session.tabs)
    };

    const data = JSON.stringify(metadataSession, null, 2);
    await fs.writeFile(sessionPath, data, 'utf8');
    console.log(`[TabSession] Saved metadata for ${session.tabs.length} tabs`);
  } catch (error) {
    console.error('[TabSession] Failed to save session:', error.message);
  }
}

/**
 * Save session to disk (debounced)
 * Useful for frequent updates like tab switches
 */
function saveSession(session) {
  if (metadataSaveTimer) {
    clearTimeout(metadataSaveTimer);
  }

  metadataSaveTimer = setTimeout(() => {
    saveSessionImmediate(session);
    metadataSaveTimer = null;
  }, METADATA_SAVE_DEBOUNCE_MS);
}

/**
 * Force immediate save (for app close)
 * Filters out Azure tabs since they require a connection to be useful
 * Also deletes Azure tab cache files since they can't be restored
 */
async function flushSession(session) {
  // Clear all pending timers
  if (metadataSaveTimer) {
    clearTimeout(metadataSaveTimer);
    metadataSaveTimer = null;
  }

  for (const [cacheFile, timer] of tabContentTimers) {
    clearTimeout(timer);
  }
  tabContentTimers.clear();

  // Helper to check if a tab should be excluded from session persistence
  const isTransientTab = (tab) =>
    tab.type === 'azure' || (tab.metadata && tab.metadata.isPdf);

  // Save content for all persistable tabs immediately
  const savePromises = [];
  for (const tab of session.tabs) {
    if (!isTransientTab(tab) && tab.cacheFile) {
      savePromises.push(saveTabContent(tab));
    }
  }
  await Promise.all(savePromises);

  // Delete cache files for transient tabs (Azure + PDF)
  const transientTabs = session.tabs.filter(isTransientTab);
  for (const tab of transientTabs) {
    if (tab.cacheFile) {
      await deleteTabCacheFile(tab.cacheFile);
    }
  }

  // Create a copy without transient tabs - Azure needs connection, PDFs cause slow startup
  const filteredSession = {
    ...session,
    tabs: session.tabs.filter(t => !isTransientTab(t)),
    tabOrder: session.tabOrder.filter(id => {
      const tab = session.tabs.find(t => t.id === id);
      return tab && !isTransientTab(tab);
    })
  };

  // Update activeTabId if it was a transient tab
  if (filteredSession.activeTabId) {
    const activeTab = filteredSession.tabs.find(t => t.id === filteredSession.activeTabId);
    if (!activeTab && filteredSession.tabs.length > 0) {
      filteredSession.activeTabId = filteredSession.tabs[0].id;
    } else if (!activeTab) {
      filteredSession.activeTabId = null;
    }
  }

  const removedCount = session.tabs.length - filteredSession.tabs.length;
  if (removedCount > 0) {
    console.log(`[TabSession] Removed ${removedCount} transient tab(s) (Azure/PDF) on shutdown`);
  }

  await saveSessionImmediate(filteredSession);
}

/**
 * Validate that a local file still exists
 * Returns true if file exists, false otherwise
 */
async function validateLocalFile(filePath) {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate all local file tabs in a session
 * Marks tabs with missing files and checks for external changes
 */
async function validateSessionFiles(session) {
  const validationPromises = session.tabs.map(async (tab) => {
    if (tab.type === 'local' && tab.filePath) {
      try {
        const stats = await fs.stat(tab.filePath);
        const currentModTime = stats.mtimeMs;

        tab.fileDeleted = false;

        // Check if file has been modified since we last loaded it
        if (tab.fileModTime && currentModTime > tab.fileModTime) {
          tab.hasExternalChanges = true;
          console.log(`[TabSession] File has external changes: ${tab.filePath}`);
        } else {
          tab.hasExternalChanges = false;
        }
      } catch (error) {
        // File doesn't exist
        tab.fileDeleted = true;
        tab.hasExternalChanges = false;
        console.warn(`[TabSession] File no longer exists: ${tab.filePath}`);
      }
    }
    return tab;
  });

  await Promise.all(validationPromises);
  return session;
}

module.exports = {
  getCacheDir,
  getTabsDir,
  getSessionPath,
  getDefaultSession,
  loadSession,
  saveSession,
  saveSessionImmediate,
  flushSession,
  validateLocalFile,
  validateSessionFiles,
  // New exports for per-tab operations
  generateTabFilename,
  saveTabContent,
  saveTabContentDebounced,
  loadTabContent,
  deleteTabCacheFile
};
