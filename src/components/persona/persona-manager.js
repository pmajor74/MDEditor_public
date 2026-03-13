/**
 * Persona Manager Component
 *
 * Modal dialog for managing AI personas.
 * Allows viewing, editing, re-analyzing, and deleting personas.
 * Shows style profile, system prompt, catalog stats, and source config.
 */

let managerOptions = {};
let personas = [];
let catalogStats = {};
let currentView = 'list'; // 'list' | 'detail'
let selectedPersonaName = null;
let selectedPersona = null;

// File list state for detail view
let personaFiles = [];
let filesExpanded = false;
let personaFileFilter = '';
let personaFileSortBy = 'name';
let showOverlapContext = false;

/**
 * Show the persona manager modal
 * @param {Object} options - Options
 * @param {Function} options.onClose - Callback when modal closes
 */
export function showPersonaManager(options = {}) {
  managerOptions = options;

  // Reset state
  currentView = 'list';
  selectedPersonaName = null;
  selectedPersona = null;

  // Remove existing modal if present
  hidePersonaManager();

  const modal = document.createElement('div');
  modal.id = 'persona-manager-modal';
  modal.className = 'persona-mgr-overlay';
  modal.innerHTML = `
    <div class="persona-mgr-dialog">
      <div class="persona-mgr-header">
        <h2>Manage Personas</h2>
        <button class="persona-mgr-close">&times;</button>
      </div>
      <div class="persona-mgr-body">
        <div class="persona-mgr-loading">Loading personas...</div>
        <div class="persona-mgr-list hidden"></div>
        <div class="persona-mgr-empty hidden">
          <p>No personas found.</p>
          <p class="hint">Use the Persona Wizard to create new personas.</p>
        </div>
      </div>
      <div class="persona-mgr-footer">
        <button class="persona-mgr-btn" id="persona-mgr-refresh">Refresh</button>
        <button class="persona-mgr-btn persona-mgr-btn-close">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  modal.querySelector('.persona-mgr-close').addEventListener('click', hidePersonaManager);
  modal.querySelector('.persona-mgr-btn-close').addEventListener('click', hidePersonaManager);
  modal.querySelector('#persona-mgr-refresh').addEventListener('click', loadPersonas);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hidePersonaManager();
  });

  loadPersonas();
}

/**
 * Hide the persona manager modal
 */
export function hidePersonaManager() {
  const modal = document.getElementById('persona-manager-modal');
  if (modal) {
    modal.remove();
    if (managerOptions.onClose) {
      managerOptions.onClose();
    }
  }
}

/**
 * Load personas and catalog stats
 */
async function loadPersonas() {
  const modal = document.getElementById('persona-manager-modal');
  if (!modal) return;

  const loading = modal.querySelector('.persona-mgr-loading');
  const list = modal.querySelector('.persona-mgr-list');
  const empty = modal.querySelector('.persona-mgr-empty');

  loading.classList.remove('hidden');
  list.classList.add('hidden');
  empty.classList.add('hidden');

  try {
    const [personaResult, collectionsResult] = await Promise.all([
      window.electronAPI.personaGetAll(),
      window.electronAPI.vectordbGetCollections()
    ]);

    // Build catalog stats lookup
    catalogStats = {};
    if (collectionsResult.success && collectionsResult.collections) {
      for (const col of collectionsResult.collections) {
        catalogStats[col.name] = {
          fileCount: col.fileCount || 0,
          chunkCount: col.documentCount || 0,
          lastUpdated: col.lastUpdated
        };
      }
    }

    personas = personaResult.success ? (personaResult.personas || []) : [];

    loading.classList.add('hidden');

    if (personas.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    list.classList.remove('hidden');
    renderPersonaList();
  } catch (error) {
    console.error('[Persona Manager] Failed to load personas:', error);
    loading.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.innerHTML = `<p class="error">Failed to load personas: ${error.message}</p>`;
  }
}

/**
 * Render the persona list
 */
function renderPersonaList() {
  const modal = document.getElementById('persona-manager-modal');
  if (!modal) return;

  const list = modal.querySelector('.persona-mgr-list');
  if (!list) return;

  list.innerHTML = personas.map(p => renderPersonaItem(p)).join('');
  attachListListeners(list);
}

/**
 * Render a single persona item
 */
function renderPersonaItem(persona) {
  const stats = catalogStats[persona.catalogName] || {};
  const fileCount = stats.fileCount || 0;
  const chunkCount = stats.chunkCount || 0;
  const created = persona.createdAt ? new Date(persona.createdAt).toLocaleDateString() : 'Unknown';
  const updated = persona.lastUpdated ? new Date(persona.lastUpdated).toLocaleDateString() : 'Unknown';

  return `
    <div class="persona-mgr-item" data-name="${escapeHtml(persona.name)}">
      <div class="persona-mgr-item-header">
        <div class="persona-mgr-item-title">
          <span class="persona-mgr-name">${escapeHtml(persona.displayName)}</span>
          ${persona.hasStyleProfile
            ? '<span class="persona-mgr-badge active">Active</span>'
            : '<span class="persona-mgr-badge no-profile">No profile</span>'}
        </div>
        <button class="persona-mgr-view-btn persona-action-view" title="View persona details">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          View
        </button>
      </div>
      ${persona.description ? `<div class="persona-mgr-desc">${escapeHtml(persona.description)}</div>` : ''}
      <div class="persona-mgr-item-details">
        <span class="persona-mgr-stat">${fileCount} files, ${chunkCount} chunks</span>
        <span class="persona-mgr-meta">Created: ${created} | Updated: ${updated}</span>
      </div>
      <div class="persona-mgr-item-actions">
        <button class="persona-mgr-action-btn persona-action-reanalyze" title="Re-analyze writing style">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6"/>
            <path d="M3 12a9 9 0 0115-6.7L21 8"/>
            <path d="M3 22v-6h6"/>
            <path d="M21 12a9 9 0 01-15 6.7L3 16"/>
          </svg>
          Re-analyze
        </button>
        <button class="persona-mgr-action-btn danger persona-action-delete" title="Delete persona">
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
 * Attach event listeners to list items
 */
function attachListListeners(list) {
  list.querySelectorAll('.persona-mgr-item').forEach(item => {
    const name = item.dataset.name;

    item.querySelector('.persona-action-view')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showPersonaDetail(name);
    });

    item.querySelector('.persona-action-reanalyze')?.addEventListener('click', (e) => {
      e.stopPropagation();
      reanalyzeStyle(name);
    });

    item.querySelector('.persona-action-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePersona(name);
    });
  });
}

