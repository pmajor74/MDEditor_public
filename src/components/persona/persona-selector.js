/**
 * Persona Selector Component
 *
 * Dropdown for the AI sidebar that lets users select persona(s).
 * Supports two modes:
 * - Single-select: Traditional single persona selection
 * - Multi-select: Select multiple personas for multi-persona conversations (max 6)
 */

const PERSONA_SELECTION_KEY = 'ai-copilot-active-persona';
const MULTI_PERSONA_SELECTION_KEY = 'ai-copilot-selected-personas';
const MAX_MULTI_SELECT = 6;
const MIN_MULTI_SELECT = 2;

let personas = [];
let activePersonaName = null;
let activePersona = null;
let selectedPersonaNames = [];  // For multi-select mode
let onChangeCallback = null;
let onMultiChangeCallback = null;
let dropdownOpen = false;
let multiSelectMode = false;

/**
 * Initialize the persona selector
 * @param {HTMLElement} container - Container element to render into
 * @param {Object} options - Options
 * @param {Function} options.onPersonaChanged - Callback when single persona selection changes
 * @param {Function} options.onMultiPersonaChanged - Callback when multi-persona selection changes
 */
export async function initPersonaSelector(container, options = {}) {
  onChangeCallback = options.onPersonaChanged || null;
  onMultiChangeCallback = options.onMultiPersonaChanged || null;

  container.innerHTML = buildSelectorHTML();
  setupSelectorEvents(container);

  // Always start with no persona selected (fresh session = None)
  activePersonaName = null;
  activePersona = null;
  selectedPersonaNames = [];
  localStorage.removeItem(PERSONA_SELECTION_KEY);

  // Listen for persona created/deleted events from other components
  document.addEventListener('persona:created', () => loadPersonas());
  document.addEventListener('persona:deleted', () => loadPersonas());

  await loadPersonas();
}

/**
 * Build the selector HTML
 */
