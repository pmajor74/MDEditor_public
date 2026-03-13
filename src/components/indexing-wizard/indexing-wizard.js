/**
 * Indexing Wizard Component
 * Main modal controller for the enhanced indexing experience
 */

import { createQualitySelectorHTML, initQualitySelector, getSelectedTier, updateTokenEstimate, QUALITY_TIERS } from './quality-selector.js';
import { createFileGridHTML, initFileGrid, updateFileStatus, addFiles, markFilesAs, getFileGridInstance } from './file-grid.js';
import { createLLMStreamPanelHTML, initLLMStreamPanel, appendStreamContent, clearStreamContent, setCurrentFile } from './llm-stream-panel.js';
import { showMinimizedStatus, hideMinimizedStatus, updateMinimizedProgress } from './minimized-status.js';
import { generateExtensionGroupsHTML, collectSelectedExtensions, updateExtensionCounter, setupExtensionListeners } from './extension-selector.js';
import { createFileConfirmationHTML, initFileConfirmation, getConfirmedFiles, getFileConfirmationStats } from './file-confirmation.js';
import { showConfirmationDialog, showAlertDialog } from '../confirmation-dialog.js';

// Wizard state
let wizardState = {
  step: 1,                  // 1: config, 2: file review, 3: progress
  selectedPaths: [],
  extensions: [],
  catalogName: '',
  isNewCatalog: true,
  qualityLevel: 'medium',
  isIndexing: false,
  isPaused: false,
  isMinimized: false,
  taskId: null,
  files: [],
  totalFiles: 0,
  processedFiles: 0,
  includeSubfolders: true,
  respectGitignore: true,
  scannedFiles: [],
  totalTokens: 0,
  chunkTokens: 0,
  currentPhase: '',
  phaseMessage: '',
  embeddingProgress: 0,
  hasShownError: false
};

// DOM references
let wizardElement = null;
let progressListenerCleanup = null;
let llmStreamListenerCleanup = null;
let fileStatusListenerCleanup = null;
let filesDiscoveredListenerCleanup = null;
let phaseChangeListenerCleanup = null;
let tokenUpdateListenerCleanup = null;

/**
 * Show the indexing wizard
 * @param {Object} options - Configuration options
 * @param {string[]} options.paths - Paths to index
 * @param {string[]} options.extensions - File extensions to include
 * @param {string} options.catalogName - Target catalog name
 * @param {boolean} options.isNewCatalog - Whether creating new catalog
 * @param {Array<{name, displayName, fileCount}>} options.existingCatalogs - Existing catalogs
 * @param {boolean} options.includeSubfolders - Whether to include subfolders
 * @param {string} options.defaultName - Default catalog name
 * @param {string} options.rootPath - Root path for new catalog
 * @param {string[]} options.folderPaths - Folder paths being added
 * @param {string[]} options.filePaths - File paths being added
 */
export async function showIndexingWizard(options) {
  console.log('[Indexing Wizard] Showing wizard with options:', options);

  // Initialize state
  wizardState = {
    step: 1,
    selectedPaths: options.paths || [],
    extensions: options.extensions || [],
    catalogName: options.catalogName || '',
    isNewCatalog: options.isNewCatalog !== false,
    qualityLevel: 'medium',
    isIndexing: false,
    isPaused: false,
    isMinimized: false,
    taskId: null,
    files: [],
    totalFiles: 0,
    processedFiles: 0,
    includeSubfolders: options.includeSubfolders !== false,
    respectGitignore: true,
    scannedFiles: [],
    existingCatalogs: options.existingCatalogs || [],
    defaultName: options.defaultName || options.catalogName || '',
    rootPath: options.rootPath || '',
    folderPaths: options.folderPaths || [],
    filePaths: options.filePaths || [],
    totalTokens: 0,
    chunkTokens: 0,
    currentPhase: '',
    phaseMessage: '',
    embeddingProgress: 0,
    hasShownError: false
  };

  // Create wizard element
  wizardElement = document.createElement('div');
  wizardElement.className = 'indexing-wizard-overlay';
  wizardElement.innerHTML = createWizardHTML();

  document.body.appendChild(wizardElement);

  // Initialize event handlers
  initWizardEventHandlers();

  // Check for incomplete tasks
  await checkForIncompleteTasks();
}

/**
 * Create wizard HTML
 * @returns {string} HTML string
 */
