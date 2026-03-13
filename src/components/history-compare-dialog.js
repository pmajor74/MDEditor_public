/**
 * History Compare Dialog Component
 *
 * Shows a diff comparison between a historical version and the current content.
 * Allows the user to restore the historical version or keep current changes.
 */

import { computeUnifiedDiff, computeSideBySideDiff, getDiffStats, hasChanges, normalizeMarkdownForComparison, computeInlineWordDiff } from '../utils/diff-utils.js';

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
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

/**
 * Show the history compare dialog
 * @param {Object} options - Dialog options
 * @param {string} options.historicalContent - Content from the historical version
 * @param {string} options.currentContent - Current editor content
 * @param {Object} options.versionInfo - Info about the historical version
 * @param {Function} options.onRestore - Callback to restore content
 * @returns {Promise<{action: 'restore'|'close'}>}
 */
export async function showHistoryCompareDialog({ historicalContent, currentContent, versionInfo, onRestore }) {
  // Normalize content for comparison to remove WYSIWYG editor escape artifacts
  // This ensures that differences like \*\* vs ** are treated as equivalent
  const normalizedHistorical = normalizeMarkdownForComparison(historicalContent);
  const normalizedCurrent = normalizeMarkdownForComparison(currentContent);

  // Check if there are differences after normalization
  if (!hasChanges(normalizedHistorical, normalizedCurrent)) {
    return { action: 'close', noDifferences: true };
  }

  const stats = getDiffStats(normalizedHistorical, normalizedCurrent);

  return new Promise((resolve) => {
    // Create dialog element
    const dialog = document.createElement('div');
    dialog.className = 'history-compare-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'history-compare-title');

    let currentView = 'unified';

    dialog.innerHTML = buildDialogHTML(versionInfo, stats);

    // Initial render of diff using normalized content
    renderDiff(dialog, normalizedHistorical, normalizedCurrent, currentView);

    // Setup event listeners - pass original historicalContent for restore, but normalized for display
    setupEventListeners(dialog, normalizedHistorical, normalizedCurrent, versionInfo, onRestore, resolve, () => currentView, (v) => { currentView = v; }, historicalContent);

    // Append to body and show
    document.body.appendChild(dialog);

    requestAnimationFrame(() => {
      dialog.classList.add('visible');
      dialog.querySelector('.btn-close-compare')?.focus();
    });
  });
}

/**
 * Build the dialog HTML
 */
function buildDialogHTML(versionInfo, stats) {
  const versionLabel = versionInfo.shortId || 'Historical';
  const authorInfo = versionInfo.author ? `by ${escapeHtml(versionInfo.author)}` : '';
  const dateInfo = versionInfo.date ? formatDate(versionInfo.date) : '';
  const messageInfo = versionInfo.message ? escapeHtml(versionInfo.message) : '';

  return `
    <div class="history-compare-backdrop"></div>
    <div class="history-compare-content">
      <div class="history-compare-header">
        <h2 id="history-compare-title">Compare with Version ${escapeHtml(versionLabel)}</h2>
        <button class="history-compare-close" aria-label="Close">&times;</button>
      </div>

      <div class="history-compare-info">
        <div class="history-compare-version-info">
          <strong>Historical Version:</strong> ${escapeHtml(versionLabel)} ${authorInfo}
          ${dateInfo ? `<span class="history-compare-date">${escapeHtml(dateInfo)}</span>` : ''}
          ${messageInfo ? `<div class="history-compare-message">${messageInfo}</div>` : ''}
        </div>
        <div class="history-compare-stats">
          <span class="stat-added">+${stats.added} in current</span>
          <span class="stat-removed">-${stats.removed} from historical</span>
        </div>
      </div>

      <div class="history-compare-toolbar">
        <div class="view-toggle">
          <button class="view-btn active" data-view="unified">Unified</button>
          <button class="view-btn" data-view="side-by-side">Side-by-Side</button>
        </div>
        <label class="show-changes-only">
          <input type="checkbox" id="history-show-changes-only" />
          Show only changes
        </label>
      </div>

      <div class="history-compare-legend">
        <span class="legend-item legend-removed">Red = In historical version only</span>
        <span class="legend-item legend-added">Green = In your current version only</span>
      </div>

      <div class="history-compare-diff-container" id="history-diff-container">
        <!-- Diff content rendered here -->
      </div>

      <div class="history-compare-actions">
        <button class="btn-restore-version">Restore Historical Version</button>
        <button class="btn-close-compare">Keep Current</button>
      </div>
    </div>
  `;
}

/**
 * Render the diff content
 */
function renderDiff(dialog, historical, current, viewMode, showOnlyChanges = false) {
  const container = dialog.querySelector('#history-diff-container');
  if (!container) return;

  if (viewMode === 'unified') {
    renderUnifiedDiff(container, historical, current, showOnlyChanges);
  } else {
    renderSideBySideDiff(container, historical, current, showOnlyChanges);
  }
}

