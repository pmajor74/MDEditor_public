/**
 * Catalog Manager Component
 *
 * Modal dialog for managing vector DB catalogs.
 * Allows viewing, deleting, renaming, and rebuilding catalogs.
 * Supports detail view with file list and "Ask Catalog" Q&A feature.
 */

import { showConfirmationDialog, showAlertDialog } from '../confirmation-dialog.js';

let catalogManagerOptions = {};
let activeIndexingStatus = {};  // Track active indexing operations
let catalogs = [];  // Cache of catalogs for UI updates

// List view state
let catalogFilter = '';  // Search filter for catalog list

// Detail view state
let currentView = 'list';  // 'list' | 'detail'
let selectedCatalog = null;
let catalogFiles = [];
let fileFilter = '';
let fileSortBy = 'name';

// Chunk viewer state
let showOverlapContext = false;

// Ask Catalog state
let askCatalogOpen = false;
let askCatalogName = null;
let askCatalogMessages = [];
let askCatalogLoading = false;

/**
 * Show the catalog manager modal
 * @param {Object} options - Options
 * @param {Function} options.onClose - Callback when modal closes
 */
export function showCatalogManager(options = {}) {
  catalogManagerOptions = options;

  // Reset state
  currentView = 'list';
  selectedCatalog = null;
  catalogFiles = [];
  fileFilter = '';
  catalogFilter = '';
  askCatalogOpen = false;
  askCatalogMessages = [];

  // Remove existing modal if present
  hideCatalogManager();

  // Create modal
  const modal = document.createElement('div');
  modal.id = 'catalog-manager-modal';
  modal.className = 'catalog-manager-overlay';
  modal.innerHTML = `
    <div class="catalog-manager-dialog">
      <div class="catalog-manager-header">
        <h2>Manage Catalogs</h2>
        <button class="catalog-manager-close">&times;</button>
      </div>
      <div class="catalog-manager-body">
        <div class="catalog-search-bar hidden">
          <input type="text" class="catalog-search-input" id="catalog-search-input"
                 placeholder="Search catalogs...">
        </div>
        <div class="catalog-manager-loading">Loading catalogs...</div>
        <div class="catalog-manager-list hidden"></div>
        <div class="catalog-manager-empty hidden">
          <p>No catalogs found.</p>
          <p class="hint">Use the File Browser to create catalogs by right-clicking folders.</p>
        </div>
      </div>
      <div class="catalog-manager-footer">
        <button class="catalog-manager-btn" id="catalog-manager-refresh">Refresh</button>
        <button class="catalog-manager-btn catalog-manager-btn-close">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  modal.querySelector('.catalog-manager-close').addEventListener('click', hideCatalogManager);
  modal.querySelector('.catalog-manager-btn-close').addEventListener('click', hideCatalogManager);
  modal.querySelector('#catalog-manager-refresh').addEventListener('click', loadCatalogs);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideCatalogManager();
  });

  // Set up real-time indexing status listener
  window.electronAPI.onVectordbIndexingStatus((status) => {
    activeIndexingStatus = status;
    refreshCatalogList();
  });

  // Load catalogs and active indexing status
  loadCatalogs();
}

/**
 * Hide the catalog manager modal
 */
export function hideCatalogManager() {
  const modal = document.getElementById('catalog-manager-modal');
  if (modal) {
    // Remove indexing status listener
    window.electronAPI.removeVectordbIndexingStatusListener?.();

    modal.remove();
    if (catalogManagerOptions.onClose) {
      catalogManagerOptions.onClose();
    }

    // Restore focus to AI chat input
    setTimeout(() => document.getElementById('ai-input')?.focus(), 50);
  }
}

/**
 * Load and display catalogs
 */
async function loadCatalogs() {
  const modal = document.getElementById('catalog-manager-modal');
  if (!modal) return;

  const loading = modal.querySelector('.catalog-manager-loading');
  const list = modal.querySelector('.catalog-manager-list');
  const empty = modal.querySelector('.catalog-manager-empty');

  loading.classList.remove('hidden');
  list.classList.add('hidden');
  empty.classList.add('hidden');

  try {
    // Fetch catalogs and active indexing status in parallel
    const [catalogsResult, indexingStatus] = await Promise.all([
      window.electronAPI.vectordbGetCollections(),
      window.electronAPI.vectordbGetActiveIndexing()
    ]);

    activeIndexingStatus = indexingStatus || {};
    // Filter out persona catalogs — those are managed via Manage Personas
    catalogs = (catalogsResult.collections || []).filter(c => !c.name.startsWith('persona-'));

    loading.classList.add('hidden');

    if (!catalogsResult.success || !catalogs || catalogs.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    // Show search bar when there are catalogs
    const searchBar = modal.querySelector('.catalog-search-bar');
    if (searchBar) {
      searchBar.classList.remove('hidden');
      const searchInput = searchBar.querySelector('#catalog-search-input');
      if (searchInput) {
        searchInput.value = catalogFilter;
        searchInput.addEventListener('input', (e) => {
          catalogFilter = e.target.value;
          renderFilteredCatalogs();
        });
      }
    }

    list.classList.remove('hidden');
    renderFilteredCatalogs();

  } catch (error) {
    console.error('[Catalog Manager] Failed to load catalogs:', error);
    loading.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.innerHTML = `<p class="error">Failed to load catalogs: ${error.message}</p>`;
  }
}

/**
 * Render the filtered catalog list based on catalogFilter
 */
function renderFilteredCatalogs() {
  const modal = document.getElementById('catalog-manager-modal');
  if (!modal) return;

  const list = modal.querySelector('.catalog-manager-list');
  if (!list) return;

  let filtered = catalogs;
  if (catalogFilter.trim()) {
    const query = catalogFilter.toLowerCase().replace(/[.\-_/\\]/g, '');
    filtered = catalogs.filter(catalog => {
      const name = (catalog.name || '').toLowerCase();
      const displayName = (catalog.displayName || '').toLowerCase();
      const stripped = name.replace(/[.\-_/\\]/g, '');
      // Match against name, display name, or separator-stripped name
      return name.includes(catalogFilter.toLowerCase()) ||
             displayName.includes(catalogFilter.toLowerCase()) ||
             stripped.includes(query);
    });
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="catalog-manager-no-match">No catalogs match "${escapeHtml(catalogFilter)}"</div>`;
  } else {
    list.innerHTML = filtered.map(catalog => renderCatalogItem(catalog)).join('');
  }

  attachCatalogListeners(list);
}

