/**
 * Image Insert Dialog Component
 *
 * Shows a dialog when users paste/drop an image, allowing them to choose:
 * 1. Upload to Azure DevOps Wiki (if connected)
 * 2. Embed as Base64 data URL
 */

/**
 * Format file size for display
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size string
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Create a thumbnail preview from a blob
 * @param {Blob} blob - Image blob
 * @returns {Promise<string>} Data URL for preview
 */
async function createThumbnail(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

/**
 * Show the image insert dialog
 * @param {Blob} blob - Image blob to insert
 * @param {boolean} isAzureConnected - Whether Azure upload is available
 * @returns {Promise<{action: 'upload'|'embed'|'cancel', remember: boolean}>}
 */
export async function showImageInsertDialog(blob, isAzureConnected) {
  // Generate thumbnail preview
  const thumbnailUrl = await createThumbnail(blob);
  const fileName = blob.name || `image-${Date.now()}.png`;
  const fileSize = formatFileSize(blob.size);

  return new Promise((resolve) => {
    // Create dialog element
    const dialog = document.createElement('div');
    dialog.className = 'image-insert-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'image-insert-title');

    dialog.innerHTML = `
      <div class="image-insert-backdrop"></div>
      <div class="image-insert-content">
        <h3 id="image-insert-title">How would you like to insert this image?</h3>

        <div class="image-preview">
          ${thumbnailUrl ? `<img src="${thumbnailUrl}" alt="Image preview" />` : '<div class="no-preview">No preview</div>'}
          <div class="image-preview-name">${fileName} (${fileSize})</div>
        </div>

        <div class="image-insert-buttons">
          <button class="btn-upload" ${!isAzureConnected ? 'disabled' : ''} title="${!isAzureConnected ? 'Connect to Azure Wiki first' : 'Upload image to Azure DevOps Wiki'}">
            <span class="btn-icon">&#9729;</span>
            Upload to Azure
          </button>
          <button class="btn-embed">
            <span class="btn-icon">&#128206;</span>
            Embed as Base64
          </button>
        </div>

        ${!isAzureConnected ? '<div class="azure-hint">Connect to Azure Wiki to enable uploads</div>' : ''}

        <div class="remember-choice">
          <label>
            <input type="checkbox" id="remember-choice" />
            Remember my choice
          </label>
        </div>

        <button class="btn-cancel">Cancel</button>
      </div>
    `;

    // Handle upload button click
    dialog.querySelector('.btn-upload').addEventListener('click', () => {
      const remember = dialog.querySelector('#remember-choice').checked;
      closeDialog(dialog);
      resolve({ action: 'upload', remember });
    });

    // Handle embed button click
    dialog.querySelector('.btn-embed').addEventListener('click', () => {
      const remember = dialog.querySelector('#remember-choice').checked;
      closeDialog(dialog);
      resolve({ action: 'embed', remember });
    });

    // Handle cancel button click
    dialog.querySelector('.btn-cancel').addEventListener('click', () => {
      closeDialog(dialog);
      resolve({ action: 'cancel', remember: false });
    });

    // Handle backdrop click
    dialog.querySelector('.image-insert-backdrop').addEventListener('click', () => {
      closeDialog(dialog);
      resolve({ action: 'cancel', remember: false });
    });

    // Handle Escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        closeDialog(dialog);
        document.removeEventListener('keydown', handleEscape);
        resolve({ action: 'cancel', remember: false });
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Append to body and show
    document.body.appendChild(dialog);

    // Focus the first enabled button
    requestAnimationFrame(() => {
      dialog.classList.add('visible');
      const firstButton = dialog.querySelector('.btn-upload:not([disabled]), .btn-embed');
      if (firstButton) firstButton.focus();
    });
  });
}

/**
 * Close and remove the dialog
 * @param {HTMLElement} dialog - Dialog element
 */
function closeDialog(dialog) {
  dialog.classList.remove('visible');
  setTimeout(() => {
    if (dialog.parentNode) {
      dialog.parentNode.removeChild(dialog);
    }
  }, 200);
}

/**
 * Show an error dialog when image upload fails
 * @param {string} errorMessage - The error message to display
 * @param {Blob} blob - The image blob (for potential embed fallback)
 * @returns {Promise<{action: 'embed'|'cancel'}>}
 */
export async function showUploadErrorDialog(errorMessage, blob) {
  const fileName = blob?.name || 'image';
  const fileSize = blob ? formatFileSize(blob.size) : '';

  return new Promise((resolve) => {
    // Create dialog element
    const dialog = document.createElement('div');
    dialog.className = 'image-insert-dialog upload-error-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'upload-error-title');
    dialog.setAttribute('aria-describedby', 'upload-error-desc');

    dialog.innerHTML = `
      <div class="image-insert-backdrop"></div>
      <div class="image-insert-content upload-error-content">
        <h3 id="upload-error-title" class="upload-error-title">
          <span class="error-icon">&#9888;</span>
          Upload Failed
        </h3>

        <p id="upload-error-desc" class="upload-error-description">
          The image could not be uploaded to Azure DevOps Wiki.
          ${fileSize ? `<span class="file-info">(${fileName}, ${fileSize})</span>` : ''}
        </p>

        <div class="error-details">
          <label for="error-message-textarea">Error Details (click to copy):</label>
          <textarea
            id="error-message-textarea"
            class="error-message-textarea"
            readonly
            rows="4"
          >${escapeHtml(errorMessage)}</textarea>
          <button class="btn-copy-error" title="Copy error message">
            <span class="copy-icon">&#128203;</span>
            Copy
          </button>
        </div>

        <div class="image-insert-buttons">
          <button class="btn-embed btn-embed-fallback">
            <span class="btn-icon">&#128206;</span>
            Embed as Base64 Instead
          </button>
          <button class="btn-cancel">Cancel</button>
        </div>
      </div>
    `;

    // Handle copy button click
    const copyBtn = dialog.querySelector('.btn-copy-error');
    const textarea = dialog.querySelector('.error-message-textarea');

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(errorMessage);
        copyBtn.innerHTML = '<span class="copy-icon">&#10003;</span> Copied!';
        setTimeout(() => {
          copyBtn.innerHTML = '<span class="copy-icon">&#128203;</span> Copy';
        }, 2000);
      } catch (err) {
        // Fallback: select the textarea content
        textarea.select();
        document.execCommand('copy');
      }
    });

    // Click on textarea to select all
    textarea.addEventListener('click', () => {
      textarea.select();
    });

    // Handle embed button click
    dialog.querySelector('.btn-embed-fallback').addEventListener('click', () => {
      closeDialog(dialog);
      resolve({ action: 'embed' });
    });

    // Handle cancel button click
    dialog.querySelector('.btn-cancel').addEventListener('click', () => {
      closeDialog(dialog);
      resolve({ action: 'cancel' });
    });

    // Handle backdrop click
    dialog.querySelector('.image-insert-backdrop').addEventListener('click', () => {
      closeDialog(dialog);
      resolve({ action: 'cancel' });
    });

    // Handle Escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        closeDialog(dialog);
        document.removeEventListener('keydown', handleEscape);
        resolve({ action: 'cancel' });
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Append to body and show
    document.body.appendChild(dialog);

    // Focus the embed button
    requestAnimationFrame(() => {
      dialog.classList.add('visible');
      dialog.querySelector('.btn-embed-fallback').focus();
    });
  });
}

/**
 * Escape HTML to prevent XSS in error messages
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export default showImageInsertDialog;
