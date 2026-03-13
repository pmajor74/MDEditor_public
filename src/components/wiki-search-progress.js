/**
 * Wiki Search Progress Component
 *
 * Progress overlay for wiki search operations.
 * Shows progress bar, current page being scanned, and cancel/stop buttons.
 */

let progressOverlay = null;
let cancelCallback = null;
let stopCallback = null;

/**
 * Create the progress overlay HTML
 */
function createOverlayHTML() {
  const overlay = document.createElement('div');
  overlay.id = 'wiki-search-overlay';
  overlay.className = 'wiki-search-overlay';
  overlay.innerHTML = `
    <div class="wiki-search-dialog" role="dialog" aria-modal="true" aria-labelledby="wiki-search-title">
      <div class="wiki-search-header">
        <h3 id="wiki-search-title">Searching Wiki</h3>
      </div>
      <div class="wiki-search-body">
        <div class="wiki-search-status" id="wiki-search-status">
          Initializing search...
        </div>
        <div class="wiki-search-current-page" id="wiki-search-current-page">
          <!-- Current page being scanned -->
        </div>
        <div class="wiki-search-progress-container">
          <div class="wiki-search-progress-bar">
            <div class="wiki-search-progress-fill" id="wiki-search-progress-fill"></div>
          </div>
          <div class="wiki-search-progress-text" id="wiki-search-progress-text">0%</div>
        </div>
        <div class="wiki-search-stats" id="wiki-search-stats">
          <!-- Stats like pages found, pages fetched -->
        </div>
      </div>
      <div class="wiki-search-actions">
        <button type="button" id="wiki-search-stop-btn" class="wiki-search-btn wiki-search-btn-stop" title="Stop searching and use results collected so far">
          Stop & Use Results
        </button>
        <button type="button" id="wiki-search-cancel-btn" class="wiki-search-btn wiki-search-btn-cancel" title="Cancel search completely">
          Cancel
        </button>
      </div>
    </div>
  `;
  return overlay;
}

/**
 * Show the search progress overlay
 * @param {Object} options - Options for the overlay
 * @param {Function} options.onCancel - Callback when Cancel is clicked
 * @param {Function} options.onStop - Callback when Stop & Use Results is clicked
 */
function showSearchProgress(options = {}) {
  // Remove existing overlay if any
  hideSearchProgress();

  cancelCallback = options.onCancel || null;
  stopCallback = options.onStop || null;

  progressOverlay = createOverlayHTML();
  document.body.appendChild(progressOverlay);

  // Setup event listeners
  const cancelBtn = progressOverlay.querySelector('#wiki-search-cancel-btn');
  const stopBtn = progressOverlay.querySelector('#wiki-search-stop-btn');

  cancelBtn.addEventListener('click', handleCancel);
  stopBtn.addEventListener('click', handleStop);

  // Keyboard handler
  document.addEventListener('keydown', handleKeydown);

  // Focus the cancel button
  setTimeout(() => cancelBtn.focus(), 100);
}

/**
 * Update the progress display
 * @param {Object} progress - Progress data
 */
function updateSearchProgress(progress) {
  if (!progressOverlay) return;

  const statusEl = progressOverlay.querySelector('#wiki-search-status');
  const currentPageEl = progressOverlay.querySelector('#wiki-search-current-page');
  const progressFill = progressOverlay.querySelector('#wiki-search-progress-fill');
  const progressText = progressOverlay.querySelector('#wiki-search-progress-text');
  const statsEl = progressOverlay.querySelector('#wiki-search-stats');
  const titleEl = progressOverlay.querySelector('#wiki-search-title');
  const stopBtn = progressOverlay.querySelector('#wiki-search-stop-btn');

  // Update title based on phase
  if (progress.phase) {
    const phaseTitles = {
      extracting: 'Analyzing Request',
      searching: 'Searching Wiki',
      fetching: 'Fetching Pages',
      analyzing: 'Analyzing Content',
      complete: 'Search Complete'
    };
    titleEl.textContent = phaseTitles[progress.phase] || 'Searching Wiki';
  }

  // Update status message
  if (progress.message) {
    statusEl.textContent = progress.message;
  }

  // Update current page
  if (progress.currentPage) {
    currentPageEl.textContent = progress.currentPage;
    currentPageEl.style.display = 'block';
  } else {
    currentPageEl.style.display = 'none';
  }

  // Update progress bar
  if (progress.total > 0) {
    const percent = Math.round((progress.current / progress.total) * 100);
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
  } else {
    // Indeterminate progress
    progressFill.style.width = '0%';
    progressText.textContent = '';
  }

  // Update stats
  const stats = [];
  if (progress.pagesFound) {
    stats.push(`${progress.pagesFound} pages found`);
  }
  if (progress.pagesFetched) {
    stats.push(`${progress.pagesFetched} fetched`);
  }
  if (progress.keywords && progress.keywords.length > 0) {
    stats.push(`Keywords: ${progress.keywords.join(', ')}`);
  }
  statsEl.textContent = stats.join(' | ');

  // Show/hide stop button based on whether we have results
  if (stopBtn) {
    stopBtn.style.display = (progress.pagesFetched && progress.pagesFetched > 0) ? 'block' : 'none';
  }

  // If complete, auto-hide after short delay
  if (progress.phase === 'complete') {
    setTimeout(() => hideSearchProgress(), 500);
  }
}

