/**
 * Reusable Confirmation Dialog Component
 *
 * Accessible modal dialog for confirming dangerous actions like delete.
 */

let currentResolve = null;

/**
 * Show a confirmation dialog
 * @param {Object} options - Dialog options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Main message
 * @param {string} [options.detail] - Additional detail text
 * @param {string} [options.confirmText='Confirm'] - Confirm button text
 * @param {string} [options.cancelText='Cancel'] - Cancel button text
 * @param {boolean} [options.isDanger=false] - If true, styles confirm button as danger
 * @returns {Promise<boolean>} - Resolves true if confirmed, false if cancelled
 */
export function showConfirmationDialog({
  title,
  message,
  detail = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDanger = false
}) {
  return new Promise((resolve) => {
    currentResolve = resolve;

    // Create or get dialog container
    let dialog = document.getElementById('confirmation-dialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'confirmation-dialog';
      dialog.className = 'confirmation-dialog hidden';
      document.body.appendChild(dialog);
    }

    // Build dialog HTML
    dialog.innerHTML = `
      <div class="confirmation-backdrop" aria-hidden="true"></div>
      <div class="confirmation-content"
           role="alertdialog"
           aria-modal="true"
           aria-labelledby="confirm-title"
           aria-describedby="confirm-message">
        <h3 id="confirm-title" class="confirmation-title">${escapeHtml(title)}</h3>
        <p id="confirm-message" class="confirmation-message">${escapeHtml(message)}</p>
        ${detail ? `<p class="confirmation-detail">${escapeHtml(detail)}</p>` : ''}
        <div class="confirmation-actions">
          <button class="btn-confirm-cancel">${escapeHtml(cancelText)}</button>
          <button class="btn-confirm-ok ${isDanger ? 'btn-danger' : ''}">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    // Show dialog
    dialog.classList.remove('hidden');
    document.body.classList.add('modal-open');

    // Attach event handlers
    const backdrop = dialog.querySelector('.confirmation-backdrop');
    const cancelBtn = dialog.querySelector('.btn-confirm-cancel');
    const confirmBtn = dialog.querySelector('.btn-confirm-ok');

    backdrop.addEventListener('click', () => closeDialog(false));
    cancelBtn.addEventListener('click', () => closeDialog(false));
    confirmBtn.addEventListener('click', () => closeDialog(true));

    // Keyboard handling
    dialog.addEventListener('keydown', handleKeydown);

    // Focus the confirm button (or cancel if danger)
    setTimeout(() => {
      (isDanger ? cancelBtn : confirmBtn).focus();
    }, 50);
  });
}

/**
 * Close the dialog and resolve the promise
 */
function closeDialog(confirmed) {
  const dialog = document.getElementById('confirmation-dialog');
  if (dialog) {
    dialog.classList.add('hidden');
    dialog.removeEventListener('keydown', handleKeydown);
  }
  document.body.classList.remove('modal-open');

  if (currentResolve) {
    currentResolve(confirmed);
    currentResolve = null;
  }
}

/**
 * Handle keyboard events
 */
function handleKeydown(event) {
  const dialog = document.getElementById('confirmation-dialog');
  if (!dialog || dialog.classList.contains('hidden')) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeDialog(false);
    return;
  }

  // Focus trap
  if (event.key === 'Tab') {
    const focusable = dialog.querySelectorAll('button');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/**
 * Escape HTML for safe insertion
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show a prompt dialog for text input
 * @param {Object} options - Dialog options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Prompt message
 * @param {string} [options.placeholder=''] - Input placeholder
 * @param {string} [options.defaultValue=''] - Default input value
 * @param {string} [options.confirmText='OK'] - Confirm button text
 * @param {string} [options.cancelText='Cancel'] - Cancel button text
 * @returns {Promise<string|null>} - Resolves to input value or null if cancelled
 */
/**
 * Show an alert dialog (single OK button)
 * @param {Object} options - Dialog options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Main message
 * @param {string} [options.detail] - Additional detail text
 * @param {string} [options.okText='OK'] - OK button text
 * @returns {Promise<void>} - Resolves when dismissed
 */
export function showAlertDialog({
  title,
  message,
  detail = '',
  okText = 'OK'
}) {
  return new Promise((resolve) => {
    currentResolve = () => resolve();

    let dialog = document.getElementById('confirmation-dialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'confirmation-dialog';
      dialog.className = 'confirmation-dialog hidden';
      document.body.appendChild(dialog);
    }

    dialog.innerHTML = `
      <div class="confirmation-backdrop" aria-hidden="true"></div>
      <div class="confirmation-content"
           role="alertdialog"
           aria-modal="true"
           aria-labelledby="confirm-title"
           aria-describedby="confirm-message">
        <h3 id="confirm-title" class="confirmation-title">${escapeHtml(title)}</h3>
        <p id="confirm-message" class="confirmation-message">${escapeHtml(message)}</p>
        ${detail ? `<p class="confirmation-detail">${escapeHtml(detail)}</p>` : ''}
        <div class="confirmation-actions">
          <button class="btn-confirm-ok">${escapeHtml(okText)}</button>
        </div>
      </div>
    `;

    dialog.classList.remove('hidden');
    document.body.classList.add('modal-open');

    const backdrop = dialog.querySelector('.confirmation-backdrop');
    const okBtn = dialog.querySelector('.btn-confirm-ok');

    const dismiss = () => closeDialog(true);
    backdrop.addEventListener('click', dismiss);
    okBtn.addEventListener('click', dismiss);

    dialog.addEventListener('keydown', handleKeydown);

    setTimeout(() => okBtn.focus(), 50);
  });
}

export function showPromptDialog({
  title,
  message,
  placeholder = '',
  defaultValue = '',
  confirmText = 'OK',
  cancelText = 'Cancel'
}) {
  return new Promise((resolve) => {
    // Create or get dialog container
    let dialog = document.getElementById('prompt-dialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'prompt-dialog';
      dialog.className = 'confirmation-dialog hidden';
      document.body.appendChild(dialog);
    }

    // Build dialog HTML
    dialog.innerHTML = `
      <div class="confirmation-backdrop" aria-hidden="true"></div>
      <div class="confirmation-content"
           role="dialog"
           aria-modal="true"
           aria-labelledby="prompt-title"
           aria-describedby="prompt-message">
        <h3 id="prompt-title" class="confirmation-title">${escapeHtml(title)}</h3>
        <p id="prompt-message" class="confirmation-message">${escapeHtml(message)}</p>
        <input type="text"
               id="prompt-input"
               class="prompt-input"
               placeholder="${escapeHtml(placeholder)}"
               value="${escapeHtml(defaultValue)}"
               aria-label="${escapeHtml(message)}">
        <div class="confirmation-actions">
          <button class="btn-confirm-cancel">${escapeHtml(cancelText)}</button>
          <button class="btn-confirm-ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    // Show dialog
    dialog.classList.remove('hidden');
    document.body.classList.add('modal-open');

    const backdrop = dialog.querySelector('.confirmation-backdrop');
    const cancelBtn = dialog.querySelector('.btn-confirm-cancel');
    const confirmBtn = dialog.querySelector('.btn-confirm-ok');
    const input = dialog.querySelector('#prompt-input');

    const close = (value) => {
      dialog.classList.add('hidden');
      document.body.classList.remove('modal-open');
      resolve(value);
    };

    backdrop.addEventListener('click', () => close(null));
    cancelBtn.addEventListener('click', () => close(null));
    confirmBtn.addEventListener('click', () => close(input.value.trim() || null));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        close(input.value.trim() || null);
      }
    });

    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    });

    // Focus the input
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  });
}
