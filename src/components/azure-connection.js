/**
 * Azure DevOps Connection Modal
 *
 * Simplified modal dialog for connecting to Azure DevOps Wiki.
 * Single-click connection with loading overlay and cancel support.
 */

let currentCallback = null;
let savedConfig = null;
let isConnecting = false;
let connectionAborted = false;

/**
 * Build the modal HTML structure
 */
function buildModalHTML() {
  const modal = document.getElementById('azure-connection-modal');
  if (!modal) return;

  modal.innerHTML = `
    <div class="azure-modal-backdrop" aria-hidden="true"></div>
    <div class="azure-modal-dialog"
         role="dialog"
         aria-modal="true"
         aria-labelledby="azure-modal-title"
         aria-describedby="connection-error">
      <div class="azure-modal-header">
        <h2 id="azure-modal-title">Connect to Azure DevOps Wiki</h2>
        <button class="azure-modal-close" title="Close" aria-label="Close dialog">&times;</button>
      </div>
      <div class="azure-modal-body">
        <form id="azure-connection-form">
          <div class="form-group">
            <label for="azure-org">Organization</label>
            <input type="text" id="azure-org" placeholder="your-organization" required
                   aria-describedby="azure-org-hint">
            <small id="azure-org-hint">Your Azure DevOps organization name</small>
          </div>

          <div class="form-group">
            <label for="azure-project">Project</label>
            <input type="text" id="azure-project" placeholder="your-project" required
                   aria-describedby="azure-project-hint">
            <small id="azure-project-hint">The project containing your wiki</small>
          </div>

          <div class="form-group">
            <label for="azure-pat">Personal Access Token</label>
            <input type="password" id="azure-pat" placeholder="••••••••••••••••" required
                   aria-describedby="azure-pat-hint">
            <small id="azure-pat-hint">
              <a href="#" id="pat-help-link">How to create a PAT</a>
            </small>
          </div>

          <div id="connection-error" class="error-message" role="alert" aria-live="polite" style="display: none;"></div>

          <div class="form-actions">
            <button type="submit" id="btn-connect" class="btn-primary">Connect</button>
          </div>
        </form>
      </div>

      <!-- Loading Overlay -->
      <div id="connection-loading-overlay" class="connection-loading-overlay hidden" role="status" aria-live="polite">
        <div class="loading-content">
          <div class="loading-spinner" aria-hidden="true"></div>
          <p class="loading-text">Connecting to Azure DevOps...</p>
          <button type="button" id="btn-cancel-connection" class="btn-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;

  // Attach event listeners
  modal.querySelector('.azure-modal-backdrop').addEventListener('click', handleBackdropClick);
  modal.querySelector('.azure-modal-close').addEventListener('click', hideConnectionModal);
  modal.querySelector('#azure-connection-form').addEventListener('submit', handleConnect);
  modal.querySelector('#pat-help-link').addEventListener('click', openPATHelp);
  modal.querySelector('#btn-cancel-connection').addEventListener('click', cancelConnection);

  // Enable/disable connect button based on form completion
  const form = modal.querySelector('#azure-connection-form');
  form.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', updateConnectButtonState);
  });

  // Keyboard handler for Escape and Tab (focus trap)
  document.addEventListener('keydown', handleModalKeydown);
}

function handleBackdropClick() {
  if (!isConnecting) {
    hideConnectionModal();
  }
}

function handleModalKeydown(event) {
  const modal = document.getElementById('azure-connection-modal');
  if (!modal || modal.classList.contains('hidden')) return;

  if (event.key === 'Escape') {
    if (isConnecting) {
      cancelConnection();
    } else {
      hideConnectionModal();
    }
    return;
  }

  // Focus trap - Tab key handling
  if (event.key === 'Tab') {
    const dialog = modal.querySelector('.azure-modal-dialog');
    const focusableElements = dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), a[href]'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey) {
      // Shift+Tab: if on first element, go to last
      if (document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: if on last element, go to first
      if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }
}

function updateConnectButtonState() {
  const org = document.getElementById('azure-org').value.trim();
  const project = document.getElementById('azure-project').value.trim();
  const pat = document.getElementById('azure-pat').value;
  const btn = document.getElementById('btn-connect');

  if (btn) {
    btn.disabled = !org || !project || !pat;
  }
}

/**
 * Handle connect form submission
 */
async function handleConnect(event) {
  event.preventDefault();

  if (isConnecting) return;

  const org = document.getElementById('azure-org').value.trim();
  const project = document.getElementById('azure-project').value.trim();
  const pat = document.getElementById('azure-pat').value;

  if (!org || !project || !pat) {
    showError('Please fill in all fields');
    return;
  }

  isConnecting = true;
  connectionAborted = false;
  hideError();
  showLoadingOverlay('Connecting to Azure DevOps...');

  // Show sidebar immediately with loading state
  if (currentCallback) {
    currentCallback({ type: 'connecting' });
  }

  try {
    // Step 1: Validate credentials
    updateLoadingText('Validating credentials...');
    const connectResult = await window.electronAPI.azureConnect({ org, project, pat });

    if (connectionAborted) {
      await window.electronAPI.azureDisconnect();
      return;
    }

    if (!connectResult.success) {
      throw new Error(connectResult.error || 'Failed to validate credentials');
    }

    // Step 2: Determine wiki ID
    let wikiId = savedConfig?.wikiId;
    let wikiName = wikiId;

    if (!wikiId) {
      // No wiki ID configured, fetch and use first wiki
      updateLoadingText('Finding wikis...');
      const wikisResult = await window.electronAPI.azureGetWikis();

      if (connectionAborted) {
        await window.electronAPI.azureDisconnect();
        return;
      }

      if (!wikisResult.success || !wikisResult.wikis || wikisResult.wikis.length === 0) {
        throw new Error('No wikis found in this project');
      }

      wikiId = wikisResult.wikis[0].id;
      wikiName = wikisResult.wikis[0].name;
    }

    // Step 2b: Resolve page path from page ID (if provided in URL)
    let rootPath = savedConfig?.rootPath || '/';
    if (savedConfig?.pageId && rootPath === '/') {
      updateLoadingText('Resolving page path...');
      const pathResult = await window.electronAPI.azureResolvePagePath({
        org, project, pat, wikiId, pageId: savedConfig.pageId
      });

      if (connectionAborted) {
        await window.electronAPI.azureDisconnect();
        return;
      }

      if (pathResult.success && pathResult.path) {
        rootPath = pathResult.path;
        console.log('Resolved page path from ID:', savedConfig.pageId, '->', rootPath);
      }
    }

    // Step 3: Complete connection with wiki ID
    updateLoadingText('Loading wiki...');
    const finalResult = await window.electronAPI.azureConnect({
      org, project, pat, wikiId, wikiName, rootPath
    });

    if (connectionAborted) {
      await window.electronAPI.azureDisconnect();
      return;
    }

    if (!finalResult.success) {
      throw new Error(finalResult.error || 'Failed to connect');
    }

    // Success! Mark as not connecting before closing modal
    isConnecting = false;
    hideLoadingOverlay();

    // Save callback reference before hiding modal (which clears it)
    const callback = currentCallback;

    // Close modal
    hideConnectionModal();

    // Notify callback after modal is hidden
    if (callback) {
      callback({
        type: 'connected',
        org, project, wikiId, wikiName,
        rootPath
      });
    }

  } catch (error) {
    isConnecting = false;
    hideLoadingOverlay();

    if (!connectionAborted) {
      showError(error.message || 'Connection failed');
      // Notify callback of failure
      if (currentCallback) {
        currentCallback({ type: 'error', error: error.message });
      }
    }
  }
}

/**
 * Cancel ongoing connection
 */
function cancelConnection() {
  connectionAborted = true;
  isConnecting = false;
  hideLoadingOverlay();

  // Notify callback of cancellation
  if (currentCallback) {
    currentCallback({ type: 'cancelled' });
  }

  // Disconnect if partially connected
  window.electronAPI.azureDisconnect();
}

/**
 * Open PAT help link
 */
function openPATHelp(event) {
  event.preventDefault();
  const org = document.getElementById('azure-org').value.trim() || 'your-org';
  showError(`Create PAT at: https://dev.azure.com/${org}/_usersSettings/tokens\nRequired scope: Wiki (Read & Write)`);
}