function createWizardHTML() {
  const pathDescription = getPathDescription(wizardState.selectedPaths);
  const catalogs = wizardState.existingCatalogs || [];
  const hasCatalogs = catalogs.length > 0;
  const isNew = wizardState.isNewCatalog;

  return `
    <div class="indexing-wizard">
      <div class="indexing-wizard-header">
        <h3>Add to Catalog</h3>
        <div class="indexing-wizard-header-actions">
          <button class="indexing-wizard-minimize" title="Minimize">&#x2500;</button>
          <button class="indexing-wizard-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="indexing-wizard-body">
        <!-- Step 1: Combined Configuration -->
        <div class="wizard-step wizard-step-1">
          <p class="wizard-path-info">Adding: <strong>${escapeHtml(pathDescription)}</strong></p>

          <!-- Catalog Selection -->
          <div class="wizard-config-section">
            <label class="wizard-radio-label">
              <input type="radio" name="wizard-catalog-choice" value="existing" ${hasCatalogs && !isNew ? 'checked' : ''} ${!hasCatalogs ? 'disabled' : ''}>
              Add to existing catalog
            </label>
            <select id="wizard-catalog-select" class="wizard-select" ${!hasCatalogs || isNew ? 'disabled' : ''}>
              ${!hasCatalogs ? '<option>No catalogs available</option>' :
                catalogs.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.displayName || c.name)} (${c.fileCount} files)</option>`).join('')}
            </select>
          </div>

          <div class="wizard-config-section">
            <label class="wizard-radio-label">
              <input type="radio" name="wizard-catalog-choice" value="new" ${!hasCatalogs || isNew ? 'checked' : ''}>
              Create new catalog
            </label>
            <input type="text" id="wizard-catalog-name" class="wizard-input" placeholder="Catalog name" value="${escapeHtml(wizardState.defaultName)}" ${hasCatalogs && !isNew ? 'disabled' : ''}>
          </div>

          ${isFilesOnlyMode() ? `
          <!-- Single-file mode: show file list instead of extension/scope options -->
          <div class="wizard-config-section">
            <label class="wizard-section-title">Files to Index</label>
            <div class="wizard-file-list-info">
              ${wizardState.filePaths.map(f => `<div class="wizard-file-list-item">${escapeHtml(f.split(/[\\/]/).pop())}</div>`).join('')}
            </div>
          </div>
          ` : `
          <!-- Subfolders & Gitignore -->
          <div class="wizard-config-section wizard-scope-section">
            <label class="wizard-checkbox-option">
              <input type="checkbox" id="wizard-include-subfolders" ${wizardState.includeSubfolders ? 'checked' : ''}>
              <span>Include subfolders</span>
            </label>
            <label class="wizard-checkbox-option">
              <input type="checkbox" id="wizard-respect-gitignore" ${wizardState.respectGitignore ? 'checked' : ''}>
              <span>Ignore .gitignored files</span>
            </label>
          </div>

          <!-- File Types -->
          <div class="wizard-config-section">
            <label class="wizard-section-title">File Types to Index</label>
            ${generateExtensionGroupsHTML()}
          </div>
          `}

          <!-- Quality Selector -->
          <div class="wizard-config-section">
            ${createQualitySelectorHTML(wizardState.qualityLevel)}
          </div>

          <div class="wizard-actions">
            <button class="wizard-btn wizard-btn-cancel">Cancel</button>
            <button class="wizard-btn wizard-btn-primary wizard-btn-start">Scan & Review</button>
          </div>
        </div>

        <!-- Step 2: File Confirmation (NEW) -->
        <div class="wizard-step wizard-step-2 hidden">
          <div class="wizard-scanning-spinner hidden">
            <div class="spinner"></div>
            <span>Scanning files...</span>
          </div>
          <div class="wizard-file-confirmation-container">
            ${createFileConfirmationHTML()}
          </div>
          <div class="wizard-actions">
            <button class="wizard-btn wizard-btn-back">Back</button>
            <button class="wizard-btn wizard-btn-primary wizard-btn-start-indexing">
              Start Indexing (<span class="wizard-confirmed-count">0</span> files)
            </button>
          </div>
        </div>

        <!-- Step 3: Progress -->
        <div class="wizard-step wizard-step-3 hidden">
          <div class="wizard-progress-header">
            <div class="wizard-progress-summary">
              <span class="wizard-progress-count">0 / 0 files</span>
              <span class="wizard-progress-tokens">0 tokens</span>
            </div>
            <div class="wizard-progress-bar">
              <div class="wizard-progress-bar-fill"></div>
            </div>
            <div class="wizard-phase-text"></div>
          </div>

          <!-- Error banner - shown on first error -->
          <div class="wizard-error-banner hidden">
            <span class="wizard-error-banner-icon">!</span>
            <span class="wizard-error-banner-message"></span>
          </div>

          <div class="wizard-progress-content">
            <!-- File Grid -->
            <div class="wizard-file-grid-container">
              ${createFileGridHTML()}
            </div>

            <!-- LLM Stream Panel (only for High quality) -->
            <div class="wizard-llm-panel-container hidden">
              ${createLLMStreamPanelHTML()}
            </div>
          </div>

          <div class="wizard-actions">
            <button class="wizard-btn wizard-btn-cancel wizard-btn-cancel-indexing">Cancel</button>
            <button class="wizard-btn wizard-btn-pause hidden">Pause</button>
            <button class="wizard-btn wizard-btn-resume hidden">Resume</button>
          </div>
        </div>

        <!-- Completion State -->
        <div class="wizard-step wizard-step-complete hidden">
          <div class="wizard-complete-icon">✓</div>
          <h4>Indexing Complete</h4>
          <div class="wizard-complete-summary">
            <div class="wizard-complete-stat">
              <span class="stat-value wizard-indexed-count">0</span>
              <span class="stat-label">Files Indexed</span>
            </div>
            <div class="wizard-complete-stat">
              <span class="stat-value wizard-skipped-count">0</span>
              <span class="stat-label">Skipped</span>
            </div>
            <div class="wizard-complete-stat">
              <span class="stat-value wizard-error-count">0</span>
              <span class="stat-label">Errors</span>
            </div>
          </div>
          <div class="wizard-actions">
            <button class="wizard-btn wizard-btn-primary wizard-btn-done">Done</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Get path description for display
 * @param {string[]} paths - Paths array
 * @returns {string} Description
 */
