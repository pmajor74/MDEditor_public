/**
 * Page History Panel Component
 *
 * Displays revision history for a wiki page and allows viewing/restoring
 * previous versions. Also supports comparing versions with diff view.
 */

import { showConfirmationDialog } from './confirmation-dialog.js';
import { announce } from '../utils/announcer.js';
import { showHistoryCompareDialog } from './history-compare-dialog.js';

let isVisible = false;
let currentPagePath = null;
let commits = [];
let onRestoreCallback = null;
let getCurrentContentFn = null; // Function to get current editor content

/**
 * Initialize the history panel
 * @param {Object} options - Initialization options
 * @param {Function} options.onRestore - Callback when a version is restored (receives content)
 * @param {Function} options.getCurrentContent - Function to get current editor content
 */
export function initHistoryPanel(options = {}) {
  if (typeof options === 'function') {
    // Backward compatibility: single callback argument
    onRestoreCallback = options;
  } else {
    onRestoreCallback = options.onRestore;
    getCurrentContentFn = options.getCurrentContent;
  }
  buildPanelHTML();
}

/**
 * Build the panel HTML structure
 */
function buildPanelHTML() {
  let panel = document.getElementById('history-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'history-panel';
    panel.className = 'history-panel hidden';
    document.body.appendChild(panel);
  }

  panel.innerHTML = `
    <div class="history-panel-header">
      <h3>Page History</h3>
      <button class="history-panel-close" aria-label="Close history panel">&times;</button>
    </div>
    <div class="history-panel-page-name"></div>
    <div class="history-panel-content">
      <div class="history-loading hidden">
        <span class="loading-spinner-small"></span> Loading history...
      </div>
      <div class="history-error hidden"></div>
      <ul class="history-list" role="list" aria-label="Page revisions"></ul>
    </div>
  `;

  // Attach event handlers
  panel.querySelector('.history-panel-close').addEventListener('click', hideHistoryPanel);

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isVisible) {
      hideHistoryPanel();
    }
  });
}

/**
 * Show the history panel for a page
 * @param {string} pagePath - The page path to show history for
 */
export async function showHistoryPanel(pagePath) {
  if (!pagePath) return;

  currentPagePath = pagePath;
  isVisible = true;

  // Build panel if it doesn't exist
  let panel = document.getElementById('history-panel');
  if (!panel) {
    buildPanelHTML();
    panel = document.getElementById('history-panel');
  }

  // Update page name
  const pageName = getPageName(pagePath);
  panel.querySelector('.history-panel-page-name').textContent = pageName;

  // Show panel
  panel.classList.remove('hidden');

  // Show loading state
  showLoading(true);
  hideError();

  try {
    const result = await window.electronAPI.azureGetPageHistory({ pagePath });

    if (result.success) {
      commits = result.commits || [];
      renderCommitList();
      announce(`Loaded ${commits.length} revisions for ${pageName}`);
    } else {
      showError(result.error || 'Failed to load history');
    }
  } catch (error) {
    console.error('[History Panel] Error loading history:', error);
    showError(error.message);
  } finally {
    showLoading(false);
  }
}

/**
 * Hide the history panel
 */
export function hideHistoryPanel() {
  const panel = document.getElementById('history-panel');
  if (panel) {
    panel.classList.add('hidden');
  }
  isVisible = false;
  currentPagePath = null;
  commits = [];
}

/**
 * Render the commit list
 */
function renderCommitList() {
  const list = document.querySelector('.history-list');
  if (!list) return;

  if (commits.length === 0) {
    list.innerHTML = '<li class="history-empty">No history found for this page</li>';
    return;
  }

  list.innerHTML = commits.map((commit, index) => {
    const date = formatDate(commit.date);
    const isLatest = index === 0;

    return `
      <li class="history-item" data-commit-id="${escapeAttr(commit.commitId)}">
        <div class="history-item-header">
          <span class="history-commit-id">${escapeHtml(commit.shortId)}</span>
          ${isLatest ? '<span class="history-badge-latest">Latest</span>' : ''}
        </div>
        <div class="history-item-message">${escapeHtml(truncateMessage(commit.message))}</div>
        <div class="history-item-meta">
          <span class="history-author">${escapeHtml(commit.author)}</span>
          <span class="history-date">${escapeHtml(date)}</span>
        </div>
        <div class="history-item-actions">
          <button class="btn-history-compare" data-commit-id="${escapeAttr(commit.commitId)}" title="Compare this version with your current content">
            Compare
          </button>
          <button class="btn-history-view" data-commit-id="${escapeAttr(commit.commitId)}" ${isLatest ? 'disabled title="This is the current version"' : ''}>
            View
          </button>
          <button class="btn-history-restore" data-commit-id="${escapeAttr(commit.commitId)}" ${isLatest ? 'disabled title="This is the current version"' : ''}>
            Restore
          </button>
        </div>
      </li>
    `;
  }).join('');

  // Attach event handlers to buttons
  list.querySelectorAll('.btn-history-compare').forEach(btn => {
    btn.addEventListener('click', () => handleCompareVersion(btn.dataset.commitId));
  });

  list.querySelectorAll('.btn-history-view').forEach(btn => {
    btn.addEventListener('click', () => handleViewVersion(btn.dataset.commitId));
  });

  list.querySelectorAll('.btn-history-restore').forEach(btn => {
    btn.addEventListener('click', () => handleRestoreVersion(btn.dataset.commitId));
  });
}

/**
 * Handle comparing a specific version with current content
 */
