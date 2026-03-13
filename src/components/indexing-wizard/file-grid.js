/**
 * File Grid Component
 * Real-time file status display with virtualized rows for performance
 */

// File status states
export const FILE_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  ERROR: 'error',
  SKIPPED: 'skipped'
};

// Status display config
const STATUS_CONFIG = {
  [FILE_STATUS.PENDING]: { icon: '○', label: 'Pending', class: 'status-pending' },
  [FILE_STATUS.PROCESSING]: { icon: '⟳', label: 'Working', class: 'status-processing' },
  [FILE_STATUS.COMPLETED]: { icon: '✓', label: 'Done', class: 'status-completed' },
  [FILE_STATUS.ERROR]: { icon: '✕', label: 'Error', class: 'status-error' },
  [FILE_STATUS.SKIPPED]: { icon: '–', label: 'Skipped', class: 'status-skipped' }
};

// Grid state
let gridState = {
  files: new Map(),       // filePath -> { status, tokens, time }
  sortBy: 'status',
  sortAsc: true,
  filterText: ''
};

/**
 * Create file grid HTML
 * @returns {string} HTML string
 */
export function createFileGridHTML() {
  return `
    <div class="file-grid">
      <div class="file-grid-toolbar">
        <input type="text" class="file-grid-filter" placeholder="Filter files..." />
        <select class="file-grid-sort">
          <option value="status">Sort by Status</option>
          <option value="path">Sort by Path</option>
          <option value="tokens">Sort by Tokens</option>
          <option value="time">Sort by Time</option>
        </select>
      </div>
      <div class="file-grid-header">
        <div class="file-grid-col file-grid-col-icon"></div>
        <div class="file-grid-col file-grid-col-path">File</div>
        <div class="file-grid-col file-grid-col-status">Status</div>
        <div class="file-grid-col file-grid-col-tokens">Tokens</div>
        <div class="file-grid-col file-grid-col-time">Time</div>
      </div>
      <div class="file-grid-body">
        <div class="file-grid-scroll-container">
          <div class="file-grid-rows"></div>
        </div>
      </div>
      <div class="file-grid-footer">
        <span class="file-grid-stats">0 files</span>
      </div>
    </div>
  `;
}

/**
 * Initialize file grid
 * @param {HTMLElement} container - Container element
 */
export function initFileGrid(container) {
  // Reset state
  gridState = {
    files: new Map(),
    sortBy: 'status',
    sortAsc: true,
    filterText: ''
  };

  const grid = container.querySelector('.file-grid');
  if (!grid) return;

  // Filter input
  const filterInput = grid.querySelector('.file-grid-filter');
  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      gridState.filterText = e.target.value.toLowerCase();
      renderGridRows(container);
    });
  }

  // Sort select
  const sortSelect = grid.querySelector('.file-grid-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      gridState.sortBy = e.target.value;
      renderGridRows(container);
    });
  }
}

/**
 * Add file to grid
 * @param {HTMLElement} container - Container element
 * @param {string} filePath - File path
 * @param {string} status - Initial status
 */
export function addFile(container, filePath, status = FILE_STATUS.PENDING) {
  gridState.files.set(filePath, {
    path: filePath,
    status: status,
    tokens: null,
    time: null
  });
  renderGridRows(container);
}

/**
 * Add multiple files to grid
 * @param {HTMLElement} container - Container element
 * @param {string[]} filePaths - Array of file paths
 */
export function addFiles(container, filePaths) {
  filePaths.forEach(path => {
    gridState.files.set(path, {
      path: path,
      status: FILE_STATUS.PENDING,
      tokens: null,
      time: null
    });
  });
  renderGridRows(container);
}

/**
 * Update file status
 * @param {HTMLElement} container - Container element
 * @param {string} filePath - File path
 * @param {string} status - New status
 * @param {number} tokens - Token count
 * @param {number} timeMs - Processing time in ms
 * @param {string} error - Optional error message
 */