function getPathDescription(paths) {
  if (!paths || paths.length === 0) return 'No paths selected';
  if (paths.length === 1) return paths[0];

  const fileCount = paths.filter(p => !isDirectory(p)).length;
  const folderCount = paths.filter(p => isDirectory(p)).length;

  const parts = [];
  if (fileCount > 0) parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
  if (folderCount > 0) parts.push(`${folderCount} folder${folderCount > 1 ? 's' : ''}`);
  return parts.join(' and ');
}

/**
 * Check if path is a directory (simple heuristic)
 * @param {string} path - Path to check
 * @returns {boolean}
 */
function isDirectory(path) {
  // Check if has file extension
  const lastSegment = path.split(/[\\/]/).pop();
  return !lastSegment.includes('.');
}

/**
 * Check if the wizard is in files-only mode (no folders selected)
 * @returns {boolean}
 */
function isFilesOnlyMode() {
  return wizardState.filePaths.length > 0 && wizardState.folderPaths.length === 0;
}

/**
 * Initialize wizard event handlers
 */
function initWizardEventHandlers() {
  if (!wizardElement) return;

  // Close button
  wizardElement.querySelector('.indexing-wizard-close').addEventListener('click', () => {
    if (wizardState.isIndexing) {
      confirmCancelIndexing();
    } else {
      closeWizard();
    }
  });

  // Minimize button
  wizardElement.querySelector('.indexing-wizard-minimize').addEventListener('click', () => {
    minimizeWizard();
  });

  // Cancel button (step 1)
  wizardElement.querySelector('.wizard-btn-cancel').addEventListener('click', closeWizard);

  // Scan & Review button (step 1 → step 2)
  wizardElement.querySelector('.wizard-btn-start').addEventListener('click', scanAndReview);

  // Back button (step 2 → step 1)
  wizardElement.querySelector('.wizard-btn-back').addEventListener('click', () => {
    wizardState.step = 1;
    showStep(1);
  });

  // Start Indexing button (step 2 → step 3)
  wizardElement.querySelector('.wizard-btn-start-indexing').addEventListener('click', startIndexing);

  // Cancel indexing button (step 3)
  wizardElement.querySelector('.wizard-btn-cancel-indexing').addEventListener('click', () => {
    confirmCancelIndexing();
  });

  // Pause button
  wizardElement.querySelector('.wizard-btn-pause').addEventListener('click', pauseIndexing);

  // Resume button
  wizardElement.querySelector('.wizard-btn-resume').addEventListener('click', resumeIndexing);

  // Done button
  wizardElement.querySelector('.wizard-btn-done').addEventListener('click', closeWizard);

  // Initialize quality selector
  initQualitySelector(wizardElement, (tier) => {
    wizardState.qualityLevel = tier;
    console.log('[Indexing Wizard] Quality tier changed:', tier);

    // Show/hide LLM panel container based on tier
    const llmPanel = wizardElement.querySelector('.wizard-llm-panel-container');
    if (llmPanel) {
      llmPanel.classList.toggle('hidden', tier !== 'high');
    }
  });

  // Catalog choice radio buttons — enable/disable select vs input
  const updateCatalogInputStates = () => {
    const isNew = wizardElement.querySelector('input[name="wizard-catalog-choice"][value="new"]').checked;
    const selectEl = wizardElement.querySelector('#wizard-catalog-select');
    const nameEl = wizardElement.querySelector('#wizard-catalog-name');
    if (selectEl) selectEl.disabled = isNew;
    if (nameEl) nameEl.disabled = !isNew;
  };
  wizardElement.querySelectorAll('input[name="wizard-catalog-choice"]').forEach(radio => {
    radio.addEventListener('change', updateCatalogInputStates);
  });

  // Extension group listeners (checkboxes, expand/collapse, counter) - only in folder mode
  if (!isFilesOnlyMode()) {
    setupExtensionListeners(wizardElement);
  }

  // Close when clicking overlay background
  wizardElement.addEventListener('click', (e) => {
    if (e.target === wizardElement) {
      if (wizardState.isIndexing) {
        confirmCancelIndexing();
      } else {
        closeWizard();
      }
    }
  });
}

/**
 * Scan files and show the file review step (Step 1 → Step 2)
 */