/**
 * Show detail view for a persona
 */
async function showPersonaDetail(name) {
  const modal = document.getElementById('persona-manager-modal');
  if (!modal) return;

  currentView = 'detail';
  selectedPersonaName = name;
  personaFiles = [];
  filesExpanded = false;
  personaFileFilter = '';
  personaFileSortBy = 'name';

  const body = modal.querySelector('.persona-mgr-body');
  body.innerHTML = '<div class="persona-mgr-loading">Loading persona...</div>';

  try {
    const result = await window.electronAPI.personaGet(name);
    if (!result.success || !result.persona) {
      body.innerHTML = `<div class="persona-mgr-empty"><p class="error">Failed to load persona: ${result.error || 'Not found'}</p></div>`;
      return;
    }

    selectedPersona = result.persona;
    renderDetailView();
  } catch (error) {
    console.error('[Persona Manager] Failed to load persona detail:', error);
    body.innerHTML = `<div class="persona-mgr-empty"><p class="error">Failed to load persona: ${error.message}</p></div>`;
  }
}

/**
 * Render the detail view
 */
function renderDetailView() {
  const modal = document.getElementById('persona-manager-modal');
  if (!modal || !selectedPersona) return;

  const p = selectedPersona;
  const stats = catalogStats[p.catalogName] || {};
  const profile = p.styleProfile;

  // Update header
  modal.querySelector('.persona-mgr-header h2').textContent = p.displayName;

  const body = modal.querySelector('.persona-mgr-body');
  body.innerHTML = `
    <div class="persona-mgr-detail">
      <button class="persona-mgr-back-btn" id="persona-back-btn">&larr; Back to list</button>

      <div class="persona-mgr-detail-header">
        <div class="persona-mgr-detail-field">
          <label>Display Name</label>
          <input type="text" id="persona-edit-name" class="persona-mgr-input"
                 value="${escapeHtml(p.displayName)}" />
        </div>
        <div class="persona-mgr-detail-field">
          <label>Description</label>
          <input type="text" id="persona-edit-desc" class="persona-mgr-input"
                 value="${escapeHtml(p.description || '')}"
                 placeholder="Short description of this persona" />
        </div>
      </div>

      <div class="persona-mgr-section">
        <h3>Style Profile</h3>
        ${profile ? renderStyleProfile(profile) : '<p class="persona-mgr-no-data">No style profile yet. Click "Re-analyze Style" to generate one.</p>'}
      </div>

      <div class="persona-mgr-section">
        <h3>System Prompt</h3>
        <textarea id="persona-edit-prompt" class="persona-mgr-prompt-editor"
                  rows="8" placeholder="Custom system prompt template...">${escapeHtml(p.systemPromptTemplate || '')}</textarea>
      </div>

      <div class="persona-mgr-section">
        <h3>Catalog Info</h3>
        <div class="persona-mgr-catalog-info">
          <div class="persona-mgr-info-row">
            <span class="persona-mgr-info-label">Catalog Name:</span>
            <span class="persona-mgr-info-value">${escapeHtml(p.catalogName)}</span>
          </div>
          <div class="persona-mgr-info-row">
            <span class="persona-mgr-info-label">Files:</span>
            <span class="persona-mgr-info-value">${stats.fileCount || 0}</span>
          </div>
          <div class="persona-mgr-info-row">
            <span class="persona-mgr-info-label">Chunks:</span>
            <span class="persona-mgr-info-value">${stats.chunkCount || 0}</span>
          </div>
          <div class="persona-mgr-info-row">
            <span class="persona-mgr-info-label">Source Path:</span>
            <span class="persona-mgr-info-value">${escapeHtml(p.rootPath || 'Not set')}</span>
          </div>
          <div class="persona-mgr-info-row">
            <span class="persona-mgr-info-label">Extensions:</span>
            <span class="persona-mgr-info-value">${(p.extensions || []).join(', ') || 'Default'}</span>
          </div>
          <div class="persona-mgr-info-row">
            <span class="persona-mgr-info-label">Last Indexed:</span>
            <span class="persona-mgr-info-value">${stats.lastUpdated ? new Date(stats.lastUpdated).toLocaleString() : 'Never'}</span>
          </div>
        </div>
        <button class="persona-mgr-files-toggle" id="persona-files-toggle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
          </svg>
          ${filesExpanded ? 'Hide Files' : 'View Files'}
        </button>
        <div class="persona-mgr-file-list ${filesExpanded ? '' : 'hidden'}" id="persona-file-list-container"></div>
      </div>
    </div>
  `;

  // Update footer for detail view
  const footer = modal.querySelector('.persona-mgr-footer');
  footer.innerHTML = `
    <button class="persona-mgr-btn persona-mgr-btn-reanalyze" id="persona-detail-reanalyze">Re-analyze Style</button>
    <button class="persona-mgr-btn persona-mgr-btn-save" id="persona-detail-save">Save Changes</button>
    <button class="persona-mgr-btn persona-mgr-btn-close">Close</button>
  `;

  // Event listeners
  modal.querySelector('#persona-back-btn').addEventListener('click', showPersonaList);
  modal.querySelector('#persona-detail-reanalyze').addEventListener('click', () => reanalyzeStyle(selectedPersonaName));
  modal.querySelector('#persona-detail-save').addEventListener('click', () => savePersonaChanges(selectedPersonaName));
  modal.querySelector('.persona-mgr-btn-close').addEventListener('click', hidePersonaManager);
  modal.querySelector('#persona-files-toggle').addEventListener('click', () => toggleFileList());

  // If files were already expanded, re-render the file list
  if (filesExpanded && personaFiles.length > 0) {
    renderFileList();
  }
}

