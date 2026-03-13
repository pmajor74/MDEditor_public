/**
 * Wiki Sidebar Component
 *
 * Collapsible left sidebar showing wiki page tree and favorites.
 * Supports expand/collapse of folders, page navigation, and resize.
 */

import { showConfirmationDialog, showPromptDialog } from './confirmation-dialog.js';
import { announce } from '../utils/announcer.js';
import { showHistoryPanel, initHistoryPanel } from './history-panel.js';

let sidebarVisible = false;
let wikiTree = null;
let favorites = [];
let currentPagePath = null;
let currentTreePath = null;  // Track what path the tree is showing
let contextMenuPath = null;  // Track which item was right-clicked
let onPageSelectCallback = null;
let focusedNodeIndex = -1;  // Track focused node for keyboard navigation
let searchFilter = '';  // Current search filter text
let searchDebounceTimer = null;  // Debounce timer for search
let onRestoreContentCallback = null;  // Callback when restoring from history
let getCurrentContentCallback = null;  // Callback to get current editor content
const SEARCH_DEBOUNCE_MS = 300;

// Wiki-wide search state (Azure DevOps Search API)
let wikiSearchResults = null;  // Results from Azure DevOps Search API
let isWikiSearching = false;  // Whether a wiki search is in progress
let wikiSearchDebounceTimer = null;  // Debounce timer for wiki search
const WIKI_SEARCH_DEBOUNCE_MS = 500;  // Longer debounce for API calls

// Lazy loading state
const loadedPaths = new Set();  // Paths whose children have been loaded
const loadingPaths = new Set();  // Paths currently being loaded
const expandedPaths = new Set();  // Paths that are expanded in the UI

// Resize state
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 500;
const SIDEBAR_WIDTH_STORAGE_KEY = 'wiki-sidebar-width';
let isResizing = false;

/**
 * Build the sidebar HTML structure
 */
function buildSidebarHTML() {
  const sidebar = document.getElementById('wiki-sidebar');
  if (!sidebar) return;

  sidebar.innerHTML = `
    <div class="sidebar-resize-handle" title="Drag to resize"></div>
    <div class="sidebar-header">
      <span class="sidebar-title">Wiki Browser</span>
      <button class="sidebar-close" title="Close sidebar">&times;</button>
    </div>

    <div class="sidebar-section">
      <div class="section-header">
        <span class="section-icon">★</span>
        <span class="section-title">Favorites</span>
      </div>
      <div id="favorites-list" class="favorites-list">
        <div class="empty-state">No favorites yet</div>
      </div>
    </div>

    <div class="sidebar-divider"></div>

    <div class="sidebar-section sidebar-section-tree">
      <div class="section-header">
        <span class="section-icon">📁</span>
        <span class="section-title">Pages</span>
        <button class="btn-refresh" title="Refresh (force)">↻</button>
      </div>
      <div class="tree-search-container">
        <input type="text" id="tree-search-input" class="tree-search-input" placeholder="Search pages..." aria-label="Search wiki pages" />
        <button id="tree-search-clear" class="tree-search-clear hidden" title="Clear search">&times;</button>
      </div>
      <div id="wiki-search-actions" class="wiki-search-actions hidden">
        <button id="btn-search-wiki" class="btn-search-wiki" title="Search the entire wiki using Azure DevOps Search">
          <span class="search-wiki-icon">🔍</span> Search entire wiki
        </button>
        <span id="wiki-search-status" class="wiki-search-status"></span>
      </div>
      <div id="wiki-search-results" class="wiki-search-results hidden"></div>
      <div id="tree-breadcrumb" class="tree-breadcrumb hidden">
        <span class="breadcrumb-label">Location:</span>
        <span class="breadcrumb-path" title=""></span>
      </div>
      <div id="wiki-tree" class="wiki-tree" tabindex="0" role="tree" aria-label="Wiki pages">
        <div class="empty-state">Not connected</div>
      </div>
    </div>
  `;

  // Attach event listeners
  sidebar.querySelector('.sidebar-close').addEventListener('click', hideSidebar);
  sidebar.querySelector('.btn-refresh').addEventListener('click', () => refreshTree(true));

  // Setup search functionality
  setupSearchHandlers();

  // Setup resize functionality
  setupResizeHandlers(sidebar);

  // Setup keyboard navigation
  setupKeyboardNavigation();

  // Context menu listeners
  setupContextMenuListeners();

  // Restore saved width
  restoreSidebarWidth(sidebar);
}

/**
 * Setup resize handle drag functionality
 */
function setupResizeHandlers(sidebar) {
  const resizeHandle = sidebar.querySelector('.sidebar-resize-handle');
  if (!resizeHandle) return;

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isResizing = true;
    resizeHandle.classList.add('resizing');
    document.body.classList.add('sidebar-resizing');

    const startX = e.clientX;
    const startWidth = sidebar.offsetWidth;

    let resizeRafPending = false;
    const onMouseMove = (moveEvent) => {
      if (!isResizing) return;
      if (resizeRafPending) return;
      resizeRafPending = true;
      requestAnimationFrame(() => {
        const deltaX = moveEvent.clientX - startX;
        let newWidth = startWidth + deltaX;

        // Constrain width
        newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, newWidth));

        sidebar.style.width = `${newWidth}px`;
        resizeRafPending = false;
      });
    };

    const onMouseUp = () => {
      isResizing = false;
      resizeHandle.classList.remove('resizing');
      document.body.classList.remove('sidebar-resizing');

      // Save width to localStorage
      const finalWidth = sidebar.offsetWidth;
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, finalWidth.toString());
      console.log('[Sidebar] Width saved:', finalWidth);

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

/**
 * Restore sidebar width from localStorage
 */
function restoreSidebarWidth(sidebar) {
  const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (savedWidth) {
    const width = parseInt(savedWidth, 10);
    if (!isNaN(width) && width >= SIDEBAR_MIN_WIDTH && width <= SIDEBAR_MAX_WIDTH) {
      sidebar.style.width = `${width}px`;
      console.log('[Sidebar] Width restored:', width);
    }
  }
}

/**
 * Setup search input event handlers
 */