/**
 * Attach event listeners to catalog items
 */
function attachCatalogListeners(list) {
  list.querySelectorAll('.catalog-item').forEach(item => {
    const name = item.dataset.name;

    // View Catalog button
    item.querySelector('.catalog-action-view')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showCatalogDetail(name);
    });

    item.querySelector('.catalog-action-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCatalog(name);
    });
    item.querySelector('.catalog-action-rebuild')?.addEventListener('click', (e) => {
      e.stopPropagation();
      rebuildCatalog(name);
    });
    item.querySelector('.catalog-action-refresh')?.addEventListener('click', (e) => {
      e.stopPropagation();
      refreshCatalogIndex(name);
    });
  });
}

/**
 * Refresh the catalog list display (for real-time status updates)
 */
function refreshCatalogList() {
  const modal = document.getElementById('catalog-manager-modal');
  if (!modal) return;

  const list = modal.querySelector('.catalog-manager-list');
  if (!list || list.classList.contains('hidden')) return;

  // Update each catalog item's status badge
  list.querySelectorAll('.catalog-item').forEach(item => {
    const name = item.dataset.name;
    const activeOps = activeIndexingStatus[name];
    const statusBadge = item.querySelector('.catalog-status-badge');
    const statsEl = item.querySelector('.catalog-item-stats');
    const actionsDiv = item.querySelector('.catalog-item-actions');

    if (activeOps) {
      // Show indexing status
      item.classList.add('indexing');

      // Update or create status badge
      if (statusBadge) {
        statusBadge.innerHTML = `<span class="spinner"></span>Indexing ${activeOps.processed || 0}/${activeOps.total || '?'}`;
      } else if (statsEl) {
        // Replace stats with status badge
        const badge = document.createElement('span');
        badge.className = 'catalog-status-badge indexing';
        badge.innerHTML = `<span class="spinner"></span>Indexing ${activeOps.processed || 0}/${activeOps.total || '?'}`;
        statsEl.parentNode.insertBefore(badge, statsEl.nextSibling);
        statsEl.classList.add('hidden');
      }

      // Hide actions while indexing
      if (actionsDiv) {
        actionsDiv.classList.add('hidden');
      }
    } else {
      // Show normal state
      item.classList.remove('indexing');

      // Remove status badge
      if (statusBadge) {
        statusBadge.remove();
      }

      // Show stats
      if (statsEl) {
        statsEl.classList.remove('hidden');
      }

      // Show actions
      if (actionsDiv) {
        actionsDiv.classList.remove('hidden');
      }
    }
  });
}

/**
 * Render a catalog item
 */