function buildSelectorHTML() {
  return `
    <div class="persona-selector" id="persona-selector">
      <div class="persona-selector-header">
        <span class="persona-selector-label">Persona</span>
        <label class="persona-multi-toggle" title="Enable multi-persona conversation mode">
          <input type="checkbox" id="persona-multi-checkbox" />
          <span class="persona-multi-label">Multi</span>
        </label>
      </div>
      <div class="persona-dropdown-wrapper">
        <button id="persona-dropdown-btn" class="persona-dropdown-btn">
          <span class="persona-btn-text">None</span>
          <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z"/>
          </svg>
        </button>
        <div id="persona-dropdown-menu" class="persona-dropdown-menu hidden">
          <div class="persona-list" id="persona-list">
            <div class="persona-empty">No personas available</div>
          </div>
          <div class="persona-multi-info hidden" id="persona-multi-info">
            <span class="persona-multi-count">0 selected</span>
            <span class="persona-multi-hint">(min ${MIN_MULTI_SELECT}, max ${MAX_MULTI_SELECT})</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Setup event listeners
 */
function setupSelectorEvents(container) {
  const btn = container.querySelector('#persona-dropdown-btn');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
  }

  // Multi-select toggle
  const multiCheckbox = container.querySelector('#persona-multi-checkbox');
  if (multiCheckbox) {
    multiCheckbox.addEventListener('change', (e) => {
      setMultiSelectMode(e.target.checked);
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (dropdownOpen && !container.querySelector('.persona-dropdown-wrapper')?.contains(e.target)) {
      closeDropdown();
    }
  });
}

/**
 * Toggle dropdown visibility
 */
function toggleDropdown() {
  const menu = document.getElementById('persona-dropdown-menu');
  if (menu) {
    dropdownOpen = !dropdownOpen;
    menu.classList.toggle('hidden', !dropdownOpen);
    document.getElementById('persona-dropdown-btn')?.classList.toggle('open', dropdownOpen);
  }
}

/**
 * Close dropdown
 */
function closeDropdown() {
  const menu = document.getElementById('persona-dropdown-menu');
  if (menu) {
    dropdownOpen = false;
    menu.classList.add('hidden');
    document.getElementById('persona-dropdown-btn')?.classList.remove('open');
  }
}

/**
 * Set multi-select mode
 * @param {boolean} enabled - Whether multi-select is enabled
 */
export function setMultiSelectMode(enabled) {
  multiSelectMode = enabled;

  // Update checkbox state
  const checkbox = document.getElementById('persona-multi-checkbox');
  if (checkbox) checkbox.checked = enabled;

  // Show/hide multi-select info
  const multiInfo = document.getElementById('persona-multi-info');
  if (multiInfo) {
    multiInfo.classList.toggle('hidden', !enabled);
  }

  // Clear selections when switching modes
  if (enabled) {
    // Switching to multi-select: clear single selection, start fresh
    activePersonaName = null;
    activePersona = null;
    selectedPersonaNames = [];
    localStorage.removeItem(PERSONA_SELECTION_KEY);
  } else {
    // Switching to single-select: clear multi-selection
    selectedPersonaNames = [];
    localStorage.removeItem(MULTI_PERSONA_SELECTION_KEY);
  }

  renderPersonaList();
  updateButtonText();

  // Notify listeners
  if (enabled && onMultiChangeCallback) {
    onMultiChangeCallback([]);
  } else if (!enabled && onChangeCallback) {
    onChangeCallback(null);
  }

  // Dispatch event for sidebar to handle mode change
  document.dispatchEvent(new CustomEvent('persona:modeChanged', {
    detail: { multiSelect: enabled }
  }));
}

/**
 * Get current multi-select mode state
 */
export function isMultiSelectMode() {
  return multiSelectMode;
}

/**
 * Load personas from backend
 */
export async function loadPersonas() {
  try {
    if (!window.electronAPI.personaGetAll) return;
    const result = await window.electronAPI.personaGetAll();
    if (result.success) {
      personas = result.personas || [];
      renderPersonaList();
      updateButtonText();

      // Restore saved selection if persona still exists (single-select mode only)
      if (!multiSelectMode && activePersonaName) {
        const exists = personas.find(p => p.name === activePersonaName);
        if (exists) {
          await selectPersona(activePersonaName, false);
        } else {
          activePersonaName = null;
          activePersona = null;
          localStorage.removeItem(PERSONA_SELECTION_KEY);
        }
      }
    }
  } catch (error) {
    console.error('[Persona Selector] Failed to load personas:', error);
  }
}

/**
 * Render the persona list in the dropdown
 */
function renderPersonaList() {
  const listContainer = document.getElementById('persona-list');
  if (!listContainer) return;

  if (personas.length === 0) {
    listContainer.innerHTML = '<div class="persona-empty">No personas created yet</div>';
    updateButtonText();
    return;
  }

  let html = '';

  if (multiSelectMode) {
    // Multi-select mode: checkboxes for each persona
    html = personas.map(p => {
      const isSelected = selectedPersonaNames.includes(p.name);
      const isDisabled = !p.hasStyleProfile;
      return `
        <label class="persona-item persona-checkbox-item ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}" data-persona="${p.name}">
          <input type="checkbox" value="${p.name}" ${isSelected ? 'checked' : ''} ${isDisabled ? 'disabled' : ''} />
          <div class="persona-item-info">
            <span class="persona-item-name">${p.displayName}</span>
            <span class="persona-item-desc">${p.description || ''}</span>
          </div>
          <div class="persona-item-status">
            ${p.hasStyleProfile ? '' : '<span class="persona-badge warn">No profile</span>'}
          </div>
        </label>
      `;
    }).join('');
  } else {
    // Single-select mode: original behavior
    html = `
      <div class="persona-item ${!activePersonaName ? 'selected' : ''}" data-persona="">
        <span class="persona-item-name">None</span>
        <span class="persona-item-desc">Use default AI assistant</span>
      </div>
    `;

    html += personas.map(p => `
      <div class="persona-item ${activePersonaName === p.name ? 'selected' : ''}" data-persona="${p.name}">
        <div class="persona-item-info">
          <span class="persona-item-name">${p.displayName}</span>
          <span class="persona-item-desc">${p.description || ''}</span>
        </div>
        <div class="persona-item-actions">
          ${p.hasStyleProfile ? '<span class="persona-badge">Active</span>' : '<span class="persona-badge warn">No profile</span>'}
          <button class="persona-delete-btn" data-delete="${p.name}" title="Delete persona">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');
  }

  listContainer.innerHTML = html;

  if (multiSelectMode) {
    // Multi-select event handlers
    listContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const name = e.target.value;
        if (e.target.checked) {
          if (selectedPersonaNames.length < MAX_MULTI_SELECT) {
            if (!selectedPersonaNames.includes(name)) {
              selectedPersonaNames.push(name);
            }
          } else {
            e.target.checked = false;
            return;
          }
        } else {
          selectedPersonaNames = selectedPersonaNames.filter(n => n !== name);
        }
        updateMultiSelectUI();
        saveMultiSelection();
        notifyMultiChange();
      });
    });
  } else {
    // Single-select event handlers
    listContainer.querySelectorAll('.persona-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.persona-delete-btn')) return;
        const name = item.dataset.persona;
        selectPersona(name || null);
        closeDropdown();
      });
    });

    listContainer.querySelectorAll('.persona-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = btn.dataset.delete;
        await deletePersona(name);
      });
    });
  }
}

/**
 * Update multi-select UI elements
 */
function updateMultiSelectUI() {
  const count = selectedPersonaNames.length;

  // Update count display
  const countEl = document.querySelector('.persona-multi-count');
  if (countEl) {
    countEl.textContent = `${count} selected`;
    countEl.classList.toggle('valid', count >= MIN_MULTI_SELECT);
  }

  // Update item selection states
  document.querySelectorAll('.persona-checkbox-item').forEach(item => {
    const name = item.dataset.persona;
    item.classList.toggle('selected', selectedPersonaNames.includes(name));
  });

  updateButtonText();
}

