/**
 * AI Chat Sidebar Component
 *
 * Right sidebar for AI Copilot interaction.
 * Supports multiple LLM providers: Gemini, OpenAI, Azure, Anthropic.
 * Allows users to ask AI to modify their wiki articles.
 * Includes wiki search capability for research-based requests.
 */

import mermaidValidator from './mermaidRendererValidator.js';
import { showAIChangesPreview } from './ai-changes-preview.js';
import {
  showSearchProgress,
  updateSearchProgress,
  hideSearchProgress,
  showLargeSearchConfirmation,
  showSearchConfirmation,
  showResultCountSelector
} from './wiki-search-progress.js';
import {
  initPersonaSelector,
  getActivePersona,
  getActivePersonaName,
  getSelectedPersonas,
  isMultiSelectMode,
  hasValidMultiSelection,
  refreshPersonas
} from './persona/persona-selector.js';

let sidebarVisible = false;
let chatHistory = [];
let isWaitingForResponse = false;
let lastBackupPath = null;
let getEditorContentFn = null;
let setEditorContentFn = null;
let getCurrentPagePathFn = null;
let attachedImages = []; // Array of {data, mimeType, name}
let previewChangesEnabled = true; // Default to showing diff preview
let visualVerifyMermaidEnabled = false; // Default OFF — skip slow Puppeteer visual verification

// RAG (Vector DB) state
let ragCatalogs = []; // Available catalogs
let selectedCatalogs = []; // User-selected catalogs for RAG context
let ragEnabled = false; // Whether RAG is enabled
let catalogDropdownOpen = false; // Whether the catalog dropdown is open
let ragLoading = false; // Whether RAG catalogs are currently loading

const PREVIEW_CHANGES_KEY = 'ai-copilot-preview-changes';
const VISUAL_VERIFY_KEY = 'ai-copilot-visual-verify-mermaid';
const RAG_SELECTED_CATALOGS_KEY = 'ai-copilot-rag-catalogs';

// Multi-persona conversation state
let multiPersonaConversationId = null;
let multiPersonaConversationActive = false;
let multiPersonaTotalTurns = 0;
let multiPersonaMaxTurns = 15;
let selectedChatMode = 'roundRobin';  // Current chat mode
let availableChatModes = [];  // Loaded from backend

// Persona colors for visual distinction (6-color cycle)
const PERSONA_COLORS = [
  '#e91e63', // Pink
  '#2196f3', // Blue
  '#4caf50', // Green
  '#ff9800', // Orange
  '#9c27b0', // Purple
  '#00bcd4'  // Cyan
];
const personaColorMap = new Map(); // Maps persona name to color index

/**
 * Load the preview changes preference from localStorage
 */
function loadPreviewChangesPreference() {
  try {
    const stored = localStorage.getItem(PREVIEW_CHANGES_KEY);
    if (stored !== null) {
      previewChangesEnabled = stored === 'true';
    }
  } catch (e) {
    console.warn('[AI Chat] Failed to load preview preference:', e);
  }
}

/**
 * Save the preview changes preference to localStorage
 */
function savePreviewChangesPreference(enabled) {
  previewChangesEnabled = enabled;
  try {
    localStorage.setItem(PREVIEW_CHANGES_KEY, String(enabled));
  } catch (e) {
    console.warn('[AI Chat] Failed to save preview preference:', e);
  }
}

/**
 * Load the visual verify mermaid preference from localStorage
 */
function loadVisualVerifyPreference() {
  try {
    const stored = localStorage.getItem(VISUAL_VERIFY_KEY);
    if (stored !== null) {
      visualVerifyMermaidEnabled = stored === 'true';
    }
  } catch (e) {
    console.warn('[AI Chat] Failed to load visual verify preference:', e);
  }
}

/**
 * Save the visual verify mermaid preference to localStorage
 */
function saveVisualVerifyPreference(enabled) {
  visualVerifyMermaidEnabled = enabled;
  try {
    localStorage.setItem(VISUAL_VERIFY_KEY, String(enabled));
  } catch (e) {
    console.warn('[AI Chat] Failed to save visual verify preference:', e);
  }
}

/**
 * Initialize the AI chat sidebar
 */
function initAIChatSidebar(options = {}) {
  getEditorContentFn = options.getEditorContent || (() => '');
  setEditorContentFn = options.setEditorContent || (() => {});
  getCurrentPagePathFn = options.getCurrentPagePath || (() => '');

  loadPreviewChangesPreference();
  loadVisualVerifyPreference();
  buildSidebarHTML();
  setupEventListeners();
  initPersonaSelectorUI();
  loadChatModes();
  checkConfiguration();
}

/**
 * Load available chat modes from backend
 */
async function loadChatModes() {
  try {
    const modes = await window.electronAPI.conversationGetChatModes();
    availableChatModes = modes || [];
    console.log('[AI Chat] Loaded chat modes:', availableChatModes.map(m => m.id));
  } catch (error) {
    console.error('[AI Chat] Failed to load chat modes:', error);
    // Fallback defaults
    availableChatModes = [
      { id: 'roundRobin', name: 'Round Robin', description: 'Each persona speaks in turn.' },
      { id: 'relevance', name: 'Relevance-Based', description: 'AI decides who speaks next.' }
    ];
  }
}

/**
 * Initialize persona selector in sidebar
 */
function initPersonaSelectorUI() {
  const container = document.getElementById('ai-persona-section');
  if (!container) return;

  initPersonaSelector(container, {
    onPersonaChanged: handlePersonaChanged,
    onMultiPersonaChanged: handleMultiPersonaChanged
  });

  // Listen for persona creation events
  document.addEventListener('persona:created', () => {
    refreshPersonas();
  });

  // Listen for persona mode changes
  document.addEventListener('persona:modeChanged', (e) => {
    handlePersonaModeChanged(e.detail.multiSelect);
  });
}

/**
 * Handle multi-persona selection change
 * @param {Array<string>} selectedNames - Array of selected persona names
 */
function handleMultiPersonaChanged(selectedNames) {
  console.log('[AI Chat] Multi-persona selection changed:', selectedNames);

  if (selectedNames.length >= 2) {
    updateWelcomeForMultiPersona(selectedNames);
  } else if (selectedNames.length > 0) {
    // Not enough personas selected
    const welcomeEl = document.querySelector('.ai-welcome-message');
    if (welcomeEl) {
      welcomeEl.innerHTML = `
        <p><strong>Multi-Persona Mode</strong></p>
        <p>Select at least 2 personas to start a multi-perspective discussion.</p>
        <p class="ai-hint"><em>Each persona will contribute their unique viewpoint to the conversation.</em></p>
      `;
    }
  }
}

/**
 * Handle persona mode change (single vs multi)
 */
function handlePersonaModeChanged(isMulti) {
  console.log('[AI Chat] Persona mode changed to:', isMulti ? 'multi' : 'single');

  // Clear any active multi-persona conversation
  if (!isMulti && multiPersonaConversationActive) {
    handleStopMultiPersonaConversation();
  }

  // Reset color map
  personaColorMap.clear();

  // Show/hide chat mode selector
  const chatModeSection = document.getElementById('ai-chat-mode-section');
  if (chatModeSection) {
    chatModeSection.style.display = isMulti ? 'block' : 'none';
  } else if (isMulti) {
    // Create the chat mode selector if it doesn't exist
    createChatModeSelector();
  }

  // Update welcome message
  if (isMulti) {
    const welcomeEl = document.querySelector('.ai-welcome-message');
    if (welcomeEl) {
      welcomeEl.innerHTML = `
        <p><strong>Multi-Persona Mode</strong></p>
        <p>Select 2-6 personas to start a multi-perspective discussion.</p>
        <p>Each persona will share their unique viewpoint and engage with each other.</p>
        <p class="ai-hint"><em>Tip: Choose personas with different perspectives for richer discussions.</em></p>
      `;
    }
  } else {
    restoreDefaultWelcome();
  }

  clearChatMessages();
}

/**
 * Create chat mode selector UI
 */
function createChatModeSelector() {
  const personaSection = document.getElementById('ai-persona-section');
  if (!personaSection) return;

  // Check if already exists
  if (document.getElementById('ai-chat-mode-section')) return;

  const section = document.createElement('div');
  section.id = 'ai-chat-mode-section';
  section.className = 'ai-chat-mode-section';
  section.innerHTML = `
    <div class="ai-chat-mode-header">
      <label>Chat Mode</label>
      <button class="ai-chat-mode-info-btn" id="ai-chat-mode-info-btn" title="About chat modes">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-6h2v6zm0-8h-2V7h2v4z"/>
        </svg>
      </button>
    </div>
    <select id="ai-chat-mode-select" class="ai-chat-mode-select">
      ${availableChatModes.map(mode => `
        <option value="${mode.id}" ${mode.id === selectedChatMode ? 'selected' : ''}>
          ${mode.name}
        </option>
      `).join('')}
    </select>
    <div class="ai-chat-mode-description" id="ai-chat-mode-description">
      ${getChatModeDescription(selectedChatMode)}
    </div>
  `;

  // Insert after persona section
  personaSection.insertAdjacentElement('afterend', section);

  // Bind events
  const select = section.querySelector('#ai-chat-mode-select');
  if (select) {
    select.addEventListener('change', (e) => {
      selectedChatMode = e.target.value;
      updateChatModeDescription();
      console.log('[AI Chat] Chat mode changed to:', selectedChatMode);
    });
  }

  const infoBtn = section.querySelector('#ai-chat-mode-info-btn');
  if (infoBtn) {
    infoBtn.addEventListener('click', showChatModeInfoModal);
  }
}

/**
 * Get description for a chat mode
 */
function getChatModeDescription(modeId) {
  const mode = availableChatModes.find(m => m.id === modeId);
  return mode ? mode.description : '';
}

/**
 * Update chat mode description display
 */
function updateChatModeDescription() {
  const descEl = document.getElementById('ai-chat-mode-description');
  if (descEl) {
    descEl.textContent = getChatModeDescription(selectedChatMode);
  }
}

/**
 * Show modal with info about all chat modes
 */
