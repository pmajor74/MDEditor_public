/**
 * LLM Stream Panel Component
 * Displays streaming LLM output with smart auto-scroll
 */

// Panel state
let panelState = {
  currentFile: null,
  content: '',
  isAutoScrollEnabled: true,
  userScrolledUp: false,
  lastScrollTop: 0,
  completedCount: 0,
  totalCount: 0
};

/**
 * Create LLM stream panel HTML
 * @returns {string} HTML string
 */
export function createLLMStreamPanelHTML() {
  return `
    <div class="llm-stream-panel">
      <div class="llm-stream-header">
        <span class="llm-stream-title">LLM Summary Generation</span>
        <span class="llm-stream-count">[Waiting...]</span>
      </div>
      <div class="llm-stream-current">
        <span class="llm-stream-current-label">Current:</span>
        <span class="llm-stream-current-file">-</span>
      </div>
      <div class="llm-stream-body">
        <pre class="llm-stream-content"></pre>
      </div>
      <div class="llm-stream-footer">
        <span class="llm-stream-scroll-indicator hidden">
          <span class="scroll-arrow">↓</span>
          Auto-scroll paused
        </span>
      </div>
    </div>
  `;
}

/**
 * Initialize LLM stream panel
 * @param {HTMLElement} container - Container element
 */
export function initLLMStreamPanel(container) {
  // Reset state
  panelState = {
    currentFile: null,
    content: '',
    isAutoScrollEnabled: true,
    userScrolledUp: false,
    lastScrollTop: 0,
    completedCount: 0,
    totalCount: 0
  };

  const panel = container.querySelector('.llm-stream-panel');
  if (!panel) return;

  const bodyEl = panel.querySelector('.llm-stream-body');
  if (!bodyEl) return;

  // Smart scroll handling
  bodyEl.addEventListener('scroll', () => {
    const scrollTop = bodyEl.scrollTop;
    const scrollHeight = bodyEl.scrollHeight;
    const clientHeight = bodyEl.clientHeight;

    // Check if user scrolled up (away from bottom)
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;

    if (scrollTop < panelState.lastScrollTop && !isAtBottom) {
      // User scrolled up - disable auto-scroll
      panelState.userScrolledUp = true;
      panelState.isAutoScrollEnabled = false;
      showScrollIndicator(container, true);
    } else if (isAtBottom) {
      // User scrolled back to bottom - re-enable auto-scroll
      panelState.userScrolledUp = false;
      panelState.isAutoScrollEnabled = true;
      showScrollIndicator(container, false);
    }

    panelState.lastScrollTop = scrollTop;
  });

  // Click scroll indicator to scroll to bottom
  const indicator = panel.querySelector('.llm-stream-scroll-indicator');
  if (indicator) {
    indicator.addEventListener('click', () => {
      scrollToBottom(container);
      panelState.isAutoScrollEnabled = true;
      showScrollIndicator(container, false);
    });
  }
}

/**
 * Set current file being summarized
 * @param {HTMLElement} container - Container element
 * @param {string} filePath - File path
 */
export function setCurrentFile(container, filePath) {
  panelState.currentFile = filePath;

  const panel = container.querySelector('.llm-stream-panel');
  if (!panel) return;

  const fileEl = panel.querySelector('.llm-stream-current-file');
  if (fileEl) {
    fileEl.textContent = getFileName(filePath);
    fileEl.title = filePath;
  }
}

/**
 * Update generation count
 * @param {HTMLElement} container - Container element
 * @param {number} completed - Completed count
 * @param {number} total - Total count
 */
export function updateGenerationCount(container, completed, total) {
  panelState.completedCount = completed;
  panelState.totalCount = total;

  const panel = container.querySelector('.llm-stream-panel');
  if (!panel) return;

  const countEl = panel.querySelector('.llm-stream-count');
  if (countEl) {
    countEl.textContent = `[Generating: ${completed}/${total}]`;
  }
}

/**
 * Append content to stream
 * @param {HTMLElement} container - Container element
 * @param {string} chunk - Text chunk to append
 */
export function appendStreamContent(container, chunk) {
  panelState.content += chunk;

  const panel = container.querySelector('.llm-stream-panel');
  if (!panel) return;

  const contentEl = panel.querySelector('.llm-stream-content');
  if (contentEl) {
    contentEl.textContent = panelState.content;

    // Auto-scroll if enabled
    if (panelState.isAutoScrollEnabled) {
      scrollToBottom(container);
    }
  }
}

/**
 * Clear stream content (when moving to next file)
 * @param {HTMLElement} container - Container element
 */
export function clearStreamContent(container) {
  panelState.content = '';

  const panel = container.querySelector('.llm-stream-panel');
  if (!panel) return;

  const contentEl = panel.querySelector('.llm-stream-content');
  if (contentEl) {
    contentEl.textContent = '';
  }
}

/**
 * Set stream content (replace all)
 * @param {HTMLElement} container - Container element
 * @param {string} content - Full content
 */
export function setStreamContent(container, content) {
  panelState.content = content;

  const panel = container.querySelector('.llm-stream-panel');
  if (!panel) return;

  const contentEl = panel.querySelector('.llm-stream-content');
  if (contentEl) {
    contentEl.textContent = content;

    if (panelState.isAutoScrollEnabled) {
      scrollToBottom(container);
    }
  }
}

/**
 * Scroll to bottom of content
 * @param {HTMLElement} container - Container element
 */
function scrollToBottom(container) {
  const panel = container.querySelector('.llm-stream-panel');
  if (!panel) return;

  const bodyEl = panel.querySelector('.llm-stream-body');
  if (bodyEl) {
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }
}

/**
 * Show/hide scroll indicator
 * @param {HTMLElement} container - Container element
 * @param {boolean} show - Whether to show
 */
function showScrollIndicator(container, show) {
  const panel = container.querySelector('.llm-stream-panel');
  if (!panel) return;

  const indicator = panel.querySelector('.llm-stream-scroll-indicator');
  if (indicator) {
    indicator.classList.toggle('hidden', !show);
  }
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
 * Mark generation as complete
 * @param {HTMLElement} container - Container element
 */
export function markComplete(container) {
  const panel = container.querySelector('.llm-stream-panel');
  if (!panel) return;

  const countEl = panel.querySelector('.llm-stream-count');
  if (countEl) {
    countEl.textContent = '[Complete]';
  }

  const fileEl = panel.querySelector('.llm-stream-current-file');
  if (fileEl) {
    fileEl.textContent = 'All files processed';
  }
}

/**
 * Get current panel state
 * @returns {Object} Panel state
 */
export function getPanelState() {
  return { ...panelState };
}
