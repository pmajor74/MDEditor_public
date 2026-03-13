/**
 * Tab Bar Component
 *
 * Renders horizontal tab bar with close buttons, dirty indicators,
 * context menus, drag-to-reorder functionality, and back/forward nav buttons.
 */

import {
  addListener as navAddListener,
  canGoBack as navCanGoBack,
  canGoForward as navCanGoForward
} from '../navigation/navigationHistory.js';

let tabBarContainer = null;
let currentSession = null;
let onTabSwitch = null;
let onNavigateBack = null;
let onNavigateForward = null;
let contextMenu = null;
let draggedTab = null;
let navBackBtn = null;
let navForwardBtn = null;

/**
 * Initialize the tab bar
 * @param {Object} options - Configuration options
 * @param {Function} options.onSwitch - Callback when tab is switched
 * @param {Function} options.onBack - Callback for back navigation
 * @param {Function} options.onForward - Callback for forward navigation
 */
export function initTabBar(options = {}) {
  onTabSwitch = options.onSwitch || (() => {});
  onNavigateBack = options.onBack || (() => {});
  onNavigateForward = options.onForward || (() => {});

  tabBarContainer = document.getElementById('tab-bar');
  if (!tabBarContainer) {
    console.warn('[TabBar] Container #tab-bar not found');
    return;
  }

  createNavButtons();
  createContextMenu();
  setupEventListeners();

  // Listen for navigation history state changes
  navAddListener((state) => {
    if (navBackBtn) navBackBtn.disabled = !state.canGoBack;
    if (navForwardBtn) navForwardBtn.disabled = !state.canGoForward;
  });

  console.log('[TabBar] Initialized');
}

/**
 * Create back/forward navigation buttons
 */
function createNavButtons() {
  if (!tabBarContainer) return;

  const navGroup = document.createElement('div');
  navGroup.className = 'tab-nav-buttons';

  navBackBtn = document.createElement('button');
  navBackBtn.className = 'tab-nav-btn';
  navBackBtn.title = 'Back (Alt+Left)';
  navBackBtn.innerHTML = '&#9664;'; // left triangle
  navBackBtn.disabled = !navCanGoBack();
  navBackBtn.addEventListener('click', () => onNavigateBack());

  navForwardBtn = document.createElement('button');
  navForwardBtn.className = 'tab-nav-btn';
  navForwardBtn.title = 'Forward (Alt+Right)';
  navForwardBtn.innerHTML = '&#9654;'; // right triangle
  navForwardBtn.disabled = !navCanGoForward();
  navForwardBtn.addEventListener('click', () => onNavigateForward());

  navGroup.appendChild(navBackBtn);
  navGroup.appendChild(navForwardBtn);
  tabBarContainer.prepend(navGroup);
}

/**
 * Update the tab bar with new session data
 * @param {Object} session - Tab session data
 */
export function updateTabs(session) {
  if (!tabBarContainer) return;

  currentSession = session;
  render();
}

/**
 * Render the tab bar
 */
function render() {
  if (!tabBarContainer || !currentSession) return;

  const { tabs, activeTabId, tabOrder } = currentSession;

  // Create tabs container
  let tabsWrapper = tabBarContainer.querySelector('.tabs-wrapper');
  if (!tabsWrapper) {
    tabsWrapper = document.createElement('div');
    tabsWrapper.className = 'tabs-wrapper';
    tabBarContainer.appendChild(tabsWrapper);
  }

  // Clear existing tabs
  tabsWrapper.innerHTML = '';

  // Sort tabs by tabOrder
  const orderedTabs = tabOrder
    .map(id => tabs.find(t => t.id === id))
    .filter(Boolean);

  // Render each tab
  orderedTabs.forEach(tab => {
    const tabEl = createTabElement(tab, tab.id === activeTabId);
    tabsWrapper.appendChild(tabEl);
  });

  // Add new tab button
  const newTabBtn = document.createElement('button');
  newTabBtn.className = 'tab-new-btn';
  newTabBtn.title = 'New Tab (Ctrl+N)';
  newTabBtn.textContent = '+';
  newTabBtn.addEventListener('click', handleNewTab);
  tabsWrapper.appendChild(newTabBtn);
}