function showChatModeInfoModal() {
  // Remove existing modal if present
  const existing = document.getElementById('ai-chat-mode-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'ai-chat-mode-modal';
  modal.className = 'ai-chat-mode-modal-overlay';
  modal.innerHTML = `
    <div class="ai-chat-mode-modal">
      <div class="ai-chat-mode-modal-header">
        <h3>Chat Modes</h3>
        <button class="ai-chat-mode-modal-close">&times;</button>
      </div>
      <div class="ai-chat-mode-modal-body">
        ${availableChatModes.map(mode => `
          <div class="ai-chat-mode-info-item">
            <h4>${mode.name}</h4>
            <p>${mode.description}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close handlers
  const closeBtn = modal.querySelector('.ai-chat-mode-modal-close');
  closeBtn.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

/**
 * Update welcome message for multi-persona mode
 */
function updateWelcomeForMultiPersona(personaNames) {
  const welcomeEl = document.querySelector('.ai-welcome-message');
  if (welcomeEl) {
    const namesList = personaNames.join(', ');
    welcomeEl.innerHTML = `
      <p><strong>Multi-Persona Discussion</strong></p>
      <p>Ready to start with: <em>${namesList}</em></p>
      <p>Ask a question and these personas will discuss it from their unique perspectives.</p>
      <p class="ai-hint"><em>Tip: You can interject during the conversation to guide the discussion.</em></p>
    `;
  }
}

/**
 * Handle persona selection change
 * @param {Object|null} persona - Selected persona or null
 */
function handlePersonaChanged(persona) {
  if (persona) {
    // Update welcome message
    updateWelcomeForPersona(persona);

    // Clear chat for fresh context
    clearChatMessages();
  } else {
    // Restore welcome message
    restoreDefaultWelcome();
  }
}

/**
 * Update welcome message for persona
 */
function updateWelcomeForPersona(persona) {
  const welcomeEl = document.querySelector('.ai-welcome-message');
  if (welcomeEl) {
    welcomeEl.innerHTML = `
      <p><strong>${persona.displayName}</strong></p>
      <p>${persona.description || 'AI Persona active'}</p>
      <p>Ask questions and I'll respond in character, drawing on my writings and philosophy.</p>
      <p class="ai-hint"><em>Tip: Try asking about specific topics from their works</em></p>
    `;
  }
}

/**
 * Restore default welcome message
 */
function restoreDefaultWelcome() {
  const welcomeEl = document.querySelector('.ai-welcome-message');
  if (welcomeEl) {
    welcomeEl.innerHTML = `
      <p><strong>Welcome to AI Copilot!</strong></p>
      <p>I can help you edit your Azure Wiki article. Try asking:</p>
      <ul>
        <li>"Add a table of contents at the top"</li>
        <li>"Create a flowchart diagram for the process"</li>
        <li>"Create a swimlane diagram showing the workflow"</li>
        <li>"Improve the formatting of this article"</li>
        <li>"Add a summary section at the end"</li>
      </ul>
      <p class="ai-hint"><em>Tip: Configure your preferred LLM provider in .env (LLM_PROVIDER=gemini|openai|azure|anthropic)</em></p>
    `;
  }
}

/**
 * Clear just the chat messages (not the welcome message)
 */
function clearChatMessages() {
  const messagesContainer = document.getElementById('ai-chat-messages');
  if (messagesContainer) {
    // Keep welcome message, remove chat messages
    const chatMsgs = messagesContainer.querySelectorAll('.ai-message');
    chatMsgs.forEach(msg => msg.remove());
  }
  chatHistory = [];
}

/**
 * Build the sidebar HTML structure
 */
const SIDEBAR_WIDTH_KEY = 'ai-copilot-sidebar-width';
const DEFAULT_SIDEBAR_WIDTH = 380;
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 600;

function buildSidebarHTML() {
  const sidebar = document.getElementById('ai-chat-sidebar');
  if (!sidebar) return;

  // Restore saved width
  const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (savedWidth) {
    const width = parseInt(savedWidth, 10);
    if (width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH) {
      sidebar.style.width = `${width}px`;
    }
  }

  sidebar.innerHTML = `
    <div class="ai-sidebar-resize-handle" id="ai-sidebar-resize-handle"></div>
    <div class="ai-sidebar-header">
      <span class="ai-sidebar-title">AI Copilot</span>
      <div class="ai-sidebar-controls">
        <button class="ai-btn-clear" title="Clear chat history">Clear</button>
        <button class="ai-sidebar-close" title="Close sidebar">&times;</button>
      </div>
    </div>

    <div class="ai-sidebar-status" id="ai-status">
      <span class="ai-status-indicator"></span>
      <span class="ai-status-text">Checking configuration...</span>
    </div>

    <div class="ai-provider-info" id="ai-provider-info" style="display: none;">
      <span class="ai-provider-badge" id="ai-provider-badge"></span>
    </div>

    <div class="ai-settings-panel">
      <button class="ai-settings-toggle" id="ai-settings-toggle" title="Show/hide settings">
        <svg class="ai-settings-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z"/>
        </svg>
        <span>Settings</span>
      </button>
      <div class="ai-settings-content hidden" id="ai-settings-content">
        <div class="ai-options-bar">
          <label class="ai-option-toggle" title="Show a diff preview before applying AI changes">
            <input type="checkbox" id="ai-preview-changes" ${previewChangesEnabled ? 'checked' : ''} />
            <span class="ai-option-label">Preview changes</span>
          </label>
          <label class="ai-option-toggle" title="Visually verify Mermaid diagrams using the LLM (slower but more accurate)">
            <input type="checkbox" id="ai-visual-verify" ${visualVerifyMermaidEnabled ? 'checked' : ''} />
            <span class="ai-option-label">Verify diagrams</span>
          </label>
        </div>

        <div class="ai-persona-section" id="ai-persona-section">
        </div>
        <div class="ai-persona-manage">
          <button id="ai-persona-manage-btn" class="ai-persona-manage-btn">Manage Personas...</button>
        </div>

        <div class="ai-rag-section" id="ai-rag-section">
          <div class="ai-rag-header">
            <label class="ai-option-toggle" title="Use indexed files as context for AI responses">
              <input type="checkbox" id="ai-rag-enabled" />
              <span class="ai-option-label">Use file index</span>
            </label>
            <div id="ai-rag-loading" class="ai-rag-loading hidden">
              <span class="ai-rag-spinner"></span>
              <span class="ai-rag-loading-text">Loading catalogs...</span>
            </div>
            <button id="ai-rag-refresh" class="ai-rag-refresh-btn" title="Refresh selected catalog">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
          </div>
          <div id="ai-catalog-selector" class="ai-catalog-selector hidden">
            <button id="ai-catalog-dropdown-btn" class="ai-catalog-dropdown-btn">
              <span class="catalog-btn-text">Select Catalogs</span>
              <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
            <div id="ai-catalog-dropdown-menu" class="ai-catalog-dropdown-menu hidden">
              <div class="ai-catalog-list" id="ai-catalog-list">
                <div class="ai-catalog-empty">No catalogs available</div>
              </div>
              <div class="ai-catalog-actions">
                <button id="ai-catalog-manage" class="ai-catalog-manage-btn">Manage Catalogs...</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="ai-restore-bar" class="ai-restore-bar hidden">
      <span>Changes applied</span>
      <button id="ai-restore-btn">Undo Changes</button>
    </div>

    <div class="ai-chat-messages" id="ai-chat-messages">
      <div class="ai-welcome-message">
        <p><strong>Welcome to AI Copilot!</strong></p>
        <p>I can help you edit your Azure Wiki article. Try asking:</p>
        <ul>
          <li>"Add a table of contents at the top"</li>
          <li>"Create a flowchart diagram for the process"</li>
          <li>"Create a swimlane diagram showing the workflow"</li>
          <li>"Improve the formatting of this article"</li>
          <li>"Add a summary section at the end"</li>
        </ul>
        <p class="ai-hint"><em>Tip: Configure your preferred LLM provider in .env (LLM_PROVIDER=gemini|openai|azure|anthropic)</em></p>
      </div>
    </div>

    <div class="ai-input-area">
      <div class="ai-input-options">
        <label class="ai-option-label" title="Enable searching Azure DevOps Wiki">
          <input type="checkbox" id="ai-wiki-search-toggle" />
          <span>Search DevOps Wiki</span>
        </label>
      </div>
      <div class="ai-image-preview-container" id="ai-image-previews"></div>
      <div class="ai-input-row">
        <button id="ai-attach-btn" class="ai-attach-btn" title="Attach image" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>
        <textarea
          id="ai-input"
          placeholder="Ask me to help with your article..."
          rows="2"
          disabled
        ></textarea>
        <button id="ai-send-btn" class="ai-send-button" disabled>Send</button>
      </div>
    </div>
  `;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  const sidebar = document.getElementById('ai-chat-sidebar');
  if (!sidebar) return;

  // Close button
  sidebar.querySelector('.ai-sidebar-close').addEventListener('click', hideAISidebar);

  // Clear button
  sidebar.querySelector('.ai-btn-clear').addEventListener('click', clearChat);

  // Settings panel toggle
  const settingsToggle = document.getElementById('ai-settings-toggle');
  if (settingsToggle) {
    settingsToggle.addEventListener('click', () => {
      const content = document.getElementById('ai-settings-content');
      const icon = settingsToggle.querySelector('.ai-settings-toggle-icon');
      if (content) {
        const isHidden = content.classList.toggle('hidden');
        if (icon) {
          icon.style.transform = isHidden ? '' : 'rotate(180deg)';
        }
      }
    });
  }

  // Send button
  const sendBtn = document.getElementById('ai-send-btn');
  sendBtn.addEventListener('click', handleSendMessage);

  // Input field - Enter to send (Shift+Enter for new line)
  const input = document.getElementById('ai-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  // Paste handler for images
  input.addEventListener('paste', handlePasteImage);

  // Attach button
  const attachBtn = document.getElementById('ai-attach-btn');
  attachBtn.addEventListener('click', handleAttachImage);

  // Restore button
  const restoreBtn = document.getElementById('ai-restore-btn');
  restoreBtn.addEventListener('click', handleRestore);

  // Preview changes toggle
  const previewToggle = document.getElementById('ai-preview-changes');
  if (previewToggle) {
    previewToggle.addEventListener('change', (e) => {
      savePreviewChangesPreference(e.target.checked);
    });
  }

  // Visual verify mermaid toggle
  const visualVerifyToggle = document.getElementById('ai-visual-verify');
  if (visualVerifyToggle) {
    visualVerifyToggle.addEventListener('change', (e) => {
      saveVisualVerifyPreference(e.target.checked);
    });
  }

  // RAG enabled toggle
  const ragToggle = document.getElementById('ai-rag-enabled');
  if (ragToggle) {
    ragToggle.addEventListener('change', (e) => {
      ragEnabled = e.target.checked;
      const catalogSelector = document.getElementById('ai-catalog-selector');
      if (catalogSelector) {
        catalogSelector.classList.toggle('hidden', !ragEnabled);
      }
      if (ragEnabled && ragCatalogs.length === 0) {
        loadRAGCatalogs();
      }
    });
  }

  // RAG refresh button - reload catalog and persona dropdowns
  const ragRefreshBtn = document.getElementById('ai-rag-refresh');
  if (ragRefreshBtn) {
    ragRefreshBtn.addEventListener('click', handleSmartRefresh);
  }

  // Catalog dropdown button
  const catalogDropdownBtn = document.getElementById('ai-catalog-dropdown-btn');
  if (catalogDropdownBtn) {
    catalogDropdownBtn.addEventListener('click', toggleCatalogDropdown);
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dropdownMenu = document.getElementById('ai-catalog-dropdown-menu');
    const dropdownBtn = document.getElementById('ai-catalog-dropdown-btn');
    if (dropdownMenu && !dropdownMenu.classList.contains('hidden')) {
      if (!dropdownMenu.contains(e.target) && !dropdownBtn.contains(e.target)) {
        closeCatalogDropdown();
      }
    }
  });

  // Manage catalogs button
  const manageCatalogsBtn = document.getElementById('ai-catalog-manage');
  if (manageCatalogsBtn) {
    manageCatalogsBtn.addEventListener('click', () => {
      closeCatalogDropdown();
      showCatalogManager();
    });
  }

  // Manage personas button
  const managePersonasBtn = document.getElementById('ai-persona-manage-btn');
  if (managePersonasBtn) {
    managePersonasBtn.addEventListener('click', () => {
      showPersonaManagerDialog();
    });
  }

  // Listen for toggle from menu
  if (window.electronAPI?.onGeminiToggleSidebar) {
    window.electronAPI.onGeminiToggleSidebar(toggleAISidebar);
  }

  // Listen for catalog manager show command from menu (View > Manage Catalogs...)
  if (window.electronAPI?.onShowCatalogManager) {
    window.electronAPI.onShowCatalogManager(() => {
      showCatalogManager();
    });
  }

  // Listen for persona manager show command from menu
  if (window.electronAPI?.onShowPersonaManager) {
    window.electronAPI.onShowPersonaManager(() => {
      showPersonaManagerDialog();
    });
  }

  // Listen for catalog deletion/creation events from catalog manager
  document.addEventListener('catalog:deleted', () => loadRAGCatalogs());
  document.addEventListener('catalog:created', () => loadRAGCatalogs());

  // Load RAG catalogs on init — restore selection first, then fetch & prune
  loadSelectedCatalogs();
  loadRAGCatalogs();

  // Sidebar resize handle
  setupResizeHandle();
}

/**
 * Setup sidebar resize functionality
 */
function setupResizeHandle() {
  const sidebar = document.getElementById('ai-chat-sidebar');
  const resizeHandle = document.getElementById('ai-sidebar-resize-handle');
  if (!sidebar || !resizeHandle) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;

    // Add class for visual feedback
    sidebar.classList.add('resizing');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    // Sidebar is on the right, so we subtract the difference
    const diff = startX - e.clientX;
    let newWidth = startWidth + diff;

    // Clamp to min/max
    newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));

    sidebar.style.width = `${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;

    isResizing = false;
    sidebar.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Save width
    const width = sidebar.offsetWidth;
    localStorage.setItem(SIDEBAR_WIDTH_KEY, width.toString());
    console.log('[AI Chat] Sidebar width saved:', width);
  });
}

/**
 * Show/hide RAG loading indicator and manage input state
 */
function setRAGLoadingState(loading) {
  ragLoading = loading;
  const loadingIndicator = document.getElementById('ai-rag-loading');
  const ragToggle = document.getElementById('ai-rag-enabled');
  const catalogSelector = document.getElementById('ai-catalog-selector');

  if (loadingIndicator) {
    loadingIndicator.classList.toggle('hidden', !loading);
  }

  // Only disable RAG-specific controls while loading catalogs.
  // The message input and send button stay enabled — there's no reason
  // to block the user from typing while catalog metadata refreshes.
  if (loading) {
    if (ragToggle) ragToggle.disabled = true;
    if (catalogSelector) catalogSelector.classList.add('loading');
  } else {
    if (ragToggle) ragToggle.disabled = false;
    if (catalogSelector) catalogSelector.classList.remove('loading');
  }
}

/**
 * Load RAG catalogs from vector DB
 */
async function loadRAGCatalogs() {
  // Show loading indicator
  setRAGLoadingState(true);

  try {
    const isAvailable = await window.electronAPI.vectordbIsAvailable();
    const ragSection = document.getElementById('ai-rag-section');

    if (!isAvailable) {
      if (ragSection) ragSection.style.display = 'none';
      setRAGLoadingState(false);
      return;
    }

    if (ragSection) ragSection.style.display = 'block';

    const result = await window.electronAPI.vectordbGetCollections();
    if (result.success) {
      ragCatalogs = (result.collections || []).filter(c => !c.name.startsWith('persona-'));
      // Prune selectedCatalogs to only include catalogs that still exist
      const validNames = new Set(ragCatalogs.map(c => c.name));
      const before = selectedCatalogs.length;
      selectedCatalogs = selectedCatalogs.filter(name => validNames.has(name));
      if (selectedCatalogs.length !== before) {
        saveSelectedCatalogs();
      }
      renderCatalogDropdown();
    }
  } catch (error) {
    console.error('[AI Chat] Failed to load RAG catalogs:', error);
  } finally {
    setRAGLoadingState(false);
  }
}

/**
 * Toggle the catalog dropdown
 */
function toggleCatalogDropdown() {
  const menu = document.getElementById('ai-catalog-dropdown-menu');
  if (menu) {
    catalogDropdownOpen = !catalogDropdownOpen;
    menu.classList.toggle('hidden', !catalogDropdownOpen);
    document.getElementById('ai-catalog-dropdown-btn')?.classList.toggle('open', catalogDropdownOpen);
  }
}

/**
 * Close the catalog dropdown
 */
function closeCatalogDropdown() {
  const menu = document.getElementById('ai-catalog-dropdown-menu');
  if (menu) {
    catalogDropdownOpen = false;
    menu.classList.add('hidden');
    document.getElementById('ai-catalog-dropdown-btn')?.classList.remove('open');
  }
}

/**
 * Render the catalog dropdown
 */
function renderCatalogDropdown() {
  const listContainer = document.getElementById('ai-catalog-list');
  if (!listContainer) return;

  // Update dropdown button text
  updateCatalogButtonText();

  if (ragCatalogs.length === 0) {
    listContainer.innerHTML = '<div class="ai-catalog-empty">No catalogs available. Use File Browser to create catalogs.</div>';
    return;
  }

  listContainer.innerHTML = ragCatalogs.map(catalog => {
    const isSelected = selectedCatalogs.includes(catalog.name);
    const displayName = catalog.displayName || catalog.name;
    return `
      <label class="ai-catalog-item ${isSelected ? 'selected' : ''}" data-name="${catalog.name}">
        <input type="checkbox" value="${catalog.name}" ${isSelected ? 'checked' : ''} />
        <span class="catalog-name">${displayName}</span>
        <span class="catalog-count">${catalog.fileCount || 0} files</span>
      </label>
    `;
  }).join('');

  // Add event listeners for catalog checkboxes
  listContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const name = e.target.value;
      if (e.target.checked) {
        if (!selectedCatalogs.includes(name)) {
          selectedCatalogs.push(name);
        }
      } else {
        selectedCatalogs = selectedCatalogs.filter(n => n !== name);
      }
      saveSelectedCatalogs();
      e.target.closest('.ai-catalog-item').classList.toggle('selected', e.target.checked);
      updateCatalogButtonText();
    });
  });
}

/**
 * Update the catalog dropdown button text
 */
function updateCatalogButtonText() {
  const btnText = document.querySelector('#ai-catalog-dropdown-btn .catalog-btn-text');
  if (!btnText) return;

  if (selectedCatalogs.length === 0) {
    btnText.textContent = 'Select Catalogs';
  } else if (selectedCatalogs.length === 1) {
    const catalog = ragCatalogs.find(c => c.name === selectedCatalogs[0]);
    btnText.textContent = catalog?.displayName || selectedCatalogs[0];
  } else {
    btnText.textContent = 'Multiple Catalogs';
  }
}

/**
 * Load selected catalogs from localStorage
 */
function loadSelectedCatalogs() {
  try {
    const stored = localStorage.getItem(RAG_SELECTED_CATALOGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Filter out persona catalogs — they should never be in the file index selection
      const filtered = parsed.filter(name => !name.startsWith('persona-'));
      selectedCatalogs = filtered;
      // Re-save if we filtered anything out
      if (filtered.length !== parsed.length) {
        saveSelectedCatalogs();
      }
    }
  } catch (e) {
    console.warn('[AI Chat] Failed to load selected catalogs:', e);
  }
}

/**
 * Save selected catalogs to localStorage
 */
function saveSelectedCatalogs() {
  try {
    localStorage.setItem(RAG_SELECTED_CATALOGS_KEY, JSON.stringify(selectedCatalogs));
  } catch (e) {
    console.warn('[AI Chat] Failed to save selected catalogs:', e);
  }
}

/**
 * Refresh the catalog and persona dropdowns with the latest available lists
 */
async function handleSmartRefresh() {
  const refreshBtn = document.getElementById('ai-rag-refresh');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('spinning');
  }

  try {
    await Promise.all([
      loadRAGCatalogs(),
      refreshPersonas()
    ]);
  } catch (error) {
    console.error('[AI Chat] Refresh error:', error);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spinning');
    }
  }
}

/**
 * Show catalog manager dialog
 */
function showCatalogManager() {
  // Import and show the catalog manager modal
  import('./catalog-manager/catalog-manager.js').then(module => {
    module.showCatalogManager({
      onClose: () => loadRAGCatalogs()
    });
  }).catch(err => {
    console.error('[AI Chat] Failed to load catalog manager:', err);
    addMessageToChat('error', 'Failed to open catalog manager');
  });
}

/**
 * Show persona manager dialog
 */
function showPersonaManagerDialog() {
  import('./persona/persona-manager.js').then(module => {
    module.showPersonaManager({
      onClose: () => { refreshPersonas(); loadRAGCatalogs(); }
    });
  }).catch(err => {
    console.error('[AI Chat] Failed to load persona manager:', err);
    addMessageToChat('error', 'Failed to open persona manager');
  });
}

/**
 * Search RAG catalogs for relevant context using enhanced context assembly
 * @param {string} query - User query
 * @returns {Promise<Array>} Relevant context chunks with sources
 */
async function searchRAGContext(query) {
  if (!ragEnabled || selectedCatalogs.length === 0) {
    return [];
  }

  // Try enhanced context assembly first (uses code graph)
  try {
    if (window.electronAPI.vectordbAssembleContext) {
      const result = await window.electronAPI.vectordbAssembleContext({
        query,
        catalogNames: selectedCatalogs,
        options: { limit: 10, minScore: 0.3 }
      });

      if (result.success) {
        console.log(`[AI Chat] Context assembled: intent=${result.intent}, sources=${result.sourceCount}`);

        // Build results array compatible with existing RAG context format
        const assembledResults = [];

        // Add graph context as a special chunk if present
        if (result.graphContext) {
          assembledResults.push({
            text: result.graphContext,
            score: 1.0,
            metadata: { structureType: 'graph_context', fileName: 'Code Graph Context' },
            catalog: selectedCatalogs[0]
          });
        }

        // Add search result chunks
        if (result.chunks) {
          assembledResults.push(...result.chunks.map(c => ({
            ...c,
            catalog: c.catalog || selectedCatalogs[0]
          })));
        }

        return assembledResults;
      }
    }
  } catch (error) {
    console.warn('[AI Chat] Enhanced context assembly failed, falling back to basic search:', error.message);
  }

  // Fallback: basic vector search
  const allResults = [];

  for (const catalogName of selectedCatalogs) {
    try {
      const result = await window.electronAPI.vectordbSearch({
        collectionName: catalogName,
        query,
        options: { limit: 5, minScore: 0.3 }
      });

      if (result.success && result.results) {
        allResults.push(...result.results.map(r => ({
          ...r,
          catalog: catalogName
        })));
      }
    } catch (error) {
      console.error(`[AI Chat] RAG search failed for ${catalogName}:`, error);
    }
  }

  // Sort by score and limit to top 10
  allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
  return allResults.slice(0, 10);
}

/**
 * Provider display names
 */
const PROVIDER_NAMES = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  azure: 'Azure OpenAI',
  anthropic: 'Anthropic Claude'
};

/**
 * Search intent detection patterns
 */
const SEARCH_PATTERNS = [
  // Original patterns
  /find\s+(?:documents?|pages?|articles?)\s+(?:about|related|on|for)/i,
  /search\s+(?:for|the\s+wiki|wiki\s+for)/i,
  /look\s+(?:for|up)\s+(?:information|pages?|docs?)/i,
  /what\s+(?:do\s+we\s+have|pages?\s+exist|articles?)\s+(?:about|on|for)/i,
  /gather\s+information\s+(?:about|on|from)/i,
  /find\s+(?:all|any)?\s*(?:related|relevant)?\s*(?:documentation|wiki\s+pages?)/i,
  /search\s+(?:across|through)\s+(?:the\s+)?wiki/i,
  /research\s+(?:about|on|for)/i,
  /find\s+(?:information|content|material)\s+(?:about|on|for|related)/i,

  // Review/summarize patterns
  /review\s+(?:the\s+)?(?:wiki\s+)?(?:articles?|pages?|docs?|documentation)/i,
  /summarize\s+(?:the\s+)?(?:wiki\s+)?(?:articles?|pages?|content|info)/i,
  /summarize\s+(?:everything|all)\s+(?:about|on|related\s+to)/i,

  // Tell me about / what is patterns
  /(?:tell\s+me|explain)\s+(?:about|what)/i,
  /what\s+(?:is|are)\s+(?:the\s+)?(?:\w+\s+){0,3}(?:in\s+the\s+wiki)/i,
  /what\s+(?:does|do)\s+(?:the\s+)?wiki\s+(?:say|have)/i,

  // Write summary/article based on wiki
  /write\s+(?:me\s+)?(?:a\s+)?(?:summary|article|overview)\s+(?:about|on|for)/i,
  /create\s+(?:a\s+)?(?:summary|overview|report)\s+(?:of|about|on)/i,

  // General wiki reference
  /(?:check|read|scan)\s+(?:the\s+)?wiki\s+(?:for|about)/i,
  /(?:from|using|based\s+on)\s+(?:the\s+)?wiki/i,
  /(?:in|across)\s+(?:the\s+)?wiki/i,

  // "Give me" patterns
  /give\s+me\s+(?:info|information|details|an?\s+overview)\s+(?:about|on)/i,
  /show\s+me\s+(?:what|everything|all)\s+(?:we\s+have|there\s+is)/i
];

/**
 * Detect if the message is a search request
 * @param {string} message - User message
 * @returns {boolean} True if this looks like a wiki search request
 */
function detectSearchRequest(message) {
  if (!message) return false;
  return SEARCH_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Documentation generation request patterns
 */
const DOC_REQUEST_PATTERNS = [
  /(?:write|generate|create)\s+(?:developer\s+)?(?:documentation|docs)\s+(?:for|about)/i,
  /(?:write|generate|create)\s+(?:developer\s+)?(?:documentation|docs)$/i,
  /(?:document|create\s+a?\s*guide\s+for)\s+(?:this|the)\s+(?:codebase|project|code)/i,
  /(?:generate|write)\s+(?:a\s+)?(?:developer\s+guide|technical\s+docs)/i,
  /(?:create|produce)\s+(?:api\s+)?(?:reference|documentation)\s+(?:for|about)/i
];

/**
 * Detect if the message is a documentation generation request
 * @param {string} message - User message
 * @returns {boolean}
 */
function detectDocRequest(message) {
  if (!message) return false;
  return DOC_REQUEST_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Handle documentation generation request
 * @param {string} message - User's message
 */
async function handleDocGeneration(message) {
  addMessageToChat('assistant', 'Starting documentation generation for your catalog(s)...');

  // Set up progress listener — update the last assistant message in place
  const progressHandler = (progress) => {
    const text = progress.message || 'Generating...';
    const pct = progress.progress ? ` (${progress.progress}%)` : '';
    updateLastAssistantMessage(`${text}${pct}`);
  };

  if (window.electronAPI.onDocsProgress) {
    window.electronAPI.onDocsProgress(progressHandler);
  }

  try {
    const result = await window.electronAPI.docsGenerate({
      catalogNames: selectedCatalogs
    });

    // Clean up progress listener
    if (window.electronAPI.removeDocsProgressListener) {
      window.electronAPI.removeDocsProgressListener();
    }

    if (result.success) {
      // Store generated content for potential insertion
      window.lastGeneratedContent = result.document;

      updateLastAssistantMessage(`Documentation generated! (${result.sectionCount} sections)`);

      // Show preview in chat with truncation
      const preview = result.document.length > 2000
        ? result.document.substring(0, 2000) + '\n\n...(truncated — type "insert" to add full document to editor)'
        : result.document;

      addMessageToChat('assistant', preview);
      addMessageToChat('assistant', 'Type **"insert"** to add this documentation to your editor, or continue chatting.');
    } else if (result.cancelled) {
      updateLastAssistantMessage('Documentation generation was cancelled.');
    } else {
      addMessageToChat('error', `Documentation generation failed: ${result.error}`);
    }
  } catch (error) {
    if (window.electronAPI.removeDocsProgressListener) {
      window.electronAPI.removeDocsProgressListener();
    }
    addMessageToChat('error', `Documentation generation error: ${error.message}`);
  }
}

/**
 * Update the last assistant message in the chat (for progress updates)
 */
function updateLastAssistantMessage(newText) {
  const messagesContainer = document.getElementById('ai-chat-messages');
  if (!messagesContainer) return;

  const messages = messagesContainer.querySelectorAll('.ai-message.assistant');
  if (messages.length === 0) return;

  const lastMsg = messages[messages.length - 1];
  const textEl = lastMsg.querySelector('.ai-message-text');
  if (textEl) {
    textEl.textContent = newText;
  }
}

/**
 * Detect if the user's message is a question (Q&A mode), edit request, or create new document request
 * @param {string} message - User message
 * @returns {'qa' | 'edit' | 'create'} - The detected intent
 */
/**
 * Detect message intent using LLM classification with regex fallback.
 * Returns 'create', 'edit', or 'qa'.
 */
async function detectMessageIntent(message, hasActivePersona = false) {
  if (!message) return 'edit';

  // Fast-path: diagram/chart/visual creation always means edit (insert into current doc)
  if (/(?:draw|create|make|generate|add)\s+(?:me\s+)?(?:a\s+)?(?:mermaid\s+)?(?:diagram|chart|flowchart|graph|sequence|gantt|table)/i.test(message)) {
    console.log('[AI Chat] Fast-path: diagram/visual creation → edit');
    return 'edit';
  }

  // Try LLM-based classification first
  try {
    const result = await window.electronAPI.llmClassifyIntent({
      message,
      hasActivePersona
    });
    if (result.success && result.intent) {
      console.log('[AI Chat] LLM classified intent:', result.intent);
      return result.intent;
    }
    console.log('[AI Chat] LLM classification unavailable, using regex fallback');
  } catch (err) {
    console.warn('[AI Chat] LLM classification failed, using regex fallback:', err.message);
  }

  // Regex fallback
  return detectMessageIntentRegex(message, hasActivePersona);
}

/**
 * Regex-based intent detection (fallback when LLM is unavailable)
 */
function detectMessageIntentRegex(message, hasActivePersona = false) {
  const lowerMsg = message.toLowerCase().trim();

  // Create new document patterns - check these first (most specific)
  const createPatterns = [
    /create\s+(?:an?\s+)?new\s+(?:article|document|page|doc|wiki)/i,
    /(?:make|write|generate|draft)\s+(?:an?\s+)?new\s+(?:article|document|page|doc)/i,
    /(?:summarize|compile|consolidate)\s+(?:this\s+)?(?:into|as)\s+(?:an?\s+)?(?:new\s+)?(?:article|document|page)/i,
    /(?:turn|convert)\s+(?:this|that|it)\s+into\s+(?:an?\s+)?(?:new\s+)?(?:article|document)/i,
    /(?:write|create|generate|draft)\s+(?:me\s+)?(?:an?\s+)?(?:article|document|summary|guide|tutorial|blog\s*post|report|essay|paper|manual|readme|spec|proposal|overview|runbook|playbook|plan)\b/i,
    /(?:put|save)\s+(?:this|that|it)\s+(?:in|into)\s+(?:an?\s+)?new\s+(?:article|document|page)/i,
    /new\s+(?:article|document|page)\s+(?:with|from|about|based)/i
  ];

  for (const pattern of createPatterns) {
    if (pattern.test(lowerMsg)) {
      console.log('[AI Chat] Detected create intent due to pattern:', pattern);
      return 'create';
    }
  }

  // Explicit edit keywords - these indicate user wants to modify the CURRENT document
  const editKeywords = [
    'edit', 'change', 'modify', 'update', 'rewrite', 'fix', 'correct',
    'add section', 'remove section', 'delete', 'insert', 'replace',
    'add a', 'add the', 'add to', 'append', 'prepend',
    'remove', 'improve', 'refactor', 'restructure', 'reorganize',
    'format', 'reformat', 'convert', 'transform',
    'draw', 'diagram', 'flowchart', 'chart', 'generate'
  ];

  for (const keyword of editKeywords) {
    if (lowerMsg.includes(keyword)) {
      console.log('[AI Chat] Detected edit intent due to keyword:', keyword);
      return 'edit';
    }
  }

  // Question patterns indicate Q&A mode
  const questionPatterns = [
    /^(what|how|why|when|where|who|which|can|does|is|are|will|would|should|could)\b/i,
    /\?$/,
    /^(tell me|explain|describe|show me|give me|list|find)\s+(about|how|what|the)/i,
    /^(do you know|can you tell|could you explain)/i
  ];

  for (const pattern of questionPatterns) {
    if (pattern.test(lowerMsg)) {
      console.log('[AI Chat] Detected Q&A intent due to pattern:', pattern);
      return 'qa';
    }
  }

  // When a persona is active, default to Q&A mode for conversational/creative requests
  if (hasActivePersona) {
    console.log('[AI Chat] No clear intent detected, defaulting to Q&A mode (persona active)');
    return 'qa';
  }

  // Default to edit mode if unclear (preserves existing behavior)
  console.log('[AI Chat] No clear intent detected, defaulting to edit mode');
  return 'edit';
}

/**
 * Check if LLM is configured
 */
async function checkConfiguration() {
  const statusIndicator = document.querySelector('.ai-status-indicator');
  const statusText = document.querySelector('.ai-status-text');
  const input = document.getElementById('ai-input');
  const sendBtn = document.getElementById('ai-send-btn');
  const attachBtn = document.getElementById('ai-attach-btn');
  const providerInfo = document.getElementById('ai-provider-info');
  const providerBadge = document.getElementById('ai-provider-badge');

  try {
    const config = await window.electronAPI.geminiGetConfig();
    const providerName = PROVIDER_NAMES[config.provider] || config.provider;

    if (config.isConfigured) {
      statusIndicator.className = 'ai-status-indicator ready';
      statusText.textContent = `Ready (${config.model})`;
      input.disabled = isWaitingForResponse;
      sendBtn.disabled = isWaitingForResponse;
      attachBtn.disabled = isWaitingForResponse;
      input.placeholder = 'Ask me to help with your article...';

      // Show provider badge
      if (providerInfo && providerBadge) {
        providerInfo.style.display = 'block';
        providerBadge.textContent = providerName;
        providerBadge.className = `ai-provider-badge provider-${config.provider}`;
      }
    } else {
      statusIndicator.className = 'ai-status-indicator error';
      statusText.textContent = `${providerName} not configured`;
      input.placeholder = `Add ${config.provider.toUpperCase()}_API_KEY to .env file to enable`;
      attachBtn.disabled = true;

      // Hide provider badge when not configured
      if (providerInfo) {
        providerInfo.style.display = 'none';
      }
    }
  } catch (error) {
    statusIndicator.className = 'ai-status-indicator error';
    statusText.textContent = 'Configuration error';
    input.placeholder = 'Error checking configuration';
    attachBtn.disabled = true;
  }
}

/**
 * Handle attaching an image via file selection
 */
async function handleAttachImage() {
  if (isWaitingForResponse) return;

  try {
    const result = await window.electronAPI.selectImageFile();
    if (result.success && result.image) {
      addImageToAttachments(result.image);
    } else if (result.error) {
      addMessageToChat('error', result.error);
    }
  } catch (error) {
    addMessageToChat('error', `Failed to select image: ${error.message}`);
  }
}

/**
 * Handle pasting an image from clipboard
 */
async function handlePasteImage(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (!blob) continue;

      // Check file size (20MB max)
      if (blob.size > 20 * 1024 * 1024) {
        addMessageToChat('error', 'Image too large. Maximum size is 20MB.');
        return;
      }

      try {
        const base64 = await blobToBase64(blob);
        const image = {
          data: base64.split(',')[1], // Remove data URL prefix
          mimeType: blob.type,
          name: `pasted-image-${Date.now()}.${blob.type.split('/')[1]}`
        };
        addImageToAttachments(image);
      } catch (error) {
        addMessageToChat('error', `Failed to process pasted image: ${error.message}`);
      }
      return;
    }
  }
}

/**
 * Convert blob to base64 string
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Add an image to the attachments array
 */
function addImageToAttachments(image) {
  // Limit to 4 images
  if (attachedImages.length >= 4) {
    addMessageToChat('error', 'Maximum 4 images per message.');
    return;
  }

  attachedImages.push(image);
  renderImagePreviews();
}

/**
 * Render image previews in the input area
 */
function renderImagePreviews() {
  const container = document.getElementById('ai-image-previews');
  if (!container) return;

  if (attachedImages.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = attachedImages.map((img, index) => `
    <div class="ai-image-preview" data-index="${index}">
      <img src="data:${img.mimeType};base64,${img.data}" alt="${img.name}" />
      <button class="ai-image-remove" onclick="window.aiRemoveImage(${index})" title="Remove image">&times;</button>
    </div>
  `).join('');
}

/**
 * Remove an image from attachments
 */
function removeImage(index) {
  attachedImages.splice(index, 1);
  renderImagePreviews();
}

// Expose removeImage globally for onclick handler
window.aiRemoveImage = removeImage;

/**
 * Clear all attached images
 */
function clearAttachments() {
  attachedImages = [];
  renderImagePreviews();
}

/**
 * Handle sending a message (or cancel if in loading state)
 */
async function handleSendMessage() {
  // If we're waiting for a response, this is a cancel click
  if (isWaitingForResponse) {
    handleCancelRequest();
    return;
  }

  const input = document.getElementById('ai-input');
  const message = input.value.trim();

  // Allow send if there's text OR images (not neither)
  if (!message && attachedImages.length === 0) return;

  // Check for generated content insertion request
  if (window.lastGeneratedContent && /^(yes|insert|add it|apply)$/i.test(message)) {
    input.value = '';
    addMessageToChat('user', message);
    setEditorContentFn(window.lastGeneratedContent);
    addMessageToChat('assistant', 'Content inserted into the editor.');
    window.lastGeneratedContent = null;
    showRestoreBar();
    return;
  }

  // Check for wiki search request (only when checkbox is enabled)
  const wikiSearchEnabled = document.getElementById('ai-wiki-search-toggle')?.checked;
  if (wikiSearchEnabled && detectSearchRequest(message) && attachedImages.length === 0) {
    // Add user message to chat
    addMessageToChat('user', message);
    input.value = '';

    // Show loading state
    setLoadingState(true);

    await handleWikiSearch(message);
    setLoadingState(false);
    return;
  }

  // Check for documentation generation request
  if (detectDocRequest(message) && ragEnabled && selectedCatalogs.length > 0) {
    addMessageToChat('user', message);
    input.value = '';
    setLoadingState(true);

    await handleDocGeneration(message);
    setLoadingState(false);
    return;
  }

  // Check for multi-persona mode
  if (isMultiSelectMode()) {
    // If conversation is active, treat as interjection
    if (multiPersonaConversationActive) {
      input.value = '';
      await handleUserInterjection(message);
      return;
    }

    // Check if valid selection (2+ personas)
    if (hasValidMultiSelection()) {
      input.value = '';
      await handleMultiPersonaConversation(message);
      return;
    } else {
      addMessageToChat('error', 'Please select at least 2 personas for multi-persona mode.');
      return;
    }
  }

  // Get current article content
  const articleContent = getEditorContentFn();
  // Allow empty documents - AI can create content from scratch
  // Only block if getEditorContentFn returns null/undefined (editor not ready)
  if (articleContent === null || articleContent === undefined) {
    addMessageToChat('error', 'Editor not ready. Please wait for the editor to initialize.');
    return;
  }

  // Capture images before clearing
  const imagesToSend = [...attachedImages];

  // Add user message to chat (with images)
  addMessageToChat('user', message || '(Image attached)', imagesToSend);
  input.value = '';
  clearAttachments();

  // Show loading state
  setLoadingState(true);

  try {
    // Create backup first
    const pagePath = getCurrentPagePathFn() || 'untitled';
    const backupResult = await window.electronAPI.geminiCreateBackup({
      content: articleContent,
      pagePath: pagePath
    });

    if (backupResult.success) {
      lastBackupPath = pagePath;
    }

    // Detect intent: question or edit?
    const intent = await detectMessageIntent(message, !!getActivePersonaName());
    console.log('[AI Chat] Detected intent:', intent);

    // Search RAG context if enabled (auto-enabled when persona is active)
    let ragContext = [];
    const activePersona = getActivePersona();
    if (ragEnabled && selectedCatalogs.length > 0) {
      ragContext = await searchRAGContext(message);
      if (ragContext.length > 0) {
        console.log(`[AI Chat] Found ${ragContext.length} RAG context chunks`);
      }
    }

    // Build RAG context string for LLM (only for edit mode - Q&A mode passes ragContext directly)
    let messageToSend = message;
    if (intent === 'edit' && ragContext.length > 0) {
      let ragContextStr = '\n\n--- RELEVANT CONTEXT FROM INDEXED FILES ---\n';
      ragContext.forEach((ctx, i) => {
        // Use full filePath (includes drive letter on Windows)
        const source = ctx.metadata?.filePath || ctx.metadata?.relativePath || ctx.metadata?.fileName || 'Unknown';
        const section = ctx.metadata?.title || '';
        ragContextStr += `\n[Source ${i + 1}: ${source}${section ? ' - ' + section : ''}]\n${ctx.text}\n`;
      });
      ragContextStr += '\n--- END CONTEXT ---\n';
      messageToSend = message + ragContextStr;
    }

    // Send to LLM (with images, mode, RAG context, visual verify flag, and persona)
    const personaName = getActivePersonaName();
    const response = await window.electronAPI.geminiSendMessage({
      message: messageToSend,
      articleContent: articleContent,
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
      mode: intent,
      ragContext: ragContext.length > 0 ? ragContext : undefined,
      visualVerifyMermaid: visualVerifyMermaidEnabled,
      personaName: personaName || undefined,
      chatHistory: chatHistory.length > 0 ? chatHistory.slice(-10) : undefined
    });

    if (!response.success) {
      addMessageToChat('error', response.error);
      setLoadingState(false);
      return;
    }

    // Check if LLM is asking for clarification
    if (response.needsClarification) {
      // Display clarification question
      let clarificationMessage = response.clarificationQuestion;

      // Add options if provided
      if (response.options && response.options.length > 0) {
        clarificationMessage += '\n\nSuggested options:\n' + response.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
      }

      // Add context if provided
      if (response.context) {
        clarificationMessage += `\n\n(${response.context})`;
      }

      addMessageToChat('clarification', clarificationMessage);

      // Add to history
      chatHistory.push({ role: 'user', content: message });
      chatHistory.push({ role: 'assistant', content: clarificationMessage });

      setLoadingState(false);
      return;
    }

    // Check if this is a Q&A response (text answer, no document edit)
    if (response.text && !response.updatedArticle) {
      // Q&A mode: just display the response as text
      addMessageToChat('assistant', response.text);

      // Show RAG sources if context was used
      if (ragContext.length > 0) {
        const sourcesHtml = formatRAGSources(ragContext);
        addMessageToChat('sources', sourcesHtml);
      }

      // Add to history
      chatHistory.push({ role: 'user', content: message });
      chatHistory.push({ role: 'assistant', content: response.text });

      setLoadingState(false);
      return;
    }

    // Check if this is a create document response
    if (response.createDocument) {
      // Append RAG sources to the new document if context was used
      let createContent = response.content || '';
      if (ragContext.length > 0) {
        createContent += formatRAGSourcesAsMarkdown(ragContext);
      }

      // Create a new tab with the generated content
      try {
        const newTab = await window.electronAPI.tabsCreate({
          type: 'untitled',
          title: response.title || 'New Document',
          content: createContent
        });

        addMessageToChat('assistant', `Created new document: **${response.title}**\n\n${response.summary || 'Document is ready in the new tab.'}`);

        // Show RAG sources if context was used
        if (ragContext.length > 0) {
          const sourcesHtml = formatRAGSources(ragContext);
          addMessageToChat('sources', sourcesHtml);
        }

        // Add to history
        chatHistory.push({ role: 'user', content: message });
        chatHistory.push({ role: 'assistant', content: `Created: ${response.title}` });

      } catch (error) {
        console.error('[AI Chat] Failed to create new tab:', error);
        addMessageToChat('error', `Failed to create new document: ${error.message}`);
      }

      setLoadingState(false);
      return;
    }

    // If we got updated article content, validate it
    if (response.updatedArticle) {
      const validation = await window.electronAPI.geminiValidateMarkdown(response.updatedArticle);

      if (!validation.isValid) {
        // Try to fix with another request
        addMessageToChat('assistant', 'Found some issues, attempting to fix...');

        const fixResponse = await window.electronAPI.geminiSendMessage({
          message: `The markdown you returned has these errors: ${validation.errors.join(', ')}. Please fix them and return the corrected article.`,
          articleContent: response.updatedArticle
        });

        if (fixResponse.success && fixResponse.updatedArticle) {
          response.updatedArticle = fixResponse.updatedArticle;
          response.changeSummary = (response.changeSummary || '') + ' (auto-corrected)';
        }
      }

      // Do final renderer-side mermaid validation using actual mermaid parser
      try {
        const mermaidValidation = await mermaidValidator.validateMermaidInContent(response.updatedArticle);
        if (!mermaidValidation.isValid && mermaidValidation.hasBlocks) {
          // Mermaid has syntax errors - show warning but still apply (user can undo)
          const errorMsg = mermaidValidator.formatErrors(mermaidValidation.errors);
          console.warn('[AI Chat] Mermaid validation failed:', errorMsg);
          response.changeSummary = (response.changeSummary || 'Changes applied') +
            '\n\nWarning: Mermaid diagram may have syntax errors. Click "Undo Changes" if needed.';
        }
      } catch (mermaidError) {
        console.warn('[AI Chat] Mermaid validation error:', mermaidError);
        // Don't block on mermaid validation errors
      }

      // Append RAG sources to the wiki content if context was used
      if (ragContext.length > 0) {
        response.updatedArticle += formatRAGSourcesAsMarkdown(ragContext);
      }

      // Check if preview is enabled
      if (previewChangesEnabled) {
        // Show diff preview dialog for user approval
        const previewResult = await showAIChangesPreview({
          originalContent: articleContent,
          newContent: response.updatedArticle,
          changeSummary: response.changeSummary || 'Changes ready to apply'
        });

        if (previewResult.noChanges) {
          // AI returned identical content
          addMessageToChat('assistant', 'No changes were made to the document.');
        } else if (previewResult.action === 'apply') {
          // User approved - apply changes to editor
          setEditorContentFn(previewResult.content);

          // Show change summary
          addMessageToChat('assistant', response.changeSummary || 'Changes applied successfully.');

          // Show restore option
          showRestoreBar();
        } else {
          // User discarded changes
          addMessageToChat('assistant', 'Changes discarded. The document was not modified.');
        }
      } else {
        // Preview disabled - apply changes directly
        setEditorContentFn(response.updatedArticle);

        // Show change summary
        addMessageToChat('assistant', response.changeSummary || 'Changes applied successfully.');

        // Show restore option
        showRestoreBar();
      }
    } else {
      // No article changes, just a response
      addMessageToChat('assistant', response.changeSummary || 'I was unable to make changes to the article.');
    }

    // Show RAG sources if context was used
    if (ragContext.length > 0) {
      const sourcesHtml = formatRAGSources(ragContext);
      addMessageToChat('sources', sourcesHtml);
    }

    // Add to local history
    chatHistory.push({ role: 'user', content: message });
    chatHistory.push({ role: 'assistant', content: response.changeSummary });

  } catch (error) {
    addMessageToChat('error', `Error: ${error.message}`);
  } finally {
    setLoadingState(false);
  }
}

/**
 * Handle restore from backup
 */
async function handleRestore() {
  try {
    const result = await window.electronAPI.geminiRestoreBackup(lastBackupPath);

    if (result.success) {
      setEditorContentFn(result.content);
      addMessageToChat('assistant', 'Previous version restored.');
      hideRestoreBar();
    } else {
      addMessageToChat('error', result.error || 'Failed to restore backup.');
    }
  } catch (error) {
    addMessageToChat('error', `Restore failed: ${error.message}`);
  }
}

/**
 * Handle wiki search workflow with synthesis
 * @param {string} query - User's search query
 */
async function handleWikiSearch(query) {
  console.log('[AI Chat] Starting wiki search for:', query);

  // Setup progress listener for search phase
  const searchProgressHandler = (progress) => {
    updateSearchProgress(progress);
  };

  // Setup progress listener for synthesis phase
  const synthesisProgressHandler = (progress) => {
    updateSearchProgress({
      ...progress,
      // Map synthesis phases to search progress format
      phase: progress.phase === 'mapping' ? 'analyzing' : progress.phase,
      message: progress.message
    });
  };

  window.electronAPI.onWikiSearchProgress(searchProgressHandler);

  // Extract search terms BEFORE showing confirmation dialog
  // This gives the user a better preview of what will be searched
  let extractedTerms = null;
  try {
    // First try quick extraction (quoted terms only, no LLM call)
    const extraction = await window.electronAPI.wikiExtractSearchTerms({ query, allowLlm: false });
    if (extraction.success) {
      extractedTerms = extraction.keywords;
      console.log('[AI Chat] Pre-extracted search terms:', extractedTerms);
    }
  } catch (e) {
    console.warn('[AI Chat] Term extraction failed:', e.message);
  }

  // Show confirmation dialog with extracted terms (if available)
  const confirmed = await showSearchConfirmation(query, extractedTerms);
  if (!confirmed) {
    window.electronAPI.removeWikiSearchProgressListener();
    addMessageToChat('assistant', 'Search cancelled.');
    setLoadingState(false);
    return;
  }

  // Show progress overlay for initial keyword extraction and page matching
  showSearchProgress({
    onCancel: () => {
      window.electronAPI.wikiCancelSearch({ mode: 'abort' });
      window.electronAPI.wikiCancelSynthesis();
    },
    onStop: () => {
      window.electronAPI.wikiCancelSearch({ mode: 'stop' });
    }
  });

  try {
    // Phase 1: Extract keywords and find matching pages (stopBeforeFetch=true)
    const matchResult = await window.electronAPI.wikiSearchPages({
      query,
      stopBeforeFetch: true
    });

    // Handle cancellation
    if (matchResult.cancelled) {
      hideSearchProgress();
      window.electronAPI.removeWikiSearchProgressListener();
      if (matchResult.cancelMode === 'abort') {
        addMessageToChat('assistant', 'Search cancelled.');
      }
      return;
    }

    // Handle errors
    if (!matchResult.success && !matchResult.needsSelection) {
      hideSearchProgress();
      window.electronAPI.removeWikiSearchProgressListener();
      addMessageToChat('error', matchResult.error || 'Search failed.');
      return;
    }

    // Handle no pages found
    if (matchResult.pagesFound === 0) {
      hideSearchProgress();
      window.electronAPI.removeWikiSearchProgressListener();
      addMessageToChat('assistant', 'No pages found matching your search terms.');
      return;
    }

    // Hide progress and show result count selector
    hideSearchProgress();

    const selection = await showResultCountSelector(
      matchResult.pagesFound,
      matchResult.keywords || []
    );

    if (!selection) {
      window.electronAPI.removeWikiSearchProgressListener();
      addMessageToChat('assistant', 'Search cancelled.');
      return;
    }

    // Show progress again for synthesis
    showSearchProgress({
      onCancel: () => {
        window.electronAPI.wikiCancelSynthesis();
      },
      onStop: () => {
        window.electronAPI.wikiCancelSynthesis();
      }
    });

    // Switch to synthesis progress listener
    window.electronAPI.removeWikiSearchProgressListener();
    window.electronAPI.onWikiSynthesisProgress(synthesisProgressHandler);

    // Get current article content for context
    const currentPageContent = getEditorContentFn() || '';

    // Run synthesis (Map-Reduce)
    const synthesisResult = await window.electronAPI.wikiSynthesize({
      query,
      pages: matchResult.pages,
      maxPages: selection.count,
      currentPageContent
    });

    hideSearchProgress();
    window.electronAPI.removeWikiSynthesisProgressListener();

    // Handle cancellation during synthesis
    if (synthesisResult.cancelled) {
      addMessageToChat('assistant', 'Synthesis cancelled.');
      return;
    }

    // Handle errors
    if (!synthesisResult.success) {
      addMessageToChat('error', synthesisResult.error || 'Synthesis failed.');
      return;
    }

    // Show sources used
    if (synthesisResult.sourcesUsed && synthesisResult.sourcesUsed.length > 0) {
      let sourcesMsg = `**Analyzed ${synthesisResult.pagesAnalyzed} pages:**\n`;
      synthesisResult.sourcesUsed.slice(0, 10).forEach(source => {
        const imgNote = source.hasImages ? ' (with images)' : '';
        sourcesMsg += `- [${source.title}](${source.path})${imgNote}\n`;
      });
      addMessageToChat('assistant', sourcesMsg);
    }

    // Show diff preview if enabled
    if (previewChangesEnabled && synthesisResult.content) {
      // Debug: Log the content arriving from IPC (preview path)
      const contentLines = synthesisResult.content.split('\n');
      const refsIdx = contentLines.findIndex(l => l.trim() === '## References');
      if (refsIdx !== -1) {
        console.log('[AI Chat] References from IPC BEFORE preview (lines', refsIdx, 'to end):');
        contentLines.slice(refsIdx, refsIdx + 10).forEach((line, i) => {
          console.log(`  IPC refs line ${refsIdx + i}: "${line}"`);
        });
      }

      const previewResult = await showAIChangesPreview({
        originalContent: currentPageContent,
        newContent: synthesisResult.content,
        changeSummary: `Synthesized content from ${synthesisResult.pagesAnalyzed} wiki pages`
      });

      if (previewResult.noChanges) {
        addMessageToChat('assistant', 'No changes were needed.');
      } else if (previewResult.action === 'apply') {
        // Debug: Log content after preview
        const previewLines = previewResult.content.split('\n');
        const previewRefsIdx = previewLines.findIndex(l => l.trim() === '## References');
        if (previewRefsIdx !== -1) {
          console.log('[AI Chat] References AFTER preview apply (lines', previewRefsIdx, 'to end):');
          previewLines.slice(previewRefsIdx, previewRefsIdx + 10).forEach((line, i) => {
            console.log(`  After preview line ${previewRefsIdx + i}: "${line}"`);
          });
        }
        // Apply changes to editor
        setEditorContentFn(previewResult.content);
        addMessageToChat('assistant', `Content synthesized from ${synthesisResult.pagesAnalyzed} pages and applied.`);
        showRestoreBar();
      } else {
        addMessageToChat('assistant', 'Synthesized content discarded.');
      }
    } else if (synthesisResult.content) {
      // Preview disabled - apply directly
      // Debug: Log the content arriving from IPC
      const contentLines = synthesisResult.content.split('\n');
      const refsIdx = contentLines.findIndex(l => l.trim() === '## References');
      if (refsIdx !== -1) {
        console.log('[AI Chat] References section from IPC (lines', refsIdx, 'to end):');
        contentLines.slice(refsIdx, refsIdx + 10).forEach((line, i) => {
          console.log(`  IPC refs line ${refsIdx + i}: "${line}"`);
        });
      }
      setEditorContentFn(synthesisResult.content);
      addMessageToChat('assistant', `Content synthesized from ${synthesisResult.pagesAnalyzed} pages and applied.`);
      showRestoreBar();
    } else {
      addMessageToChat('assistant', 'Synthesis completed but no content was generated.');
    }

    // Add to history
    chatHistory.push({ role: 'user', content: query });
    chatHistory.push({ role: 'assistant', content: `Synthesized from ${synthesisResult.pagesAnalyzed} pages` });

  } catch (error) {
    hideSearchProgress();
    window.electronAPI.removeWikiSearchProgressListener();
    window.electronAPI.removeWikiSynthesisProgressListener();
    console.error('[AI Chat] Wiki search/synthesis error:', error);
    addMessageToChat('error', `Search failed: ${error.message}`);
  }
}

/**
 * Display search results in the chat
 * @param {string} query - Original query
 * @param {Object} result - Search result object
 */
function displaySearchResults(query, result) {
  if (!result.success) {
    addMessageToChat('error', result.error || 'Search failed.');
    return;
  }

  // Build the response message
  let message = '';

  // Add summary
  if (result.summary) {
    message += result.summary + '\n\n';
  }

  // Add sources
  if (result.sources && result.sources.length > 0) {
    message += '**Sources found:**\n';
    result.sources.slice(0, 10).forEach(source => {
      message += `- [${source.title}](${source.path}) (${source.relevance}% match)\n`;
    });
    message += '\n';
  }

  // Add suggested follow-ups
  if (result.suggestedFollowUp && result.suggestedFollowUp.length > 0) {
    message += '**Suggested next steps:**\n';
    result.suggestedFollowUp.forEach(step => {
      message += `- ${step}\n`;
    });
  }

  addMessageToChat('assistant', message);

  // If there's generated content, offer to insert it
  if (result.generatedContent) {
    addMessageToChat('assistant', '---\n**Generated content based on search:**');

    // Show preview of generated content
    const preview = result.generatedContent.substring(0, 500);
    addMessageToChat('assistant', preview + (result.generatedContent.length > 500 ? '...' : ''));

    // Store generated content for potential insertion
    window.lastGeneratedContent = result.generatedContent;

    addMessageToChat('clarification',
      'Would you like me to insert this content into the editor? Reply "yes" or "insert" to add it, or continue editing.');
  }

  // Add to history
  chatHistory.push({ role: 'user', content: query });
  chatHistory.push({ role: 'assistant', content: message });
}

/**
 * Format RAG sources for display
 * @param {Array} ragContext - Array of RAG context chunks
 * @returns {string} Formatted HTML for sources display
 */
function formatRAGSources(ragContext) {
  if (!ragContext || ragContext.length === 0) return '';

  // Group by file using full filePath as the key
  const byFile = {};
  ragContext.forEach(ctx => {
    // Use full filePath for display (includes drive letter on Windows)
    const filePath = ctx.metadata?.filePath || ctx.metadata?.relativePath || ctx.metadata?.fileName || 'Unknown';

    if (!byFile[filePath]) {
      byFile[filePath] = {
        sections: []
      };
    }
    if (ctx.metadata?.title && !byFile[filePath].sections.includes(ctx.metadata.title)) {
      byFile[filePath].sections.push(ctx.metadata.title);
    }
  });

  const fileList = Object.entries(byFile).map(([filePath, info]) => {
    const sections = info.sections.length > 0 ? ` (${info.sections.join(', ')})` : '';
    return `<li title="${filePath}">${filePath}${sections}</li>`;
  }).join('');

  return `<div class="ai-rag-sources">
    <span class="sources-label">Sources used:</span>
    <ul>${fileList}</ul>
  </div>`;
}

/**
 * Format RAG sources as wiki markdown for embedding in the document
 * @param {Array} ragContext - Array of RAG context chunks
 * @returns {string} Markdown string with a Sources section, or empty string
 */
function formatRAGSourcesAsMarkdown(ragContext) {
  if (!ragContext || ragContext.length === 0) return '';

  // Group by file, deduplicating sections
  const byFile = {};
  ragContext.forEach(ctx => {
    const filePath = ctx.metadata?.filePath || ctx.metadata?.relativePath || ctx.metadata?.fileName || 'Unknown';
    if (!byFile[filePath]) {
      byFile[filePath] = { sections: [] };
    }
    if (ctx.metadata?.title && !byFile[filePath].sections.includes(ctx.metadata.title)) {
      byFile[filePath].sections.push(ctx.metadata.title);
    }
  });

  let md = '\n\n---\n\n## Sources\n\n';
  for (const [filePath, info] of Object.entries(byFile)) {
    const sections = info.sections.length > 0 ? ` — ${info.sections.join(', ')}` : '';
    md += `- \`${filePath}\`${sections}\n`;
  }
  return md;
}