function renderCatalogItem(catalog) {
  const displayName = catalog.displayName || catalog.name;
  const rootPaths = catalog.rootPaths || (catalog.rootPath ? [catalog.rootPath] : []);
  const lastUpdated = catalog.lastUpdated ? new Date(catalog.lastUpdated).toLocaleString() : 'Never';

  return `
    <div class="catalog-item" data-name="${escapeHtml(catalog.name)}">
      <div class="catalog-item-header">
        <span class="catalog-item-name">${escapeHtml(displayName)}</span>
        <span class="catalog-item-stats">${catalog.fileCount || 0} files, ${catalog.documentCount || 0} chunks</span>
        <button class="catalog-view-btn catalog-action-view" title="View catalog files">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          View Catalog
        </button>
      </div>
      <div class="catalog-item-details">
        <div class="catalog-item-paths">
          ${rootPaths.map(p => `<span class="catalog-path" title="${escapeHtml(p)}">${escapeHtml(shortenPath(p))}</span>`).join('')}
        </div>
        <div class="catalog-item-meta">
          Extensions: ${(catalog.extensions || ['.md', '.txt']).join(', ')}
          | Last updated: ${lastUpdated}
        </div>
      </div>
      <div class="catalog-item-actions">
        <button class="catalog-action-btn catalog-action-refresh" title="Smart refresh (detect changes)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
          Refresh
        </button>
        <button class="catalog-action-btn catalog-action-rebuild" title="Full rebuild (re-index all files)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6"/>
            <path d="M3 12a9 9 0 0115-6.7L21 8"/>
            <path d="M3 22v-6h6"/>
            <path d="M21 12a9 9 0 01-15 6.7L3 16"/>
          </svg>
          Rebuild
        </button>
        <button class="catalog-action-btn catalog-action-delete danger" title="Delete catalog">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
          Delete
        </button>
      </div>
    </div>
  `;
}

/**
 * Show detail view for a catalog
 */
async function showCatalogDetail(catalogName) {
  const modal = document.getElementById('catalog-manager-modal');
  if (!modal) return;

  currentView = 'detail';
  selectedCatalog = catalogName;
  fileFilter = '';
  fileSortBy = 'name';

  // Show loading state
  const body = modal.querySelector('.catalog-manager-body');
  body.innerHTML = '<div class="catalog-manager-loading">Loading catalog files...</div>';

  try {
    // Get catalog metadata with files
    const result = await window.electronAPI.vectordbGetCatalogMeta({ catalogName });

    if (!result.success || !result.meta) {
      body.innerHTML = `<div class="catalog-manager-empty"><p class="error">Failed to load catalog: ${result.error || 'Not found'}</p></div>`;
      return;
    }

    const meta = result.meta;
    catalogFiles = Object.entries(meta.files || {}).map(([filePath, info]) => ({
      path: filePath,
      relativePath: info.relativePath || filePath,
      chunkCount: info.chunkCount || 0,
      indexedAt: info.indexedAt,
      hash: info.hash
    }));

    renderDetailView();
  } catch (error) {
    console.error('[Catalog Manager] Failed to load catalog detail:', error);
    body.innerHTML = `<div class="catalog-manager-empty"><p class="error">Failed to load catalog: ${error.message}</p></div>`;
  }
}

/**
 * Render the detail view (file list)
 */
