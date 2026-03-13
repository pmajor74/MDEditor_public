/**
 * Search Panel Component
 *
 * Search interface for finding files by name or content.
 * Supports regex, case-sensitive options, and context display.
 */

import { getFileIcon, getFileIconColor } from '../file-browser/file-icons.js';

// State
let panelVisible = false;
let currentSearchId = null;
let isSearching = false;
let searchResults = [];

// Callbacks
let onFileSelectCallback = null;

// Resize state
const PANEL_MIN_WIDTH = 200;
const PANEL_MAX_WIDTH = 500;
const PANEL_WIDTH_STORAGE_KEY = 'search-panel-width';
let isResizing = false;

// Debounce timer
let searchDebounceTimer = null;
const DEBOUNCE_MS = 300;

/**
 * Build the search panel HTML
 */
function buildPanelHTML() {
  const panel = document.getElementById('search-panel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="sidebar-resize-handle" title="Drag to resize"></div>
    <div class="sidebar-header search-panel-header">
      <span class="sidebar-title">Search</span>
      <button class="sidebar-close" title="Close">&times;</button>
    </div>

    <div class="search-panel-controls">
      <div class="search-input-container">
        <input
          type="text"
          id="search-input"
          class="search-input"
          placeholder="Search files..."
          aria-label="Search query"
        />
        <button id="search-clear" class="search-clear hidden" title="Clear search">&times;</button>
      </div>

      <div class="search-options">
        <label class="search-option">
          <input type="checkbox" id="search-case-sensitive" />
          <span>Aa</span>
          <span class="option-tooltip">Case sensitive</span>
        </label>
        <label class="search-option">
          <input type="checkbox" id="search-regex" />
          <span>.*</span>
          <span class="option-tooltip">Use regex</span>
        </label>
      </div>

      <div class="search-type-selector">
        <label>
          <input type="radio" name="search-type" value="content" checked />
          Content
        </label>
        <label>
          <input type="radio" name="search-type" value="filename" />
          Filename
        </label>
        <label>
          <input type="radio" name="search-type" value="both" />
          Both
        </label>
      </div>

      <div class="search-folder-selector">
        <button id="search-select-folder" class="btn-select-folder">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
          <span id="search-folder-name">Select Folder</span>
        </button>
      </div>
    </div>

    <div id="search-status" class="search-status hidden"></div>

    <div id="search-results" class="search-results">
      <div class="empty-state">
        <p>Enter a search query</p>
        <p class="empty-state-hint">Search files by content or name</p>
      </div>
    </div>
  `;

  // Attach event listeners
  panel.querySelector('.sidebar-close').addEventListener('click', hidePanel);
  panel.querySelector('#search-input').addEventListener('input', handleSearchInput);
  panel.querySelector('#search-clear').addEventListener('click', clearSearch);
  panel.querySelector('#search-select-folder').addEventListener('click', selectSearchFolder);

  // Options change handlers
  panel.querySelector('#search-case-sensitive').addEventListener('change', triggerSearch);
  panel.querySelector('#search-regex').addEventListener('change', triggerSearch);
  panel.querySelectorAll('input[name="search-type"]').forEach(radio => {
    radio.addEventListener('change', triggerSearch);
  });

  // Setup resize
  setupResizeHandlers(panel);

  // Restore saved width
  restorePanelWidth(panel);
}

/**
 * Setup resize handle drag functionality
 */
function setupResizeHandlers(panel) {
  const resizeHandle = panel.querySelector('.sidebar-resize-handle');
  if (!resizeHandle) return;

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isResizing = true;
    resizeHandle.classList.add('resizing');
    document.body.classList.add('sidebar-resizing');

    const startX = e.clientX;
    const startWidth = panel.offsetWidth;

    let resizeRafPending = false;
    const onMouseMove = (moveEvent) => {
      if (!isResizing) return;
      if (resizeRafPending) return;
      resizeRafPending = true;
      requestAnimationFrame(() => {
        const deltaX = moveEvent.clientX - startX;
        let newWidth = startWidth + deltaX;

        newWidth = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, newWidth));
        panel.style.width = `${newWidth}px`;
        resizeRafPending = false;
      });
    };

    const onMouseUp = () => {
      isResizing = false;
      resizeHandle.classList.remove('resizing');
      document.body.classList.remove('sidebar-resizing');

      const finalWidth = panel.offsetWidth;
      localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, finalWidth.toString());

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

/**
 * Restore saved panel width
 */
function restorePanelWidth(panel) {
  const savedWidth = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
  if (savedWidth) {
    const width = parseInt(savedWidth, 10);
    if (width >= PANEL_MIN_WIDTH && width <= PANEL_MAX_WIDTH) {
      panel.style.width = `${width}px`;
    }
  }
}

// Search folder path
let searchFolderPath = null;

/**
 * Select search folder
 */
async function selectSearchFolder() {
  try {
    const result = await window.electronAPI.fileOpenFolder();
    if (result.success && result.path) {
      searchFolderPath = result.path;
      const folderName = result.path.split(/[\\/]/).pop();
      document.getElementById('search-folder-name').textContent = folderName;
      triggerSearch();
    }
  } catch (err) {
    console.error('[Search Panel] Failed to select folder:', err);
  }
}

/**
 * Handle search input
 */
function handleSearchInput(e) {
  const query = e.target.value;
  const clearBtn = document.getElementById('search-clear');

  if (query) {
    clearBtn.classList.remove('hidden');
  } else {
    clearBtn.classList.add('hidden');
  }

  // Debounce search
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  searchDebounceTimer = setTimeout(() => {
    triggerSearch();
  }, DEBOUNCE_MS);
}

/**
 * Clear search
 */
function clearSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');

  input.value = '';
  clearBtn.classList.add('hidden');
  searchResults = [];
  renderResults();

  // Cancel any running search
  if (currentSearchId) {
    window.electronAPI.fileSearchCancel(currentSearchId);
    currentSearchId = null;
  }
}

/**
 * Trigger a new search
 */
async function triggerSearch() {
  const query = document.getElementById('search-input')?.value?.trim();

  if (!query) {
    searchResults = [];
    renderResults();
    return;
  }

  if (!searchFolderPath) {
    showStatus('Select a folder to search', 'info');
    return;
  }

  // Cancel previous search
  if (currentSearchId) {
    await window.electronAPI.fileSearchCancel(currentSearchId);
  }

  // Get options
  const caseSensitive = document.getElementById('search-case-sensitive')?.checked || false;
  const useRegex = document.getElementById('search-regex')?.checked || false;
  const searchType = document.querySelector('input[name="search-type"]:checked')?.value || 'content';

  isSearching = true;
  showStatus('Searching...', 'loading');

  try {
    const result = await window.electronAPI.fileSearch({
      query,
      searchPath: searchFolderPath,
      searchType,
      caseSensitive,
      useRegex
    });

    isSearching = false;

    if (result.success) {
      searchResults = result.results;

      if (result.cancelled) {
        showStatus('Search cancelled', 'info');
      } else if (result.results.length === 0) {
        showStatus('No results found', 'info');
      } else {
        const statsMsg = result.stats.maxResultsReached
          ? `Found ${result.results.length}+ matches (limit reached)`
          : `Found ${result.results.length} matches in ${result.stats.filesSearched} files`;
        showStatus(statsMsg, 'success');
      }

      renderResults();
    } else {
      showStatus(`Error: ${result.error}`, 'error');
    }
  } catch (err) {
    isSearching = false;
    showStatus(`Error: ${err.message}`, 'error');
    console.error('[Search Panel] Search failed:', err);
  }
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
  const status = document.getElementById('search-status');
  if (!status) return;

  status.className = `search-status search-status-${type}`;
  status.textContent = message;
  status.classList.remove('hidden');

  if (type === 'loading') {
    status.innerHTML = `<div class="loading-spinner"></div> ${message}`;
  }
}

/**
 * Hide status message
 */
function hideStatus() {
  const status = document.getElementById('search-status');
  if (status) {
    status.classList.add('hidden');
  }
}

/**
 * Render search results
 */
function renderResults() {
  const container = document.getElementById('search-results');
  if (!container) return;

  if (searchResults.length === 0) {
    const query = document.getElementById('search-input')?.value?.trim();
    if (query) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No results found</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <p>Enter a search query</p>
          <p class="empty-state-hint">Search files by content or name</p>
        </div>
      `;
    }
    return;
  }

  const html = searchResults.map(result => renderResult(result)).join('');
  container.innerHTML = html;

  // Attach click handlers
  container.querySelectorAll('.search-result-item').forEach((item, index) => {
    item.addEventListener('click', () => {
      openResult(searchResults[index]);
    });
  });
}