async function scanAndReview() {
  // Read form values from Step 1
  const isNew = wizardElement.querySelector('input[name="wizard-catalog-choice"][value="new"]').checked;
  const catalogName = isNew
    ? wizardElement.querySelector('#wizard-catalog-name').value.trim()
    : wizardElement.querySelector('#wizard-catalog-select').value;
  const qualityLevel = getSelectedTier(wizardElement);

  // In files-only mode, derive extensions from file paths and skip folder options
  const filesOnly = isFilesOnlyMode();
  const extensions = filesOnly
    ? [...new Set(wizardState.filePaths.map(f => {
        const name = f.split(/[\\/]/).pop();
        const dotIdx = name.lastIndexOf('.');
        return dotIdx >= 0 ? name.substring(dotIdx).toLowerCase() : '';
      }).filter(e => e))]
    : collectSelectedExtensions(wizardElement);

  const includeSubfoldersEl = wizardElement.querySelector('#wizard-include-subfolders');
  const respectGitignoreEl = wizardElement.querySelector('#wizard-respect-gitignore');
  const includeSubfolders = includeSubfoldersEl ? includeSubfoldersEl.checked : true;
  const respectGitignore = respectGitignoreEl ? respectGitignoreEl.checked : true;

  // Validate
  if (!catalogName) {
    await showAlertDialog({ title: 'Missing Name', message: 'Please enter a catalog name.' });
    return;
  }
  if (!filesOnly && extensions.length === 0) {
    await showAlertDialog({ title: 'No Extensions', message: 'Please select at least one file extension.' });
    return;
  }

  // Update state with form values
  wizardState.catalogName = catalogName;
  wizardState.isNewCatalog = isNew;
  wizardState.extensions = extensions;
  wizardState.includeSubfolders = includeSubfolders;
  wizardState.respectGitignore = respectGitignore;
  wizardState.qualityLevel = qualityLevel;

  console.log('[Indexing Wizard] Scanning files for review, respectGitignore:', respectGitignore);

  // Switch to Step 2 and show scanning spinner
  wizardState.step = 2;
  showStep(2);
  setScanningSpinnerVisible(true);

  try {
    const result = await window.electronAPI.indexingScanPreview({
      paths: wizardState.selectedPaths,
      extensions: wizardState.extensions,
      includeSubfolders: wizardState.includeSubfolders,
      respectGitignore: wizardState.respectGitignore
    });

    setScanningSpinnerVisible(false);

    if (!result.success) {
      showError('Scan failed: ' + result.error);
      showStep(1);
      return;
    }

    // Populate the file confirmation tree
    wizardState.scannedFiles = result.files;
    initFileConfirmation(wizardElement, result.files, (stats) => {
      const countEl = wizardElement?.querySelector('.wizard-confirmed-count');
      if (countEl) countEl.textContent = stats.selected;
    });
    updateConfirmedCount();
  } catch (err) {
    setScanningSpinnerVisible(false);
    console.error('[Indexing Wizard] Scan error:', err);
    showError('Scan failed: ' + err.message);
    showStep(1);
  }
}

/**
 * Show/hide the scanning spinner in Step 2
 */
function setScanningSpinnerVisible(visible) {
  if (!wizardElement) return;
  const spinner = wizardElement.querySelector('.wizard-scanning-spinner');
  const container = wizardElement.querySelector('.wizard-file-confirmation-container');
  const actions = wizardElement.querySelector('.wizard-step-2 .wizard-actions');
  if (spinner) spinner.classList.toggle('hidden', !visible);
  if (container) container.classList.toggle('hidden', visible);
  if (actions) actions.classList.toggle('hidden', visible);
}

/**
 * Update the confirmed file count on the Start Indexing button
 */
function updateConfirmedCount() {
  if (!wizardElement) return;
  const stats = getFileConfirmationStats(wizardElement);
  const countEl = wizardElement.querySelector('.wizard-confirmed-count');
  if (countEl) countEl.textContent = stats.selected;
}

/**
 * Start the indexing process (Step 2 → Step 3)
 */
async function startIndexing() {
  const confirmedFiles = getConfirmedFiles(wizardElement);

  if (confirmedFiles.length === 0) {
    await showAlertDialog({ title: 'No Files', message: 'Please select at least one file to index.' });
    return;
  }

  console.log('[Indexing Wizard] Starting indexing with', confirmedFiles.length, 'files, quality:', wizardState.qualityLevel);

  // Switch to progress step
  wizardState.step = 3;
  wizardState.isIndexing = true;
  showStep(3);

  // Show LLM panel for high quality
  const llmPanel = wizardElement.querySelector('.wizard-llm-panel-container');
  if (llmPanel) {
    llmPanel.classList.toggle('hidden', wizardState.qualityLevel !== 'high');
  }

  // Initialize file grid
  initFileGrid(wizardElement);

  // Initialize LLM stream panel if high quality
  if (wizardState.qualityLevel === 'high') {
    initLLMStreamPanel(wizardElement);
  }

  // Setup progress listeners
  setupProgressListeners();

  try {
    // Call indexing API with quality level and pre-scanned files
    const result = await window.electronAPI.indexingStart({
      catalogName: wizardState.catalogName,
      qualityLevel: wizardState.qualityLevel,
      paths: wizardState.selectedPaths,
      extensions: wizardState.extensions,
      isNewCatalog: wizardState.isNewCatalog,
      includeSubfolders: wizardState.includeSubfolders,
      preScannedFiles: confirmedFiles
    });

    if (result.success) {
      wizardState.taskId = result.taskId;
      console.log('[Indexing Wizard] Indexing started, taskId:', result.taskId);
    } else {
      console.error('[Indexing Wizard] Failed to start indexing:', result.error);
      showError('Failed to start indexing: ' + result.error);
      wizardState.isIndexing = false;
    }
  } catch (err) {
    console.error('[Indexing Wizard] Error starting indexing:', err);
    showError('Error starting indexing: ' + err.message);
    wizardState.isIndexing = false;
  }
}