/**
 * Render style profile as a readable grid
 */
function renderStyleProfile(profile) {
  const fields = [
    { label: 'Writing Style', key: 'writingStyle' },
    { label: 'Tone', key: 'tone' },
    { label: 'Philosophical Outlook', key: 'philosophicalOutlook' },
    { label: 'Communication Patterns', key: 'communicationPatterns' }
  ];

  const tagFields = [
    { label: 'Vocabulary', key: 'vocabulary' },
    { label: 'Key Phrases', key: 'keyPhrases' },
    { label: 'Common Metaphors', key: 'commonMetaphors' }
  ];

  let html = '<div class="persona-mgr-profile-grid">';

  for (const field of fields) {
    const value = profile[field.key];
    if (value) {
      html += `
        <div class="persona-mgr-profile-field">
          <strong>${field.label}</strong>
          <p>${escapeHtml(typeof value === 'string' ? value : JSON.stringify(value))}</p>
        </div>
      `;
    }
  }

  for (const field of tagFields) {
    const values = profile[field.key];
    if (values && Array.isArray(values) && values.length > 0) {
      html += `
        <div class="persona-mgr-profile-field persona-mgr-profile-tags">
          <strong>${field.label}</strong>
          <div class="persona-mgr-tags">
            ${values.map(v => `<span class="persona-mgr-tag">${escapeHtml(v)}</span>`).join('')}
          </div>
        </div>
      `;
    } else if (values && typeof values === 'string') {
      html += `
        <div class="persona-mgr-profile-field">
          <strong>${field.label}</strong>
          <p>${escapeHtml(values)}</p>
        </div>
      `;
    }
  }

  html += '</div>';
  return html;
}

