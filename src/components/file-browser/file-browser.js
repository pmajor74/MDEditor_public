/**
 * File Browser Component
 *
 * Local file system browser with tree view navigation.
 * Follows wiki-sidebar patterns for consistency.
 */

import { getFileIcon, getFileIconColor } from './file-icons.js';
import { showIndexingWizard } from '../indexing-wizard/indexing-wizard.js';
import { showPersonaWizard } from '../persona/persona-wizard.js';
import { startTranscription, startFolderTranscription } from './transcription-ui.js';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a']);

// State
let browserVisible = false;
let currentRootPath = null;
let expandedPaths = new Set();
let loadingPaths = new Set();
let loadedPaths = new Set();

// Multi-selection state
let selectedPaths = new Set();      // All selected item paths
let lastClickedPath = null;         // For Shift+click range selection
let anchorPath = null;              // Range anchor for Shift+click

let focusedNodeIndex = -1;
let contextMenuPaths = new Set();   // Snapshot of selected paths for context menu actions
let contextMenuShowTime = 0;        // Timestamp when context menu was shown (prevents immediate hiding)

// Callbacks
let onFileSelectCallback = null;

// Resize state
const BROWSER_MIN_WIDTH = 200;
const BROWSER_MAX_WIDTH = 500;
const BROWSER_WIDTH_STORAGE_KEY = 'file-browser-width';
const LAST_FOLDER_STORAGE_KEY = 'file-browser-last-folder';
let isResizing = false;

/**
 * Build the file browser HTML structure
 */
function buildBrowserHTML() {
  const browser = document.getElementById('file-browser');
  if (!browser) return;

  browser.innerHTML = `
    <div class="sidebar-resize-handle" title="Drag to resize"></div>
    <div class="sidebar-header file-browser-header">
      <span class="sidebar-title">File Explorer</span>
      <button class="sidebar-close" title="Close">&times;</button>
    </div>

    <div class="file-browser-actions">
      <button class="btn-open-folder" title="Open Folder">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>
        </svg>
        Open Folder
      </button>
    </div>

    <div id="file-browser-breadcrumb" class="file-browser-breadcrumb hidden"></div>

    <div id="file-browser-tree" class="file-browser-tree" tabindex="0" role="tree" aria-label="File explorer">
      <div class="empty-state">
        <p>No folder open</p>
        <p class="empty-state-hint">Click "Open Folder" to browse local files</p>
      </div>
    </div>
  `;

  // Attach event listeners
  browser.querySelector('.sidebar-close').addEventListener('click', hideBrowser);
  browser.querySelector('.btn-open-folder').addEventListener('click', openFolder);

  // Setup resize
  setupResizeHandlers(browser);

  // Setup keyboard navigation
  setupKeyboardNavigation();

  // Setup context menu
  setupContextMenu();

  // Restore saved width
  restoreBrowserWidth(browser);

  // Try to load last used folder
  initializeLastFolder();
}

/**
 * Setup resize handle drag functionality
 */