/**
 * Setup progress listeners
 */
function setupProgressListeners() {
  // File status updates
  if (window.electronAPI.onIndexingFileStatus) {
    window.electronAPI.onIndexingFileStatus((data) => {
      handleFileStatusUpdate(data);
    });
    fileStatusListenerCleanup = () => {
      if (window.electronAPI.removeIndexingFileStatusListener) {
        window.electronAPI.removeIndexingFileStatusListener();
      }
    };
  }

  // Batch file discovery (all files at once)
  if (window.electronAPI.onIndexingFilesDiscovered) {
    window.electronAPI.onIndexingFilesDiscovered((data) => {
      handleFilesDiscovered(data);
    });
    filesDiscoveredListenerCleanup = () => {
      if (window.electronAPI.removeIndexingFilesDiscoveredListener) {
        window.electronAPI.removeIndexingFilesDiscoveredListener();
      }
    };
  }

  // LLM stream updates (for high quality)
  if (window.electronAPI.onIndexingLLMStream) {
    window.electronAPI.onIndexingLLMStream((data) => {
      handleLLMStreamUpdate(data);
    });
    llmStreamListenerCleanup = () => {
      if (window.electronAPI.removeIndexingLLMStreamListener) {
        window.electronAPI.removeIndexingLLMStreamListener();
      }
    };
  }

  // Task completion
  if (window.electronAPI.onIndexingTaskComplete) {
    window.electronAPI.onIndexingTaskComplete((data) => {
      handleTaskComplete(data);
    });
    progressListenerCleanup = () => {
      if (window.electronAPI.removeIndexingTaskCompleteListener) {
        window.electronAPI.removeIndexingTaskCompleteListener();
      }
    };
  }

  // Phase change updates (scanning, indexing, embedding, etc.)
  if (window.electronAPI.onIndexingPhaseChange) {
    window.electronAPI.onIndexingPhaseChange((data) => {
      handlePhaseChange(data);
    });
    phaseChangeListenerCleanup = () => {
      if (window.electronAPI.removeIndexingPhaseChangeListener) {
        window.electronAPI.removeIndexingPhaseChangeListener();
      }
    };
  }

  // Token updates
  if (window.electronAPI.onIndexingTokenUpdate) {
    window.electronAPI.onIndexingTokenUpdate((data) => {
      handleTokenUpdate(data);
    });
    tokenUpdateListenerCleanup = () => {
      if (window.electronAPI.removeIndexingTokenUpdateListener) {
        window.electronAPI.removeIndexingTokenUpdateListener();
      }
    };
  }
}

/**
 * Handle file status update
 * @param {Object} data - Status update data
 */
function handleFileStatusUpdate(data) {
  const { taskId, filePath, status, tokens, timeMs, processed, total, error } = data;

  // Accept if taskId not yet set (race condition) or matches
  if (wizardState.taskId && taskId !== wizardState.taskId) return;

  // Update file in grid (pass error message for display)
  updateFileStatus(wizardElement, filePath, status, tokens, timeMs, error);

  // Track chunk tokens from file processing
  if (tokens && tokens > 0) {
    wizardState.chunkTokens += tokens;
  }

  // Update progress
  if (processed !== undefined && total !== undefined) {
    wizardState.processedFiles = processed;
    wizardState.totalFiles = total;
    updateProgressDisplay();
  }

  // Update minimized status if minimized
  if (wizardState.isMinimized) {
    updateMinimizedProgress(processed, total);
  }

  // Show error banner on first error
  if (status === 'error' && error && !wizardState.hasShownError) {
    wizardState.hasShownError = true;
    showErrorBanner(error);
    console.error(`[Indexing Wizard] File error: ${filePath} - ${error}`);
  }
}

/**
 * Handle batch file discovery (all files arrive at once)
 * @param {Object} data - Discovery data
 */
function handleFilesDiscovered(data) {
  const { taskId, files, total } = data;

  // Accept if taskId not yet set (race condition) or matches
  if (wizardState.taskId && taskId !== wizardState.taskId) return;

  // Add all files to grid at once (single render)
  addFiles(wizardElement, files);

  wizardState.totalFiles = total;
  updateProgressDisplay();
}

/**
 * Handle phase change (scanning, indexing, embedding, overview)
 * @param {Object} data - Phase data
 */