/**
 * Hide the progress overlay
 */
function hideSearchProgress() {
  if (progressOverlay) {
    document.removeEventListener('keydown', handleKeydown);
    progressOverlay.remove();
    progressOverlay = null;
  }
  cancelCallback = null;
  stopCallback = null;
}

/**
 * Handle Cancel button click
 */
function handleCancel() {
  if (cancelCallback) {
    cancelCallback();
  }
  hideSearchProgress();
}

/**
 * Handle Stop & Use Results button click
 */
function handleStop() {
  if (stopCallback) {
    stopCallback();
  }
  // Don't hide immediately - let the search finish using results
  const stopBtn = progressOverlay?.querySelector('#wiki-search-stop-btn');
  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping...';
  }
}

/**
 * Handle keyboard events
 */
function handleKeydown(event) {
  if (!progressOverlay) return;

  if (event.key === 'Escape') {
    handleCancel();
  }
}

/**
 * Show confirmation dialog for large search
 * @param {number} pageCount - Number of pages to search
 * @returns {Promise<boolean>} - True to proceed, false to cancel
 */
function showLargeSearchConfirmation(pageCount) {
  return new Promise((resolve) => {
    // Create confirmation overlay
    const overlay = document.createElement('div');
    overlay.id = 'wiki-search-confirm-overlay';
    overlay.className = 'wiki-search-overlay';
    overlay.innerHTML = `
      <div class="wiki-search-dialog wiki-search-confirm-dialog" role="alertdialog" aria-modal="true">
        <div class="wiki-search-header">
          <h3>Large Search</h3>
        </div>
        <div class="wiki-search-body">
          <p>This search found <strong>${pageCount}</strong> matching pages.</p>
          <p>Scanning all of them may take some time. Do you want to continue?</p>
        </div>
        <div class="wiki-search-actions">
          <button type="button" id="wiki-confirm-yes" class="wiki-search-btn wiki-search-btn-primary">
            Continue
          </button>
          <button type="button" id="wiki-confirm-no" class="wiki-search-btn wiki-search-btn-cancel">
            Cancel
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const yesBtn = overlay.querySelector('#wiki-confirm-yes');
    const noBtn = overlay.querySelector('#wiki-confirm-no');

    const cleanup = () => {
      overlay.remove();
    };

    yesBtn.addEventListener('click', () => {
      cleanup();
      resolve(true);
    });

    noBtn.addEventListener('click', () => {
      cleanup();
      resolve(false);
    });

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleEscape);
        cleanup();
        resolve(false);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Focus the continue button
    setTimeout(() => yesBtn.focus(), 100);
  });
}

/**
 * Show search initiation confirmation
 * @param {string} query - User's search query
 * @param {string[]|null} extractedTerms - Pre-extracted search terms (optional)
 * @returns {Promise<boolean>} - True to proceed, false to cancel
 */
function showSearchConfirmation(query, extractedTerms = null) {
  return new Promise((resolve) => {
    // Determine what to display
    const hasExtractedTerms = extractedTerms && extractedTerms.length > 0;
    const searchTermsDisplay = hasExtractedTerms
      ? extractedTerms.join(', ')
      : null;

    const overlay = document.createElement('div');
    overlay.id = 'wiki-search-confirm-overlay';
    overlay.className = 'wiki-search-overlay';
    overlay.innerHTML = `
      <div class="wiki-search-dialog wiki-search-confirm-dialog" role="alertdialog" aria-modal="true">
        <div class="wiki-search-header">
          <h3>Search Wiki</h3>
        </div>
        <div class="wiki-search-body">
          ${hasExtractedTerms ? `
            <p>Searching for:</p>
            <p class="wiki-search-terms"><strong>${escapeHtml(searchTermsDisplay)}</strong></p>
            <p class="wiki-search-original-query">(from: "${escapeHtml(query.substring(0, 100))}${query.length > 100 ? '...' : ''}")</p>
          ` : `
            <p>This will search the wiki for pages related to your request:</p>
            <p class="wiki-search-query">"${escapeHtml(query.substring(0, 200))}${query.length > 200 ? '...' : ''}"</p>
          `}
          <p>Do you want to proceed?</p>
        </div>
        <div class="wiki-search-actions">
          <button type="button" id="wiki-confirm-yes" class="wiki-search-btn wiki-search-btn-primary">
            Search
          </button>
          <button type="button" id="wiki-confirm-no" class="wiki-search-btn wiki-search-btn-cancel">
            Cancel
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const yesBtn = overlay.querySelector('#wiki-confirm-yes');
    const noBtn = overlay.querySelector('#wiki-confirm-no');

    const cleanup = () => {
      overlay.remove();
    };

    yesBtn.addEventListener('click', () => {
      cleanup();
      resolve(true);
    });

    noBtn.addEventListener('click', () => {
      cleanup();
      resolve(false);
    });

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleEscape);
        cleanup();
        resolve(false);
      }
    };
    document.addEventListener('keydown', handleEscape);

    setTimeout(() => yesBtn.focus(), 100);
  });
}