async function handleCompareVersion(commitId) {
  if (!currentPagePath || !commitId) return;

  // Get current content from editor
  const currentContent = getCurrentContentFn ? getCurrentContentFn() : '';

  console.log('[History Panel] Compare version:', commitId);

  try {
    const result = await window.electronAPI.azureGetPageAtVersion({
      pagePath: currentPagePath,
      commitId
    });

    if (result.success) {
      const commit = commits.find(c => c.commitId === commitId);
      const versionInfo = commit ? {
        shortId: commit.shortId,
        author: commit.author,
        date: commit.date,
        message: commit.message
      } : { shortId: commitId.substring(0, 7) };

      // Show diff comparison dialog
      const dialogResult = await showHistoryCompareDialog({
        historicalContent: result.content,
        currentContent: currentContent,
        versionInfo: versionInfo,
        onRestore: onRestoreCallback
      });

      // If user chose to restore, close the history panel
      if (dialogResult?.action === 'restore') {
        hideHistoryPanel();
      }
    } else {
      announce(`Failed to load version: ${result.error}`);
    }
  } catch (error) {
    console.error('[History Panel] Error comparing version:', error);
    announce(`Error: ${error.message}`);
  }
}

/**
 * Handle viewing a specific version
 */
async function handleViewVersion(commitId) {
  if (!currentPagePath || !commitId) return;

  console.log('[History Panel] View version:', commitId);

  try {
    const result = await window.electronAPI.azureGetPageAtVersion({
      pagePath: currentPagePath,
      commitId
    });

    console.log('[History Panel] API result:', {
      success: result.success,
      hasContent: !!result.content,
      contentLength: result.content?.length,
      error: result.error
    });

    if (result.success) {
      // Show content in a modal or open in a new read-only tab
      console.log('[History Panel] Showing preview modal...');
      showVersionPreview(result.content, commitId);
    } else {
      announce(`Failed to load version: ${result.error}`);
    }
  } catch (error) {
    console.error('[History Panel] Error loading version:', error);
    announce(`Error: ${error.message}`);
  }
}

/**
 * Handle restoring a specific version
 */
async function handleRestoreVersion(commitId) {
  if (!currentPagePath || !commitId) return;

  const commit = commits.find(c => c.commitId === commitId);
  const commitInfo = commit ? `${commit.shortId} by ${commit.author}` : commitId.substring(0, 7);

  const confirmed = await showConfirmationDialog({
    title: 'Restore Version',
    message: `Restore page to version ${commitInfo}?`,
    detail: 'The current content will be replaced. You can undo this by restoring the previous version again.',
    confirmText: 'Restore',
    cancelText: 'Cancel',
    isDanger: false
  });

  if (!confirmed) return;

  try {
    const result = await window.electronAPI.azureGetPageAtVersion({
      pagePath: currentPagePath,
      commitId
    });

    if (result.success && onRestoreCallback) {
      onRestoreCallback(result.content, currentPagePath);
      announce(`Restored to version ${commit?.shortId || commitId.substring(0, 7)}`);
      hideHistoryPanel();
    } else if (!result.success) {
      announce(`Failed to restore: ${result.error}`);
    }
  } catch (error) {
    console.error('[History Panel] Error restoring version:', error);
    announce(`Error: ${error.message}`);
  }
}

/**
 * Show a preview of a specific version
 */
function showVersionPreview(content, commitId) {
  console.log('[History Panel] showVersionPreview called, content length:', content?.length);

  const commit = commits.find(c => c.commitId === commitId);
  const shortId = commit?.shortId || commitId.substring(0, 7);

  // Create or get preview modal
  let modal = document.getElementById('version-preview-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'version-preview-modal';
    modal.className = 'version-preview-modal hidden';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="version-preview-backdrop" aria-hidden="true"></div>
    <div class="version-preview-content"
         role="dialog"
         aria-modal="true"
         aria-labelledby="preview-title">
      <div class="version-preview-header">
        <h3 id="preview-title">Version ${escapeHtml(shortId)}</h3>
        <button class="version-preview-close" aria-label="Close preview">&times;</button>
      </div>
      <div class="version-preview-meta">
        ${commit ? `<span>${escapeHtml(commit.author)}</span> &middot; <span>${escapeHtml(formatDate(commit.date))}</span>` : ''}
      </div>
      <pre class="version-preview-code">${escapeHtml(content)}</pre>
    </div>
  `;

  modal.classList.remove('hidden');
  console.log('[History Panel] Modal shown, classes:', modal.className);

  // Attach event handlers
  modal.querySelector('.version-preview-backdrop').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
  modal.querySelector('.version-preview-close').addEventListener('click', () => {
    modal.classList.add('hidden');
  });
}

// Helper functions
function showLoading(show) {
  const loading = document.querySelector('.history-loading');
  if (loading) {
    loading.classList.toggle('hidden', !show);
  }
}

function showError(message) {
  const error = document.querySelector('.history-error');
  if (error) {
    error.textContent = message;
    error.classList.remove('hidden');
  }
}

function hideError() {
  const error = document.querySelector('.history-error');
  if (error) {
    error.classList.add('hidden');
  }
}

function formatDate(dateStr) {
  if (!dateStr) return 'Unknown date';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

function truncateMessage(message, maxLength = 100) {
  if (!message) return '';
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength) + '...';
}

function getPageName(path) {
  if (!path || path === '/') return 'Home';
  const parts = path.split('/');
  return decodeURIComponent(parts[parts.length - 1] || parts[parts.length - 2] || 'Home');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function escapeAttr(text) {
  return (text || '').replace(/"/g, '&quot;');
}
