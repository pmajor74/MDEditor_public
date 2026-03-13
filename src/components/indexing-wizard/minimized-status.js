/**
 * Minimized Status Indicator Component
 * Floating indicator shown when indexing wizard is minimized
 */

// Element reference
let statusElement = null;
let expandCallback = null;

/**
 * Show minimized status indicator
 * @param {Object} options - Configuration
 * @param {number} options.processed - Number of processed files
 * @param {number} options.total - Total number of files
 * @param {Function} options.onExpand - Callback when expand is clicked
 */
export function showMinimizedStatus(options) {
  const { processed = 0, total = 0, onExpand } = options;

  expandCallback = onExpand;

  // Remove existing if any
  hideMinimizedStatus();

  // Create element
  statusElement = document.createElement('div');
  statusElement.className = 'minimized-indexing-status';
  statusElement.innerHTML = `
    <div class="minimized-status-bar">
      <div class="minimized-status-fill" style="width: ${getPercent(processed, total)}%"></div>
    </div>
    <span class="minimized-status-text">Indexing: ${processed}/${total}</span>
    <button class="minimized-status-expand" title="Expand">↗</button>
  `;

  document.body.appendChild(statusElement);

  // Expand button handler
  statusElement.querySelector('.minimized-status-expand').addEventListener('click', () => {
    if (expandCallback) {
      expandCallback();
    }
  });
}

/**
 * Hide minimized status indicator
 */
export function hideMinimizedStatus() {
  if (statusElement) {
    statusElement.remove();
    statusElement = null;
  }
  expandCallback = null;
}

/**
 * Update progress in minimized status
 * @param {number} processed - Number of processed files
 * @param {number} total - Total number of files
 */
export function updateMinimizedProgress(processed, total) {
  if (!statusElement) return;

  const fillEl = statusElement.querySelector('.minimized-status-fill');
  const textEl = statusElement.querySelector('.minimized-status-text');

  if (fillEl) {
    fillEl.style.width = `${getPercent(processed, total)}%`;
  }

  if (textEl) {
    textEl.textContent = `Indexing: ${processed}/${total}`;
  }
}

/**
 * Set status text
 * @param {string} text - Status text
 */
export function setMinimizedStatusText(text) {
  if (!statusElement) return;

  const textEl = statusElement.querySelector('.minimized-status-text');
  if (textEl) {
    textEl.textContent = text;
  }
}

/**
 * Mark as complete
 */
export function markMinimizedComplete() {
  if (!statusElement) return;

  statusElement.classList.add('complete');

  const fillEl = statusElement.querySelector('.minimized-status-fill');
  if (fillEl) {
    fillEl.style.width = '100%';
  }

  const textEl = statusElement.querySelector('.minimized-status-text');
  if (textEl) {
    textEl.textContent = 'Indexing complete';
  }
}

/**
 * Mark as paused
 */
export function markMinimizedPaused() {
  if (!statusElement) return;

  statusElement.classList.add('paused');

  const textEl = statusElement.querySelector('.minimized-status-text');
  if (textEl) {
    const currentText = textEl.textContent;
    if (!currentText.includes('(Paused)')) {
      textEl.textContent = currentText + ' (Paused)';
    }
  }
}

/**
 * Mark as error
 * @param {string} message - Error message
 */
export function markMinimizedError(message = 'Error') {
  if (!statusElement) return;

  statusElement.classList.add('error');

  const textEl = statusElement.querySelector('.minimized-status-text');
  if (textEl) {
    textEl.textContent = message;
  }
}

/**
 * Check if minimized status is visible
 * @returns {boolean}
 */
export function isMinimizedStatusVisible() {
  return statusElement !== null;
}

/**
 * Get percentage
 * @param {number} processed - Processed count
 * @param {number} total - Total count
 * @returns {number} Percentage
 */
function getPercent(processed, total) {
  if (total === 0) return 0;
  return Math.round((processed / total) * 100);
}
