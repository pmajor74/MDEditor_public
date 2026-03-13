/**
 * Save Conflict Dialog Component
 *
 * Shows a diff comparison when attempting to save and the remote page
 * has been modified since it was loaded. Allows user to see changes
 * and decide whether to overwrite or cancel.
 */

import { computeUnifiedDiff, computeSideBySideDiff, getDiffStats, normalizeMarkdownForComparison } from '../utils/diff-utils.js';

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Show the save conflict dialog
 * @param {Object} options - Dialog options
 * @param {string} options.localContent - User's current content (unsaved)
 * @param {string} options.remoteContent - Content on the server
 * @param {string} options.pagePath - The page path being saved
 * @returns {Promise<{action: 'overwrite'|'cancel'|'reload'}>}
 */
export async function showSaveConflictDialog({ localContent, remoteContent, pagePath }) {
  // Normalize content for comparison to remove WYSIWYG editor escape artifacts
  const normalizedLocal = normalizeMarkdownForComparison(localContent);
  const normalizedRemote = normalizeMarkdownForComparison(remoteContent);

  const stats = getDiffStats(normalizedRemote, normalizedLocal);

  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'save-conflict-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'conflict-title');
    dialog.setAttribute('aria-describedby', 'conflict-desc');

    let currentView = 'unified';

    dialog.innerHTML = buildDialogHTML(pagePath, stats);

    // Initial render using normalized content
    renderDiff(dialog, normalizedRemote, normalizedLocal, currentView);

    // Setup event listeners
    setupEventListeners(dialog, normalizedRemote, normalizedLocal, resolve, () => currentView, (v) => { currentView = v; });

    document.body.appendChild(dialog);

    requestAnimationFrame(() => {
      dialog.classList.add('visible');
      dialog.querySelector('.btn-cancel-save')?.focus();
    });
  });
}

/**
 * Build the dialog HTML
 */
function buildDialogHTML(pagePath, stats) {
  const pageName = pagePath ? pagePath.split('/').pop() || 'Page' : 'Page';

  return `
    <div class="save-conflict-backdrop"></div>
    <div class="save-conflict-content">
      <div class="save-conflict-header">
        <div class="conflict-icon">&#9888;</div>
        <div class="conflict-title-area">
          <h2 id="conflict-title">Save Conflict Detected</h2>
          <p id="conflict-desc">
            "${escapeHtml(pageName)}" has been modified on the server since you loaded it.
            Review the differences below to decide how to proceed.
          </p>
        </div>
        <button class="save-conflict-close" aria-label="Close">&times;</button>
      </div>

      <div class="save-conflict-warning">
        <strong>Warning:</strong> If you overwrite, the remote changes (shown in red) will be lost.
        Consider copying your changes, reloading the page, and manually merging.
      </div>

      <div class="save-conflict-stats">
        <span class="stat-info">Comparing: <strong>Server version</strong> vs <strong>Your changes</strong></span>
        <span class="stat-added">+${stats.added} lines you added</span>
        <span class="stat-removed">-${stats.removed} lines from server</span>
      </div>

      <div class="save-conflict-toolbar">
        <div class="view-toggle">
          <button class="view-btn active" data-view="unified">Unified</button>
          <button class="view-btn" data-view="side-by-side">Side-by-Side</button>
        </div>
        <label class="show-changes-only">
          <input type="checkbox" id="conflict-show-changes-only" />
          Show only changes
        </label>
      </div>

      <div class="save-conflict-legend">
        <span class="legend-item legend-removed">Red = On server (will be lost if you overwrite)</span>
        <span class="legend-item legend-added">Green = Your changes (will be saved)</span>
      </div>

      <div class="save-conflict-diff-container" id="conflict-diff-container">
        <!-- Diff content rendered here -->
      </div>

      <div class="save-conflict-actions">
        <button class="btn-reload-page" title="Discard your changes and reload the latest version from server">
          Reload from Server
        </button>
        <button class="btn-cancel-save">
          Cancel (Keep Editing)
        </button>
        <button class="btn-overwrite-save" title="Replace server version with your changes">
          Overwrite Server Version
        </button>
      </div>
    </div>
  `;
}

/**
 * Render diff content
 */
function renderDiff(dialog, remote, local, viewMode, showOnlyChanges = false) {
  const container = dialog.querySelector('#conflict-diff-container');
  if (!container) return;

  if (viewMode === 'unified') {
    renderUnifiedDiff(container, remote, local, showOnlyChanges);
  } else {
    renderSideBySideDiff(container, remote, local, showOnlyChanges);
  }
}

/**
 * Render unified diff view
 */
