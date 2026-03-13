/**
 * Tab Manager
 *
 * Manages the state of all open tabs in the editor.
 * Handles creation, switching, closing, and content updates.
 */

const path = require('path');
const crypto = require('crypto');
const sessionStore = require('./tabSessionStore');

// Current session state
let session = null;

/**
 * Generate a unique tab ID
 */
function generateTabId() {
  return crypto.randomUUID();
}

/**
 * Get title from file path
 */
function getTitleFromPath(filePath) {
  if (!filePath) return 'Untitled';
  return path.basename(filePath);
}

/**
 * Get title from Azure page path
 */
function getTitleFromAzurePath(pagePath) {
  if (!pagePath) return 'Untitled';
  const parts = pagePath.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : 'Root';
}

/**
 * Initialize the tab manager
 * Loads session from disk and validates file existence
 */
async function initialize() {
  session = await sessionStore.loadSession();
  session = await sessionStore.validateSessionFiles(session);

  // If no tabs, create a default untitled tab
  if (session.tabs.length === 0) {
    const newTab = createTabObject({ type: 'untitled' });
    session.tabs.push(newTab);
    session.tabOrder.push(newTab.id);
    session.activeTabId = newTab.id;
  }

  // Ensure we have an active tab
  if (!session.activeTabId && session.tabs.length > 0) {
    session.activeTabId = session.tabs[0].id;
  }

  await sessionStore.saveSessionImmediate(session);
  return session;
}

/**
 * Create a tab object with default values
 */
function createTabObject(options = {}) {
  const id = generateTabId();
  const type = options.type || 'untitled';

  let title = 'Untitled';
  if (type === 'local' && options.filePath) {
    title = getTitleFromPath(options.filePath);
  } else if (type === 'azure' && options.azurePage?.pagePath) {
    title = getTitleFromAzurePath(options.azurePage.pagePath);
  }

  const tab = {
    id,
    type,
    filePath: options.filePath || null,
    azurePage: options.azurePage || null,
    title: options.title || title,
    content: options.content || '',
    isDirty: options.isDirty || false,
    fileModTime: options.fileModTime || null,        // File mtime when loaded
    hasExternalChanges: options.hasExternalChanges || false, // File modified externally
    metadata: options.metadata || null,                     // Extra metadata (e.g. isPdf)
    cursorPosition: options.cursorPosition || { line: 0, ch: 0 },
    scrollPosition: options.scrollPosition || 0,
    lastModified: Date.now(),
    fileDeleted: false,
    cacheFile: null  // Will be set below
  };

  // Generate cache filename for the tab
  tab.cacheFile = sessionStore.generateTabFilename(tab);

  return tab;
}

/**
 * Create a new tab
 */
async function createTab(options = {}) {
  if (!session) await initialize();

  const newTab = createTabObject(options);
  session.tabs.push(newTab);
  session.tabOrder.push(newTab.id);
  session.activeTabId = newTab.id;

  sessionStore.saveSession(session);
  return newTab;
}

/**
 * Find existing tab by file path
 */
function findTabByFilePath(filePath) {
  if (!session || !filePath) return null;
  return session.tabs.find(t => t.type === 'local' && t.filePath === filePath);
}

/**
 * Find existing tab by Azure page path
 */
function findTabByAzurePath(pagePath) {
  if (!session || !pagePath) return null;
  return session.tabs.find(t =>
    t.type === 'azure' &&
    t.azurePage?.pagePath === pagePath
  );
}

/**
 * Switch to a tab
 */
async function switchTab(tabId) {
  if (!session) await initialize();

  const tab = session.tabs.find(t => t.id === tabId);
  if (!tab) {
    console.warn(`[TabManager] Tab not found: ${tabId}`);
    return null;
  }

  session.activeTabId = tabId;
  sessionStore.saveSession(session);
  return tab;
}

/**
 * Close a tab
 * Returns { needsSave: boolean, tab: object } if tab has unsaved changes
 */