/**
 * Create a tab element
 */
function createTabElement(tab, isActive) {
  const tabEl = document.createElement('div');
  tabEl.className = `tab-item${isActive ? ' active' : ''}${tab.isDirty ? ' dirty' : ''}${tab.fileDeleted ? ' deleted' : ''}${tab.hasExternalChanges ? ' external-changes' : ''}`;
  tabEl.dataset.tabId = tab.id;
  tabEl.draggable = true;

  // Icon based on type
  const icon = document.createElement('span');
  icon.className = 'tab-icon';
  if (tab.type === 'azure') {
    // Azure DevOps icon - distinctive wiki cloud icon
    icon.innerHTML = `<svg class="tab-icon-azure-svg" viewBox="0 0 16 16" width="14" height="14">
      <path fill="currentColor" d="M8 1C4.1 1 1 4.1 1 8s3.1 7 7 7 7-3.1 7-7-3.1-7-7-7zm0 12.5c-3 0-5.5-2.5-5.5-5.5S5 2.5 8 2.5s5.5 2.5 5.5 5.5-2.5 5.5-5.5 5.5z"/>
      <path fill="currentColor" d="M11 6.5L7.5 10 5 7.5l1-1 1.5 1.5L10 5.5z"/>
    </svg>`;
    icon.classList.add('tab-icon-azure');
    icon.title = 'Azure DevOps Wiki';
    tabEl.classList.add('tab-azure');
  } else if (tab.type === 'local') {
    icon.textContent = '📄';
    icon.title = tab.filePath || 'Local file';
  } else {
    icon.textContent = '📝';
    icon.title = 'Untitled';
  }
  tabEl.appendChild(icon);

  // Title
  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title;
  if (tab.isDirty) {
    title.textContent += '*';
  }
  tabEl.appendChild(title);

  // External changes warning badge
  if (tab.hasExternalChanges) {
    const badge = document.createElement('span');
    badge.className = 'tab-external-badge';
    badge.textContent = '↻';
    badge.title = 'File has been modified externally - click tab to reload';
    tabEl.appendChild(badge);
  }

  // Deleted warning badge
  if (tab.fileDeleted) {
    const badge = document.createElement('span');
    badge.className = 'tab-deleted-badge';
    badge.textContent = '!';
    badge.title = 'File has been deleted';
    tabEl.appendChild(badge);
  }

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close-btn';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close tab';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleCloseTab(tab.id);
  });
  tabEl.appendChild(closeBtn);

  // Click to switch
  tabEl.addEventListener('click', () => {
    handleSwitchTab(tab.id);
  });

  // Right-click context menu
  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, tab);
  });

  // Drag events
  tabEl.addEventListener('dragstart', handleDragStart);
  tabEl.addEventListener('dragover', handleDragOver);
  tabEl.addEventListener('dragend', handleDragEnd);
  tabEl.addEventListener('drop', handleDrop);

  return tabEl;
}

/**
 * Create the context menu element
 */
function createContextMenu() {
  contextMenu = document.getElementById('tab-context-menu');
  if (contextMenu) return;

  contextMenu = document.createElement('div');
  contextMenu.id = 'tab-context-menu';
  contextMenu.className = 'tab-context-menu hidden';
  contextMenu.innerHTML = `
    <button class="context-menu-item" data-action="close">Close</button>
    <button class="context-menu-item" data-action="close-others">Close Others</button>
    <button class="context-menu-item" data-action="close-all">Close All</button>
    <div class="context-menu-divider"></div>
    <button class="context-menu-item" data-action="copy-path">Copy Path</button>
  `;
  document.body.appendChild(contextMenu);
}

/**
 * Show context menu at position
 */
function showContextMenu(event, tab) {
  if (!contextMenu) return;

  contextMenu.dataset.tabId = tab.id;

  // Position menu
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.classList.remove('hidden');

  // Enable/disable copy path based on tab type
  const copyPathBtn = contextMenu.querySelector('[data-action="copy-path"]');
  if (copyPathBtn) {
    if (tab.type === 'local' && tab.filePath) {
      copyPathBtn.disabled = false;
      copyPathBtn.dataset.path = tab.filePath;
    } else if (tab.type === 'azure' && tab.azurePage?.pagePath) {
      copyPathBtn.disabled = false;
      copyPathBtn.dataset.path = tab.azurePage.pagePath;
    } else {
      copyPathBtn.disabled = true;
    }
  }
}