function setupSearchHandlers() {
  const searchInput = document.getElementById('tree-search-input');
  const clearButton = document.getElementById('tree-search-clear');
  const searchActions = document.getElementById('wiki-search-actions');
  const searchWikiBtn = document.getElementById('btn-search-wiki');

  if (!searchInput || !clearButton) return;

  // Handle search input with debounce
  searchInput.addEventListener('input', (e) => {
    const value = e.target.value.trim();

    // Show/hide clear button
    clearButton.classList.toggle('hidden', value === '');

    // Show/hide "Search entire wiki" button (only if 2+ chars)
    if (searchActions) {
      searchActions.classList.toggle('hidden', value.length < 2);
    }

    // Clear wiki search results when input changes
    clearWikiSearchResults();

    // Debounce the local filter
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }

    searchDebounceTimer = setTimeout(() => {
      searchFilter = value.toLowerCase();
      renderTree();
    }, SEARCH_DEBOUNCE_MS);
  });

  // Handle "Search entire wiki" button click
  if (searchWikiBtn) {
    searchWikiBtn.addEventListener('click', () => {
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        performWikiSearch(query);
      }
    });
  }

  // Handle Enter key to trigger wiki search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        e.preventDefault();
        performWikiSearch(query);
      }
    }
  });

  // Clear search on button click
  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    searchFilter = '';
    clearButton.classList.add('hidden');
    if (searchActions) searchActions.classList.add('hidden');
    clearWikiSearchResults();
    renderTree();
    searchInput.focus();
  });

  // Clear search on Escape key
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (searchFilter || wikiSearchResults) {
        e.preventDefault();
        searchInput.value = '';
        searchFilter = '';
        clearButton.classList.add('hidden');
        if (searchActions) searchActions.classList.add('hidden');
        clearWikiSearchResults();
        renderTree();
      }
    }
  });
}

/**
 * Perform wiki-wide search using Azure DevOps Search API
 * @param {string} query - Search query
 */
async function performWikiSearch(query) {
  if (isWikiSearching) return;
  if (!query || query.length < 2) return;

  const statusEl = document.getElementById('wiki-search-status');
  const resultsContainer = document.getElementById('wiki-search-results');
  const treeContainer = document.getElementById('wiki-tree');

  isWikiSearching = true;
  wikiSearchResults = null;

  // Show loading state
  if (statusEl) {
    statusEl.textContent = 'Searching...';
    statusEl.classList.add('searching');
  }

  try {
    console.log('[Sidebar] Performing wiki search:', query);
    const result = await window.electronAPI.azureSearchWiki({
      searchText: query,
      top: 25,
      skip: 0
    });

    if (result.success) {
      wikiSearchResults = result;
      console.log('[Sidebar] Wiki search returned', result.count, 'results');

      // Update status
      if (statusEl) {
        statusEl.textContent = result.count > 0
          ? `Found ${result.count} result${result.count !== 1 ? 's' : ''}`
          : 'No results found';
        statusEl.classList.remove('searching');
      }

      // Render results
      renderWikiSearchResults();

      // Hide tree, show results
      if (treeContainer) treeContainer.classList.add('hidden');
      if (resultsContainer) resultsContainer.classList.remove('hidden');
    } else {
      if (statusEl) {
        statusEl.textContent = `Search failed: ${result.error}`;
        statusEl.classList.remove('searching');
      }
    }
  } catch (error) {
    console.error('[Sidebar] Wiki search error:', error);
    if (statusEl) {
      statusEl.textContent = `Search error: ${error.message}`;
      statusEl.classList.remove('searching');
    }
  } finally {
    isWikiSearching = false;
  }
}

/**
 * Clear wiki search results and show tree again
 */
function clearWikiSearchResults() {
  wikiSearchResults = null;

  const statusEl = document.getElementById('wiki-search-status');
  const resultsContainer = document.getElementById('wiki-search-results');
  const treeContainer = document.getElementById('wiki-tree');

  if (statusEl) {
    statusEl.textContent = '';
    statusEl.classList.remove('searching');
  }
  if (resultsContainer) {
    resultsContainer.innerHTML = '';
    resultsContainer.classList.add('hidden');
  }
  if (treeContainer) {
    treeContainer.classList.remove('hidden');
  }
}

/**
 * Render wiki search results
 */
function renderWikiSearchResults() {
  const container = document.getElementById('wiki-search-results');
  if (!container || !wikiSearchResults) return;

  if (!wikiSearchResults.results || wikiSearchResults.results.length === 0) {
    container.innerHTML = '<div class="wiki-search-empty">No pages found matching your search.</div>';
    return;
  }

  const html = wikiSearchResults.results.map(result => {
    const pageName = result.fileName.replace(/\.md$/, '');
    const pagePath = result.path;

    // Extract content snippet from highlights if available
    let snippet = '';
    const contentHit = result.highlights?.find(h => h.field === 'content');
    if (contentHit && contentHit.snippets.length > 0) {
      // Clean up highlight tags and truncate
      snippet = contentHit.snippets[0]
        .replace(/<highlighthit>/g, '<mark>')
        .replace(/<\/highlighthit>/g, '</mark>');
    }

    return `
      <div class="wiki-search-result" data-path="${escapeAttr(pagePath)}">
        <div class="wiki-search-result-name">📄 ${escapeHtml(pageName)}</div>
        <div class="wiki-search-result-path" title="${escapeAttr(pagePath)}">${escapeHtml(pagePath)}</div>
        ${snippet ? `<div class="wiki-search-result-snippet">${snippet}</div>` : ''}
      </div>
    `;
  }).join('');

  container.innerHTML = html;

  // Attach click handlers
  container.querySelectorAll('.wiki-search-result').forEach(resultEl => {
    resultEl.addEventListener('click', () => {
      const path = resultEl.dataset.path;
      handleSearchResultClick(path);
    });
  });
}

/**
 * Handle click on a wiki search result
 * @param {string} path - Page path from search result (already decoded by azureClient)
 */
async function handleSearchResultClick(path) {
  console.log('[Sidebar] Search result clicked:', path);

  // Clear search UI
  const searchInput = document.getElementById('tree-search-input');
  const clearButton = document.getElementById('tree-search-clear');
  const searchActions = document.getElementById('wiki-search-actions');

  if (searchInput) searchInput.value = '';
  if (clearButton) clearButton.classList.add('hidden');
  if (searchActions) searchActions.classList.add('hidden');
  searchFilter = '';
  clearWikiSearchResults();

  // Navigate to the parent folder of the selected page
  const parentPath = getParentPath(path);
  if (parentPath !== null) {
    await navigateToPath(parentPath);
  }

  // Select and load the page
  selectPage(path);

  // Scroll selected into view
  scrollSelectedIntoView();
}

