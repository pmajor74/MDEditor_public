/**
 * Activity Bar Component
 *
 * VS Code-style activity bar with icons for switching left panel views.
 * Provides navigation between Wiki Browser, File Explorer, and Search panels.
 */

// Panel identifiers
const PANELS = {
  WIKI: 'wiki',
  FILES: 'files',
  SEARCH: 'search'
};

// Current active panel
let activePanel = null;

// Panel visibility callback
let onPanelChangeCallback = null;

// Panel elements cache
let panelElements = {};

// Panel handlers for custom show/hide logic
let panelHandlers = {};

/**
 * Build the activity bar HTML
 */
function buildActivityBar() {
  const container = document.getElementById('activity-bar');
  if (!container) return;

  container.innerHTML = `
    <div class="activity-bar-icons">
      <button
        class="activity-bar-icon"
        data-panel="${PANELS.WIKI}"
        title="Wiki Browser (Ctrl+Shift+W)"
        aria-label="Wiki Browser"
        aria-pressed="false"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h.71C7.37 7.69 9.48 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3s-1.34 3-3 3z"/>
        </svg>
      </button>
      <button
        class="activity-bar-icon"
        data-panel="${PANELS.FILES}"
        title="File Explorer (Ctrl+Shift+E)"
        aria-label="File Explorer"
        aria-pressed="false"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
      </button>
      <button
        class="activity-bar-icon"
        data-panel="${PANELS.SEARCH}"
        title="Search (Ctrl+Shift+F)"
        aria-label="Search"
        aria-pressed="false"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
      </button>
    </div>
  `;

  // Attach click handlers
  const icons = container.querySelectorAll('.activity-bar-icon');
  icons.forEach(icon => {
    icon.addEventListener('click', () => {
      const panel = icon.dataset.panel;
      togglePanel(panel);
    });
  });
}

/**
 * Toggle a panel - show it if hidden, or hide if already active
 * @param {string} panelId - The panel to toggle
 */
function togglePanel(panelId) {
  if (activePanel === panelId) {
    // Clicking active panel hides it
    hideAllPanels();
    setActivePanel(null);
  } else {
    // Show the requested panel
    showPanel(panelId);
  }
}

/**
 * Show a specific panel
 * @param {string} panelId - The panel to show
 */
function showPanel(panelId) {
  hideAllPanels();

  // Safety net: force-hide all panel DOM elements directly
  Object.values(PANELS).forEach(id => {
    const el = getPanelElement(id);
    if (el) el.classList.add('hidden');
  });

  setActivePanel(panelId);

  // Call custom show handler if exists
  if (panelHandlers[panelId]?.show) {
    panelHandlers[panelId].show();
  } else {
    // Default: just remove hidden class
    const panelElement = getPanelElement(panelId);
    if (panelElement) {
      panelElement.classList.remove('hidden');
    }
  }

  // Notify callback
  if (onPanelChangeCallback) {
    onPanelChangeCallback(panelId, true);
  }
}

/**
 * Hide all panels
 */
function hideAllPanels() {
  Object.values(PANELS).forEach(panelId => {
    // Call custom hide handler if exists
    if (panelHandlers[panelId]?.hide) {
      panelHandlers[panelId].hide();
    } else {
      // Default: just add hidden class
      const panelElement = getPanelElement(panelId);
      if (panelElement) {
        panelElement.classList.add('hidden');
      }
    }
  });
}

/**
 * Set the active panel and update icon states
 * @param {string|null} panelId - The active panel or null
 */
function setActivePanel(panelId) {
  activePanel = panelId;

  // Update icon states
  const icons = document.querySelectorAll('.activity-bar-icon');
  icons.forEach(icon => {
    const isActive = icon.dataset.panel === panelId;
    icon.classList.toggle('active', isActive);
    icon.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

/**
 * Get the panel element for a given panel ID
 * @param {string} panelId - The panel ID
 * @returns {HTMLElement|null}
 */
function getPanelElement(panelId) {
  // Use cached elements or query DOM
  if (!panelElements[panelId]) {
    switch (panelId) {
      case PANELS.WIKI:
        panelElements[panelId] = document.getElementById('wiki-sidebar');
        break;
      case PANELS.FILES:
        panelElements[panelId] = document.getElementById('file-browser');
        break;
      case PANELS.SEARCH:
        panelElements[panelId] = document.getElementById('search-panel');
        break;
    }
  }
  return panelElements[panelId];
}

/**
 * Initialize the activity bar
 * @param {Object} options - Initialization options
 * @param {Function} options.onPanelChange - Callback when panel changes
 * @param {Object} options.panelHandlers - Custom show/hide handlers for panels
 */
function initActivityBar(options = {}) {
  onPanelChangeCallback = options.onPanelChange || null;
  panelHandlers = options.panelHandlers || {};
  buildActivityBar();

  // Setup keyboard shortcuts
  document.addEventListener('keydown', handleKeyboardShortcut);

  console.log('[Activity Bar] Initialized');
}

/**
 * Register a panel handler
 * @param {string} panelId - The panel ID
 * @param {Object} handlers - Object with show/hide functions
 */
function registerPanelHandler(panelId, handlers) {
  panelHandlers[panelId] = handlers;
}

/**
 * Handle keyboard shortcuts for panel switching
 * @param {KeyboardEvent} e
 */
function handleKeyboardShortcut(e) {
  // Check for Ctrl+Shift combinations
  if (e.ctrlKey && e.shiftKey) {
    switch (e.key.toUpperCase()) {
      case 'W':
        e.preventDefault();
        togglePanel(PANELS.WIKI);
        break;
      case 'E':
        e.preventDefault();
        togglePanel(PANELS.FILES);
        break;
      case 'F':
        e.preventDefault();
        togglePanel(PANELS.SEARCH);
        break;
    }
  }
}

/**
 * Get the currently active panel
 * @returns {string|null}
 */
function getActivePanel() {
  return activePanel;
}

/**
 * Programmatically show a panel (used by other components)
 * @param {string} panelId - The panel to show
 */
function activatePanel(panelId) {
  if (Object.values(PANELS).includes(panelId)) {
    showPanel(panelId);
  }
}

/**
 * Hide the current panel
 */
function hideCurrentPanel() {
  hideAllPanels();
  setActivePanel(null);
}

/**
 * Clear cached panel elements (call when DOM changes)
 */
function clearPanelCache() {
  panelElements = {};
}

export {
  initActivityBar,
  togglePanel,
  showPanel,
  hideAllPanels,
  setActivePanel,
  getActivePanel,
  activatePanel,
  hideCurrentPanel,
  clearPanelCache,
  registerPanelHandler,
  PANELS
};