export function updateFileStatus(container, filePath, status, tokens = null, timeMs = null, error = null) {
  const file = gridState.files.get(filePath);
  if (file) {
    file.status = status;
    if (tokens !== null) file.tokens = tokens;
    if (timeMs !== null) file.time = timeMs;
    if (error !== null) file.error = error;

    // Update single row if visible, or full render
    const row = container.querySelector(`.file-grid-row[data-path="${CSS.escape(filePath)}"]`);
    if (row) {
      updateRowElement(row, file);
    }

    // Update stats
    updateStats(container);
  } else {
    // Add new file if not exists
    gridState.files.set(filePath, {
      path: filePath,
      status: status,
      tokens: tokens,
      time: timeMs,
      error: error
    });
    renderGridRows(container);
  }
}

/**
 * Update a single row element
 * @param {HTMLElement} row - Row element
 * @param {Object} file - File data
 */
function updateRowElement(row, file) {
  const statusConfig = STATUS_CONFIG[file.status] || STATUS_CONFIG[FILE_STATUS.PENDING];

  // Update status
  const statusEl = row.querySelector('.file-grid-col-status');
  if (statusEl) {
    statusEl.innerHTML = `<span class="status-badge ${statusConfig.class}">${statusConfig.icon} ${statusConfig.label}</span>`;
  }

  // Update tokens
  const tokensEl = row.querySelector('.file-grid-col-tokens');
  if (tokensEl) {
    tokensEl.textContent = file.tokens !== null ? formatNumber(file.tokens) : '-';
  }

  // Update time
  const timeEl = row.querySelector('.file-grid-col-time');
  if (timeEl) {
    timeEl.textContent = file.time !== null ? formatTime(file.time) : '-';
  }

  // Update row class
  row.className = `file-grid-row ${statusConfig.class}`;
}

/**
 * Render grid rows
 * @param {HTMLElement} container - Container element
 */
function renderGridRows(container) {
  const grid = container.querySelector('.file-grid');
  if (!grid) return;

  const rowsContainer = grid.querySelector('.file-grid-rows');
  if (!rowsContainer) return;

  // Get filtered and sorted files
  const filteredFiles = getFilteredSortedFiles();

  // Render all rows (scrollable via .file-grid-body overflow)
  rowsContainer.innerHTML = filteredFiles.map((file) => {
    return createRowHTML(file);
  }).join('');

  // Update stats
  updateStats(container);
}

/**
 * Create row HTML
 * @param {Object} file - File data
 * @returns {string} HTML string
 */
function createRowHTML(file) {
  const statusConfig = STATUS_CONFIG[file.status] || STATUS_CONFIG[FILE_STATUS.PENDING];
  const fileName = getFileName(file.path);
  const fileExt = getFileExtension(file.path);
  const icon = getFileIcon(fileExt);

  // Build title with error info if present
  let rowTitle = escapeHtml(file.path);
  if (file.error) {
    rowTitle += `\n\nError: ${escapeHtml(file.error)}`;
  }

  // Show error indicator in status
  const statusText = `${statusConfig.icon} ${statusConfig.label}`;

  return `
    <div class="file-grid-row ${statusConfig.class}"
         data-path="${escapeHtml(file.path)}"
         title="${rowTitle}">
      <div class="file-grid-col file-grid-col-icon">${icon}</div>
      <div class="file-grid-col file-grid-col-path" title="${escapeHtml(file.path)}">${escapeHtml(fileName)}</div>
      <div class="file-grid-col file-grid-col-status">
        <span class="status-badge ${statusConfig.class}" ${file.error ? `title="${escapeHtml(file.error)}"` : ''}>${statusText}</span>
      </div>
      <div class="file-grid-col file-grid-col-tokens">${file.tokens !== null ? formatNumber(file.tokens) : '-'}</div>
      <div class="file-grid-col file-grid-col-time">${file.time !== null ? formatTime(file.time) : '-'}</div>
    </div>
  `;
}

/**
 * Get filtered and sorted files
 * @returns {Array} Filtered and sorted file array
 */