async function closeTab(tabId) {
  if (!session) await initialize();

  const tabIndex = session.tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) {
    console.warn(`[TabManager] Tab not found: ${tabId}`);
    return { closed: false, error: 'Tab not found' };
  }

  const tab = session.tabs[tabIndex];

  // Check for unsaved changes
  if (tab.isDirty) {
    return { closed: false, needsSave: true, tab };
  }

  // Delete the tab's cache file before removing
  if (tab.cacheFile) {
    await sessionStore.deleteTabCacheFile(tab.cacheFile);
  }

  // Remove tab
  session.tabs.splice(tabIndex, 1);
  session.tabOrder = session.tabOrder.filter(id => id !== tabId);

  // Update active tab if we closed the active one
  if (session.activeTabId === tabId) {
    if (session.tabs.length > 0) {
      // Switch to adjacent tab or first tab
      const newIndex = Math.min(tabIndex, session.tabs.length - 1);
      session.activeTabId = session.tabOrder[newIndex] || session.tabs[0].id;
    } else {
      // Create a new untitled tab if all tabs are closed
      const newTab = createTabObject({ type: 'untitled' });
      session.tabs.push(newTab);
      session.tabOrder.push(newTab.id);
      session.activeTabId = newTab.id;
    }
  }

  sessionStore.saveSession(session);
  return { closed: true, newActiveTabId: session.activeTabId };
}

/**
 * Force close a tab (ignoring unsaved changes)
 */
async function forceCloseTab(tabId) {
  if (!session) await initialize();

  const tabIndex = session.tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return { closed: false, error: 'Tab not found' };

  const tab = session.tabs[tabIndex];

  // Delete the tab's cache file before removing
  if (tab.cacheFile) {
    await sessionStore.deleteTabCacheFile(tab.cacheFile);
  }

  session.tabs.splice(tabIndex, 1);
  session.tabOrder = session.tabOrder.filter(id => id !== tabId);

  if (session.activeTabId === tabId) {
    if (session.tabs.length > 0) {
      const newIndex = Math.min(tabIndex, session.tabs.length - 1);
      session.activeTabId = session.tabOrder[newIndex] || session.tabs[0].id;
    } else {
      const newTab = createTabObject({ type: 'untitled' });
      session.tabs.push(newTab);
      session.tabOrder.push(newTab.id);
      session.activeTabId = newTab.id;
    }
  }

  sessionStore.saveSession(session);
  return { closed: true, newActiveTabId: session.activeTabId };
}

/**
 * Update tab content
 * Only marks tab as dirty if content actually changed
 * @param {string} tabId - Tab ID
 * @param {string} content - New content
 * @param {object} cursorPosition - Cursor position
 * @param {number} scrollPosition - Scroll position
 * @param {boolean} skipDirty - If true, never mark dirty (for initial content sync)
 */
async function updateTabContent(tabId, content, cursorPosition = null, scrollPosition = null, skipDirty = false) {
  if (!session) await initialize();

  const tab = session.tabs.find(t => t.id === tabId);
  if (!tab) {
    console.warn(`[TabManager] Tab not found: ${tabId}`);
    return null;
  }

  // Only mark dirty if content actually changed and skipDirty is false
  const contentChanged = tab.content !== content;
  tab.content = content;
  if (contentChanged && !skipDirty) {
    tab.isDirty = true;
  }
  tab.lastModified = Date.now();

  if (cursorPosition !== null) {
    tab.cursorPosition = cursorPosition;
  }
  if (scrollPosition !== null) {
    tab.scrollPosition = scrollPosition;
  }

  // Save metadata (debounced)
  sessionStore.saveSession(session);

  // Save content to per-tab cache file (debounced per-tab)
  if (contentChanged && tab.cacheFile) {
    sessionStore.saveTabContentDebounced(tab);
  }

  return tab;
}

/**
 * Mark tab as saved (no longer dirty)
 * Deletes the cache file since content is now saved to disk
 */
async function markTabSaved(tabId, newFilePath = null) {
  if (!session) await initialize();

  const tab = session.tabs.find(t => t.id === tabId);
  if (!tab) return null;

  tab.isDirty = false;

  // Update file path if provided (for Save As)
  if (newFilePath) {
    tab.filePath = newFilePath;
    tab.type = 'local';
    tab.title = getTitleFromPath(newFilePath);
  }

  // Delete the cache file - content is now saved to the actual file
  if (tab.cacheFile) {
    await sessionStore.deleteTabCacheFile(tab.cacheFile);
  }

  sessionStore.saveSession(session);
  return tab;
}

/**
 * Update Azure page info on a tab
 */
async function updateTabAzureInfo(tabId, azurePage) {
  if (!session) await initialize();

  const tab = session.tabs.find(t => t.id === tabId);
  if (!tab) return null;

  tab.azurePage = azurePage;
  tab.type = 'azure';
  tab.title = getTitleFromAzurePath(azurePage.pagePath);

  sessionStore.saveSession(session);
  return tab;
}

/**
 * Replace an Azure tab's content with a new page
 */
