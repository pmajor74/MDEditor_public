/**
 * Keyboard Shortcuts Dialog
 *
 * Displays a modal overlay listing all available keyboard shortcuts,
 * grouped by category. Triggered from Help > Keyboard Shortcuts (Ctrl+/).
 */

const SHORTCUT_GROUPS = [
  {
    title: 'File',
    shortcuts: [
      { keys: 'Ctrl+N', action: 'New file' },
      { keys: 'Ctrl+O', action: 'Open file' },
      { keys: 'Ctrl+S', action: 'Save' },
      { keys: 'Ctrl+Shift+S', action: 'Save As' },
      { keys: 'Ctrl+W', action: 'Close tab' },
    ]
  },
  {
    title: 'Edit',
    shortcuts: [
      { keys: 'Ctrl+Z', action: 'Undo' },
      { keys: 'Ctrl+Y', action: 'Redo' },
      { keys: 'Ctrl+X', action: 'Cut' },
      { keys: 'Ctrl+C', action: 'Copy' },
      { keys: 'Ctrl+V', action: 'Paste' },
      { keys: 'Ctrl+A', action: 'Select all' },
      { keys: 'Ctrl+F', action: 'Find' },
      { keys: 'Ctrl+H', action: 'Replace' },
    ]
  },
  {
    title: 'Text Formatting',
    shortcuts: [
      { keys: 'Ctrl+B', action: 'Bold' },
      { keys: 'Ctrl+I', action: 'Italic' },
      { keys: 'Ctrl+U', action: 'Underline' },
      { keys: 'Ctrl+D', action: 'Strikethrough' },
      { keys: 'Ctrl+M', action: 'Inline markdown input' },
    ]
  },
  {
    title: 'View',
    shortcuts: [
      { keys: 'Ctrl+,', action: 'Settings' },
      { keys: 'Ctrl+Shift+A', action: 'Toggle AI Copilot' },
      { keys: 'Ctrl+Shift+C', action: 'Manage catalogs' },
      { keys: 'Ctrl+Shift+P', action: 'Manage personas' },
      { keys: 'Ctrl+0', action: 'Reset zoom' },
      { keys: 'Ctrl++', action: 'Zoom in' },
      { keys: 'Ctrl+-', action: 'Zoom out' },
      { keys: 'F11', action: 'Toggle fullscreen' },
      { keys: 'F12', action: 'Developer tools' },
    ]
  },
  {
    title: 'Azure DevOps',
    shortcuts: [
      { keys: 'Ctrl+B', action: 'Browse wiki' },
    ]
  },
];

/**
 * Show the keyboard shortcuts dialog
 */
export function showKeyboardShortcutsDialog() {
  // Remove any existing instance
  const existing = document.getElementById('keyboard-shortcuts-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'keyboard-shortcuts-dialog';
  dialog.className = 'kbd-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'kbd-dialog-title');

  dialog.innerHTML = `
    <div class="kbd-backdrop"></div>
    <div class="kbd-content">
      <div class="kbd-header">
        <h2 id="kbd-dialog-title">Keyboard Shortcuts</h2>
        <button class="kbd-close" title="Close (Escape)">&times;</button>
      </div>
      <div class="kbd-body">
        ${buildShortcutsHTML()}
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  // Event listeners
  const backdrop = dialog.querySelector('.kbd-backdrop');
  const closeBtn = dialog.querySelector('.kbd-close');

  backdrop.addEventListener('click', () => hideKeyboardShortcutsDialog());
  closeBtn.addEventListener('click', () => hideKeyboardShortcutsDialog());
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideKeyboardShortcutsDialog();
    }
  });

  // Animate in
  requestAnimationFrame(() => {
    dialog.classList.add('visible');
    closeBtn.focus();
  });

  console.log('[INFO] KeyboardShortcutsDialog: shown');
}

/**
 * Hide and remove the keyboard shortcuts dialog
 */
export function hideKeyboardShortcutsDialog() {
  const dialog = document.getElementById('keyboard-shortcuts-dialog');
  if (!dialog) return;

  dialog.classList.remove('visible');
  setTimeout(() => dialog.remove(), 200);
}

/**
 * Build the HTML for all shortcut groups
 */
function buildShortcutsHTML() {
  return SHORTCUT_GROUPS.map(group => `
    <div class="kbd-group">
      <h3 class="kbd-group-title">${group.title}</h3>
      <div class="kbd-list">
        ${group.shortcuts.map(s => `
          <div class="kbd-row">
            <span class="kbd-action">${s.action}</span>
            <span class="kbd-keys">${formatKeys(s.keys)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

/**
 * Wrap each key in a <kbd> tag for styling
 */
function formatKeys(keys) {
  return keys.split('+').map(k => `<kbd>${k}</kbd>`).join('<span class="kbd-plus">+</span>');
}