/**
 * Render unified diff view
 */
function renderUnifiedDiff(container, historical, current, showOnlyChanges) {
  const diff = computeUnifiedDiff(historical, current);
  let html = '<div class="diff-unified">';

  const CONTEXT_LINES = 3;
  const lines = [];
  let unchangedCount = 0;

  for (let i = 0; i < diff.length; i++) {
    const line = diff[i];

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
 * Render inline word diff for modified lines
 * @param {Array<{type: string, value: string}>} parts - Word diff parts
 * @param {'left'|'right'} side - Which side of the diff (left shows removed, right shows added)
 * @returns {string} - HTML with highlighted changes
 */
function renderInlineWordDiff(parts, side) {
  return parts.map(part => {
    const escapedValue = escapeHtml(part.value);
    if (part.type === 'unchanged') {
      return escapedValue;
    } else if (part.type === 'removed' && side === 'left') {
      return `<span class="diff-word-removed">${escapedValue}</span>`;
    } else if (part.type === 'added' && side === 'right') {
      return `<span class="diff-word-added">${escapedValue}</span>`;
    }
    return '';
  }).join('');
}

/**
 * Render side-by-side diff view
 */
function renderSideBySideDiff(container, historical, current, showOnlyChanges) {
  const diff = computeSideBySideDiff(historical, current);
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

    // Handle modified lines with inline word highlighting
    if (row.left.type === 'modified' && row.right.type === 'modified') {
      const { removedParts, addedParts } = computeInlineWordDiff(row.left.content, row.right.content);
      const leftContent = renderInlineWordDiff(removedParts, 'left');
      const rightContent = renderInlineWordDiff(addedParts, 'right');

      leftHtml += `
        <div class="diff-line diff-modified">
          <span class="diff-line-num">${row.left.lineNum || ''}</span>
          <span class="diff-line-content">${leftContent || '&nbsp;'}</span>
        </div>
      `;

      rightHtml += `
        <div class="diff-line diff-modified">
          <span class="diff-line-num">${row.right.lineNum || ''}</span>
          <span class="diff-line-content">${rightContent || '&nbsp;'}</span>
        </div>
      `;
    } else {
      // Regular added/removed/unchanged/empty lines
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
  }

  if (skippedCount > 0 && showOnlyChanges) {
    const separatorHtml = `<div class="diff-separator">... ${skippedCount} unchanged ...</div>`;
    leftHtml += separatorHtml;
    rightHtml += separatorHtml;
  }

  container.innerHTML = `
    <div class="diff-side-by-side">
      <div class="diff-side diff-side-left">
        <div class="diff-side-header">Historical Version</div>
        <div class="diff-side-content">${leftHtml}</div>
      </div>
      <div class="diff-side diff-side-right">
        <div class="diff-side-header">Your Current Content</div>
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
 * @param {HTMLElement} dialog - Dialog element
 * @param {string} historical - Normalized historical content (for display)
 * @param {string} current - Normalized current content (for display)
 * @param {Object} versionInfo - Version info
 * @param {Function} onRestore - Restore callback
 * @param {Function} resolve - Promise resolve function
 * @param {Function} getView - Get current view mode
 * @param {Function} setView - Set current view mode
 * @param {string} originalHistorical - Original (non-normalized) historical content for restore
 */
function setupEventListeners(dialog, historical, current, versionInfo, onRestore, resolve, getView, setView, originalHistorical) {
  // Use original content for restore if provided, otherwise fall back to normalized
  const contentToRestore = originalHistorical || historical;

  // Close button
  dialog.querySelector('.history-compare-close').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'close' });
  });

  // Backdrop click
  dialog.querySelector('.history-compare-backdrop').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'close' });
  });

  // Keep Current button
  dialog.querySelector('.btn-close-compare').addEventListener('click', () => {
    closeDialog(dialog);
    resolve({ action: 'close' });
  });

  // Restore Version button
  dialog.querySelector('.btn-restore-version').addEventListener('click', () => {
    if (onRestore) {
      onRestore(contentToRestore);
    }
    closeDialog(dialog);
    resolve({ action: 'restore' });
  });

  // View toggle buttons
  dialog.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      setView(view);

      dialog.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const showOnlyChanges = dialog.querySelector('#history-show-changes-only').checked;
      renderDiff(dialog, historical, current, view, showOnlyChanges);
    });
  });

  // Show only changes checkbox
  dialog.querySelector('#history-show-changes-only').addEventListener('change', (e) => {
    renderDiff(dialog, historical, current, getView(), e.target.checked);
  });

  // Keyboard shortcuts
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeDialog(dialog);
      document.removeEventListener('keydown', handleKeyDown);
      resolve({ action: 'close' });
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

export default showHistoryCompareDialog;