function getFilteredSortedFiles() {
  let files = Array.from(gridState.files.values());

  // Filter
  if (gridState.filterText) {
    files = files.filter(f => f.path.toLowerCase().includes(gridState.filterText));
  }

  // Sort
  files.sort((a, b) => {
    let cmp = 0;
    switch (gridState.sortBy) {
      case 'status':
        const statusOrder = { [FILE_STATUS.PROCESSING]: 0, [FILE_STATUS.PENDING]: 1, [FILE_STATUS.COMPLETED]: 2, [FILE_STATUS.ERROR]: 3, [FILE_STATUS.SKIPPED]: 4 };
        cmp = (statusOrder[a.status] || 5) - (statusOrder[b.status] || 5);
        break;
      case 'path':
        cmp = a.path.localeCompare(b.path);
        break;
      case 'tokens':
        cmp = (a.tokens || 0) - (b.tokens || 0);
        break;
      case 'time':
        cmp = (a.time || 0) - (b.time || 0);
        break;
    }
    return gridState.sortAsc ? cmp : -cmp;
  });

  return files;
}

/**
 * Update stats display
 * @param {HTMLElement} container - Container element
 */
function updateStats(container) {
  const statsEl = container.querySelector('.file-grid-stats');
  if (!statsEl) return;

  const files = Array.from(gridState.files.values());
  const total = files.length;
  const completed = files.filter(f => f.status === FILE_STATUS.COMPLETED).length;
  const errors = files.filter(f => f.status === FILE_STATUS.ERROR).length;
  const totalTokens = files.reduce((sum, f) => sum + (f.tokens || 0), 0);

  statsEl.textContent = `${completed} / ${total} files • ${formatNumber(totalTokens)} tokens${errors > 0 ? ` • ${errors} errors` : ''}`;
}

/**
 * Get file name from path
 * @param {string} path - Full path
 * @returns {string} File name
 */
function getFileName(path) {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * Get file extension
 * @param {string} path - File path
 * @returns {string} Extension (with dot)
 */
function getFileExtension(path) {
  const name = getFileName(path);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.substring(dotIndex) : '';
}

/**
 * Get file icon based on extension
 * @param {string} ext - File extension
 * @returns {string} Icon character
 */
function getFileIcon(ext) {
  const icons = {
    '.js': '📜',
    '.ts': '📜',
    '.jsx': '📜',
    '.tsx': '📜',
    '.py': '🐍',
    '.json': '📋',
    '.md': '📝',
    '.txt': '📄',
    '.html': '🌐',
    '.css': '🎨',
    '.cs': '🔷',
    '.java': '☕',
    '.go': '🔵',
    '.rs': '🦀',
    '.yml': '⚙️',
    '.yaml': '⚙️',
    '.xml': '📰',
    '.sql': '🗃️'
  };
  return icons[ext.toLowerCase()] || '📄';
}

/**
 * Format number with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted string
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toLocaleString();
}

/**
 * Format time in ms
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted string
 */
function formatTime(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Clear the grid
 * @param {HTMLElement} container - Container element
 */
export function clearGrid(container) {
  gridState.files.clear();
  renderGridRows(container);
}

/**
 * Batch-update all files matching a given status to a new status
 * @param {HTMLElement} container - Container element
 * @param {string} fromStatus - Status to match
 * @param {string} toStatus - Status to set
 */
export function markFilesAs(container, fromStatus, toStatus) {
  let changed = false;
  for (const file of gridState.files.values()) {
    if (file.status === fromStatus) {
      file.status = toStatus;
      changed = true;
    }
  }
  if (changed) {
    renderGridRows(container);
  }
}

/**
 * Get grid instance state
 * @returns {Object} Grid state
 */
export function getFileGridInstance() {
  return {
    files: new Map(gridState.files),
    totalFiles: gridState.files.size,
    completedFiles: Array.from(gridState.files.values()).filter(f => f.status === FILE_STATUS.COMPLETED).length
  };
}