/**
 * Add a message to the chat display
 * @param {string} role - 'user', 'assistant', 'error', 'clarification', or 'sources'
 * @param {string} content - The text content of the message
 * @param {Array} images - Optional array of {data, mimeType, name} objects
 */
function addMessageToChat(role, content, images = []) {
  const messagesContainer = document.getElementById('ai-chat-messages');
  if (!messagesContainer) return;

  // Remove welcome message if present
  const welcomeMsg = messagesContainer.querySelector('.ai-welcome-message');
  if (welcomeMsg) {
    welcomeMsg.remove();
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = `ai-message ${role}`;

  // Add images if present
  if (images && images.length > 0) {
    const imagesDiv = document.createElement('div');
    imagesDiv.className = 'ai-message-images';
    images.forEach(img => {
      const imgEl = document.createElement('img');
      imgEl.src = `data:${img.mimeType};base64,${img.data}`;
      imgEl.alt = img.name || 'Attached image';
      imagesDiv.appendChild(imgEl);
    });
    messageDiv.appendChild(imagesDiv);
  }

  // Add text content - use innerHTML with safe rendering for markdown support
  const textDiv = document.createElement('div');
  textDiv.className = 'ai-message-text';
  // For 'sources' role, content is already HTML
  if (role === 'sources') {
    textDiv.innerHTML = content;
  } else {
    textDiv.innerHTML = renderMarkdownForChat(content);
  }
  messageDiv.appendChild(textDiv);

  // Add click handler for wiki links - dispatch custom event for renderer to handle
  textDiv.querySelectorAll('.wiki-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const wikiPath = link.dataset.wikiPath;
      if (wikiPath) {
        // Dispatch custom event that renderer.js listens for
        const event = new CustomEvent('ai-chat-open-wiki-page', {
          detail: { path: wikiPath },
          bubbles: true
        });
        document.dispatchEvent(event);
      }
    });
  });

  messagesContainer.appendChild(messageDiv);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Add a persona message to the chat display (for multi-persona mode)
 * @param {string} personaName - Persona identifier
 * @param {string} displayName - Persona display name
 * @param {string} content - Message content
 * @param {Object} turnInfo - Turn information {turn, totalTurns}
 */