/**
 * Save multi-selection to localStorage
 */
function saveMultiSelection() {
  try {
    localStorage.setItem(MULTI_PERSONA_SELECTION_KEY, JSON.stringify(selectedPersonaNames));
  } catch (e) {
    console.warn('[Persona Selector] Failed to save multi-selection:', e);
  }
}

/**
 * Notify multi-selection change
 */
function notifyMultiChange() {
  if (onMultiChangeCallback) {
    // Only pass valid selections (2+ personas with profiles)
    const validPersonas = selectedPersonaNames.filter(name => {
      const p = personas.find(p => p.name === name);
      return p && p.hasStyleProfile;
    });
    onMultiChangeCallback(validPersonas);
  }

  // Dispatch event
  document.dispatchEvent(new CustomEvent('persona:multiSelectionChanged', {
    detail: { selectedNames: [...selectedPersonaNames] }
  }));
}

/**
 * Select a persona (single-select mode)
 * @param {string|null} name - Persona name or null to clear
 * @param {boolean} notify - Whether to notify via callback
 */
async function selectPersona(name, notify = true) {
  if (multiSelectMode) return;  // Ignore in multi-select mode
  if (name === activePersonaName) return;

  activePersonaName = name;
  activePersona = null;

  if (name) {
    try {
      const result = await window.electronAPI.personaGet(name);
      if (result.success) {
        activePersona = result.persona;
      }
    } catch (error) {
      console.error('[Persona Selector] Failed to load persona:', error);
    }
    localStorage.setItem(PERSONA_SELECTION_KEY, name);
  } else {
    localStorage.removeItem(PERSONA_SELECTION_KEY);
  }

  updateButtonText();
  renderPersonaList();

  if (notify && onChangeCallback) {
    onChangeCallback(activePersona);
  }
}

/**
 * Update the dropdown button text
 */
function updateButtonText() {
  const btnText = document.querySelector('#persona-dropdown-btn .persona-btn-text');
  if (!btnText) return;

  if (multiSelectMode) {
    const count = selectedPersonaNames.length;
    if (count === 0) {
      btnText.textContent = 'Select personas...';
    } else if (count === 1) {
      const p = personas.find(p => p.name === selectedPersonaNames[0]);
      btnText.textContent = p?.displayName || selectedPersonaNames[0];
    } else {
      btnText.textContent = `${count} personas selected`;
    }
  } else {
    if (activePersona) {
      btnText.textContent = activePersona.displayName;
    } else if (activePersonaName) {
      const found = personas.find(p => p.name === activePersonaName);
      btnText.textContent = found ? found.displayName : activePersonaName;
    } else {
      btnText.textContent = 'None';
    }
  }
}

/**
 * Get the currently active persona (single-select mode)
 * @returns {Object|null} Full persona object or null
 */
export function getActivePersona() {
  return multiSelectMode ? null : activePersona;
}

/**
 * Get the active persona name (single-select mode)
 * @returns {string|null}
 */
export function getActivePersonaName() {
  return multiSelectMode ? null : activePersonaName;
}

/**
 * Get selected personas (multi-select mode)
 * @returns {Array<string>} Array of persona names
 */
export function getSelectedPersonas() {
  return multiSelectMode ? [...selectedPersonaNames] : [];
}

/**
 * Check if multi-select has valid selection (2+ personas)
 */
export function hasValidMultiSelection() {
  return multiSelectMode && selectedPersonaNames.length >= MIN_MULTI_SELECT;
}

/**
 * Delete a persona with confirmation
 * @param {string} name - Persona identifier
 */
async function deletePersona(name) {
  const persona = personas.find(p => p.name === name);
  const displayName = persona?.displayName || name;

  const confirmed = confirm(`Delete persona "${displayName}"?\n\nThis will remove the persona and its associated catalog.`);
  if (!confirmed) return;

  try {
    const result = await window.electronAPI.personaDelete({ name, deleteCatalog: true });
    if (result.success) {
      // Clear from selections
      if (activePersonaName === name) {
        activePersonaName = null;
        activePersona = null;
        localStorage.removeItem(PERSONA_SELECTION_KEY);
        if (onChangeCallback) onChangeCallback(null);
      }
      selectedPersonaNames = selectedPersonaNames.filter(n => n !== name);
      saveMultiSelection();
      notifyMultiChange();

      await loadPersonas();
    } else {
      alert(`Failed to delete persona: ${result.error}`);
    }
  } catch (error) {
    console.error('[Persona Selector] Delete failed:', error);
    alert(`Failed to delete persona: ${error.message}`);
  }
}

/**
 * Refresh the persona list (after create/delete)
 */
export async function refreshPersonas() {
  await loadPersonas();
}