/**
 * Render a single search result
 */
function renderResult(result) {
  const icon = getFileIcon(result.name, false, false);
  const iconColor = getFileIconColor(result.name, false);

  if (result.type === 'filename') {
    return `
      <div class="search-result-item" data-path="${escapeHtml(result.path)}">
        <div class="result-header">
          <span class="result-icon" style="color: ${iconColor};">${icon}</span>
          <span class="result-name">${escapeHtml(result.name)}</span>
        </div>
        <div class="result-path">${escapeHtml(result.directory)}</div>
      </div>
    `;
  }

  // Content result with context
  let contextHtml = '';

  // Context before
  if (result.contextBefore && result.contextBefore.length > 0) {
    contextHtml += result.contextBefore.map(ctx =>
      `<div class="result-context-line"><span class="line-number">${ctx.line}</span>${escapeHtml(ctx.text)}</div>`
    ).join('');
  }

  // Match line
  contextHtml += `<div class="result-match-line"><span class="line-number">${result.line}</span>${escapeHtml(result.text)}</div>`;

  // Context after
  if (result.contextAfter && result.contextAfter.length > 0) {
    contextHtml += result.contextAfter.map(ctx =>
      `<div class="result-context-line"><span class="line-number">${ctx.line}</span>${escapeHtml(ctx.text)}</div>`
    ).join('');
  }

  return `
    <div class="search-result-item" data-path="${escapeHtml(result.path)}" data-line="${result.line}">
      <div class="result-header">
        <span class="result-icon" style="color: ${iconColor};">${icon}</span>
        <span class="result-name">${escapeHtml(result.name)}</span>
        <span class="result-line-badge">Line ${result.line}</span>
      </div>
      <div class="result-path">${escapeHtml(result.directory)}</div>
      <div class="result-context">${contextHtml}</div>
    </div>
  `;
}