function renderDetailView() {
  const modal = document.getElementById('catalog-manager-modal');
  if (!modal) return;

  const catalog = catalogs.find(c => c.name === selectedCatalog);
  const displayName = catalog?.displayName || selectedCatalog;

  // Filter and sort files
  let filtered = catalogFiles.filter(f =>
    f.relativePath.toLowerCase().includes(fileFilter.toLowerCase())
  );

  filtered = sortFiles(filtered, fileSortBy);

  // Calculate total chunks
  const totalChunks = catalogFiles.reduce((sum, f) => sum + f.chunkCount, 0);

  const body = modal.querySelector('.catalog-manager-body');
  body.innerHTML = `
    <div class="catalog-detail-header">
      <button class="catalog-back-btn" id="catalog-back-btn">&larr; Back</button>
      <div class="catalog-detail-info">
        <h3>${escapeHtml(displayName)}</h3>
        <span class="catalog-detail-stats">${catalogFiles.length} files &bull; ${totalChunks} chunks</span>
      </div>
    </div>

    <div class="catalog-file-toolbar">
      <input type="text" class="catalog-file-filter" id="catalog-file-filter"
             placeholder="Filter files..." value="${escapeHtml(fileFilter)}">
      <select class="catalog-file-sort" id="catalog-file-sort">
        <option value="name" ${fileSortBy === 'name' ? 'selected' : ''}>Sort: Name</option>
        <option value="date" ${fileSortBy === 'date' ? 'selected' : ''}>Sort: Date</option>
        <option value="chunks" ${fileSortBy === 'chunks' ? 'selected' : ''}>Sort: Chunks</option>
      </select>
    </div>

    <div class="catalog-file-grid">
      <div class="catalog-file-grid-header">
        <span class="grid-col grid-col-icon"></span>
        <span class="grid-col grid-col-path" data-resize="path">File Path</span>
        <span class="grid-col grid-col-chunks" data-resize="chunks">Chunks</span>
        <span class="grid-col grid-col-date" data-resize="date">Indexed</span>
        <span class="grid-col grid-col-actions">Actions</span>
      </div>
      <div class="catalog-file-list">
        ${filtered.length === 0
          ? '<div class="catalog-empty-files">No files match filter</div>'
          : filtered.map(f => `
            <div class="catalog-file-item" data-path="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}">
              <span class="grid-col grid-col-icon">&#128196;</span>
              <span class="grid-col grid-col-path">${escapeHtml(f.relativePath)}</span>
              <span class="grid-col grid-col-chunks">${f.chunkCount}</span>
              <span class="grid-col grid-col-date">${formatDate(f.indexedAt)}</span>
              <span class="grid-col grid-col-actions">
                <button class="file-view-chunks-btn" data-path="${escapeHtml(f.path)}" title="View file chunks">
                  View
                </button>
              </span>
            </div>
          `).join('')
        }
      </div>
    </div>
  `;

  // Update header title
  modal.querySelector('.catalog-manager-header h2').textContent = 'Catalog: ' + displayName;

  // Update footer
  const footer = modal.querySelector('.catalog-manager-footer');
  footer.innerHTML = `
    <button class="catalog-manager-btn catalog-ask-btn" id="catalog-ask-btn">
      &#128172; Ask this Catalog
    </button>
    <button class="catalog-manager-btn" id="catalog-detail-refresh">Refresh</button>
    <button class="catalog-manager-btn catalog-manager-btn-close">Close</button>
  `;

  // Event listeners
  modal.querySelector('#catalog-back-btn').addEventListener('click', showCatalogList);
  modal.querySelector('#catalog-file-filter').addEventListener('input', (e) => {
    fileFilter = e.target.value;
    renderDetailView();
  });
  modal.querySelector('#catalog-file-sort').addEventListener('change', (e) => {
    fileSortBy = e.target.value;
    renderDetailView();
  });
  modal.querySelector('#catalog-ask-btn').addEventListener('click', () => openAskCatalog(selectedCatalog));
  modal.querySelector('#catalog-detail-refresh').addEventListener('click', () => refreshCatalogIndex(selectedCatalog));
  modal.querySelector('.catalog-manager-btn-close').addEventListener('click', hideCatalogManager);

  // View Chunks button listeners
  modal.querySelectorAll('.file-view-chunks-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const filePath = btn.dataset.path;
      showFileChunks(filePath);
    });
  });
}

/**
 * Sort files by the specified field
 */
function sortFiles(files, sortBy) {
  return [...files].sort((a, b) => {
    switch (sortBy) {
      case 'date':
        return new Date(b.indexedAt || 0) - new Date(a.indexedAt || 0);
      case 'chunks':
        return b.chunkCount - a.chunkCount;
      case 'name':
      default:
        return a.relativePath.localeCompare(b.relativePath);
    }
  });
}

/**
 * Render chunks into the viewer body (used by toggle to re-render)
 * @param {HTMLElement} body - The chunks-viewer-body element
 * @param {Array} chunks - Array of chunk objects
 */