/**
 * Go back to the list view
 */
function showPersonaList() {
  currentView = 'list';
  selectedPersonaName = null;
  selectedPersona = null;
  personaFiles = [];
  filesExpanded = false;
  personaFileFilter = '';
  personaFileSortBy = 'name';

  const modal = document.getElementById('persona-manager-modal');
  if (!modal) return;

  // Reset header
  modal.querySelector('.persona-mgr-header h2').textContent = 'Manage Personas';

  // Reset body
  const body = modal.querySelector('.persona-mgr-body');
  body.innerHTML = `
    <div class="persona-mgr-loading hidden">Loading personas...</div>
    <div class="persona-mgr-list hidden"></div>
    <div class="persona-mgr-empty hidden">
      <p>No personas found.</p>
      <p class="hint">Use the Persona Wizard to create new personas.</p>
    </div>
  `;

  // Reset footer
  const footer = modal.querySelector('.persona-mgr-footer');
  footer.innerHTML = `
    <button class="persona-mgr-btn" id="persona-mgr-refresh">Refresh</button>
    <button class="persona-mgr-btn persona-mgr-btn-close">Close</button>
  `;

  footer.querySelector('#persona-mgr-refresh').addEventListener('click', loadPersonas);
  footer.querySelector('.persona-mgr-btn-close').addEventListener('click', hidePersonaManager);

  loadPersonas();
}

/**
 * Save edited persona changes (display name, description, system prompt)
 */