function handlePhaseChange(data) {
  const { taskId, phase, message, progress } = data;

  // Accept if taskId not yet set (race condition) or matches
  if (wizardState.taskId && taskId !== wizardState.taskId) return;

  console.log(`[Indexing Wizard] Phase change: ${phase}, progress: ${progress}, message: ${message}`);

  wizardState.currentPhase = phase;
  wizardState.phaseMessage = message || '';
  if (phase === 'embedding' && progress !== undefined) {
    wizardState.embeddingProgress = progress;
  }

  updateProgressDisplay();
}

/**
 * Handle LLM stream update
 * @param {Object} data - Stream data
 */
function handleLLMStreamUpdate(data) {
  const { taskId, filePath, chunk, isComplete } = data;

  if (taskId !== wizardState.taskId) return;

  if (filePath) {
    setCurrentFile(wizardElement, filePath);
  }

  if (chunk) {
    appendStreamContent(wizardElement, chunk);
  }

  if (isComplete) {
    clearStreamContent(wizardElement);
  }
}

/**
 * Handle token update
 * @param {Object} data - Token data
 */
function handleTokenUpdate(data) {
  const { taskId, inputTokens, outputTokens } = data;

  if (taskId !== wizardState.taskId) return;

  wizardState.totalTokens += (inputTokens || 0) + (outputTokens || 0);
  updateProgressDisplay();
}

/**
 * Handle task completion
 * @param {Object} data - Completion data
 */
function handleTaskComplete(data) {
  const { taskId, summary } = data;

  if (taskId !== wizardState.taskId) return;

  console.log('[Indexing Wizard] Task complete:', summary);

  wizardState.isIndexing = false;

  // Update completion stats
  if (wizardElement) {
    wizardElement.querySelector('.wizard-indexed-count').textContent = summary.indexed || 0;
    wizardElement.querySelector('.wizard-skipped-count').textContent = summary.skipped || 0;
    wizardElement.querySelector('.wizard-error-count').textContent = summary.errors || 0;

    // Update completion icon and title based on result
    const completeIcon = wizardElement.querySelector('.wizard-complete-icon');
    const completeTitle = wizardElement.querySelector('.wizard-step-complete h4');

    if (summary.errors > 0 || summary.error) {
      // Show warning/error state
      if (completeIcon) completeIcon.textContent = '⚠';
      if (completeIcon) completeIcon.style.color = '#f59e0b';
      if (completeTitle) completeTitle.textContent = summary.indexed > 0 ? 'Indexing Completed with Errors' : 'Indexing Failed';

      // Show error message if available
      if (summary.error) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'wizard-error-message';
        errorDiv.innerHTML = `<strong>Error:</strong> ${escapeHtml(summary.error)}`;
        const statsDiv = wizardElement.querySelector('.wizard-complete-summary');
        if (statsDiv) {
          statsDiv.parentNode.insertBefore(errorDiv, statsDiv.nextSibling);
        }
      }
    } else {
      // Success state
      if (completeIcon) completeIcon.textContent = '✓';
      if (completeIcon) completeIcon.style.color = '';
      if (completeTitle) completeTitle.textContent = 'Indexing Complete';
    }
  }

  // Batch-mark all remaining processing files as completed (safety net)
  markFilesAs(wizardElement, 'processing', 'completed');

  // Delay showing completion view by one paint frame so "Done" badges render
  requestAnimationFrame(() => {
    showStep('complete');

    // Hide minimized status if minimized
    if (wizardState.isMinimized) {
      hideMinimizedStatus();
      restoreWizard();
    }

    // Cleanup listeners
    cleanupListeners();
  });
}

/**
 * Update progress display (phase-aware)
 */
function updateProgressDisplay() {
  if (!wizardElement) return;

  const countEl = wizardElement.querySelector('.wizard-progress-count');
  const barFill = wizardElement.querySelector('.wizard-progress-bar-fill');
  const tokensEl = wizardElement.querySelector('.wizard-progress-tokens');
  const phaseEl = wizardElement.querySelector('.wizard-phase-text');

  const phase = wizardState.currentPhase;

  if (phase === 'embedding') {
    // During embedding, show embedding progress — not the misleading file count
    const pct = wizardState.embeddingProgress || 0;
    console.log(`[Indexing Wizard] Updating embedding display: ${pct}%, countEl=${!!countEl}, barFill=${!!barFill}, phaseEl=${!!phaseEl}`);
    if (countEl) countEl.textContent = `Embedding ${wizardState.totalFiles} files...`;
    if (barFill) barFill.style.width = `${pct}%`;
    if (phaseEl) phaseEl.textContent = `${pct}% complete`;
  } else if (phase === 'overview') {
    if (countEl) countEl.textContent = `${wizardState.processedFiles} / ${wizardState.totalFiles} files processed`;
    if (barFill) barFill.style.width = '100%';
    if (phaseEl) phaseEl.textContent = 'Generating project overview...';
  } else {
    // Scanning / indexing phases
    if (countEl) countEl.textContent = `${wizardState.processedFiles} / ${wizardState.totalFiles} files`;
    if (barFill && wizardState.totalFiles > 0) {
      const percent = Math.round((wizardState.processedFiles / wizardState.totalFiles) * 100);
      barFill.style.width = `${percent}%`;
    }
    if (phaseEl) phaseEl.textContent = wizardState.phaseMessage || '';
  }

  // Show chunk tokens (accumulated from file processing) or LLM tokens
  const displayTokens = wizardState.chunkTokens || wizardState.totalTokens;
  if (tokensEl) {
    tokensEl.textContent = formatTokens(displayTokens);
  }
}