function renderChunks(body, chunks) {
  const hasOverlap = chunks.some(c =>
    c.metadata?.overlapBefore || c.metadata?.overlapAfter
  );

  body.innerHTML = `
    <div class="chunks-summary">
      <span>${chunks.length} chunks</span>
      ${hasOverlap ? `
        <label class="chunks-overlap-toggle">
          <input type="checkbox" id="chunks-overlap-toggle" ${showOverlapContext ? 'checked' : ''}>
          Show context overlap
        </label>
      ` : ''}
    </div>
    <div class="chunks-list">
      ${chunks.map((chunk, idx) => {
        const overlapBefore = chunk.metadata?.overlapBefore || '';
        const overlapAfter = chunk.metadata?.overlapAfter || '';
        const structInfo = chunk.metadata?.structureType
          ? `<span class="chunk-structure">${escapeHtml(chunk.metadata.structureType)}${chunk.metadata.structureName ? ': ' + escapeHtml(chunk.metadata.structureName) : ''}</span>`
          : '';
        return `
          <div class="chunk-item">
            <div class="chunk-header">
              <span class="chunk-number">Chunk ${chunk.metadata?.chunkIndex !== undefined ? chunk.metadata.chunkIndex + 1 : idx + 1}${chunk.metadata?.totalChunks ? ' of ' + chunk.metadata.totalChunks : ''}</span>
              ${structInfo}
              <span class="chunk-chars">${chunk.charCount || chunk.text?.length || '?'} chars</span>
            </div>
            ${showOverlapContext && overlapBefore ? `<div class="chunk-overlap chunk-overlap-before">${escapeHtml(overlapBefore)}</div>` : ''}
            <div class="chunk-content">${escapeHtml(chunk.text || '')}</div>
            ${showOverlapContext && overlapAfter ? `<div class="chunk-overlap chunk-overlap-after">${escapeHtml(overlapAfter)}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Re-attach toggle listener
  const toggleEl = body.querySelector('#chunks-overlap-toggle');
  if (toggleEl) {
    toggleEl.addEventListener('change', (e) => {
      showOverlapContext = e.target.checked;
      renderChunks(body, chunks);
    });
  }
}

/**
 * Show file chunks in a modal overlay
 */
async function showFileChunks(filePath) {
  const fileName = filePath.split(/[\\/]/).pop();
  showOverlapContext = false;

  // Create chunks viewer overlay
  const overlay = document.createElement('div');
  overlay.className = 'chunks-viewer-overlay';
  overlay.innerHTML = `
    <div class="chunks-viewer-dialog">
      <div class="chunks-viewer-header">
        <h3>File Chunks: ${escapeHtml(fileName)}</h3>
        <button class="chunks-viewer-close">&times;</button>
      </div>
      <div class="chunks-viewer-body">
        <div class="chunks-loading">Loading chunks...</div>
      </div>
      <div class="chunks-viewer-footer">
        <span class="chunks-path" title="${escapeHtml(filePath)}">${escapeHtml(filePath)}</span>
        <button class="catalog-manager-btn chunks-close-btn">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Event listeners
  const closeOverlay = () => overlay.remove();
  overlay.querySelector('.chunks-viewer-close').addEventListener('click', closeOverlay);
  overlay.querySelector('.chunks-close-btn').addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });

  // Load chunks
  try {
    const result = await window.electronAPI.vectordbGetFileChunks({
      catalogName: selectedCatalog,
      filePath: filePath
    });

    const body = overlay.querySelector('.chunks-viewer-body');

    if (!result.success || !result.chunks || result.chunks.length === 0) {
      body.innerHTML = `<div class="chunks-empty">No chunks found for this file.</div>`;
      return;
    }

    renderChunks(body, result.chunks);
  } catch (error) {
    console.error('[Catalog Manager] Failed to load chunks:', error);
    const body = overlay.querySelector('.chunks-viewer-body');
    body.innerHTML = `<div class="chunks-error">Failed to load chunks: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Go back to catalog list view
 */
function showCatalogList() {
  currentView = 'list';
  selectedCatalog = null;
  catalogFiles = [];
  askCatalogOpen = false;

  const modal = document.getElementById('catalog-manager-modal');
  if (!modal) return;

  // Reset header
  modal.querySelector('.catalog-manager-header h2').textContent = 'Manage Catalogs';

  // Remove ask panel if present
  const askPanel = modal.querySelector('.ask-catalog-panel');
  if (askPanel) askPanel.remove();

  // Remove ask-open class from dialog
  modal.querySelector('.catalog-manager-dialog')?.classList.remove('ask-open');

  // Reload catalogs
  catalogFilter = '';
  const body = modal.querySelector('.catalog-manager-body');
  body.innerHTML = `
    <div class="catalog-search-bar hidden">
      <input type="text" class="catalog-search-input" id="catalog-search-input"
             placeholder="Search catalogs...">
    </div>
    <div class="catalog-manager-loading hidden">Loading catalogs...</div>
    <div class="catalog-manager-list hidden"></div>
    <div class="catalog-manager-empty hidden">
      <p>No catalogs found.</p>
      <p class="hint">Use the File Browser to create catalogs by right-clicking folders.</p>
    </div>
  `;

  // Reset footer
  const footer = modal.querySelector('.catalog-manager-footer');
  footer.innerHTML = `
    <button class="catalog-manager-btn" id="catalog-manager-refresh">Refresh</button>
    <button class="catalog-manager-btn catalog-manager-btn-close">Close</button>
  `;

  footer.querySelector('#catalog-manager-refresh').addEventListener('click', loadCatalogs);
  footer.querySelector('.catalog-manager-btn-close').addEventListener('click', hideCatalogManager);

  loadCatalogs();
}

/**
 * Open the Ask Catalog chat panel
 */
function openAskCatalog(catalogName) {
  askCatalogOpen = true;
  askCatalogName = catalogName;
  askCatalogMessages = [];
  askCatalogLoading = false;

  renderAskCatalogPanel();
}

/**
 * Close the Ask Catalog panel
 */
function closeAskCatalog() {
  askCatalogOpen = false;
  askCatalogMessages = [];

  const modal = document.getElementById('catalog-manager-modal');
  if (!modal) return;

  const panel = modal.querySelector('.ask-catalog-panel');
  if (panel) {
    panel.classList.remove('visible');
    setTimeout(() => panel.remove(), 200);
  }

  modal.querySelector('.catalog-manager-dialog')?.classList.remove('ask-open');
}

/**
 * Render the Ask Catalog chat panel
 */
function renderAskCatalogPanel() {
  const modal = document.getElementById('catalog-manager-modal');
  if (!modal) return;

  const dialog = modal.querySelector('.catalog-manager-dialog');
  const catalog = catalogs.find(c => c.name === askCatalogName);
  const displayName = catalog?.displayName || askCatalogName;

  // Create or update panel
  let panel = modal.querySelector('.ask-catalog-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'ask-catalog-panel';
    dialog.appendChild(panel);
  }

  panel.innerHTML = `
    <div class="ask-catalog-header">
      <span class="ask-catalog-title">Ask: ${escapeHtml(displayName)}</span>
      <button class="ask-catalog-close" id="ask-catalog-close">&times;</button>
    </div>

    <div class="ask-catalog-messages" id="ask-catalog-messages">
      ${askCatalogMessages.length === 0 ? `
        <div class="ask-catalog-welcome">
          <p>Ask questions about files in this catalog.</p>
          <p class="hint">Try: "How do I configure X?" or "What is Y?"</p>
        </div>
      ` : askCatalogMessages.map(m => `
        <div class="ask-message ${m.role}">
          <div class="ask-message-content">${m.role === 'user' ? escapeHtml(m.content) : renderMarkdownSimple(m.content)}</div>
          ${m.sources ? `<div class="ask-sources">${escapeHtml(m.sources)}</div>` : ''}
        </div>
      `).join('')}
      ${askCatalogLoading ? '<div class="ask-loading"><span class="spinner"></span> Thinking...</div>' : ''}
    </div>

    <div class="ask-catalog-input">
      <input type="text" id="ask-catalog-input" placeholder="Ask a question..."
             ${askCatalogLoading ? 'disabled' : ''}>
      <button id="ask-catalog-send" ${askCatalogLoading ? 'disabled' : ''}>Send</button>
    </div>
  `;

  // Add event listeners
  panel.querySelector('#ask-catalog-close').addEventListener('click', closeAskCatalog);
  panel.querySelector('#ask-catalog-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendAskCatalog();
  });
  panel.querySelector('#ask-catalog-send').addEventListener('click', sendAskCatalog);

  // Show panel with animation
  dialog.classList.add('ask-open');
  setTimeout(() => panel.classList.add('visible'), 10);

  // Scroll to bottom of messages
  const messages = panel.querySelector('#ask-catalog-messages');
  if (messages) messages.scrollTop = messages.scrollHeight;

  // Focus input
  if (!askCatalogLoading) {
    panel.querySelector('#ask-catalog-input')?.focus();
  }
}

/**
 * Race a promise against a timeout
 * @param {Promise} promise - Promise to race
 * @param {number} ms - Timeout in milliseconds
 * @param {string} label - Label for timeout error message
 * @returns {Promise} Result of the promise or timeout rejection
 */
function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

/**
 * Send a question to the Ask Catalog chat
 */
async function sendAskCatalog() {
  const input = document.getElementById('ask-catalog-input');
  const question = input?.value.trim();
  if (!question || askCatalogLoading) return;

  askCatalogMessages.push({ role: 'user', content: question });
  input.value = '';
  askCatalogLoading = true;
  renderAskCatalogPanel();

  try {
    // Step 1: Search catalog for relevant context (30s timeout)
    console.log('[Ask Catalog] Searching catalog:', askCatalogName);
    const searchResult = await withTimeout(
      window.electronAPI.vectordbSearch({
        collectionName: askCatalogName,
        query: question,
        options: { limit: 8, minScore: 0.25 }
      }),
      30000,
      'Catalog search'
    );
    console.log('[Ask Catalog] Search result:', searchResult.success, searchResult.results?.length || 0, 'results');

    const ragContext = searchResult.success ? searchResult.results : [];

    // Step 2: Send to LLM with RAG context (60s timeout)
    console.log('[Ask Catalog] Sending to LLM with', ragContext.length, 'context chunks');
    const response = await withTimeout(
      window.electronAPI.geminiSendMessage({
        message: question,
        articleContent: '',
        mode: 'qa',
        ragContext: ragContext
      }),
      60000,
      'LLM response'
    );
    console.log('[Ask Catalog] LLM response:', response.success);

    if (response.success && response.text) {
      let sources = '';
      if (ragContext.length > 0) {
        const uniqueFiles = [...new Set(ragContext.map(r => r.metadata?.filePath || r.metadata?.relativePath || r.metadata?.fileName || 'Unknown'))];
        sources = `Sources: ${uniqueFiles.slice(0, 3).join(', ')}${uniqueFiles.length > 3 ? ` (+${uniqueFiles.length - 3} more)` : ''}`;
      }
      askCatalogMessages.push({ role: 'assistant', content: response.text, sources });
    } else {
      askCatalogMessages.push({
        role: 'error',
        content: response.error || 'Failed to get response'
      });
    }
  } catch (error) {
    console.error('[Ask Catalog] Error:', error);
    askCatalogMessages.push({
      role: 'error',
      content: `Error: ${error.message}`
    });
  } finally {
    askCatalogLoading = false;
    renderAskCatalogPanel();
  }
}

/**
 * Simple markdown renderer for chat responses
 */
function renderMarkdownSimple(text) {
  if (!text) return '';

  // Escape HTML first
  let html = escapeHtml(text);

  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

/**
 * Shorten a file path for display
 */
function shortenPath(filePath) {
  if (filePath.length <= 50) return filePath;
  const parts = filePath.split(/[\\/]/);
  if (parts.length <= 3) return filePath;
  return parts[0] + '/.../' + parts.slice(-2).join('/');
}

/**
 * Format a date for display
 */
function formatDate(isoString) {
  if (!isoString) return 'Unknown';
  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Delete a catalog
 */
async function deleteCatalog(name) {
  const confirmed = await showConfirmationDialog({
    title: 'Delete Catalog',
    message: `Are you sure you want to delete the catalog "${name}"?`,
    detail: 'This will remove the index but will not delete any files.',
    confirmText: 'Delete',
    isDanger: true
  });
  if (!confirmed) return;

  // Show immediate visual feedback
  const modal = document.getElementById('catalog-manager-modal');
  const item = modal?.querySelector(`.catalog-item[data-name="${name}"]`);
  if (item) {
    item.classList.add('deleting');
    item.insertAdjacentHTML('beforeend',
      '<div class="catalog-item-overlay"><span class="loading-spinner-small"></span> Deleting...</div>'
    );
  }

  try {
    // If this is a persona catalog, delete the persona metadata too
    if (name.startsWith('persona-') && window.electronAPI.personaDelete) {
      const personaName = name.replace(/^persona-/, '');
      await window.electronAPI.personaDelete({ name: personaName, deleteCatalog: true }).catch(err => {
        console.warn('[Catalog Manager] Persona cleanup for catalog:', err.message);
      });
      // personaDelete with deleteCatalog:true handles both persona + catalog deletion
      // Refresh persona selector if available
      document.dispatchEvent(new CustomEvent('persona:deleted', { detail: { name: personaName } }));
    } else {
      // Non-persona catalog: just delete the catalog
      const result = await window.electronAPI.vectordbDeleteCollection({ name });
      if (!result.success) {
        if (item) {
          item.classList.remove('deleting');
          item.querySelector('.catalog-item-overlay')?.remove();
        }
        await showAlertDialog({ title: 'Delete Failed', message: `Failed to delete catalog: ${result.error}` });
        return;
      }
      document.dispatchEvent(new CustomEvent('catalog:deleted', { detail: { name } }));
    }

    // Fade out then reload
    if (item) {
      item.style.transition = 'opacity 0.2s, max-height 0.3s';
      item.style.opacity = '0';
      item.style.maxHeight = item.offsetHeight + 'px';
      setTimeout(() => {
        item.style.maxHeight = '0';
        item.style.padding = '0';
        item.style.margin = '0';
        item.style.overflow = 'hidden';
      }, 100);
      setTimeout(() => loadCatalogs(), 350);
    } else {
      loadCatalogs();
    }
  } catch (error) {
    console.error('[Catalog Manager] Delete failed:', error);
    if (item) {
      item.classList.remove('deleting');
      item.querySelector('.catalog-item-overlay')?.remove();
    }
    await showAlertDialog({ title: 'Delete Failed', message: `Failed to delete catalog: ${error.message}` });
  }
}

/**
 * Rebuild a catalog (full re-index)
 */
async function rebuildCatalog(name) {
  const confirmed = await showConfirmationDialog({
    title: 'Rebuild Catalog',
    message: `Rebuild catalog "${name}"?`,
    detail: 'This will re-index all files from scratch.',
    confirmText: 'Rebuild'
  });
  if (!confirmed) return;

  const modal = document.getElementById('catalog-manager-modal');
  const item = modal?.querySelector(`[data-name="${name}"]`);

  try {
    // Show progress
    if (item) {
      item.classList.add('rebuilding');
      const actionsDiv = item.querySelector('.catalog-item-actions');
      if (actionsDiv) {
        actionsDiv.innerHTML = '<span class="catalog-progress">Rebuilding...</span>';
      }
    }

    // Setup progress listener
    const progressHandler = (progress) => {
      if (progress.catalog !== name && progress.collection !== name) return;

      const progressEl = item?.querySelector('.catalog-progress');
      if (!progressEl) return;

      if (progress.type === 'scanning') {
        progressEl.textContent = progress.message || 'Scanning...';
      } else if (progress.type === 'processing') {
        progressEl.textContent = `${progress.file || ''} (${progress.processed}/${progress.total})`;
      } else if (progress.type === 'embedding') {
        progressEl.textContent = `Embedding... ${progress.percent || 0}%`;
      }
    };

    window.electronAPI.onVectordbIndexProgress(progressHandler);

    const result = await window.electronAPI.vectordbRebuildIndex({ collectionName: name });

    window.electronAPI.removeVectordbIndexProgressListener();

    if (result.success) {
      loadCatalogs();
    } else {
      await showAlertDialog({ title: 'Rebuild Failed', message: `Rebuild failed: ${result.error}` });
      loadCatalogs();
    }
  } catch (error) {
    console.error('[Catalog Manager] Rebuild failed:', error);
    await showAlertDialog({ title: 'Rebuild Failed', message: `Rebuild failed: ${error.message}` });
    window.electronAPI.removeVectordbIndexProgressListener?.();
    loadCatalogs();
  }
}

/**
 * Refresh a catalog (smart refresh - detect changes)
 */
async function refreshCatalogIndex(name) {
  const modal = document.getElementById('catalog-manager-modal');
  const item = modal?.querySelector(`[data-name="${name}"]`);

  try {
    // Show progress
    if (item) {
      item.classList.add('refreshing');
      const actionsDiv = item.querySelector('.catalog-item-actions');
      if (actionsDiv) {
        actionsDiv.innerHTML = '<span class="catalog-progress">Refreshing...</span>';
      }
    }

    // Setup progress listener
    const progressHandler = (progress) => {
      if (progress.catalog !== name && progress.collection !== name) return;

      const progressEl = item?.querySelector('.catalog-progress');
      if (!progressEl) return;

      if (progress.type === 'scanning') {
        progressEl.textContent = progress.message || 'Scanning...';
      } else if (progress.type === 'analyzing') {
        progressEl.textContent = progress.message || 'Analyzing...';
      } else if (progress.type === 'processing') {
        const action = progress.action || '';
        progressEl.textContent = `${action} ${progress.file || ''} (${progress.processed}/${progress.total})`;
      } else if (progress.type === 'embedding') {
        progressEl.textContent = `Embedding... ${progress.percent || 0}%`;
      }
    };

    window.electronAPI.onVectordbIndexProgress(progressHandler);

    const result = await window.electronAPI.vectordbRefreshCatalog({ catalogName: name });

    window.electronAPI.removeVectordbIndexProgressListener();

    if (result.success) {
      const summary = [];
      if (result.added > 0) summary.push(`${result.added} added`);
      if (result.removed > 0) summary.push(`${result.removed} removed`);
      if (result.updated > 0) summary.push(`${result.updated} updated`);
      if (result.unchanged > 0) summary.push(`${result.unchanged} unchanged`);
      if (result.binarySkipped > 0) summary.push(`${result.binarySkipped} binary files skipped`);

      if (summary.length > 0) {
        await showAlertDialog({ title: 'Refresh Complete', message: `Refresh complete: ${summary.join(', ')}` });
      } else {
        await showAlertDialog({ title: 'Refresh Complete', message: 'Refresh complete: No changes detected.' });
      }

      // If in detail view, refresh the file list
      if (currentView === 'detail' && selectedCatalog === name) {
        showCatalogDetail(name);
      } else {
        loadCatalogs();
      }
    } else {
      await showAlertDialog({ title: 'Refresh Failed', message: `Refresh failed: ${result.error}` });
      loadCatalogs();
    }
  } catch (error) {
    console.error('[Catalog Manager] Refresh failed:', error);
    await showAlertDialog({ title: 'Refresh Failed', message: `Refresh failed: ${error.message}` });
    window.electronAPI.removeVectordbIndexProgressListener?.();
    loadCatalogs();
  }
}