function addPersonaMessageToChat(personaName, displayName, content, turnInfo = {}) {
  const messagesContainer = document.getElementById('ai-chat-messages');
  if (!messagesContainer) return;

  // Remove welcome message if present
  const welcomeMsg = messagesContainer.querySelector('.ai-welcome-message');
  if (welcomeMsg) {
    welcomeMsg.remove();
  }

  // Assign color to persona if not already assigned
  if (!personaColorMap.has(personaName)) {
    personaColorMap.set(personaName, personaColorMap.size % PERSONA_COLORS.length);
  }
  const colorIndex = personaColorMap.get(personaName);

  const messageDiv = document.createElement('div');
  messageDiv.className = `ai-message persona persona-color-${colorIndex}`;

  // Create persona header with avatar and name
  const headerDiv = document.createElement('div');
  headerDiv.className = 'persona-message-header';
  headerDiv.innerHTML = `
    <span class="persona-avatar" style="background-color: ${PERSONA_COLORS[colorIndex]}">${displayName.charAt(0).toUpperCase()}</span>
    <span class="persona-name">${displayName}</span>
    ${turnInfo.turn ? `<span class="turn-indicator">Turn ${turnInfo.turn}</span>` : ''}
  `;
  messageDiv.appendChild(headerDiv);

  // Add text content
  const textDiv = document.createElement('div');
  textDiv.className = 'ai-message-text';
  textDiv.innerHTML = renderMarkdownForChat(content);
  messageDiv.appendChild(textDiv);

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // Update progress bar if present
  updateConversationProgress(turnInfo.totalTurns || 0, multiPersonaMaxTurns);
}