async function savePersonaChanges(name) {
  const modal = document.getElementById('persona-manager-modal');
  if (!modal) return;

  const displayName = modal.querySelector('#persona-edit-name')?.value.trim();
  const description = modal.querySelector('#persona-edit-desc')?.value.trim();
  const systemPromptTemplate = modal.querySelector('#persona-edit-prompt')?.value;

  if (!displayName) {
    alert('Display name cannot be empty.');
    return;
  }

  const saveBtn = modal.querySelector('#persona-detail-save');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const result = await window.electronAPI.personaUpdate({
      name,
      updates: { displayName, description, systemPromptTemplate }
    });

    if (result.success) {
      if (saveBtn) {
        saveBtn.textContent = 'Saved!';
        setTimeout(() => {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
          }
        }, 1500);
      }

      // Update local data
      selectedPersona = { ...selectedPersona, displayName, description, systemPromptTemplate };
      modal.querySelector('.persona-mgr-header h2').textContent = displayName;

      // Notify other components
      document.dispatchEvent(new CustomEvent('persona:updated', { detail: { name } }));
    } else {
      alert(`Failed to save: ${result.error}`);
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    }
  } catch (error) {
    console.error('[Persona Manager] Save failed:', error);
    alert(`Failed to save: ${error.message}`);
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
}

/**
 * Re-analyze writing style for a persona
 */
async function reanalyzeStyle(name) {
  const modal = document.getElementById('persona-manager-modal');
  if (!modal) return;

  // Find the action button (could be in list or detail view)
  const listItem = modal.querySelector(`.persona-mgr-item[data-name="${name}"]`);
  const detailBtn = modal.querySelector('#persona-detail-reanalyze');

  // Show progress feedback
  if (listItem) {
    const reanalyzeBtn = listItem.querySelector('.persona-action-reanalyze');
    if (reanalyzeBtn) {
      reanalyzeBtn.disabled = true;
      reanalyzeBtn.innerHTML = '<span class="persona-mgr-spinner"></span> Analyzing...';
    }
  }
  if (detailBtn) {
    detailBtn.disabled = true;
    detailBtn.textContent = 'Analyzing...';
  }

  try {
    // Look up persona details for the IPC call
    const persona = personas.find(p => p.name === name) || selectedPersona;
    const catalogName = persona?.catalogName;
    const displayName = persona?.displayName || name;

    if (!catalogName) {
      alert('Cannot re-analyze: persona catalog name not found.');
      resetReanalyzeButton(listItem, detailBtn);
      return;
    }

    const result = await window.electronAPI.personaAnalyzeStyle({
      personaName: name,
      catalogName,
      displayName
    });

    if (result.success) {
      alert('Style analysis complete! Profile has been updated.');

      // Refresh the view
      if (currentView === 'detail' && selectedPersonaName === name) {
        await showPersonaDetail(name);
      } else {
        await loadPersonas();
      }

      document.dispatchEvent(new CustomEvent('persona:updated', { detail: { name } }));
    } else {
      alert(`Style analysis failed: ${result.error}`);
      resetReanalyzeButton(listItem, detailBtn);
    }
  } catch (error) {
    console.error('[Persona Manager] Re-analyze failed:', error);
    alert(`Style analysis failed: ${error.message}`);
    resetReanalyzeButton(listItem, detailBtn);
  }
}

/**
 * Reset reanalyze button state after error
 */