function showError(message) {
  const errorEl = document.getElementById('connection-error');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
}

function hideError() {
  const errorEl = document.getElementById('connection-error');
  if (errorEl) {
    errorEl.style.display = 'none';
  }
}

function showLoadingOverlay(text) {
  const overlay = document.getElementById('connection-loading-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    updateLoadingText(text);
  }
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('connection-loading-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

function updateLoadingText(text) {
  const textEl = document.querySelector('.loading-text');
  if (textEl) {
    textEl.textContent = text;
  }
}

/**
 * Show the connection modal
 */
export async function showConnectionModal(onConnect) {
  currentCallback = onConnect;

  const modal = document.getElementById('azure-connection-modal');
  if (!modal) {
    console.error('Azure connection modal not found in DOM');
    return;
  }

  // Build modal if not already built
  if (!modal.querySelector('.azure-modal-dialog')) {
    buildModalHTML();
  }

  // Reset form and state
  document.getElementById('azure-connection-form').reset();
  hideError();
  hideLoadingOverlay();
  isConnecting = false;
  connectionAborted = false;

  // Load saved config from .env
  try {
    savedConfig = await window.electronAPI.azureLoadConfig();
    if (savedConfig.org) document.getElementById('azure-org').value = savedConfig.org;
    if (savedConfig.project) document.getElementById('azure-project').value = savedConfig.project;
    if (savedConfig.pat) document.getElementById('azure-pat').value = savedConfig.pat;
  } catch (error) {
    console.warn('Could not load saved config:', error);
    savedConfig = null;
  }

  // Update button state
  updateConnectButtonState();

  // Show modal
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');

  // Focus first empty input
  const orgInput = document.getElementById('azure-org');
  if (!orgInput.value) {
    orgInput.focus();
  } else {
    const projectInput = document.getElementById('azure-project');
    if (!projectInput.value) {
      projectInput.focus();
    } else {
      const patInput = document.getElementById('azure-pat');
      if (!patInput.value) {
        patInput.focus();
      }
    }
  }
}

/**
 * Hide the connection modal
 */
export function hideConnectionModal() {
  if (isConnecting) {
    cancelConnection();
    return;
  }

  const modal = document.getElementById('azure-connection-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  document.body.classList.remove('modal-open');
  currentCallback = null;
}