/**
 * Check if a node or any of its descendants match the search filter
 * @param {Object} node - Tree node
 * @param {string} filter - Lowercase filter text
 * @returns {boolean} True if node or descendants match
 */
function nodeMatchesFilter(node, filter) {
  if (!filter) return true;

  const name = getPageName(node.path).toLowerCase();
  if (name.includes(filter)) return true;

  // Check children recursively
  if (node.subPages) {
    for (const child of node.subPages) {
      if (nodeMatchesFilter(child, filter)) return true;
    }
  }

  return false;
}

/**
 * Highlight matching text in a string
 * @param {string} text - Original text
 * @param {string} filter - Filter text to highlight
 * @returns {string} HTML with highlighted matches
 */
function highlightMatch(text, filter) {
  if (!filter) return escapeHtml(text);

  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(filter.toLowerCase());

  if (index < 0) return escapeHtml(text);

  const before = text.substring(0, index);
  const match = text.substring(index, index + filter.length);
  const after = text.substring(index + filter.length);

  return `${escapeHtml(before)}<mark class="search-highlight">${escapeHtml(match)}</mark>${escapeHtml(after)}`;
}

/**
 * Setup keyboard navigation for the wiki tree
 */
function setupKeyboardNavigation() {
  const treeContainer = document.getElementById('wiki-tree');
  if (!treeContainer) return;

  treeContainer.addEventListener('keydown', handleTreeKeydown);
  treeContainer.addEventListener('focus', () => {
    // Select first node if none focused
    if (focusedNodeIndex < 0) {
      const nodes = getVisibleNodes();
      if (nodes.length > 0) {
        focusNode(0);
      }
    }
  });
}

/**
 * Render the favorites list
 */
function renderFavorites() {
  const container = document.getElementById('favorites-list');
  if (!container) return;

  if (favorites.length === 0) {
    container.innerHTML = '<div class="empty-state">No favorites yet</div>';
    return;
  }

  container.innerHTML = favorites.map(fav => `
    <div class="favorite-item" data-path="${escapeAttr(fav.path)}">
      <span class="favorite-icon">📄</span>
      <span class="favorite-name" title="${escapeAttr(fav.path)}">${escapeHtml(fav.name || getPageName(fav.path))}</span>
      <button class="btn-remove-favorite" title="Remove from favorites">&times;</button>
    </div>
  `).join('');

  // Attach click handlers
  container.querySelectorAll('.favorite-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('btn-remove-favorite')) {
        const path = item.dataset.path;
        // Navigate to parent folder to show context
        const parentPath = getParentPath(path);
        if (parentPath !== null) {
          await navigateToPath(parentPath);
        }
        // Select the page in the editor
        selectPage(path);
        // Scroll selected item into view
        scrollSelectedIntoView();
      }
    });

    item.querySelector('.btn-remove-favorite').addEventListener('click', async (e) => {
      e.stopPropagation();
      const path = item.dataset.path;
      await removeFavorite(path);
    });
  });
}

/**
 * Render the wiki tree
 */
function renderTree() {
  const container = document.getElementById('wiki-tree');
  if (!container) return;

  if (!wikiTree) {
    container.innerHTML = '<div class="empty-state">Not connected</div>';
    return;
  }

  let html = '';
  let hasVisibleNodes = false;

  // Add ".." entry if not at root (and not filtering)
  const parentPath = getParentPath(currentTreePath);
  if (parentPath !== null && !searchFilter) {
    html += `
      <div class="tree-node tree-node-parent" data-path="${escapeAttr(parentPath)}">
        <div class="tree-node-content">
          <span class="tree-toggle-spacer"></span>
          <span class="tree-icon">📁</span>
          <span class="tree-name">..</span>
        </div>
      </div>
    `;
    hasVisibleNodes = true;
  }

  // Render tree nodes (with filtering)
  if (wikiTree.subPages && wikiTree.subPages.length > 0) {
    const filteredHtml = wikiTree.subPages
      .filter(child => nodeMatchesFilter(child, searchFilter))
      .map(child => renderTreeNode(child, false, searchFilter))
      .join('');

    if (filteredHtml) {
      html += filteredHtml;
      hasVisibleNodes = true;
    }
  } else if (wikiTree.path && wikiTree.path !== '/') {
    if (nodeMatchesFilter(wikiTree, searchFilter)) {
      html += renderTreeNode(wikiTree, false, searchFilter);
      hasVisibleNodes = true;
    }
  }

  // Show appropriate empty state
  if (!hasVisibleNodes) {
    if (searchFilter) {
      html = `<div class="empty-state search-no-results">No pages matching "${escapeHtml(searchFilter)}"</div>`;
    } else if (!parentPath) {
      html = '<div class="empty-state">No pages found</div>';
    }
  }

  container.innerHTML = html || '<div class="empty-state">No pages found</div>';
  attachTreeEventHandlers(container);
}

/**
 * Recursively render a tree node
 * @param {Object} node - Tree node to render
 * @param {boolean} isRoot - Whether this is the root node
 * @param {string} filter - Search filter for highlighting
 */