/**
 * Format token count for display
 * @param {number} tokens - Token count
 * @returns {string} Formatted string
 */
function formatTokens(tokens) {
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M tokens';
  } else if (tokens >= 1000) {
    return (tokens / 1000).toFixed(1) + 'K tokens';
  }
  return tokens + ' tokens';
}

/**
 * Show error banner
 * @param {string} message - Error message
 */
function showErrorBanner(message) {
  if (!wizardElement) return;

  const banner = wizardElement.querySelector('.wizard-error-banner');
  const messageEl = wizardElement.querySelector('.wizard-error-banner-message');

  if (banner && messageEl) {
    messageEl.textContent = message;
    banner.classList.remove('hidden');
  }
}

/**
 * Show specific step
 * @param {number|string} step - Step number or 'complete'
 */
function showStep(step) {
  if (!wizardElement) return;

  wizardElement.querySelectorAll('.wizard-step').forEach(el => {
    el.classList.add('hidden');
  });

  if (step === 'complete') {
    wizardElement.querySelector('.wizard-step-complete').classList.remove('hidden');
  } else {
    wizardElement.querySelector(`.wizard-step-${step}`).classList.remove('hidden');
  }
}

/**
 * Minimize the wizard
 */
function minimizeWizard() {
  if (!wizardElement) return;

  wizardState.isMinimized = true;
  wizardElement.style.display = 'none';

  showMinimizedStatus({
    processed: wizardState.processedFiles,
    total: wizardState.totalFiles,
    onExpand: restoreWizard
  });
}

/**
 * Restore wizard from minimized state
 */
function restoreWizard() {
  if (!wizardElement) return;

  wizardState.isMinimized = false;
  wizardElement.style.display = '';
  hideMinimizedStatus();
}

/**
 * Pause indexing
 */
async function pauseIndexing() {
  if (!wizardState.taskId) return;

  try {
    await window.electronAPI.indexingPause({ taskId: wizardState.taskId });
    wizardState.isPaused = true;

    // Update UI
    wizardElement.querySelector('.wizard-btn-pause').classList.add('hidden');
    wizardElement.querySelector('.wizard-btn-resume').classList.remove('hidden');
  } catch (err) {
    console.error('[Indexing Wizard] Failed to pause:', err);
  }
}

/**
 * Resume indexing
 */
async function resumeIndexing() {
  if (!wizardState.taskId) return;

  try {
    await window.electronAPI.indexingResume({ taskId: wizardState.taskId });
    wizardState.isPaused = false;

    // Update UI
    wizardElement.querySelector('.wizard-btn-resume').classList.add('hidden');
    wizardElement.querySelector('.wizard-btn-pause').classList.remove('hidden');
  } catch (err) {
    console.error('[Indexing Wizard] Failed to resume:', err);
  }
}

/**
 * Confirm cancel indexing
 */
async function confirmCancelIndexing() {
  const confirmed = await showConfirmationDialog({
    title: 'Cancel Indexing',
    message: 'Are you sure you want to cancel indexing?',
    detail: 'Progress will be saved and can be resumed later.',
    confirmText: 'Cancel Indexing',
    isDanger: true
  });
  if (confirmed) {
    cancelIndexing();
  }
}

/**
 * Cancel indexing
 */
async function cancelIndexing() {
  if (wizardState.taskId) {
    try {
      await window.electronAPI.indexingCancel({ taskId: wizardState.taskId });
    } catch (err) {
      console.error('[Indexing Wizard] Failed to cancel:', err);
    }
  }

  wizardState.isIndexing = false;
  closeWizard();
}

/**
 * Close the wizard
 */
function closeWizard() {
  cleanupListeners();
  hideMinimizedStatus();

  if (wizardElement) {
    wizardElement.remove();
    wizardElement = null;
  }

  // Restore focus to AI chat input
  setTimeout(() => document.getElementById('ai-input')?.focus(), 50);

  // Reset state
  wizardState = {
    step: 1,
    selectedPaths: [],
    extensions: [],
    catalogName: '',
    isNewCatalog: true,
    qualityLevel: 'medium',
    isIndexing: false,
    isPaused: false,
    isMinimized: false,
    taskId: null,
    files: [],
    totalFiles: 0,
    processedFiles: 0,
    includeSubfolders: true,
    respectGitignore: true,
    scannedFiles: [],
    existingCatalogs: [],
    defaultName: '',
    rootPath: '',
    folderPaths: [],
    filePaths: [],
    totalTokens: 0,
    chunkTokens: 0,
    currentPhase: '',
    phaseMessage: '',
    embeddingProgress: 0,
    hasShownError: false
  };
}