/**
 * Show the conversation controls panel (progress bar, stop button)
 */
function showConversationControls() {
  let controlsEl = document.getElementById('ai-conversation-controls');
  if (!controlsEl) {
    const messagesContainer = document.getElementById('ai-chat-messages');
    if (!messagesContainer) return;

    controlsEl = document.createElement('div');
    controlsEl.id = 'ai-conversation-controls';
    controlsEl.className = 'ai-conversation-controls';
    controlsEl.innerHTML = `
      <div class="conversation-progress-container">
        <div class="conversation-progress-bar">
          <div class="conversation-progress-fill" id="conversation-progress-fill"></div>
        </div>
        <span class="conversation-progress-text" id="conversation-progress-text">Turn 0 / ${multiPersonaMaxTurns}</span>
      </div>
      <button class="conversation-stop-btn" id="conversation-stop-btn" title="Stop conversation">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="1"/>
        </svg>
        Stop
      </button>
    `;
    messagesContainer.parentNode.insertBefore(controlsEl, messagesContainer);

    // Add stop button handler
    document.getElementById('conversation-stop-btn')?.addEventListener('click', handleStopMultiPersonaConversation);
  }
  controlsEl.classList.remove('hidden');
}

/**
 * Hide the conversation controls panel
 */
function hideConversationControls() {
  const controlsEl = document.getElementById('ai-conversation-controls');
  if (controlsEl) {
    controlsEl.classList.add('hidden');
  }
}