function setupResizeHandlers(browser) {
  const resizeHandle = browser.querySelector('.sidebar-resize-handle');
  if (!resizeHandle) return;

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isResizing = true;
    resizeHandle.classList.add('resizing');
    document.body.classList.add('sidebar-resizing');

    const startX = e.clientX;
    const startWidth = browser.offsetWidth;

    let resizeRafPending = false;
    const onMouseMove = (moveEvent) => {
      if (!isResizing) return;
      if (resizeRafPending) return;
      resizeRafPending = true;
      requestAnimationFrame(() => {
        const deltaX = moveEvent.clientX - startX;
        let newWidth = startWidth + deltaX;

        // Constrain width
        newWidth = Math.max(BROWSER_MIN_WIDTH, Math.min(BROWSER_MAX_WIDTH, newWidth));

        browser.style.width = `${newWidth}px`;
        resizeRafPending = false;
      });
    };

    const onMouseUp = () => {
      isResizing = false;
      resizeHandle.classList.remove('resizing');
      document.body.classList.remove('sidebar-resizing');

      // Save width to localStorage
      const finalWidth = browser.offsetWidth;
      localStorage.setItem(BROWSER_WIDTH_STORAGE_KEY, finalWidth.toString());

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

/**
 * Restore saved browser width
 */
function restoreBrowserWidth(browser) {
  const savedWidth = localStorage.getItem(BROWSER_WIDTH_STORAGE_KEY);
  if (savedWidth) {
    const width = parseInt(savedWidth, 10);
    if (width >= BROWSER_MIN_WIDTH && width <= BROWSER_MAX_WIDTH) {
      browser.style.width = `${width}px`;
    }
  }
}

/**
 * Setup keyboard navigation
 */
function setupKeyboardNavigation() {
  const treeContainer = document.getElementById('file-browser-tree');
  if (!treeContainer) return;

  treeContainer.addEventListener('keydown', (e) => {
    const items = treeContainer.querySelectorAll('.tree-item');
    if (items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusedNodeIndex = Math.min(focusedNodeIndex + 1, items.length - 1);
        updateFocus(items);
        break;

      case 'ArrowUp':
        e.preventDefault();
        focusedNodeIndex = Math.max(focusedNodeIndex - 1, 0);
        updateFocus(items);
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (focusedNodeIndex >= 0) {
          const item = items[focusedNodeIndex];
          const path = item.dataset.path;
          if (item.dataset.isDirectory === 'true' && !expandedPaths.has(path)) {
            toggleExpand(path);
          }
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (focusedNodeIndex >= 0) {
          const item = items[focusedNodeIndex];
          const path = item.dataset.path;
          if (item.dataset.isDirectory === 'true' && expandedPaths.has(path)) {
            toggleExpand(path);
          }
        }
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedNodeIndex >= 0) {
          const item = items[focusedNodeIndex];
          handleItemClick(item.dataset.path, item.dataset.isDirectory === 'true');
        }
        break;

      case 'Home':
        e.preventDefault();
        focusedNodeIndex = 0;
        updateFocus(items);
        break;

      case 'End':
        e.preventDefault();
        focusedNodeIndex = items.length - 1;
        updateFocus(items);
        break;

      case 'Delete':
        e.preventDefault();
        if (focusedNodeIndex >= 0) {
          const item = items[focusedNodeIndex];
          deleteItem(item.dataset.path);
        }
        break;

      case 'F2':
        e.preventDefault();
        if (focusedNodeIndex >= 0) {
          const item = items[focusedNodeIndex];
          renameItem(item.dataset.path);
        }
        break;

      case 'a':
        // Ctrl+A: Select all visible items
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          selectAllVisible();
        }
        break;

      case 'Escape':
        // Escape: Clear selection
        e.preventDefault();
        clearSelection();
        break;
    }
  });
}

/**
 * Select all visible items in the tree
 */
function selectAllVisible() {
  const items = getVisibleItems();
  selectedPaths = new Set(items.map(i => i.path));
  renderTree();
}

/**
 * Clear all selected items
 */
function clearSelection() {
  selectedPaths.clear();
  anchorPath = null;
  lastClickedPath = null;
  renderTree();
}

/**
 * Get flat list of visible items (expanded directories' children included)
 * @returns {Array<{path: string, isDirectory: boolean}>}
 */
function getVisibleItems() {
  const items = [];

  function collectItems(dirPath, depth = 0) {
    const dirItems = directoryCache.get(dirPath) || [];
    for (const item of dirItems) {
      items.push({ path: item.path, isDirectory: item.isDirectory, name: item.name });
      if (item.isDirectory && expandedPaths.has(item.path)) {
        collectItems(item.path, depth + 1);
      }
    }
  }

  if (currentRootPath) {
    collectItems(currentRootPath);
  }

  return items;
}

/**
 * Setup context menu
 */
function setupContextMenu() {
  const treeContainer = document.getElementById('file-browser-tree');
  console.log('[File Browser] setupContextMenu - treeContainer:', treeContainer);
  if (!treeContainer) {
    console.warn('[File Browser] Tree container not found, context menu not setup');
    return;
  }

  treeContainer.addEventListener('contextmenu', (e) => {
    console.log('[File Browser] contextmenu event fired on:', e.target);
    e.preventDefault();

    // Find the tree-item that was right-clicked
    const item = e.target.closest('.tree-item');
    console.log('[File Browser] Closest tree-item:', item);
    if (!item) return;

    const clickedPath = item.dataset.path;
    const isClickedSelected = selectedPaths.has(clickedPath);

    // If right-clicked item is not in selection, select it alone
    if (!isClickedSelected) {
      selectedPaths.clear();
      selectedPaths.add(clickedPath);
      anchorPath = clickedPath;
      renderTree();
    }

    // Context menu now operates on selectedPaths Set
    contextMenuPaths = new Set(selectedPaths);  // Snapshot for menu actions

    showContextMenu(e.clientX, e.clientY);
  });

  // Close context menu when clicking elsewhere
  // Use mousedown instead of click to avoid race conditions with contextmenu event
  document.addEventListener('mousedown', (e) => {
    const menu = document.getElementById('file-browser-context-menu');
    if (menu && !menu.contains(e.target)) {
      hideContextMenu();
    }
  });
}

/**
 * Show context menu at position
 */
function showContextMenu(x, y) {
  console.log('[File Browser] showContextMenu called at:', x, y);
  // Remove existing menu
  hideContextMenu(true);  // Force hide any existing menu

  const menu = document.createElement('div');
  menu.id = 'file-browser-context-menu';
  menu.className = 'context-menu file-browser-context-menu';
  menu.setAttribute('role', 'menu');

  // Determine what's selected
  const pathsArray = [...contextMenuPaths];
  const count = pathsArray.length;
  const hasFiles = pathsArray.some(p => !isPathDirectorySync(p));
  const hasFolders = pathsArray.some(p => isPathDirectorySync(p));
  const singleItem = count === 1;
  const singleDir = singleItem && hasFolders;
  const singleFile = singleItem && hasFiles;

  // Build context menu based on selection
  const menuItems = [
    { action: 'open', icon: '📂', label: singleDir ? 'Expand' : (singleFile ? 'Open' : `Open ${count} items`), show: true },
    { divider: true },
    { action: 'new-file', icon: '📄', label: 'New File', show: singleDir },
    { action: 'new-folder', icon: '📁', label: 'New Folder', show: singleDir },
    { divider: true, show: singleDir },
    { action: 'rename', icon: '✏️', label: 'Rename', show: singleItem },
    { action: 'delete', icon: '🗑️', label: count === 1 ? 'Delete' : `Delete ${count} items`, show: true, danger: true },
    { divider: true },
    { action: 'transcribe-audio', icon: '🎙️', label: 'Transcribe Audio', show: singleFile && isAudioFile(pathsArray[0]) },
    { action: 'transcribe-folder', icon: '🎙️', label: 'Transcribe Audio in Folder', show: singleDir },
    { divider: true, show: (singleFile && isAudioFile(pathsArray[0])) || singleDir },
    { action: 'add-to-catalog', icon: '🧠', label: 'Add to Catalog...', show: true },  // Always show - works with files and folders
    { action: 'create-persona', icon: '🎭', label: 'Create Persona...', show: singleDir || singleFile },
    { divider: true },
    { action: 'copy-path', icon: '📋', label: count === 1 ? 'Copy Path' : 'Copy Paths', show: true },
    { action: 'reveal', icon: '🔍', label: 'Reveal in Explorer', show: singleItem }
  ];

  menuItems.forEach(item => {
    if (item.show === false) return;

    if (item.divider) {
      const divider = document.createElement('div');
      divider.className = 'context-divider';
      divider.setAttribute('role', 'separator');
      menu.appendChild(divider);
    } else {
      const button = document.createElement('button');
      button.className = `context-menu-item${item.danger ? ' context-menu-item-danger' : ''}`;
      button.setAttribute('role', 'menuitem');
      button.dataset.action = item.action;
      button.innerHTML = `
        <span class="context-icon">${item.icon}</span>
        <span>${item.label}</span>
      `;
      button.addEventListener('click', (e) => {
        console.log('[File Browser] Menu item clicked:', item.action);
        e.stopPropagation();
        handleContextMenuAction(item.action);
        hideContextMenu(true);  // Force hide after action
      });
      menu.appendChild(button);
    }
  });

  document.body.appendChild(menu);
  console.log('[File Browser] Context menu appended to body');

  // Position menu, keeping it on screen
  const rect = menu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (x + rect.width > viewportWidth) {
    x = viewportWidth - rect.width - 10;
  }
  if (y + rect.height > viewportHeight) {
    y = viewportHeight - rect.height - 10;
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Set timestamp to prevent immediate hiding
  contextMenuShowTime = Date.now();
  console.log('[File Browser] Context menu positioned at:', x, y, 'size:', rect.width, rect.height, 'showTime:', contextMenuShowTime);
}

/**
 * Check if a file has an audio extension
 * @param {string} filePath - File path to check
 * @returns {boolean}
 */
function isAudioFile(filePath) {
  const ext = filePath.includes('.') ? '.' + filePath.split('.').pop().toLowerCase() : '';
  return AUDIO_EXTENSIONS.has(ext);
}

/**
 * Check if path is a directory (sync, using cached data)
 * @param {string} filePath - Path to check
 * @returns {boolean}
 */
function isPathDirectorySync(filePath) {
  // Check in directory cache
  for (const [, items] of directoryCache) {
    const found = items.find(item => item.path === filePath);
    if (found) {
      return found.isDirectory;
    }
  }
  // Default to false if not found
  return false;
}

/**
 * Hide context menu
 * @param {boolean} force - If true, hide immediately regardless of timestamp
 */
function hideContextMenu(force = false) {
  const menu = document.getElementById('file-browser-context-menu');
  if (menu) {
    const timeSinceShow = Date.now() - contextMenuShowTime;
    console.log('[File Browser] hideContextMenu called, timeSinceShow:', timeSinceShow, 'force:', force);

    // Prevent hiding if menu was just shown (within 100ms) unless forced
    if (!force && timeSinceShow < 100) {
      console.log('[File Browser] Ignoring hide request - menu was just shown');
      return;
    }

    console.log('[File Browser] Actually removing menu');
    menu.remove();
    // Only clear paths when actually removing a menu
    contextMenuPaths.clear();
  }
  // Note: Don't clear contextMenuPaths if no menu exists - it may have just been set
}

/**
 * Handle context menu action
 */
async function handleContextMenuAction(action) {
  const pathsArray = [...contextMenuPaths];
  if (pathsArray.length === 0) return;

  const singlePath = pathsArray.length === 1 ? pathsArray[0] : null;

  switch (action) {
    case 'open':
      // Open all selected items
      for (const p of pathsArray) {
        const isDir = isPathDirectorySync(p);
        if (isDir) {
          if (!expandedPaths.has(p)) {
            toggleExpand(p);
          }
        } else {
          openFile(p);
        }
      }
      break;

    case 'new-file':
      if (singlePath) createNewFile(singlePath);
      break;

    case 'new-folder':
      if (singlePath) createNewFolder(singlePath);
      break;

    case 'rename':
      if (singlePath) renameItem(singlePath);
      break;

    case 'delete':
      await deleteItems(pathsArray);
      break;

    case 'copy-path':
      // Copy all paths, one per line
      copyToClipboard(pathsArray.join('\n'));
      break;

    case 'reveal':
      if (singlePath) revealInExplorer(singlePath);
      break;

    case 'add-to-catalog':
      console.log('[File Browser] Add to Catalog action triggered for:', pathsArray);
      showCatalogDialog(pathsArray);
      break;

    case 'create-persona':
      if (singlePath) {
        console.log('[File Browser] Create Persona action triggered for:', singlePath);
        showPersonaWizard(singlePath);
      }
      break;

    case 'transcribe-audio':
      if (singlePath) {
        console.log('[File Browser] Transcribe Audio action triggered for:', singlePath);
        startTranscription(singlePath, () => refresh(true));
      }
      break;

    case 'transcribe-folder':
      if (singlePath) {
        handleTranscribeFolder(singlePath);
      }
      break;
  }
}

/**
 * Delete multiple items
 * @param {string[]} paths - Paths to delete
 */
async function deleteItems(paths) {
  const count = paths.length;
  const message = count === 1
    ? `Are you sure you want to delete "${paths[0].split(/[\\/]/).pop()}"?`
    : `Are you sure you want to delete ${count} items?`;

  const confirmed = confirm(message);
  if (!confirmed) return;

  const errors = [];
  const affectedDirs = new Set();

  for (const itemPath of paths) {
    try {
      const result = await window.electronAPI.fileDelete(itemPath);
      if (result.success) {
        const parentDir = getParentPath(itemPath);
        if (parentDir) affectedDirs.add(parentDir);
      } else {
        errors.push({ path: itemPath, error: result.error });
      }
    } catch (err) {
      console.error('[File Browser] Failed to delete:', itemPath, err);
      errors.push({ path: itemPath, error: err.message });
    }
  }

  // Refresh affected directories
  for (const dir of affectedDirs) {
    await refreshDirectory(dir || currentRootPath);
  }

  // Clear selection
  selectedPaths.clear();

  if (errors.length > 0) {
    alert(`Failed to delete ${errors.length} item(s):\n${errors.map(e => e.path).join('\n')}`);
  }
}

/**
 * Check if path is a directory
 */
async function isPathDirectory(path) {
  try {
    const result = await window.electronAPI.fileGetMetadata(path);
    return result.success && result.isDirectory;
  } catch {
    return false;
  }
}

/**
 * Create new file in directory
 */
async function createNewFile(dirPath) {
  const filename = prompt('Enter file name:', 'new-file.md');
  if (!filename) return;

  try {
    const result = await window.electronAPI.fileCreateFile(dirPath, filename);
    if (result.success) {
      await refreshDirectory(dirPath);
    } else {
      alert('Failed to create file: ' + result.error);
    }
  } catch (err) {
    console.error('[File Browser] Failed to create file:', err);
    alert('Failed to create file');
  }
}

/**
 * Create new folder in directory
 */
async function createNewFolder(dirPath) {
  const folderName = prompt('Enter folder name:', 'new-folder');
  if (!folderName) return;

  try {
    const result = await window.electronAPI.fileCreateFolder(dirPath, folderName);
    if (result.success) {
      await refreshDirectory(dirPath);
    } else {
      alert('Failed to create folder: ' + result.error);
    }
  } catch (err) {
    console.error('[File Browser] Failed to create folder:', err);
    alert('Failed to create folder');
  }
}

/**
 * Rename a file or folder
 */
async function renameItem(itemPath) {
  const currentName = itemPath.split(/[\\/]/).pop();
  const newName = prompt('Enter new name:', currentName);
  if (!newName || newName === currentName) return;

  try {
    const result = await window.electronAPI.fileRename(itemPath, newName);
    if (result.success) {
      // Refresh parent directory
      const parentDir = itemPath.substring(0, itemPath.lastIndexOf(/[\\/]/.test(itemPath) ? itemPath.match(/[\\/]/)[0] : '/'));
      await refreshDirectory(parentDir || currentRootPath);
    } else {
      alert('Failed to rename: ' + result.error);
    }
  } catch (err) {
    console.error('[File Browser] Failed to rename:', err);
    alert('Failed to rename');
  }
}

/**
 * Delete a file or folder
 */
async function deleteItem(itemPath) {
  const name = itemPath.split(/[\\/]/).pop();
  const confirmed = confirm(`Are you sure you want to delete "${name}"?`);
  if (!confirmed) return;

  try {
    const result = await window.electronAPI.fileDelete(itemPath);
    if (result.success) {
      // Refresh parent directory
      const parentDir = getParentPath(itemPath);
      await refreshDirectory(parentDir || currentRootPath);
    } else {
      alert('Failed to delete: ' + result.error);
    }
  } catch (err) {
    console.error('[File Browser] Failed to delete:', err);
    alert('Failed to delete');
  }
}

/**
 * Copy path to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('[File Browser] Failed to copy to clipboard:', err);
  }
}

/**
 * Reveal item in system file explorer
 */
async function revealInExplorer(itemPath) {
  try {
    // Use shell.showItemInFolder via IPC if available
    // For now, copy path as fallback
    await copyToClipboard(itemPath);
    alert('Path copied to clipboard');
  } catch (err) {
    console.error('[File Browser] Failed to reveal:', err);
  }
}

/**
 * Show catalog selection dialog for adding files/folders to vector DB
 * Delegates to the indexing wizard with all necessary context.
 * @param {string|string[]} paths - Single path or array of paths to add
 */
async function showCatalogDialog(paths) {
  console.log('[File Browser] showCatalogDialog called with paths:', paths);

  // Normalize to array
  const pathsArray = Array.isArray(paths) ? paths : [paths];

  // Check if vector DB is available
  let isAvailable = false;
  try {
    isAvailable = await window.electronAPI.vectordbIsAvailable();
  } catch (err) {
    console.error('[File Browser] Failed to check vector DB availability:', err);
  }

  if (!isAvailable) {
    let detail = '';
    try {
      const info = await window.electronAPI.vectordbGetProviderInfo();
      detail = `\nProvider: ${info?.provider || 'unknown'}`;
      if (info?.error) detail += `\nError: ${info.error}`;
      if (info && !info.initialized && !info.error) {
        detail += '\nVector DB failed to initialize. Check the application logs for details.';
      }
      if (info && !info.configured) {
        detail += '\nEmbedding provider is not configured.';
      }
    } catch (e) { /* ignore */ }
    alert('Vector DB is not available.' + detail + '\nPlease check your LLM provider settings (Settings > AI / LLM Provider).');
    return;
  }

  // Get existing catalogs
  let catalogs = [];
  try {
    const result = await window.electronAPI.vectordbGetCollections();
    if (result.success) {
      catalogs = (result.collections || []).filter(c => !c.name.startsWith('persona-'));
    }
  } catch (err) {
    console.error('[File Browser] Failed to load catalogs:', err);
  }

  // Get default catalog name from first folder or file's parent
  const folderPaths = pathsArray.filter(p => isPathDirectorySync(p));
  const filePaths = pathsArray.filter(p => !isPathDirectorySync(p));

  let defaultName = 'New Catalog';
  if (folderPaths.length > 0) {
    defaultName = folderPaths[0].split(/[\\/]/).pop() || defaultName;
  } else if (filePaths.length > 0) {
    const parentDir = getParentPath(filePaths[0]);
    defaultName = parentDir ? parentDir.split(/[\\/]/).pop() : 'Files';
  }

  const rootPath = folderPaths.length > 0
    ? folderPaths[0]
    : (filePaths.length > 0 ? getParentPath(filePaths[0]) : null);

  // Open the unified indexing wizard
  showIndexingWizard({
    paths: pathsArray,
    extensions: [],
    catalogName: defaultName,
    isNewCatalog: catalogs.length === 0,
    existingCatalogs: catalogs,
    includeSubfolders: true,
    defaultName,
    rootPath,
    folderPaths,
    filePaths
  });
}

/**
 * Handle "Transcribe Audio in Folder" action
 * Lists audio files in the folder and starts batch transcription
 * @param {string} dirPath - Path to the folder
 */
async function handleTranscribeFolder(dirPath) {
  try {
    const result = await window.electronAPI.fileGetDirectoryContents(dirPath);
    if (!result.success) {
      alert('Failed to read folder contents');
      return;
    }

    const audioFiles = (result.items || []).filter(
      item => !item.isDirectory && isAudioFile(item.path)
    );

    if (audioFiles.length === 0) {
      alert('No audio files found in this folder.');
      return;
    }

    const folderDisplayName = dirPath.split(/[\\/]/).pop();
    const confirmed = confirm(
      `Found ${audioFiles.length} audio file(s) in "${folderDisplayName}".\n\nTranscribe all?`
    );
    if (!confirmed) return;

    const filePaths = audioFiles.map(f => f.path);
    startFolderTranscription(filePaths, folderDisplayName, () => refresh(true));
  } catch (err) {
    console.error('[File Browser] Failed to transcribe folder:', err);
    alert('Failed to start folder transcription');
  }
}

/**
 * Get parent path
 */
function getParentPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  return filePath.substring(0, lastSlash);
}

/**
 * Refresh a specific directory
 */
async function refreshDirectory(dirPath) {
  loadedPaths.delete(dirPath);
  directoryCache.delete(dirPath);
  await loadDirectory(dirPath, true);
  renderTree();
}

/**
 * Update visual focus on tree items
 */
function updateFocus(items) {
  items.forEach((item, index) => {
    if (index === focusedNodeIndex) {
      item.classList.add('focused');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('focused');
    }
  });
}

/**
 * Open folder dialog
 */
async function openFolder() {
  try {
    const result = await window.electronAPI.fileOpenFolder();
    if (result.success && result.path) {
      currentRootPath = result.path;
      expandedPaths.clear();
      loadedPaths.clear();
      directoryCache.clear();
      selectedPaths.clear();
      anchorPath = null;
      lastClickedPath = null;
      focusedNodeIndex = -1;

      // Expand root by default
      expandedPaths.add(currentRootPath);
      await loadDirectory(currentRootPath);
      renderTree();
      updateBreadcrumb();

      // Save last used folder
      try {
        localStorage.setItem(LAST_FOLDER_STORAGE_KEY, currentRootPath);
      } catch (e) {
        console.warn('[File Browser] Failed to save last folder:', e);
      }
    }
  } catch (err) {
    console.error('[File Browser] Failed to open folder:', err);
  }
}

/**
 * Initialize with last used folder (if available)
 * @returns {Promise<boolean>} Whether a folder was loaded
 */
async function initializeLastFolder() {
  try {
    const savedPath = localStorage.getItem(LAST_FOLDER_STORAGE_KEY);
    if (!savedPath) return false;

    // Register the path as an allowed root before any validation
    await window.electronAPI.pathValidatorAddRoot?.(savedPath);

    // Verify the folder still exists
    const meta = await window.electronAPI.fileGetMetadata(savedPath);
    if (!meta.success || !meta.isDirectory) {
      localStorage.removeItem(LAST_FOLDER_STORAGE_KEY);
      return false;
    }

    // Load the folder
    currentRootPath = savedPath;
    expandedPaths.add(currentRootPath);
    await loadDirectory(currentRootPath);
    renderTree();
    updateBreadcrumb();
    console.log('[File Browser] Loaded last folder:', savedPath);
    return true;
  } catch (e) {
    console.warn('[File Browser] Failed to load last folder:', e);
    return false;
  }
}

/**
 * Load directory contents
 */
async function loadDirectory(dirPath, forceRefresh = false) {
  if (loadingPaths.has(dirPath)) return;

  loadingPaths.add(dirPath);

  try {
    const result = await window.electronAPI.fileGetDirectoryContents(dirPath, {
      forceRefresh
    });

    if (result.success) {
      loadedPaths.add(dirPath);
      directoryCache.set(dirPath, result.items);
    } else {
      console.error('[File Browser] Failed to load directory:', result.error);
    }
  } catch (err) {
    console.error('[File Browser] Error loading directory:', err);
  } finally {
    loadingPaths.delete(dirPath);
  }
}

// Simple cache for directory contents
const directoryCache = new Map();

/**
 * Toggle expand/collapse of a directory
 */
async function toggleExpand(dirPath) {
  if (expandedPaths.has(dirPath)) {
    expandedPaths.delete(dirPath);
  } else {
    expandedPaths.add(dirPath);
    if (!loadedPaths.has(dirPath)) {
      await loadDirectory(dirPath);
    }
  }
  renderTree();
}

/**
 * Handle item click with multi-selection support
 * @param {string} itemPath - Clicked item path
 * @param {boolean} isDirectory - Whether it's a directory
 * @param {MouseEvent} event - Original click event (optional)
 */
function handleItemClick(itemPath, isDirectory, event = null) {
  const items = getVisibleItems();

  if (event && event.shiftKey && anchorPath) {
    // Range selection: select all items between anchor and clicked item
    const anchorIdx = items.findIndex(i => i.path === anchorPath);
    const clickIdx = items.findIndex(i => i.path === itemPath);

    if (anchorIdx >= 0 && clickIdx >= 0) {
      const [start, end] = anchorIdx < clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx];

      if (!event.ctrlKey && !event.metaKey) {
        selectedPaths.clear();  // Clear unless Ctrl also held
      }

      for (let i = start; i <= end; i++) {
        selectedPaths.add(items[i].path);
      }
    }
    // Don't update anchor on shift-click
  } else if (event && (event.ctrlKey || event.metaKey)) {
    // Toggle selection: add/remove clicked item
    if (selectedPaths.has(itemPath)) {
      selectedPaths.delete(itemPath);
    } else {
      selectedPaths.add(itemPath);
    }
    anchorPath = itemPath;
  } else {
    // Normal click: clear selection, select single item
    selectedPaths.clear();
    selectedPaths.add(itemPath);
    anchorPath = itemPath;

    // Double-click detection for opening files
    // Single click on directory expands/collapses, single click on file just selects
    // We use a timeout to detect double-click
    if (!event || !event.detail || event.detail === 1) {
      // Single click
      if (isDirectory) {
        toggleExpand(itemPath);
      }
    }
    if (event && event.detail === 2 && !isDirectory) {
      // Double-click on file - open it
      openFile(itemPath);
    }
  }

  lastClickedPath = itemPath;
  renderTree();
}