/**
 * Cleanup all listeners
 */
function cleanupListeners() {
  if (progressListenerCleanup) {
    progressListenerCleanup();
    progressListenerCleanup = null;
  }
  if (llmStreamListenerCleanup) {
    llmStreamListenerCleanup();
    llmStreamListenerCleanup = null;
  }
  if (fileStatusListenerCleanup) {
    fileStatusListenerCleanup();
    fileStatusListenerCleanup = null;
  }
  if (filesDiscoveredListenerCleanup) {
    filesDiscoveredListenerCleanup();
    filesDiscoveredListenerCleanup = null;
  }
  if (phaseChangeListenerCleanup) {
    phaseChangeListenerCleanup();
    phaseChangeListenerCleanup = null;
  }
  if (tokenUpdateListenerCleanup) {
    tokenUpdateListenerCleanup();
    tokenUpdateListenerCleanup = null;
  }
}

/**
 * Check for incomplete indexing tasks on startup
 */
async function checkForIncompleteTasks() {
  try {
    const result = await window.electronAPI.indexingGetIncomplete();
    if (result.success && result.tasks && result.tasks.length > 0) {
      // Show recovery dialog for first incomplete task
      const task = result.tasks[0];
      showRecoveryDialog(task);
    }
  } catch (err) {
    console.error('[Indexing Wizard] Failed to check incomplete tasks:', err);
  }
}

/**
 * Show recovery dialog for incomplete task
 * @param {Object} task - Incomplete task data
 */
function showRecoveryDialog(task) {
  const dialog = document.createElement('div');
  dialog.className = 'indexing-recovery-overlay';
  dialog.innerHTML = `
    <div class="indexing-recovery-dialog">
      <h3>Resume Indexing?</h3>
      <p>A previous indexing task was interrupted:</p>
      <div class="recovery-info">
        <div class="recovery-info-row">
          <span class="recovery-label">Catalog:</span>
          <span class="recovery-value">${escapeHtml(task.catalogName)}</span>
        </div>
        <div class="recovery-info-row">
          <span class="recovery-label">Progress:</span>
          <span class="recovery-value">${task.processedFiles} / ${task.totalFiles} files</span>
        </div>
        <div class="recovery-info-row">
          <span class="recovery-label">Quality:</span>
          <span class="recovery-value">${QUALITY_TIERS[task.qualityLevel]?.name || task.qualityLevel}</span>
        </div>
      </div>
      <div class="recovery-actions">
        <button class="wizard-btn recovery-btn-discard">Discard</button>
        <button class="wizard-btn wizard-btn-primary recovery-btn-resume">Resume</button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  // Discard button
  dialog.querySelector('.recovery-btn-discard').addEventListener('click', async () => {
    await window.electronAPI.indexingDiscardTask({ taskId: task.taskId });
    dialog.remove();
  });

  // Resume button
  dialog.querySelector('.recovery-btn-resume').addEventListener('click', async () => {
    dialog.remove();
    await resumeIncompleteTask(task);
  });
}

/**
 * Resume an incomplete task
 * @param {Object} task - Task to resume
 */
async function resumeIncompleteTask(task) {
  // Initialize wizard state from task
  wizardState = {
    step: 3,
    selectedPaths: task.config?.rootPaths || [],
    extensions: task.config?.extensions || [],
    catalogName: task.catalogName,
    isNewCatalog: false,
    qualityLevel: task.qualityLevel,
    isIndexing: true,
    isPaused: false,
    isMinimized: false,
    taskId: task.taskId,
    files: [],
    totalFiles: task.totalFiles,
    processedFiles: task.processedFiles,
    includeSubfolders: task.config?.includeSubfolders !== false,
    respectGitignore: true,
    scannedFiles: [],
    totalTokens: 0,
    chunkTokens: 0,
    currentPhase: '',
    phaseMessage: '',
    embeddingProgress: 0,
    hasShownError: false
  };

  // Create wizard element
  wizardElement = document.createElement('div');
  wizardElement.className = 'indexing-wizard-overlay';
  wizardElement.innerHTML = createWizardHTML();

  document.body.appendChild(wizardElement);

  // Initialize event handlers
  initWizardEventHandlers();

  // Show progress step (step 3)
  showStep(3);

  // Initialize components
  initFileGrid(wizardElement);
  if (wizardState.qualityLevel === 'high') {
    initLLMStreamPanel(wizardElement);
    wizardElement.querySelector('.wizard-llm-panel-container').classList.remove('hidden');
  }

  // Setup listeners
  setupProgressListeners();

  // Update progress display
  updateProgressDisplay();

  // Resume the task
  await window.electronAPI.indexingResume({ taskId: task.taskId });
}

/**
 * Show error message
 * @param {string} message - Error message
 */
function showError(message) {
  showAlertDialog({ title: 'Error', message });
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export for external use
export { wizardState, closeWizard };