function renderTreeNode(node, isRoot = false, filter = '') {
  // Check if node has loaded children or is known to have children (from API isParentPage flag)
  const hasLoadedChildren = node.subPages && node.subPages.length > 0;
  // Azure API returns isParentPage=true for folders with children (even when not loaded yet)
  const mayHaveChildren = node.isParentPage || hasLoadedChildren;
  const name = getPageName(node.path);
  const isSelected = node.path === currentPagePath;

  // When filtering, auto-expand if any descendant matches
  const hasMatchingDescendant = filter && hasLoadedChildren &&
    node.subPages.some(child => nodeMatchesFilter(child, filter));

  // Check if path is expanded (user has expanded it before)
  const isUserExpanded = expandedPaths.has(node.path);
  const isExpanded = isRoot || (filter && hasMatchingDescendant) || isUserExpanded;

  if (isRoot) {
    // Render children directly for root (filtered)
    const children = node.subPages || [];
    return children
      .filter(child => nodeMatchesFilter(child, filter))
      .map(child => renderTreeNode(child, false, filter))
      .join('');
  }

  // Highlight name if it matches the filter
  const displayName = filter ? highlightMatch(name, filter) : escapeHtml(name);

  // Calculate aria-level based on path depth
  const pathParts = node.path.split('/').filter(p => p);
  const ariaLevel = pathParts.length || 1;

  // Build ARIA attributes
  const ariaAttrs = [
    'role="treeitem"',
    `aria-level="${ariaLevel}"`,
    `aria-selected="${isSelected}"`,
    mayHaveChildren ? `aria-expanded="${isExpanded}"` : ''
  ].filter(Boolean).join(' ');

  let html = `
    <div class="tree-node${isSelected ? ' selected' : ''}${mayHaveChildren ? ' has-children' : ''}"
         data-path="${escapeAttr(node.path)}"
         ${ariaAttrs}
         tabindex="${isSelected ? '0' : '-1'}">
      <div class="tree-node-content">
        ${mayHaveChildren ? `<span class="tree-toggle${isExpanded ? ' expanded' : ''}" aria-hidden="true">▶</span>` : '<span class="tree-toggle-spacer" aria-hidden="true"></span>'}
        <span class="tree-icon" aria-hidden="true">${mayHaveChildren ? '📁' : '📄'}</span>
        <span class="tree-name">${displayName}</span>
      </div>
  `;

  if (mayHaveChildren) {
    // Create children container (may be empty for lazy loading)
    html += `<div class="tree-children${isExpanded ? '' : ' collapsed'}" role="group">`;

    if (hasLoadedChildren) {
      // Filter children when searching
      const filteredChildren = filter
        ? node.subPages.filter(child => nodeMatchesFilter(child, filter))
        : node.subPages;

      html += filteredChildren.map(child => renderTreeNode(child, false, filter)).join('');
    }
    // If no loaded children but mayHaveChildren, container stays empty for lazy loading

    html += '</div>';
  }

  html += '</div>';
  return html;
}

/**
 * Attach event handlers to tree nodes
 */