function renderUnifiedDiff(container, remote, local, showOnlyChanges) {
  const diff = computeUnifiedDiff(remote, local);
  let html = '<div class="diff-unified">';

  const CONTEXT_LINES = 3;
  const lines = [];
  let unchangedCount = 0;

  for (let i = 0; i < diff.length; i++) {
    const line = diff[i];

    let withinContext = false;
    for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(diff.length - 1, i + CONTEXT_LINES); j++) {
      if (diff[j].type !== 'unchanged') {
        withinContext = true;
        break;
      }
    }

    if (line.type === 'unchanged' && showOnlyChanges && !withinContext) {
      unchangedCount++;
      continue;
    }

    if (unchangedCount > 0 && showOnlyChanges) {
      lines.push(`<div class="diff-separator">... ${unchangedCount} unchanged line${unchangedCount === 1 ? '' : 's'} ...</div>`);
      unchangedCount = 0;
    }

    const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
    const lineNum = line.type === 'added' ? line.modifiedLineNum : line.originalLineNum;
    const escapedContent = escapeHtml(line.content);

    lines.push(`
      <div class="diff-line diff-${line.type}">
        <span class="diff-line-num">${lineNum || ''}</span>
        <span class="diff-line-prefix">${prefix}</span>
        <span class="diff-line-content">${escapedContent || '&nbsp;'}</span>
      </div>
    `);
  }

  if (unchangedCount > 0 && showOnlyChanges) {
    lines.push(`<div class="diff-separator">... ${unchangedCount} unchanged line${unchangedCount === 1 ? '' : 's'} ...</div>`);
  }

  html += lines.join('');
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Render side-by-side diff view
 */
function renderSideBySideDiff(container, remote, local, showOnlyChanges) {
  const diff = computeSideBySideDiff(remote, local);
  const CONTEXT_LINES = 3;

  let leftHtml = '';
  let rightHtml = '';
  let skippedCount = 0;

  for (let i = 0; i < diff.length; i++) {
    const row = diff[i];

    let withinContext = false;
    for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(diff.length - 1, i + CONTEXT_LINES); j++) {
      if (diff[j].left.type !== 'unchanged' || diff[j].right.type !== 'unchanged') {
        withinContext = true;
        break;
      }
    }

    const isUnchanged = row.left.type === 'unchanged' && row.right.type === 'unchanged';

    if (isUnchanged && showOnlyChanges && !withinContext) {
      skippedCount++;
      continue;
    }

    if (skippedCount > 0 && showOnlyChanges) {
      const separatorHtml = `<div class="diff-separator">... ${skippedCount} unchanged ...</div>`;
      leftHtml += separatorHtml;
      rightHtml += separatorHtml;
      skippedCount = 0;
    }

    const leftContent = escapeHtml(row.left.content);
    const rightContent = escapeHtml(row.right.content);

    leftHtml += `
      <div class="diff-line diff-${row.left.type}">
        <span class="diff-line-num">${row.left.lineNum || ''}</span>
        <span class="diff-line-content">${leftContent || '&nbsp;'}</span>
      </div>
    `;

    rightHtml += `
      <div class="diff-line diff-${row.right.type}">
        <span class="diff-line-num">${row.right.lineNum || ''}</span>
        <span class="diff-line-content">${rightContent || '&nbsp;'}</span>
      </div>
    `;
  }

  if (skippedCount > 0 && showOnlyChanges) {
    const separatorHtml = `<div class="diff-separator">... ${skippedCount} unchanged ...</div>`;
    leftHtml += separatorHtml;
    rightHtml += separatorHtml;
  }

  container.innerHTML = `
    <div class="diff-side-by-side">
      <div class="diff-side diff-side-left">
        <div class="diff-side-header">Server Version</div>
        <div class="diff-side-content">${leftHtml}</div>
      </div>
      <div class="diff-side diff-side-right">
        <div class="diff-side-header">Your Changes</div>
        <div class="diff-side-content">${rightHtml}</div>
      </div>
    </div>
  `;

  // Sync scroll
  const leftPanel = container.querySelector('.diff-side-left .diff-side-content');
  const rightPanel = container.querySelector('.diff-side-right .diff-side-content');

  if (leftPanel && rightPanel) {
    let syncing = false;
    leftPanel.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      rightPanel.scrollTop = leftPanel.scrollTop;
      syncing = false;
    });
    rightPanel.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      leftPanel.scrollTop = rightPanel.scrollTop;
      syncing = false;
    });
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners(dialog, remote, local, resolve, getView, setView) {
  // Close button
  dialog.querySelector('.save-conflict-close').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'cancel' });
  });

  // Backdrop click
  dialog.querySelector('.save-conflict-backdrop').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'cancel' });
  });

  // Cancel button
  dialog.querySelector('.btn-cancel-save').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'cancel' });
  });

  // Overwrite button
  dialog.querySelector('.btn-overwrite-save').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'overwrite' });
  });

  // Reload button
  dialog.querySelector('.btn-reload-page').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'reload' });
  });

  // View toggle buttons
  dialog.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      setView(view);

      dialog.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const showOnlyChanges = dialog.querySelector('#conflict-show-changes-only').checked;
      renderDiff(dialog, remote, local, view, showOnlyChanges);
    });
  });

  // Show only changes checkbox
  dialog.querySelector('#conflict-show-changes-only').addEventListener('change', (e) => {
    renderDiff(dialog, remote, local, getView(), e.target.checked);
  });

  // Keyboard shortcuts
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeDialog(dialog);
      document.removeEventListener('keydown', handleKeyDown);
      resolve({ action: 'cancel' });
    }
  };
  document.addEventListener('keydown', handleKeyDown);
}

/**
 * Close and remove the dialog
 */
function closeDialog(dialog) {
  dialog.classList.remove('visible');
  setTimeout(() => {
    if (dialog.parentNode) {
      dialog.parentNode.removeChild(dialog);
    }
  }, 200);
}

export default showSaveConflictDialog;
