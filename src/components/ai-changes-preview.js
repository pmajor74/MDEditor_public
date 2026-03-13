/**
 * AI Changes Preview Component
 *
 * Shows a diff preview dialog when AI Copilot generates changes,
 * allowing users to review and approve changes before applying.
 */

import { computeUnifiedDiff, computeSideBySideDiff, getDiffStats, hasChanges } from '../utils/diff-utils.js';

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Show the AI changes preview dialog
 * @param {Object} options - Preview options
 * @param {string} options.originalContent - Original document content
 * @param {string} options.newContent - AI-modified content
 * @param {string} options.changeSummary - AI's description of changes
 * @returns {Promise<{action: 'apply'|'discard', content?: string}>}
 */
export async function showAIChangesPreview({ originalContent, newContent, changeSummary }) {
  // Handle edge case: no changes
  if (!hasChanges(originalContent, newContent)) {
    return { action: 'discard', noChanges: true };
  }

  const stats = getDiffStats(originalContent, newContent);

  return new Promise((resolve) => {
    // Create dialog element
    const dialog = document.createElement('div');
    dialog.className = 'ai-changes-preview-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'ai-changes-title');

    // Track current view mode
    let currentView = 'unified';

    dialog.innerHTML = buildDialogHTML(changeSummary, stats);

    // Initial render of diff
    renderDiff(dialog, originalContent, newContent, currentView);

    // Setup event listeners
    setupEventListeners(dialog, originalContent, newContent, resolve, () => currentView, (v) => { currentView = v; });

    // Append to body and show
    document.body.appendChild(dialog);

    // Animate in and focus
    requestAnimationFrame(() => {
      dialog.classList.add('visible');
      dialog.querySelector('.btn-apply').focus();
    });
  });
}

/**
 * Build the dialog HTML structure
 */
function buildDialogHTML(changeSummary, stats) {
  return `
    <div class="ai-changes-backdrop"></div>
    <div class="ai-changes-content">
      <div class="ai-changes-header">
        <h2 id="ai-changes-title">AI Changes Preview</h2>
        <button class="ai-changes-close" aria-label="Close preview">&times;</button>
      </div>

      <div class="ai-changes-summary">
        <div class="ai-changes-summary-text">${escapeHtml(changeSummary || 'Changes ready to apply')}</div>
        <div class="ai-changes-stats">
          <span class="stat-added">+${stats.added} added</span>
          <span class="stat-removed">-${stats.removed} removed</span>
        </div>
      </div>

      <div class="ai-changes-toolbar">
        <div class="view-toggle">
          <button class="view-btn active" data-view="unified">Unified</button>
          <button class="view-btn" data-view="side-by-side">Side-by-Side</button>
        </div>
        <label class="show-changes-only">
          <input type="checkbox" id="show-changes-only" />
          Show only changes
        </label>
      </div>

      <div class="ai-changes-diff-container" id="diff-container">
        <!-- Diff content rendered here -->
      </div>

      <div class="ai-changes-actions">
        <button class="btn-discard">Discard Changes</button>
        <button class="btn-apply">Apply Changes</button>
      </div>
    </div>
  `;
}

/**
 * Render the diff content based on view mode
 */
function renderDiff(dialog, original, modified, viewMode, showOnlyChanges = false) {
  const container = dialog.querySelector('#diff-container');
  if (!container) return;

  if (viewMode === 'unified') {
    renderUnifiedDiff(container, original, modified, showOnlyChanges);
  } else {
    renderSideBySideDiff(container, original, modified, showOnlyChanges);
  }
}

/**
 * Render unified diff view
 */
function renderUnifiedDiff(container, original, modified, showOnlyChanges) {
  const diff = computeUnifiedDiff(original, modified);
  let html = '<div class="diff-unified">';

  // Group consecutive unchanged lines for collapsing in large diffs
  let unchangedCount = 0;
  const CONTEXT_LINES = 3; // Lines to show around changes

  const lines = [];
  for (let i = 0; i < diff.length; i++) {
    const line = diff[i];
    const prevChanged = i > 0 && diff[i - 1].type !== 'unchanged';
    const nextChanged = i < diff.length - 1 && diff[i + 1].type !== 'unchanged';

    // Check if within context of a change
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

    // If we skipped unchanged lines, show a separator
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

  // Handle trailing unchanged separator
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
function renderSideBySideDiff(container, original, modified, showOnlyChanges) {
  const diff = computeSideBySideDiff(original, modified);
  const CONTEXT_LINES = 3;

  let leftHtml = '';
  let rightHtml = '';
  let skippedCount = 0;

  for (let i = 0; i < diff.length; i++) {
    const row = diff[i];

    // Check if within context
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

    // Add separator if we skipped lines
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

  // Trailing separator
  if (skippedCount > 0 && showOnlyChanges) {
    const separatorHtml = `<div class="diff-separator">... ${skippedCount} unchanged ...</div>`;
    leftHtml += separatorHtml;
    rightHtml += separatorHtml;
  }

  container.innerHTML = `
    <div class="diff-side-by-side">
      <div class="diff-side diff-side-left">
        <div class="diff-side-header">Original</div>
        <div class="diff-side-content">${leftHtml}</div>
      </div>
      <div class="diff-side diff-side-right">
        <div class="diff-side-header">Modified</div>
        <div class="diff-side-content">${rightHtml}</div>
      </div>
    </div>
  `;

  // Sync scroll between left and right panels
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
 * Setup event listeners for the dialog
 */
function setupEventListeners(dialog, original, modified, resolve, getView, setView) {
  // Close button
  dialog.querySelector('.ai-changes-close').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'discard' });
  });

  // Backdrop click
  dialog.querySelector('.ai-changes-backdrop').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'discard' });
  });

  // Discard button
  dialog.querySelector('.btn-discard').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'discard' });
  });

  // Apply button
  dialog.querySelector('.btn-apply').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'apply', content: modified });
  });

  // View toggle buttons
  dialog.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      setView(view);

      // Update active state
      dialog.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Re-render diff
      const showOnlyChanges = dialog.querySelector('#show-changes-only').checked;
      renderDiff(dialog, original, modified, view, showOnlyChanges);
    });
  });

  // Show only changes checkbox
  dialog.querySelector('#show-changes-only').addEventListener('change', (e) => {
    renderDiff(dialog, original, modified, getView(), e.target.checked);
  });

  // Keyboard shortcuts
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeDialog(dialog);
      document.removeEventListener('keydown', handleKeyDown);
      resolve({ action: 'discard' });
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      // Ctrl/Cmd+Enter to apply
      closeDialog(dialog);
      document.removeEventListener('keydown', handleKeyDown);
      resolve({ action: 'apply', content: modified });
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

export default showAIChangesPreview;