/**
 * Open a file (only if it's a text-based file)
 */
async function openFile(filePath) {
  try {
    const filename = filePath.split(/[\\/]/).pop();
    const ext = filename.split('.').pop().toLowerCase();

    // Handle PDF files separately
    if (ext === 'pdf') {
      if (onFileSelectCallback) {
        onFileSelectCallback({
          path: filePath,
          name: filename,
          isPdf: true
        });
      }
      return;
    }

    // Check if this is a text file that can be opened in the editor
    const isText = await window.electronAPI.fileIsTextFile(filePath);
    if (!isText) {
      alert(`Cannot open "${filename}" in the editor.\n\nThis file type is not recognized as a text file. Only text-based files (code, markdown, config files, etc.) can be opened.`);
      return;
    }

    const result = await window.electronAPI.fileReadFile(filePath);
    if (result.success && onFileSelectCallback) {
      onFileSelectCallback({
        path: result.path,
        content: result.content,
        name: result.path.split(/[\\/]/).pop()
      });
    }
  } catch (err) {
    console.error('[File Browser] Failed to open file:', err);
  }
}

/**
 * Update breadcrumb navigation
 */
function updateBreadcrumb() {
  const breadcrumb = document.getElementById('file-browser-breadcrumb');
  if (!breadcrumb) return;

  if (!currentRootPath) {
    breadcrumb.classList.add('hidden');
    return;
  }

  breadcrumb.classList.remove('hidden');

  // Get path segments
  const rootName = currentRootPath.split(/[\\/]/).pop();

  breadcrumb.innerHTML = `
    <span class="breadcrumb-segment breadcrumb-root" data-path="${escapeHtml(currentRootPath)}" title="${escapeHtml(currentRootPath)}">
      📁 ${escapeHtml(rootName)}
    </span>
  `;

  // Add click handler
  breadcrumb.querySelector('.breadcrumb-root').addEventListener('click', () => {
    // Collapse to root
    expandedPaths.clear();
    expandedPaths.add(currentRootPath);
    selectedPath = null;
    renderTree();
  });
}