function attachTreeEventHandlers(container) {
  // Handle ".." navigation (parent directory)
  const parentNode = container.querySelector('.tree-node-parent');
  if (parentNode) {
    parentNode.querySelector('.tree-node-content').addEventListener('click', () => {
      const path = parentNode.dataset.path;
      navigateToPath(path);
    });
  }

  // Toggle expand/collapse with lazy loading
  container.querySelectorAll('.tree-toggle').forEach(toggle => {
    toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      const node = toggle.closest('.tree-node');
      const nodePath = node.dataset.path;
      const children = node.querySelector('.tree-children');
      const isExpanding = !toggle.classList.contains('expanded');

      if (isExpanding && children) {
        // Expanding - check if we need to load children
        const needsLoad = !loadedPaths.has(nodePath) && !loadingPaths.has(nodePath);

        if (needsLoad) {
          // Show loading state
          await loadNodeChildren(nodePath, node, children);
        }

        // Expand the node
        toggle.classList.add('expanded');
        children.classList.remove('collapsed');
        expandedPaths.add(nodePath);
        node.setAttribute('aria-expanded', 'true');
      } else if (children) {
        // Collapsing
        toggle.classList.remove('expanded');
        children.classList.add('collapsed');
        expandedPaths.delete(nodePath);
        node.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // Select page (exclude parent node)
  container.querySelectorAll('.tree-node:not(.tree-node-parent) .tree-node-content').forEach(content => {
    content.addEventListener('click', () => {
      const node = content.closest('.tree-node');
      const path = node.dataset.path;
      selectPage(path);
    });
  });

  // Right-click context menu for all tree nodes
  container.querySelectorAll('.tree-node').forEach(node => {
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const path = node.dataset.path;
      showContextMenu(e.clientX, e.clientY, path);
    });
  });
}

/**
 * Load children for a tree node (lazy loading)
 * @param {string} nodePath - Path of the node to load children for
 * @param {HTMLElement} nodeElement - The DOM node element
 * @param {HTMLElement} childrenContainer - The children container element
 */
async function loadNodeChildren(nodePath, nodeElement, childrenContainer) {
  if (loadedPaths.has(nodePath) || loadingPaths.has(nodePath)) {
    return;
  }

  // Check if children already exist in cached tree data (from disk persistence)
  const existingChildren = findNodeChildren(wikiTree, nodePath);
  if (existingChildren && existingChildren.length > 0) {
    console.log('[Sidebar] Using cached children for:', nodePath, '(' + existingChildren.length + ' items)');
    loadedPaths.add(nodePath);

    // Render existing children without API call
    const childrenHtml = existingChildren.map(child =>
      renderTreeNode(child, false, searchFilter)
    ).join('');
    childrenContainer.innerHTML = childrenHtml;
    childrenContainer.classList.remove('collapsed');

    // Attach event handlers to nodes
    attachTreeEventHandlers(childrenContainer);
    return;
  }

  loadingPaths.add(nodePath);
  console.log('[Sidebar] Loading children for:', nodePath);

  // Show loading spinner in the children container
  childrenContainer.innerHTML = '<div class="tree-node-loading"><span class="loading-spinner-small"></span> Loading...</div>';
  childrenContainer.classList.remove('collapsed');

  try {
    const result = await window.electronAPI.azureGetWikiTree({
      path: nodePath,
      recursionLevel: 'oneLevel'
    });

    loadingPaths.delete(nodePath);

    if (result.success && result.pages) {
      loadedPaths.add(nodePath);

      // Get the sub pages from the result
      const subPages = result.pages.subPages || [];
      console.log('[Sidebar] Loaded', subPages.length, 'children for:', nodePath);

      if (subPages.length > 0) {
        // Update the wikiTree data structure with loaded children
        updateTreeDataWithChildren(nodePath, subPages);

        // Render children
        const childrenHtml = subPages.map(child => renderTreeNode(child, false, searchFilter)).join('');
        childrenContainer.innerHTML = childrenHtml;

        // Attach event handlers to new nodes
        attachTreeEventHandlers(childrenContainer);
      } else {
        // No children - show empty state or remove the container
        childrenContainer.innerHTML = '';
        // Remove the toggle since there are no children
        const toggle = nodeElement.querySelector('.tree-toggle');
        if (toggle) {
          const spacer = document.createElement('span');
          spacer.className = 'tree-toggle-spacer';
          toggle.replaceWith(spacer);
        }
        // Update the icon to a file icon
        const icon = nodeElement.querySelector('.tree-icon');
        if (icon) {
          icon.textContent = '📄';
        }
      }
    } else {
      // Error loading
      childrenContainer.innerHTML = `<div class="tree-node-error">Failed to load</div>`;
    }
  } catch (error) {
    loadingPaths.delete(nodePath);
    console.error('[Sidebar] Error loading children:', error);
    childrenContainer.innerHTML = `<div class="tree-node-error">${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Update the wikiTree data structure with loaded children
 * @param {string} parentPath - Path of the parent node
 * @param {Array} children - Array of child nodes
 */
function updateTreeDataWithChildren(parentPath, children) {
  if (!wikiTree) return;

  // Find the parent node in the tree and add children
  const findAndUpdate = (node) => {
    if (node.path === parentPath) {
      node.subPages = children;
      return true;
    }
    if (node.subPages) {
      for (const child of node.subPages) {
        if (findAndUpdate(child)) return true;
      }
    }
    return false;
  };

  findAndUpdate(wikiTree);
}

/**
 * Find children of a node in the tree structure
 * @param {Object} tree - Tree root
 * @param {string} targetPath - Path to find children for
 * @returns {Array|null} Children array or null if not found
 */
function findNodeChildren(tree, targetPath) {
  if (!tree) return null;
  if (tree.path === targetPath) return tree.subPages || null;
  if (tree.subPages) {
    for (const child of tree.subPages) {
      const found = findNodeChildren(child, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Select a page and load its content
 */
async function selectPage(path) {
  // Update UI - remove selection from previous node
  document.querySelectorAll('.tree-node.selected').forEach(el => {
    el.classList.remove('selected');
    el.setAttribute('aria-selected', 'false');
    el.setAttribute('tabindex', '-1');
  });

  // Select new node
  const node = document.querySelector(`.tree-node[data-path="${CSS.escape(path)}"]`);
  if (node) {
    node.classList.add('selected');
    node.setAttribute('aria-selected', 'true');
    node.setAttribute('tabindex', '0');
  }

  currentPagePath = path;

  if (onPageSelectCallback) {
    onPageSelectCallback(path);
  }
}

/**
 * Get page name from path
 */
function getPageName(path) {
  if (!path || path === '/') return 'Home';
  const parts = path.split('/');
  return decodeURIComponent(parts[parts.length - 1] || parts[parts.length - 2] || 'Home');
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
 * Escape attribute value
 */
function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Get parent path from current path
 * Returns null if at root, otherwise returns the parent path
 */
function getParentPath(path) {
  if (!path || path === '/') return null;
  const parts = path.split('/').filter(p => p);
  if (parts.length <= 1) return '/';
  parts.pop();
  return '/' + parts.join('/');
}

/**
 * Scroll the selected tree node into view
 */
function scrollSelectedIntoView() {
  setTimeout(() => {
    const selected = document.querySelector('.tree-node.selected');
    if (selected) {
      selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 100); // Small delay to ensure DOM is updated after navigation
}

/**
 * Update the breadcrumb display
 */
function updateBreadcrumb() {
  const breadcrumb = document.getElementById('tree-breadcrumb');
  const pathContainer = breadcrumb?.querySelector('.breadcrumb-path');
  if (!breadcrumb || !pathContainer) return;

  if (currentTreePath && currentTreePath !== '/') {
    breadcrumb.classList.remove('hidden');

    // Build clickable breadcrumb segments
    const pathParts = currentTreePath.split('/').filter(p => p);
    const segments = [];

    // Add root segment
    segments.push(`<span class="breadcrumb-segment breadcrumb-root" data-path="/" title="Go to root">Home</span>`);

    // Add each path segment
    let currentPath = '';
    for (let i = 0; i < pathParts.length; i++) {
      currentPath += '/' + pathParts[i];
      const name = decodeURIComponent(pathParts[i]);
      const isLast = i === pathParts.length - 1;

      segments.push(`<span class="breadcrumb-separator">/</span>`);

      if (isLast) {
        // Current location - not clickable
        segments.push(`<span class="breadcrumb-segment breadcrumb-current" title="${escapeAttr(currentPath)}">${escapeHtml(name)}</span>`);
      } else {
        // Clickable parent segment
        segments.push(`<span class="breadcrumb-segment breadcrumb-clickable" data-path="${escapeAttr(currentPath)}" title="Go to ${escapeAttr(name)}">${escapeHtml(name)}</span>`);
      }
    }

    pathContainer.innerHTML = segments.join('');

    // Attach click handlers to clickable segments
    pathContainer.querySelectorAll('.breadcrumb-clickable, .breadcrumb-root').forEach(segment => {
      segment.addEventListener('click', (e) => {
        e.stopPropagation();
        const path = segment.dataset.path;
        if (path) {
          navigateToPath(path);
        }
      });
    });
  } else {
    breadcrumb.classList.add('hidden');
  }
}

/**
 * Show context menu at position
 */
function showContextMenu(x, y, path) {
  const menu = document.getElementById('tree-context-menu');
  if (!menu) return;

  contextMenuPath = path;

  // Check if already a favorite
  const isFavorite = favorites.some(f => f.path === path);

  // Show/hide appropriate buttons
  const addBtn = menu.querySelector('[data-action="add-favorite"]');
  const removeBtn = menu.querySelector('[data-action="remove-favorite"]');

  if (addBtn) addBtn.style.display = isFavorite ? 'none' : 'flex';
  if (removeBtn) removeBtn.style.display = isFavorite ? 'flex' : 'none';

  // Position menu
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');

  // Adjust if menu goes off screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${window.innerHeight - rect.height - 10}px`;
  }
}

/**
 * Hide context menu
 */
function hideContextMenu() {
  const menu = document.getElementById('tree-context-menu');
  if (menu) {
    menu.classList.add('hidden');
  }
  contextMenuPath = null;
}

/**
 * Handle context menu action
 */
async function handleContextMenuAction(action) {
  if (!contextMenuPath) return;

  switch (action) {
    case 'new-page':
      await handleNewPage(contextMenuPath);
      break;
    case 'rename-page':
      await handleRenamePage(contextMenuPath);
      break;
    case 'delete-page':
      await handleDeletePage(contextMenuPath);
      break;
    case 'view-history':
      showHistoryPanel(contextMenuPath);
      break;
    case 'open-in-new-tab':
      window.electronAPI.wikiOpenInNewTab(contextMenuPath);
      break;
    case 'open-in-browser':
      await openPageInBrowser(contextMenuPath);
      break;
    case 'add-favorite':
      await addPathToFavorites(contextMenuPath);
      break;
    case 'remove-favorite':
      await removeFavorite(contextMenuPath);
      break;
    case 'copy-path':
      navigator.clipboard.writeText(contextMenuPath);
      announce('Path copied to clipboard');
      break;
  }

  hideContextMenu();
}

/**
 * Open a wiki page in the default browser
 */
async function openPageInBrowser(path) {
  const conn = await window.electronAPI.azureGetConnectionStatus();
  if (!conn.connected) {
    announce('Not connected to Azure DevOps');
    return;
  }

  // Build the Azure DevOps wiki URL
  // Format: https://dev.azure.com/{org}/{project}/_wiki/wikis/{wikiId}?pagePath={path}
  const encodedPath = encodeURIComponent(path);
  const url = `https://dev.azure.com/${conn.org}/${conn.project}/_wiki/wikis/${conn.wikiId}?pagePath=${encodedPath}`;

  window.electronAPI.openExternal(url);
}

/**
 * Handle creating a new page
 */
async function handleNewPage(parentPath) {
  const pageName = await showPromptDialog({
    title: 'Create New Page',
    message: 'Enter the name for the new page:',
    placeholder: 'New Page',
    confirmText: 'Create'
  });

  if (!pageName) return;

  // Sanitize the page name (replace invalid characters)
  const sanitizedName = pageName.replace(/[\\/:*?"<>|#%]/g, '-').trim();
  if (!sanitizedName) {
    announce('Invalid page name');
    return;
  }

  // Build the new page path
  const newPath = parentPath === '/' ? `/${sanitizedName}` : `${parentPath}/${sanitizedName}`;

  try {
    const result = await window.electronAPI.azureCreatePage({
      pagePath: newPath,
      content: `# ${sanitizedName}\n\nNew page content here.`
    });

    if (result.success) {
      announce(`Page "${sanitizedName}" created`);
      // Clear lazy loading cache for parent and refresh
      loadedPaths.delete(parentPath);
      await refreshTree(true);
      // Select the new page
      selectPage(newPath);
    } else {
      announce(`Failed to create page: ${result.error}`);
    }
  } catch (error) {
    console.error('[Sidebar] Create page error:', error);
    announce(`Error creating page: ${error.message}`);
  }
}

/**
 * Handle renaming a page
 */
async function handleRenamePage(pagePath) {
  const currentName = getPageName(pagePath);
  const parentPath = getParentPath(pagePath) || '/';

  const newName = await showPromptDialog({
    title: 'Rename Page',
    message: 'Enter the new name for this page:',
    placeholder: 'New name',
    defaultValue: currentName,
    confirmText: 'Rename'
  });

  if (!newName || newName === currentName) return;

  // Sanitize the page name
  const sanitizedName = newName.replace(/[\\/:*?"<>|#%]/g, '-').trim();
  if (!sanitizedName) {
    announce('Invalid page name');
    return;
  }

  // Build the new path
  const newPath = parentPath === '/' ? `/${sanitizedName}` : `${parentPath}/${sanitizedName}`;

  try {
    const result = await window.electronAPI.azureRenamePage({
      oldPath: pagePath,
      newPath: newPath
    });

    if (result.success) {
      announce(`Page renamed to "${sanitizedName}"`);
      // Clear lazy loading cache and refresh
      loadedPaths.delete(parentPath);
      await refreshTree(true);
      // Select the renamed page
      selectPage(newPath);
    } else {
      announce(`Failed to rename page: ${result.error}`);
    }
  } catch (error) {
    console.error('[Sidebar] Rename page error:', error);
    announce(`Error renaming page: ${error.message}`);
  }
}

/**
 * Handle deleting a page
 */
async function handleDeletePage(pagePath) {
  const pageName = getPageName(pagePath);

  const confirmed = await showConfirmationDialog({
    title: 'Delete Page',
    message: `Are you sure you want to delete "${pageName}"?`,
    detail: 'This action cannot be undone. All child pages will also be deleted.',
    confirmText: 'Delete',
    cancelText: 'Cancel',
    isDanger: true
  });

  if (!confirmed) return;

  try {
    const result = await window.electronAPI.azureDeletePage({
      pagePath: pagePath
    });

    if (result.success) {
      announce(`Page "${pageName}" deleted`);
      // Clear lazy loading cache
      const parentPath = getParentPath(pagePath) || '/';
      loadedPaths.delete(parentPath);
      // Refresh tree
      await refreshTree(true);
      // If deleted page was selected, clear selection
      if (currentPagePath === pagePath) {
        currentPagePath = null;
      }
    } else {
      announce(`Failed to delete page: ${result.error}`);
    }
  } catch (error) {
    console.error('[Sidebar] Delete page error:', error);
    announce(`Error deleting page: ${error.message}`);
  }
}

/**
 * Add a specific path to favorites
 */
async function addPathToFavorites(path) {
  const conn = await window.electronAPI.azureGetConnectionStatus();
  if (!conn.connected) return;

  const favorite = {
    org: conn.org,
    project: conn.project,
    wikiId: conn.wikiId,
    path: path,
    name: getPageName(path)
  };

  favorites = await window.electronAPI.azureAddFavorite(favorite);
  renderFavorites();
}

/**
 * Setup context menu event listeners
 */
function setupContextMenuListeners() {
  // Close context menu on click outside
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('tree-context-menu');
    if (menu && !menu.contains(e.target)) {
      hideContextMenu();
    }
  });

  // Close context menu on scroll
  const treeContainer = document.getElementById('wiki-tree');
  if (treeContainer) {
    treeContainer.addEventListener('scroll', hideContextMenu);
  }

  // Context menu action handlers
  const contextMenu = document.getElementById('tree-context-menu');
  if (contextMenu) {
    contextMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-menu-item');
      if (item) {
        const action = item.dataset.action;
        handleContextMenuAction(action);
      }
    });
  }
}

/**
 * Navigate to a specific path in the wiki tree
 */
export async function navigateToPath(path) {
  const container = document.getElementById('wiki-tree');
  if (container) {
    container.innerHTML = '<div class="loading">Loading...</div>';
  }

  try {
    const result = await window.electronAPI.azureGetWikiTree({ path });

    if (result.success) {
      // Replace tree data with fresh data from API
      // Don't use broken mergeTreeData - it preserves deleted nodes
      wikiTree = result.pages;
      currentTreePath = path;

      // Mark this path as loaded in lazy loading state
      loadedPaths.add(path);

      updateBreadcrumb();
      renderTree();
    } else {
      if (container) {
        container.innerHTML = `<div class="error-state">${escapeHtml(result.error || 'Failed to load')}</div>`;
      }
    }
  } catch (error) {
    if (container) {
      container.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
    }
  }
}

/**
 * Add current page to favorites
 */
export async function addCurrentToFavorites() {
  if (!currentPagePath) {
    console.warn('No page selected');
    return;
  }

  const conn = await window.electronAPI.azureGetConnectionStatus();
  if (!conn.connected) return;

  const favorite = {
    org: conn.org,
    project: conn.project,
    wikiId: conn.wikiId,
    path: currentPagePath,
    name: getPageName(currentPagePath)
  };

  favorites = await window.electronAPI.azureAddFavorite(favorite);
  renderFavorites();
}

/**
 * Remove a favorite
 */
async function removeFavorite(path) {
  const conn = await window.electronAPI.azureGetConnectionStatus();
  if (!conn.connected) return;

  favorites = await window.electronAPI.azureRemoveFavorite({
    org: conn.org,
    project: conn.project,
    wikiId: conn.wikiId,
    path
  });
  renderFavorites();
}

/**
 * Refresh the wiki tree
 * @param {boolean} forceRefresh - Skip cache and fetch fresh data from API
 */
export async function refreshTree(forceRefresh = false) {
  const container = document.getElementById('wiki-tree');
  if (container) {
    container.innerHTML = '<div class="loading">Loading...</div>';
  }

  // Clear lazy loading state and old tree data on force refresh
  if (forceRefresh) {
    loadedPaths.clear();
    loadingPaths.clear();
    expandedPaths.clear();
    wikiTree = null;  // Clear old tree data completely to prevent stale nodes
  }

  try {
    const result = await window.electronAPI.azureGetWikiTree({ forceRefresh });

    if (result.success) {
      wikiTree = result.pages;
      currentTreePath = wikiTree?.path || '/';  // Track the displayed path

      // Mark the current tree path as loaded (we have its immediate children)
      loadedPaths.add(currentTreePath);

      updateBreadcrumb();
      renderTree();
      focusedNodeIndex = -1;  // Reset keyboard focus
      // Don't auto-select a page - let user choose what to open
    } else {
      if (container) {
        container.innerHTML = `<div class="error-state">${escapeHtml(result.error || 'Failed to load')}</div>`;
      }
    }
  } catch (error) {
    if (container) {
      container.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
    }
  }

  // Also refresh favorites
  favorites = await window.electronAPI.azureGetFavorites();
  renderFavorites();
}

/**
 * Show the sidebar
 */
export function showSidebar() {
  const sidebar = document.getElementById('wiki-sidebar');
  if (!sidebar) return;

  if (!sidebar.querySelector('.sidebar-header')) {
    buildSidebarHTML();
  }

  sidebar.classList.remove('hidden');
  sidebarVisible = true;

  // Load data if connected
  refreshTree();
}

/**
 * Show the sidebar with a connecting/loading state
 */
export function showSidebarConnecting() {
  const sidebar = document.getElementById('wiki-sidebar');
  if (!sidebar) return;

  if (!sidebar.querySelector('.sidebar-header')) {
    buildSidebarHTML();
  }

  sidebar.classList.remove('hidden');
  sidebarVisible = true;

  // Show connecting state in the tree area
  const treeContainer = document.getElementById('wiki-tree');
  if (treeContainer) {
    treeContainer.innerHTML = `
      <div class="sidebar-connecting">
        <div class="loading-spinner"></div>
        <p class="sidebar-connecting-text">Connecting to Azure DevOps...</p>
      </div>
    `;
  }

  // Clear favorites while connecting
  const favContainer = document.getElementById('favorites-list');
  if (favContainer) {
    favContainer.innerHTML = '<div class="empty-state">Loading...</div>';
  }
}

/**
 * Hide the sidebar
 */
export function hideSidebar() {
  const sidebar = document.getElementById('wiki-sidebar');
  if (sidebar) {
    sidebar.classList.add('hidden');
  }
  sidebarVisible = false;
}

/**
 * Toggle sidebar visibility
 */
export function toggleSidebar() {
  if (sidebarVisible) {
    hideSidebar();
  } else {
    showSidebar();
  }
}

/**
 * Check if sidebar is visible
 */
export function isSidebarVisible() {
  return sidebarVisible;
}

/**
 * Set the page select callback
 */
export function setOnPageSelect(callback) {
  onPageSelectCallback = callback;
}

/**
 * Setup history panel with callbacks for restore and getting current content
 * @param {Object} options
 * @param {Function} options.onRestore - Called when user restores a version (receives content)
 * @param {Function} options.getCurrentContent - Returns current editor content
 */
export function setupHistoryCallbacks(options = {}) {
  onRestoreContentCallback = options.onRestore;
  getCurrentContentCallback = options.getCurrentContent;

  // Initialize the history panel with callbacks
  initHistoryPanel({
    onRestore: onRestoreContentCallback,
    getCurrentContent: getCurrentContentCallback
  });
}

/**
 * Get current page path
 */
export function getCurrentPagePath() {
  return currentPagePath;
}

/**
 * Set current page path (for external updates)
 */
export function setCurrentPagePath(path) {
  currentPagePath = path;
}

/**
 * Highlight a path in the wiki tree without loading the page content.
 * Used when switching tabs to sync the sidebar selection with the active tab.
 * This function only updates the visual selection, it does NOT trigger page loading.
 * Pass null to clear the current selection.
 *
 * If the node is not visible (parent folders collapsed), this will expand them first.
 *
 * @param {string|null} path - The path to highlight in the tree, or null to clear selection
 */
export async function highlightPathInTree(path) {
  // Update UI - remove selection from previous node
  document.querySelectorAll('.tree-node.selected').forEach(el => {
    el.classList.remove('selected');
    el.setAttribute('aria-selected', 'false');
    el.setAttribute('tabindex', '-1');
  });

  // If null path, just clear selection and return
  if (!path) {
    currentPagePath = null;
    return;
  }

  // Update current page path
  currentPagePath = path;

  // Try to find the node - it may not be visible if parent folders are collapsed
  let node = document.querySelector(`.tree-node[data-path="${CSS.escape(path)}"]`);

  // If node not found, try to expand parent folders to reveal it
  if (!node) {
    await expandPathToNode(path);
    // Try to find node again after expanding
    node = document.querySelector(`.tree-node[data-path="${CSS.escape(path)}"]`);
  }

  if (node) {
    node.classList.add('selected');
    node.setAttribute('aria-selected', 'true');
    node.setAttribute('tabindex', '0');

    // Scroll selected into view
    setTimeout(() => {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }

  // Update breadcrumb to reflect current path
  updateBreadcrumb();
}

/**
 * Expand tree nodes along a path to reveal a specific node.
 * @param {string} targetPath - The path to reveal
 */
async function expandPathToNode(targetPath) {
  if (!targetPath || targetPath === '/') return;

  // Get all ancestor paths that need to be expanded
  const pathParts = targetPath.split('/').filter(p => p);
  const pathsToExpand = [];

  let currentPath = '';
  for (let i = 0; i < pathParts.length - 1; i++) {
    currentPath += '/' + pathParts[i];
    pathsToExpand.push(currentPath);
  }

  // Expand each ancestor node
  for (const ancestorPath of pathsToExpand) {
    const ancestorNode = document.querySelector(`.tree-node[data-path="${CSS.escape(ancestorPath)}"]`);
    if (!ancestorNode) continue;

    const toggle = ancestorNode.querySelector('.tree-toggle');
    const children = ancestorNode.querySelector('.tree-children');

    if (toggle && children && !toggle.classList.contains('expanded')) {
      // Check if we need to load children
      const needsLoad = !loadedPaths.has(ancestorPath) && !loadingPaths.has(ancestorPath);

      if (needsLoad) {
        await loadNodeChildren(ancestorPath, ancestorNode, children);
      }

      // Expand the node
      toggle.classList.add('expanded');
      children.classList.remove('collapsed');
      expandedPaths.add(ancestorPath);
      ancestorNode.setAttribute('aria-expanded', 'true');
    }
  }
}

/**
 * Reset sidebar state (on disconnect)
 */
export function resetSidebar() {
  wikiTree = null;
  favorites = [];
  currentPagePath = null;
  currentTreePath = null;
  focusedNodeIndex = -1;

  // Clear lazy loading state
  loadedPaths.clear();
  loadingPaths.clear();
  expandedPaths.clear();

  const treeContainer = document.getElementById('wiki-tree');
  if (treeContainer) {
    treeContainer.innerHTML = '<div class="empty-state">Not connected</div>';
  }

  const favContainer = document.getElementById('favorites-list');
  if (favContainer) {
    favContainer.innerHTML = '<div class="empty-state">No favorites yet</div>';
  }
}

// ============================================
// Keyboard Navigation Helpers
// ============================================

/**
 * Get all visible tree nodes (excluding collapsed children)
 * @returns {Element[]} Array of visible node elements
 */
function getVisibleNodes() {
  const container = document.getElementById('wiki-tree');
  if (!container) return [];

  const allNodes = container.querySelectorAll('.tree-node');
  const visibleNodes = [];

  allNodes.forEach(node => {
    // Check if node is inside a collapsed children container
    const parent = node.parentElement;
    if (parent && parent.classList.contains('tree-children') && parent.classList.contains('collapsed')) {
      return; // Skip collapsed children
    }

    // Check all ancestor tree-children containers
    let ancestor = node.closest('.tree-children');
    while (ancestor) {
      if (ancestor.classList.contains('collapsed')) {
        return; // Skip if any ancestor is collapsed
      }
      ancestor = ancestor.parentElement?.closest('.tree-children');
    }

    visibleNodes.push(node);
  });

  return visibleNodes;
}

/**
 * Focus a specific node by index
 * @param {number} index - Index in visible nodes array
 */
function focusNode(index) {
  const nodes = getVisibleNodes();
  if (index < 0 || index >= nodes.length) return;

  // Remove focus from previous node
  const container = document.getElementById('wiki-tree');
  container?.querySelectorAll('.tree-node.keyboard-focus').forEach(el => {
    el.classList.remove('keyboard-focus');
  });

  // Add focus to new node
  const node = nodes[index];
  node.classList.add('keyboard-focus');
  focusedNodeIndex = index;

  // Scroll into view if needed
  node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Handle keyboard events for tree navigation
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleTreeKeydown(e) {
  const nodes = getVisibleNodes();
  if (nodes.length === 0) return;

  // Ensure we have a valid focused index
  if (focusedNodeIndex < 0 || focusedNodeIndex >= nodes.length) {
    focusedNodeIndex = 0;
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (focusedNodeIndex < nodes.length - 1) {
        focusNode(focusedNodeIndex + 1);
      }
      break;

    case 'ArrowUp':
      e.preventDefault();
      if (focusedNodeIndex > 0) {
        focusNode(focusedNodeIndex - 1);
      }
      break;

    case 'ArrowRight': {
      e.preventDefault();
      const currentNode = nodes[focusedNodeIndex];
      const toggle = currentNode.querySelector('.tree-toggle');
      if (toggle && !toggle.classList.contains('expanded')) {
        // Expand the node
        toggle.click();
        // Re-focus after DOM updates
        setTimeout(() => focusNode(focusedNodeIndex), 50);
      }
      break;
    }

    case 'ArrowLeft': {
      e.preventDefault();
      const currentNode = nodes[focusedNodeIndex];
      const toggle = currentNode.querySelector('.tree-toggle');
      if (toggle && toggle.classList.contains('expanded')) {
        // Collapse the node
        toggle.click();
        // Re-focus after DOM updates
        setTimeout(() => focusNode(focusedNodeIndex), 50);
      } else {
        // Navigate to parent node
        const parent = currentNode.parentElement?.closest('.tree-node');
        if (parent) {
          const parentIndex = nodes.indexOf(parent);
          if (parentIndex >= 0) {
            focusNode(parentIndex);
          }
        }
      }
      break;
    }

    case 'Enter':
    case ' ':
      e.preventDefault();
      const currentNode = nodes[focusedNodeIndex];
      const content = currentNode.querySelector('.tree-node-content');
      if (content) {
        content.click();
      }
      break;

    case 'Home':
      e.preventDefault();
      focusNode(0);
      break;

    case 'End':
      e.preventDefault();
      focusNode(nodes.length - 1);
      break;
  }
}