/**
 * Hide context menu
 */
function hideContextMenu() {
  if (contextMenu) {
    contextMenu.classList.add('hidden');
  }
}

/**
 * Setup global event listeners
 */
function setupEventListeners() {
  // Hide context menu on click outside
  document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  // Context menu actions
  if (contextMenu) {
    contextMenu.addEventListener('click', (e) => {
      const action = e.target.dataset?.action;
      const tabId = contextMenu.dataset.tabId;

      if (!action || !tabId) return;

      switch (action) {
        case 'close':
          handleCloseTab(tabId);
          break;
        case 'close-others':
          handleCloseOthers(tabId);
          break;
        case 'close-all':
          handleCloseAll();
          break;
        case 'copy-path':
          const pathToCopy = e.target.dataset.path;
          if (pathToCopy) {
            navigator.clipboard.writeText(pathToCopy);
          }
          break;
      }

      hideContextMenu();
    });
  }

  // Handle horizontal scroll with mouse wheel
  if (tabBarContainer) {
    tabBarContainer.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        tabBarContainer.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }
}

/**
 * Handle switching to a tab
 */
async function handleSwitchTab(tabId) {
  if (!window.electronAPI) return;

  const tab = await window.electronAPI.tabsSwitch(tabId);
  if (tab && onTabSwitch) {
    onTabSwitch(tab);
  }
}

/**
 * Handle closing a tab
 */
async function handleCloseTab(tabId) {
  if (!window.electronAPI) return;
  await window.electronAPI.tabsClose(tabId);
}

/**
 * Handle creating a new tab
 */
async function handleNewTab() {
  if (!window.electronAPI) return;

  const newTab = await window.electronAPI.tabsCreate({ type: 'untitled' });
  if (newTab && onTabSwitch) {
    onTabSwitch(newTab);
  }
}

/**
 * Handle close others
 */
async function handleCloseOthers(keepTabId) {
  if (!window.electronAPI) return;
  await window.electronAPI.tabsCloseOthers(keepTabId);
}

/**
 * Handle close all
 */
async function handleCloseAll() {
  if (!window.electronAPI) return;
  await window.electronAPI.tabsCloseAll();
}

// Drag and drop handlers
function handleDragStart(e) {
  draggedTab = e.target;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', e.target.dataset.tabId);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const targetTab = e.target.closest('.tab-item');
  if (!targetTab || targetTab === draggedTab) return;

  const tabsWrapper = tabBarContainer.querySelector('.tabs-wrapper');
  const tabs = Array.from(tabsWrapper.querySelectorAll('.tab-item'));
  const draggedIndex = tabs.indexOf(draggedTab);
  const targetIndex = tabs.indexOf(targetTab);

  if (draggedIndex < targetIndex) {
    targetTab.parentNode.insertBefore(draggedTab, targetTab.nextSibling);
  } else {
    targetTab.parentNode.insertBefore(draggedTab, targetTab);
  }
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedTab = null;

  // Get new order from DOM
  const tabsWrapper = tabBarContainer.querySelector('.tabs-wrapper');
  const tabs = Array.from(tabsWrapper.querySelectorAll('.tab-item'));
  const newOrder = tabs.map(t => t.dataset.tabId);

  // Send new order to main process
  if (window.electronAPI) {
    window.electronAPI.tabsReorder(newOrder);
  }
}

function handleDrop(e) {
  e.preventDefault();
}

/**
 * Get current active tab ID
 */
export function getActiveTabId() {
  return currentSession?.activeTabId || null;
}

/**
 * Scroll to make active tab visible
 */
export function scrollToActiveTab() {
  if (!tabBarContainer || !currentSession?.activeTabId) return;

  const activeTabEl = tabBarContainer.querySelector(`.tab-item[data-tab-id="${currentSession.activeTabId}"]`);
  if (activeTabEl) {
    activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}