/**
 * Update the conversation progress bar
 */
function updateConversationProgress(current, max) {
  const fill = document.getElementById('conversation-progress-fill');
  const text = document.getElementById('conversation-progress-text');
  if (fill) {
    const percent = Math.min((current / max) * 100, 100);
    fill.style.width = `${percent}%`;
  }
  if (text) {
    text.textContent = `Turn ${current} / ${max}`;
  }
}

/**
 * Show observer summary when conversation ends
 */
function showObserverSummary(summary, reason) {
  const messagesContainer = document.getElementById('ai-chat-messages');
  if (!messagesContainer) return;

  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'ai-message observer-summary';
  summaryDiv.innerHTML = `
    <div class="observer-summary-header">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      <span>Conversation Complete</span>
    </div>
    <div class="observer-summary-reason">${reason || 'Discussion concluded'}</div>
    <div class="observer-summary-content">${renderMarkdownForChat(summary || 'No summary available.')}</div>
  `;
  messagesContainer.appendChild(summaryDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Handle stop button for multi-persona conversation
 */
async function handleStopMultiPersonaConversation() {
  if (!multiPersonaConversationActive || !multiPersonaConversationId) return;

  console.log('[AI Chat] Stopping multi-persona conversation');

  try {
    const result = await window.electronAPI.conversationStop(multiPersonaConversationId);
    multiPersonaConversationActive = false;

    hideConversationControls();
    setLoadingState(false);

    // Check if an article was generated (create mode)
    if (result.articleGenerated && result.content) {
      showObserverSummary(
        `**Article Generated:** ${result.title}\n\n${result.summary}`,
        'Conversation stopped by user'
      );

      // Offer to apply the article
      if (previewChangesEnabled) {
        const previewResult = await showAIChangesPreview({
          originalContent: getEditorContentFn(),
          newContent: result.content,
          changeSummary: `Generated article: ${result.title}`
        });

        if (previewResult.action === 'apply') {
          setEditorContentFn(previewResult.content);
          addMessageToChat('assistant', `Wiki article "${result.title}" inserted into document.`);
          showRestoreBar();
        } else {
          addMessageToChat('assistant', 'Article discarded.');
        }
      } else {
        setEditorContentFn(result.content);
        addMessageToChat('assistant', `Wiki article "${result.title}" inserted into document.`);
        showRestoreBar();
      }
    } else if (result.summary) {
      showObserverSummary(result.summary, 'Conversation stopped by user');
    }
  } catch (error) {
    console.error('[AI Chat] Error stopping conversation:', error);
    addMessageToChat('error', `Failed to stop conversation: ${error.message}`);
  }
}

/**
 * Handle multi-persona conversation
 */
async function handleMultiPersonaConversation(message) {
  const selectedPersonas = getSelectedPersonas();

  if (selectedPersonas.length < 2) {
    addMessageToChat('error', 'Multi-persona mode requires at least 2 personas selected.');
    return;
  }

  console.log('[AI Chat] Starting multi-persona conversation with:', selectedPersonas);

  // Reset color map for new conversation
  personaColorMap.clear();

  // Add user message to chat
  addMessageToChat('user', message);

  // Show loading and conversation controls
  setLoadingState(true);
  showConversationControls();

  try {
    // Detect intent - support 'create' mode for wiki article generation
    const intent = await detectMessageIntent(message, true);
    let mode = 'qa';
    if (intent === 'edit') {
      mode = 'edit';
    } else if (intent === 'create') {
      mode = 'create';
      console.log('[AI Chat] Multi-persona mode: create article');
    }

    // Start the conversation
    const startResult = await window.electronAPI.conversationStart({
      personaNames: selectedPersonas,
      message,
      documentContext: mode === 'edit' ? getEditorContentFn() : '',
      mode,
      chatMode: selectedChatMode
    });

    if (!startResult.success) {
      addMessageToChat('error', startResult.error || 'Failed to start conversation');
      setLoadingState(false);
      hideConversationControls();
      return;
    }

    multiPersonaConversationId = startResult.conversationId;
    multiPersonaConversationActive = true;
    multiPersonaTotalTurns = 0;

    // Process conversation turns
    while (multiPersonaConversationActive) {
      const turnResult = await window.electronAPI.conversationNextTurn(multiPersonaConversationId);

      if (!turnResult) {
        console.log('[AI Chat] No turn result received');
        break;
      }

      switch (turnResult.type) {
        case 'speaking':
          // Update status to show who's speaking
          updateStatusText(`${turnResult.displayName} is thinking...`);
          break;

        case 'persona_response':
          multiPersonaTotalTurns = turnResult.totalTurns || multiPersonaTotalTurns + 1;
          addPersonaMessageToChat(
            turnResult.personaName,
            turnResult.displayName,
            turnResult.content,
            { turn: turnResult.turn, totalTurns: multiPersonaTotalTurns }
          );
          break;

        case 'user_interjection':
          // User's interjection already displayed
          break;

        case 'termination':
          console.log('[AI Chat] Conversation terminated:', turnResult.reason);
          multiPersonaConversationActive = false;
          showObserverSummary(turnResult.summary, turnResult.reason);
          break;

        case 'edit_complete':
          if (turnResult.hasEdits && turnResult.combinedContent) {
            // Show diff preview
            if (previewChangesEnabled) {
              const previewResult = await showAIChangesPreview({
                originalContent: getEditorContentFn(),
                newContent: turnResult.combinedContent,
                changeSummary: turnResult.summary || 'Combined edit from multi-persona discussion'
              });

              if (previewResult.action === 'apply') {
                setEditorContentFn(previewResult.content);
                addMessageToChat('assistant', 'Combined edits applied to document.');
                showRestoreBar();
              } else {
                addMessageToChat('assistant', 'Edits discarded.');
              }
            } else {
              setEditorContentFn(turnResult.combinedContent);
              addMessageToChat('assistant', turnResult.summary || 'Combined edits applied.');
              showRestoreBar();
            }
          }
          multiPersonaConversationActive = false;
          break;

        case 'article_complete':
          // Wiki article generated from multi-persona conversation
          console.log('[AI Chat] Article generated:', turnResult.title);
          showObserverSummary(
            `**Article Generated:** ${turnResult.title}\n\n${turnResult.summary}`,
            turnResult.reason
          );

          if (turnResult.content) {
            // Show preview and let user apply
            if (previewChangesEnabled) {
              const previewResult = await showAIChangesPreview({
                originalContent: getEditorContentFn(),
                newContent: turnResult.content,
                changeSummary: `Generated article: ${turnResult.title}`
              });

              if (previewResult.action === 'apply') {
                setEditorContentFn(previewResult.content);
                addMessageToChat('assistant', `Wiki article "${turnResult.title}" inserted into document.`);
                showRestoreBar();
              } else {
                addMessageToChat('assistant', 'Article discarded.');
              }
            } else {
              setEditorContentFn(turnResult.content);
              addMessageToChat('assistant', `Wiki article "${turnResult.title}" inserted into document.`);
              showRestoreBar();
            }
          }
          multiPersonaConversationActive = false;
          break;

        case 'error':
          addMessageToChat('error', turnResult.message || 'An error occurred');
          if (turnResult.fatal) {
            multiPersonaConversationActive = false;
          }
          break;

        default:
          console.log('[AI Chat] Unknown turn type:', turnResult.type);
      }
    }

  } catch (error) {
    console.error('[AI Chat] Multi-persona conversation error:', error);
    addMessageToChat('error', `Conversation error: ${error.message}`);
  } finally {
    multiPersonaConversationActive = false;
    multiPersonaConversationId = null;
    setLoadingState(false);
    hideConversationControls();
  }
}

/**
 * Handle user interjection in active multi-persona conversation
 */
async function handleUserInterjection(message) {
  if (!multiPersonaConversationActive || !multiPersonaConversationId) return;

  console.log('[AI Chat] User interjection:', message);
  addMessageToChat('user', message);

  try {
    await window.electronAPI.conversationUserMessage(multiPersonaConversationId, message);
  } catch (error) {
    console.error('[AI Chat] Interjection error:', error);
  }
}

/**
 * Update status text
 */
function updateStatusText(text) {
  const statusText = document.querySelector('.ai-status-text');
  if (statusText) {
    statusText.textContent = text;
  }
}

// Track if cancellation was requested
let cancelRequested = false;

/**
 * Safely render markdown content as HTML for chat display
 * Supports: **bold**, links [text](url), and basic escaping
 * @param {string} content - Markdown content
 * @returns {string} Safe HTML string
 */
function renderMarkdownForChat(content) {
  if (!content) return '';

  // First escape HTML to prevent XSS
  let html = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Convert markdown links [text](url) to HTML links
  // Only allow wiki paths (starting with /) or http(s) URLs
  html = html.replace(
    /\[([^\]]+)\]\((\/?[^\)]+)\)/g,
    (match, text, url) => {
      // Validate URL - only allow wiki paths or http(s)
      if (url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://')) {
        // For wiki paths, make them clickable with a special data attribute
        if (url.startsWith('/')) {
          return `<a href="#" class="wiki-link" data-wiki-path="${url}" title="Wiki: ${url}">${text}</a>`;
        }
        // For external URLs
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
      // If URL doesn't match allowed patterns, return original text
      return match;
    }
  );

  // Convert **bold** to <strong>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Convert newlines to <br>
  html = html.replace(/\n/g, '<br>');

  // Convert bullet lists (- item) to proper list items
  // Split by <br>, process each line
  const lines = html.split('<br>');
  let inList = false;
  const processedLines = [];

  for (const line of lines) {
    if (line.trim().startsWith('- ')) {
      if (!inList) {
        processedLines.push('<ul class="chat-list">');
        inList = true;
      }
      processedLines.push(`<li>${line.trim().substring(2)}</li>`);
    } else {
      if (inList) {
        processedLines.push('</ul>');
        inList = false;
      }
      processedLines.push(line);
    }
  }
  if (inList) {
    processedLines.push('</ul>');
  }

  return processedLines.join('');
}

/**
 * Handle cancel button click
 */
function handleCancelRequest() {
  console.log('[AI Chat] Cancel requested by user');
  cancelRequested = true;

  // Cancel any ongoing wiki search/synthesis
  if (window.electronAPI.wikiCancelSearch) {
    window.electronAPI.wikiCancelSearch({ mode: 'abort' });
  }
  if (window.electronAPI.wikiCancelSynthesis) {
    window.electronAPI.wikiCancelSynthesis();
  }

  // Update UI immediately
  addMessageToChat('assistant', 'Request cancelled.');
  setLoadingState(false);
}

/**
 * Check if cancel was requested (for use in async operations)
 */
function wasCancelRequested() {
  return cancelRequested;
}

/**
 * Set loading state
 */
function setLoadingState(loading) {
  isWaitingForResponse = loading;

  const input = document.getElementById('ai-input');
  const sendBtn = document.getElementById('ai-send-btn');
  const attachBtn = document.getElementById('ai-attach-btn');
  const statusIndicator = document.querySelector('.ai-status-indicator');
  const statusText = document.querySelector('.ai-status-text');
  const messagesContainer = document.getElementById('ai-chat-messages');

  if (loading) {
    // Reset cancel flag when starting new request
    cancelRequested = false;

    input.disabled = true;
    attachBtn.disabled = true;
    statusIndicator.className = 'ai-status-indicator loading';
    statusText.textContent = 'Processing...';

    // Transform Send button to Cancel button
    sendBtn.disabled = false;
    sendBtn.textContent = 'Cancel';
    sendBtn.classList.add('cancel-mode');

    // Add typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'ai-typing-indicator';
    typingDiv.id = 'ai-typing';
    typingDiv.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } else {
    input.disabled = false;
    attachBtn.disabled = false;
    statusIndicator.className = 'ai-status-indicator ready';
    statusText.textContent = 'Ready';

    // Transform Cancel button back to Send button
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    sendBtn.classList.remove('cancel-mode');

    // Remove typing indicator
    const typing = document.getElementById('ai-typing');
    if (typing) typing.remove();

    // Focus the input field so user can immediately type the next message
    input.focus();
  }
}

/**
 * Show the restore bar
 */
function showRestoreBar() {
  const restoreBar = document.getElementById('ai-restore-bar');
  if (restoreBar) {
    restoreBar.classList.remove('hidden');
  }
}

/**
 * Hide the restore bar
 */
function hideRestoreBar() {
  const restoreBar = document.getElementById('ai-restore-bar');
  if (restoreBar) {
    restoreBar.classList.add('hidden');
  }
}

/**
 * Clear chat history
 */
async function clearChat() {
  chatHistory = [];
  clearAttachments();

  // Clear on backend
  await window.electronAPI.geminiClearHistory();

  // Reset UI
  const messagesContainer = document.getElementById('ai-chat-messages');
  if (messagesContainer) {
    messagesContainer.innerHTML = `
      <div class="ai-welcome-message">
        <p><strong>Welcome to AI Copilot!</strong></p>
        <p>I can help you edit your Azure Wiki article. Try asking:</p>
        <ul>
          <li>"Add a table of contents at the top"</li>
          <li>"Create a flowchart diagram for the process"</li>
          <li>"Create a swimlane diagram showing the workflow"</li>
          <li>"Improve the formatting of this article"</li>
          <li>"Add a summary section at the end"</li>
        </ul>
      </div>
    `;
  }

  hideRestoreBar();
}

/**
 * Show the AI sidebar
 */
function showAISidebar() {
  const sidebar = document.getElementById('ai-chat-sidebar');
  if (sidebar) {
    sidebar.classList.remove('hidden');
    sidebarVisible = true;

    // Focus input
    const input = document.getElementById('ai-input');
    if (input && !input.disabled) {
      input.focus();
    }

    // Re-check configuration in case it changed
    checkConfiguration();

    // Re-check RAG catalog availability (vectorDB may have initialized since last check)
    loadRAGCatalogs();

    // Refresh personas in case they were created after initial load or persona manager just initialized
    refreshPersonas();
  }
}

/**
 * Hide the AI sidebar
 */
function hideAISidebar() {
  const sidebar = document.getElementById('ai-chat-sidebar');
  if (sidebar) {
    sidebar.classList.add('hidden');
    sidebarVisible = false;
  }
}

/**
 * Toggle the AI sidebar visibility
 */
function toggleAISidebar() {
  if (sidebarVisible) {
    hideAISidebar();
  } else {
    showAISidebar();
  }
}

/**
 * Check if sidebar is visible
 */
function isAISidebarVisible() {
  return sidebarVisible;
}

// Export functions
export {
  initAIChatSidebar,
  showAISidebar,
  hideAISidebar,
  toggleAISidebar,
  isAISidebarVisible
};