/**
 * Render the file tree
 */
function renderTree() {
  const treeContainer = document.getElementById('file-browser-tree');
  if (!treeContainer) return;

  if (!currentRootPath) {
    treeContainer.innerHTML = `
      <div class="empty-state">
        <p>No folder open</p>
        <p class="empty-state-hint">Click "Open Folder" to browse local files</p>
      </div>
    `;
    return;
  }

  const html = renderDirectory(currentRootPath, 0);
  treeContainer.innerHTML = html;

  // Attach click handlers with event for modifier key detection
  treeContainer.querySelectorAll('.tree-item').forEach(item => {
    item.addEventListener('click', (event) => {
      handleItemClick(item.dataset.path, item.dataset.isDirectory === 'true', event);
    });
  });
}

/**
 * Render a directory and its contents recursively
 */
function renderDirectory(dirPath, depth) {
  const items = directoryCache.get(dirPath) || [];
  const isLoading = loadingPaths.has(dirPath);

  if (dirPath === currentRootPath) {
    if (items.length === 0 && !isLoading) {
      return '<div class="empty-state">Folder is empty</div>';
    }

    return items.map(item => renderItem(item, depth)).join('');
  }

  return '';
}

/**
 * Render a single file/folder item
 */
function renderItem(item, depth) {
  const isExpanded = expandedPaths.has(item.path);
  const isSelected = selectedPaths.has(item.path);
  const icon = getFileIcon(item.name, item.isDirectory, isExpanded);
  const iconColor = getFileIconColor(item.name, item.isDirectory);

  const indent = depth * 16;
  const chevron = item.isDirectory ?
    `<span class="tree-chevron ${isExpanded ? 'expanded' : ''}">\u25B6</span>` :
    '<span class="tree-chevron-placeholder"></span>';

  let childrenHtml = '';
  if (item.isDirectory && isExpanded) {
    const children = directoryCache.get(item.path) || [];
    if (loadingPaths.has(item.path)) {
      childrenHtml = `<div class="tree-loading" style="padding-left: ${indent + 32}px;">Loading...</div>`;
    } else if (children.length > 0) {
      childrenHtml = children.map(child => renderItem(child, depth + 1)).join('');
    }
  }

  return `
    <div
      class="tree-item ${isSelected ? 'selected' : ''}"
      data-path="${escapeHtml(item.path)}"
      data-is-directory="${item.isDirectory}"
      style="padding-left: ${indent}px;"
      role="treeitem"
      aria-expanded="${item.isDirectory ? isExpanded : undefined}"
    >
      ${chevron}
      <span class="tree-icon" style="color: ${iconColor};">${icon}</span>
      <span class="tree-name">${escapeHtml(item.name)}</span>
    </div>
    ${childrenHtml}
  `;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show the file browser
 */
function showBrowser() {
  const browser = document.getElementById('file-browser');
  if (!browser) return;

  if (!browser.querySelector('.sidebar-header')) {
    buildBrowserHTML();
  }

  browser.classList.remove('hidden');
  browserVisible = true;
}

/**
 * Hide the file browser
 */
function hideBrowser() {
  const browser = document.getElementById('file-browser');
  if (browser) {
    browser.classList.add('hidden');
  }
  browserVisible = false;
}

/**
 * Toggle file browser visibility
 */
function toggleBrowser() {
  if (browserVisible) {
    hideBrowser();
  } else {
    showBrowser();
  }
}

/**
 * Check if browser is visible
 */
function isBrowserVisible() {
  return browserVisible;
}

/**
 * Set callback for file selection
 */
function setOnFileSelect(callback) {
  onFileSelectCallback = callback;
}

/**
 * Refresh the current directory tree
 */
async function refresh(forceRefresh = true) {
  if (!currentRootPath) return;

  // Clear cache
  directoryCache.clear();
  loadedPaths.clear();

  // Reload expanded directories
  for (const dirPath of expandedPaths) {
    await loadDirectory(dirPath, forceRefresh);
  }

  renderTree();
}

/**
 * Get the current root path
 */
function getCurrentRootPath() {
  return currentRootPath;
}

/**
 * Handle external file system changes
 */
function handleExternalChanges(changeData) {
  console.log('[File Browser] External changes detected:', changeData);

  // Invalidate affected directories
  for (const dir of changeData.affectedDirectories) {
    loadedPaths.delete(dir);
    directoryCache.delete(dir);
  }

  // Refresh if any affected directory is currently visible
  if (currentRootPath && expandedPaths.size > 0) {
    refresh(true);
  }
}

export {
  buildBrowserHTML,
  showBrowser,
  hideBrowser,
  toggleBrowser,
  isBrowserVisible,
  setOnFileSelect,
  refresh,
  getCurrentRootPath,
  openFolder,
  handleExternalChanges
};