/**
 * Open a search result
 */
async function openResult(result) {
  if (!onFileSelectCallback) return;

  try {
    const fileResult = await window.electronAPI.fileReadFile(result.path);
    if (fileResult.success) {
      onFileSelectCallback({
        path: result.path,
        content: fileResult.content,
        name: result.name,
        line: result.line || 1
      });
    }
  } catch (err) {
    console.error('[Search Panel] Failed to open result:', err);
  }
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
 * Show the search panel
 */
function showPanel() {
  const panel = document.getElementById('search-panel');
  if (!panel) return;

  if (!panel.querySelector('.sidebar-header')) {
    buildPanelHTML();
  }

  panel.classList.remove('hidden');
  panelVisible = true;

  // Focus the search input
  setTimeout(() => {
    document.getElementById('search-input')?.focus();
  }, 100);
}

/**
 * Hide the search panel
 */
function hidePanel() {
  const panel = document.getElementById('search-panel');
  if (panel) {
    panel.classList.add('hidden');
  }
  panelVisible = false;

  // Cancel any running search
  if (currentSearchId) {
    window.electronAPI.fileSearchCancel(currentSearchId);
    currentSearchId = null;
  }
}

/**
 * Toggle search panel visibility
 */
function togglePanel() {
  if (panelVisible) {
    hidePanel();
  } else {
    showPanel();
  }
}

/**
 * Check if panel is visible
 */
function isPanelVisible() {
  return panelVisible;
}

/**
 * Set callback for file selection
 */
function setOnFileSelect(callback) {
  onFileSelectCallback = callback;
}

export {
  buildPanelHTML,
  showPanel,
  hidePanel,
  togglePanel,
  isPanelVisible,
  setOnFileSelect
};