/**
 * Show result count selector with slider
 * Allows user to choose how many pages to analyze
 * @param {number} totalPages - Total matching pages found
 * @param {string[]} keywords - Search keywords extracted
 * @returns {Promise<{mode: 'all'|'top', count: number}|null>} - Selection or null if cancelled
 */
function showResultCountSelector(totalPages, keywords = []) {
  return new Promise((resolve) => {
    const defaultTop = Math.min(10, totalPages);
    const minTop = Math.min(5, totalPages);

    const overlay = document.createElement('div');
    overlay.id = 'wiki-result-count-overlay';
    overlay.className = 'wiki-search-overlay';
    overlay.innerHTML = `
      <div class="wiki-search-dialog wiki-result-count-dialog" role="dialog" aria-modal="true">
        <div class="wiki-search-header">
          <h3>Search Results</h3>
        </div>
        <div class="wiki-search-body">
          <p class="wiki-result-found">Found <strong>${totalPages}</strong> pages matching your search</p>
          ${keywords.length > 0 ? `<p class="wiki-result-keywords">Keywords: ${keywords.join(', ')}</p>` : ''}

          <div class="wiki-result-options">
            <p class="wiki-result-question">How many pages to analyze?</p>

            <label class="wiki-result-option">
              <input type="radio" name="result-mode" value="all" />
              <span class="wiki-radio-label">All ${totalPages} pages</span>
            </label>

            <label class="wiki-result-option wiki-result-option-slider">
              <input type="radio" name="result-mode" value="top" checked />
              <span class="wiki-radio-label">Top</span>
              <input type="range" id="wiki-top-count-slider"
                     min="${minTop}" max="${totalPages}" value="${defaultTop}"
                     class="wiki-top-slider" />
              <span id="wiki-top-count-value" class="wiki-slider-value">${defaultTop}</span>
              <span class="wiki-radio-label">pages</span>
            </label>
          </div>

          <p class="wiki-result-hint">(Ranked by name match relevance)</p>
        </div>
        <div class="wiki-search-actions">
          <button type="button" id="wiki-result-cancel" class="wiki-search-btn wiki-search-btn-cancel">
            Cancel
          </button>
          <button type="button" id="wiki-result-search" class="wiki-search-btn wiki-search-btn-primary">
            Search
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const slider = overlay.querySelector('#wiki-top-count-slider');
    const sliderValue = overlay.querySelector('#wiki-top-count-value');
    const topRadio = overlay.querySelector('input[value="top"]');
    const allRadio = overlay.querySelector('input[value="all"]');
    const searchBtn = overlay.querySelector('#wiki-result-search');
    const cancelBtn = overlay.querySelector('#wiki-result-cancel');

    // Update slider value display
    slider.addEventListener('input', () => {
      sliderValue.textContent = slider.value;
      // Ensure "Top" radio is selected when slider is used
      topRadio.checked = true;
    });

    // Enable/disable slider based on radio selection
    const updateSliderState = () => {
      slider.disabled = allRadio.checked;
      if (allRadio.checked) {
        slider.classList.add('disabled');
      } else {
        slider.classList.remove('disabled');
      }
    };

    allRadio.addEventListener('change', updateSliderState);
    topRadio.addEventListener('change', updateSliderState);

    const cleanup = () => {
      document.removeEventListener('keydown', handleEscape);
      overlay.remove();
    };

    const handleSearch = () => {
      const mode = allRadio.checked ? 'all' : 'top';
      const count = mode === 'all' ? totalPages : parseInt(slider.value, 10);
      cleanup();
      resolve({ mode, count });
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    searchBtn.addEventListener('click', handleSearch);
    cancelBtn.addEventListener('click', handleCancel);

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Focus search button
    setTimeout(() => searchBtn.focus(), 100);
  });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Check if progress overlay is visible
 */
function isProgressVisible() {
  return progressOverlay !== null;
}

export {
  showSearchProgress,
  updateSearchProgress,
  hideSearchProgress,
  showLargeSearchConfirmation,
  showSearchConfirmation,
  showResultCountSelector,
  isProgressVisible
};