function resetReanalyzeButton(listItem, detailBtn) {
  if (listItem) {
    const reanalyzeBtn = listItem.querySelector('.persona-action-reanalyze');
    if (reanalyzeBtn) {
      reanalyzeBtn.disabled = false;
      reanalyzeBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 2v6h-6"/>
          <path d="M3 12a9 9 0 0115-6.7L21 8"/>
          <path d="M3 22v-6h6"/>
          <path d="M21 12a9 9 0 01-15 6.7L3 16"/>
        </svg>
        Re-analyze
      `;
    }
  }
  if (detailBtn) {
    detailBtn.disabled = false;
    detailBtn.textContent = 'Re-analyze Style';
  }
}

/**
 * Delete a persona with confirmation
 */
async function deletePersona(name) {
  const persona = personas.find(p => p.name === name);
  const displayName = persona?.displayName || name;

  const confirmed = confirm(
    `Delete persona "${displayName}"?\n\nThis will remove the persona and its associated catalog.`
  );
  if (!confirmed) return;

  const modal = document.getElementById('persona-manager-modal');
  const item = modal?.querySelector(`.persona-mgr-item[data-name="${name}"]`);

  if (item) {
    item.classList.add('deleting');
    item.insertAdjacentHTML('beforeend',
      '<div class="persona-mgr-item-overlay"><span class="persona-mgr-spinner"></span> Deleting...</div>'
    );
  }

  try {
    const result = await window.electronAPI.personaDelete({ name, deleteCatalog: true });

    if (result.success) {
      document.dispatchEvent(new CustomEvent('persona:deleted', { detail: { name } }));

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
        setTimeout(() => loadPersonas(), 350);
      } else {
        loadPersonas();
      }
    } else {
      if (item) {
        item.classList.remove('deleting');
        item.querySelector('.persona-mgr-item-overlay')?.remove();
      }
      alert(`Failed to delete persona: ${result.error}`);
    }
  } catch (error) {
    console.error('[Persona Manager] Delete failed:', error);
    if (item) {
      item.classList.remove('deleting');
      item.querySelector('.persona-mgr-item-overlay')?.remove();
    }
    alert(`Failed to delete persona: ${error.message}`);
  }
}

/**
 * Toggle the file list in the detail view
 */
async function toggleFileList() {
  filesExpanded = !filesExpanded;

  const modal = document.getElementById('persona-manager-modal');
  if (!modal) return;

  const toggleBtn = modal.querySelector('#persona-files-toggle');
  const container = modal.querySelector('#persona-file-list-container');

  if (!filesExpanded) {
    toggleBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>
      View Files
    `;
    container.classList.add('hidden');
    return;
  }

  toggleBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
    Hide Files
  `;
  container.classList.remove('hidden');

  // Load files if not already loaded
  if (personaFiles.length === 0) {
    container.innerHTML = '<div class="persona-mgr-loading">Loading files...</div>';
    try {
      const result = await window.electronAPI.vectordbGetCatalogMeta({
        catalogName: selectedPersona.catalogName
      });

      if (!result.success || !result.meta) {
        container.innerHTML = `<p class="error">Failed to load files: ${result.error || 'Not found'}</p>`;
        return;
      }

      personaFiles = Object.entries(result.meta.files || {}).map(([filePath, info]) => ({
        path: filePath,
        relativePath: info.relativePath || filePath,
        chunkCount: info.chunkCount || 0,
        indexedAt: info.indexedAt,
        hash: info.hash
      }));
    } catch (error) {
      console.error('[Persona Manager] Failed to load files:', error);
      container.innerHTML = `<p class="error">Failed to load files: ${error.message}</p>`;
      return;
    }
  }

  renderFileList();
}

/**
 * Render the file list inside the detail view
 */
function renderFileList() {
  const modal = document.getElementById('persona-manager-modal');
  if (!modal) return;

  const container = modal.querySelector('#persona-file-list-container');
  if (!container) return;

  let filtered = personaFiles.filter(f =>
    f.relativePath.toLowerCase().includes(personaFileFilter.toLowerCase())
  );

  filtered = sortPersonaFiles(filtered, personaFileSortBy);

  const totalChunks = personaFiles.reduce((sum, f) => sum + f.chunkCount, 0);

  container.innerHTML = `
    <div class="persona-mgr-file-toolbar">
      <input type="text" class="persona-mgr-file-filter" id="persona-file-filter"
             placeholder="Filter files..." value="${escapeHtml(personaFileFilter)}">
      <select class="persona-mgr-file-sort" id="persona-file-sort">
        <option value="name" ${personaFileSortBy === 'name' ? 'selected' : ''}>Sort: Name</option>
        <option value="date" ${personaFileSortBy === 'date' ? 'selected' : ''}>Sort: Date</option>
        <option value="chunks" ${personaFileSortBy === 'chunks' ? 'selected' : ''}>Sort: Chunks</option>
      </select>
      <span class="persona-mgr-file-stats">${personaFiles.length} files, ${totalChunks} chunks</span>
    </div>
    <div class="persona-mgr-file-grid">
      <div class="persona-mgr-file-grid-header">
        <span class="grid-col grid-col-path">File Path</span>
        <span class="grid-col grid-col-chunks">Chunks</span>
        <span class="grid-col grid-col-date">Indexed</span>
        <span class="grid-col grid-col-actions">Actions</span>
      </div>
      <div class="persona-mgr-file-rows">
        ${filtered.length === 0
          ? '<div class="persona-mgr-file-empty">No files match filter</div>'
          : filtered.map(f => `
            <div class="persona-mgr-file-item" data-path="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}">
              <span class="grid-col grid-col-path">${escapeHtml(f.relativePath)}</span>
              <span class="grid-col grid-col-chunks">${f.chunkCount}</span>
              <span class="grid-col grid-col-date">${formatDate(f.indexedAt)}</span>
              <span class="grid-col grid-col-actions">
                <button class="persona-mgr-view-chunks-btn" data-path="${escapeHtml(f.path)}" title="View file chunks">
                  View Chunks
                </button>
              </span>
            </div>
          `).join('')
        }
      </div>
    </div>
  `;

  // Event listeners
  container.querySelector('#persona-file-filter')?.addEventListener('input', (e) => {
    personaFileFilter = e.target.value;
    renderFileList();
  });
  container.querySelector('#persona-file-sort')?.addEventListener('change', (e) => {
    personaFileSortBy = e.target.value;
    renderFileList();
  });
  container.querySelectorAll('.persona-mgr-view-chunks-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showPersonaFileChunks(btn.dataset.path);
    });
  });
}

/**
 * Sort persona files by the specified field
 */
function sortPersonaFiles(files, sortBy) {
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
 * Show file chunks in an overlay (same pattern as catalog-manager)
 */
async function showPersonaFileChunks(filePath) {
  const fileName = filePath.split(/[\\/]/).pop();
  showOverlapContext = false;

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

  const closeOverlay = () => overlay.remove();
  overlay.querySelector('.chunks-viewer-close').addEventListener('click', closeOverlay);
  overlay.querySelector('.chunks-close-btn').addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });

  try {
    const result = await window.electronAPI.vectordbGetFileChunks({
      catalogName: selectedPersona.catalogName,
      filePath: filePath
    });

    const body = overlay.querySelector('.chunks-viewer-body');

    if (!result.success || !result.chunks || result.chunks.length === 0) {
      body.innerHTML = '<div class="chunks-empty">No chunks found for this file.</div>';
      return;
    }

    renderPersonaChunks(body, result.chunks);
  } catch (error) {
    console.error('[Persona Manager] Failed to load chunks:', error);
    const body = overlay.querySelector('.chunks-viewer-body');
    body.innerHTML = `<div class="chunks-error">Failed to load chunks: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Render chunks into the viewer body
 */
function renderPersonaChunks(body, chunks) {
  const hasOverlap = chunks.some(c =>
    c.metadata?.overlapBefore || c.metadata?.overlapAfter
  );

  body.innerHTML = `
    <div class="chunks-summary">
      <span>${chunks.length} chunks</span>
      ${hasOverlap ? `
        <label class="chunks-overlap-toggle">
          <input type="checkbox" id="persona-chunks-overlap-toggle" ${showOverlapContext ? 'checked' : ''}>
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

  const toggleEl = body.querySelector('#persona-chunks-overlap-toggle');
  if (toggleEl) {
    toggleEl.addEventListener('change', (e) => {
      showOverlapContext = e.target.checked;
      renderPersonaChunks(body, chunks);
    });
  }
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