async function replaceAzureTab(tabId, azurePage, content) {
  if (!session) await initialize();

  const tab = session.tabs.find(t => t.id === tabId);
  if (!tab) return null;

  tab.type = 'azure';
  tab.azurePage = azurePage;
  tab.content = content;
  tab.title = getTitleFromAzurePath(azurePage.pagePath);
  tab.isDirty = false;
  tab.lastModified = Date.now();
  tab.filePath = null;
  tab.fileModTime = null;
  tab.hasExternalChanges = false;

  sessionStore.saveSession(session);
  return tab;
}

/**
 * Reorder tabs
 */
async function reorderTabs(newOrder) {
  if (!session) await initialize();

  // Validate that all IDs exist
  const validIds = new Set(session.tabs.map(t => t.id));
  const validOrder = newOrder.filter(id => validIds.has(id));

  // Add any missing tabs at the end
  for (const tab of session.tabs) {
    if (!validOrder.includes(tab.id)) {
      validOrder.push(tab.id);
    }
  }

  session.tabOrder = validOrder;
  sessionStore.saveSession(session);
  return session.tabOrder;
}

/**
 * Get all tabs
 */
function getAllTabs() {
  if (!session) return [];
  return session.tabs.map(tab => ({ ...tab }));
}

/**
 * Get active tab
 */
function getActiveTab() {
  if (!session || !session.activeTabId) return null;
  const tab = session.tabs.find(t => t.id === session.activeTabId);
  return tab ? { ...tab } : null;
}

/**
 * Get tab by ID
 */
function getTabById(tabId) {
  if (!session) return null;
  const tab = session.tabs.find(t => t.id === tabId);
  return tab ? { ...tab } : null;
}

/**
 * Get tab order
 */
function getTabOrder() {
  return session ? [...session.tabOrder] : [];
}

/**
 * Get active tab ID
 */
function getActiveTabId() {
  return session?.activeTabId || null;
}

/**
 * Get all dirty tabs
 */
function getDirtyTabs() {
  if (!session) return [];
  return session.tabs.filter(t => t.isDirty).map(tab => ({ ...tab }));
}

/**
 * Get dirty Azure tabs only (for close prompts)
 * Local files and untitled tabs have content persisted in session, so no prompt needed
 */
function getDirtyAzureTabs() {
  if (!session) return [];
  return session.tabs.filter(t => t.isDirty && t.type === 'azure').map(tab => ({ ...tab }));
}

/**
 * Update tab file modification time
 */
async function updateTabFileModTime(tabId, fileModTime) {
  if (!session) await initialize();

  const tab = session.tabs.find(t => t.id === tabId);
  if (!tab) return null;

  tab.fileModTime = fileModTime;
  tab.hasExternalChanges = false; // Clear external changes flag when we update mod time
  sessionStore.saveSession(session);
  return tab;
}

/**
 * Clear external changes flag on a tab
 */
async function clearTabExternalChanges(tabId) {
  if (!session) await initialize();

  const tab = session.tabs.find(t => t.id === tabId);
  if (!tab) return null;

  tab.hasExternalChanges = false;
  sessionStore.saveSession(session);
  return tab;
}

/**
 * Mark a tab as having external changes
 */
async function markTabExternalChanges(tabId) {
  if (!session) await initialize();

  const tab = session.tabs.find(t => t.id === tabId);
  if (!tab) return null;

  tab.hasExternalChanges = true;
  sessionStore.saveSession(session);
  return tab;
}

/**
 * Check if any tab has unsaved changes
 */
function hasUnsavedChanges() {
  if (!session) return false;
  return session.tabs.some(t => t.isDirty);
}

/**
 * Flush session to disk (for app close)
 */
async function flushSession() {
  if (session) {
    await sessionStore.flushSession(session);
  }
}

/**
 * Get current session state
 */
function getSession() {
  if (!session) return null;
  return {
    tabs: session.tabs.map(t => ({ ...t })),
    activeTabId: session.activeTabId,
    tabOrder: [...session.tabOrder]
  };
}

module.exports = {
  initialize,
  createTab,
  findTabByFilePath,
  findTabByAzurePath,
  switchTab,
  closeTab,
  forceCloseTab,
  updateTabContent,
  markTabSaved,
  updateTabAzureInfo,
  replaceAzureTab,
  reorderTabs,
  getAllTabs,
  getActiveTab,
  getTabById,
  getTabOrder,
  getActiveTabId,
  getDirtyTabs,
  getDirtyAzureTabs,
  updateTabFileModTime,
  clearTabExternalChanges,
  markTabExternalChanges,
  hasUnsavedChanges,
  flushSession,
  getSession
};
