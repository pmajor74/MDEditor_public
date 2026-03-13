/**
 * Persona Wizard Component
 *
 * 3-step modal wizard for creating an AI persona:
 * Step 1: Configure (name, description, source folder, extensions, quality)
 * Step 2: Index & Analyze (progress)
 * Step 3: Review & Save (style profile + editable system prompt)
 */

import { createQualitySelectorHTML, initQualitySelector, getSelectedTier } from '../indexing-wizard/quality-selector.js';

let wizardElement = null;
let wizardState = {
  step: 1,
  personaName: '',
  displayName: '',
  description: '',
  rootPath: '',
  sourceFiles: [],  // For single/multiple file mode
  sourceMode: 'folder',  // 'folder' or 'files'
  extensions: ['.md', '.txt', '.text', '.rtf'],
  qualityLevel: 'medium',
  isIndexing: false,
  isAnalyzing: false,
  catalogName: '',
  styleProfile: null,
  systemPromptTemplate: '',
  cancelled: false
};

/**
 * Show the persona wizard
 * @param {string} sourcePath - Pre-filled source path (can be folder or file)
 */
export function showPersonaWizard(sourcePath = '') {
  // Detect if path is a file or folder based on extension
  const hasFileExtension = sourcePath && /\.[a-zA-Z0-9]+$/.test(sourcePath);
  const isFilePath = hasFileExtension && ['.md', '.txt', '.text', '.rtf', '.pdf'].some(ext =>
    sourcePath.toLowerCase().endsWith(ext)
  );

  wizardState = {
    step: 1,
    personaName: '',
    displayName: '',
    description: '',
    rootPath: isFilePath ? '' : sourcePath,
    sourceFiles: isFilePath ? [sourcePath] : [],
    sourceMode: isFilePath ? 'files' : 'folder',
    extensions: ['.md', '.txt', '.text', '.rtf'],
    qualityLevel: 'medium',
    isIndexing: false,
    isAnalyzing: false,
    catalogName: '',
    styleProfile: null,
    systemPromptTemplate: '',
    cancelled: false
  };

  console.log('[Persona Wizard] Initialized with mode:', wizardState.sourceMode,
    isFilePath ? 'file:' + sourcePath : 'folder:' + sourcePath);

  wizardElement = document.createElement('div');
  wizardElement.className = 'persona-wizard-overlay';
  wizardElement.innerHTML = createWizardHTML();
  document.body.appendChild(wizardElement);

  initWizardEvents();
}

/**
 * Create the wizard HTML
 */
function createWizardHTML() {
  return `
    <div class="persona-wizard-dialog">
      <div class="persona-wizard-header">
        <h2>Create AI Persona</h2>
        <button class="persona-wizard-close" id="persona-wizard-close">&times;</button>
      </div>

      <div class="persona-wizard-steps">
        <div class="persona-step ${wizardState.step === 1 ? 'active' : ''}" data-step="1">
          <span class="step-number">1</span>
          <span class="step-label">Configure</span>
        </div>
        <div class="persona-step ${wizardState.step === 2 ? 'active' : ''}" data-step="2">
          <span class="step-number">2</span>
          <span class="step-label">Index & Analyze</span>
        </div>
        <div class="persona-step ${wizardState.step === 3 ? 'active' : ''}" data-step="3">
          <span class="step-number">3</span>
          <span class="step-label">Review & Save</span>
        </div>
      </div>

      <div class="persona-wizard-body" id="persona-wizard-body">
        ${renderStep1()}
      </div>

      <div class="persona-wizard-footer" id="persona-wizard-footer">
        ${renderFooter()}
      </div>
    </div>
  `;
}

/**
 * Render Step 1: Configure
 */
function renderStep1() {
  const extOptions = ['.md', '.txt', '.text', '.rtf'];
  const isFolderMode = wizardState.sourceMode === 'folder';
  const fileListHtml = wizardState.sourceFiles.length > 0
    ? wizardState.sourceFiles.map(f => `<div class="persona-file-item">${f.split(/[/\\]/).pop()}</div>`).join('')
    : '<div class="persona-file-item empty">No files selected</div>';

  return `
    <div class="persona-step-content" id="persona-step-1">
      <div class="persona-form-group">
        <label for="persona-name">Persona Name</label>
        <input type="text" id="persona-name" placeholder="e.g. Napoleon Hill" value="${wizardState.displayName}" />
        <span class="persona-form-hint">The name will be used as the persona identifier</span>
      </div>

      <div class="persona-form-group">
        <label for="persona-desc">Description</label>
        <input type="text" id="persona-desc" placeholder="e.g. Author of Think and Grow Rich" value="${wizardState.description}" />
      </div>

      <div class="persona-form-group">
        <label>Source Type</label>
        <div class="persona-source-toggle">
          <button id="persona-source-folder" class="persona-source-btn ${isFolderMode ? 'active' : ''}" data-mode="folder">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            Folder
          </button>
          <button id="persona-source-files" class="persona-source-btn ${!isFolderMode ? 'active' : ''}" data-mode="files">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>
            File(s)
          </button>
        </div>
      </div>

      <div class="persona-form-group" id="persona-source-section">
        ${isFolderMode ? `
          <label for="persona-path">Source Folder</label>
          <div class="persona-path-row">
            <input type="text" id="persona-path" placeholder="Path to folder with source texts" value="${wizardState.rootPath}" readonly />
            <button id="persona-browse-btn" class="persona-browse-btn">Browse...</button>
          </div>
          <span class="persona-form-hint">Folder containing the author's writings (.md, .txt, etc.)</span>
        ` : `
          <label>Selected Files</label>
          <div class="persona-files-list" id="persona-files-list">
            ${fileListHtml}
          </div>
          <button id="persona-select-files-btn" class="persona-browse-btn">Select Files...</button>
          <span class="persona-form-hint">Select one or more text files containing the author's writings</span>
        `}
      </div>

      ${isFolderMode ? `
      <div class="persona-form-group">
        <label>File Extensions</label>
        <div class="persona-ext-checkboxes">
          ${extOptions.map(ext => `
            <label class="persona-ext-option">
              <input type="checkbox" value="${ext}" ${wizardState.extensions.includes(ext) ? 'checked' : ''} />
              <span>${ext}</span>
            </label>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <div class="persona-form-group">
        ${createQualitySelectorHTML(wizardState.qualityLevel)}
      </div>
    </div>
  `;
}

/**
 * Render Step 2: Index & Analyze (progress)
 */
function renderStep2() {
  return `
    <div class="persona-step-content" id="persona-step-2">
      <div class="persona-progress-section">
        <div class="persona-progress-phase" id="persona-phase-text">
          ${wizardState.isAnalyzing ? 'Analyzing writing style...' : 'Indexing files...'}
        </div>
        <div class="persona-progress-bar-container">
          <div class="persona-progress-bar" id="persona-progress-bar" style="width: 0%"></div>
        </div>
        <div class="persona-progress-detail" id="persona-progress-detail">Starting...</div>
      </div>
    </div>
  `;
}

/**
 * Render Step 3: Review & Save
 */
function renderStep3() {
  const profile = wizardState.styleProfile;
  return `
    <div class="persona-step-content" id="persona-step-3">
      <div class="persona-review-section">
        <h3>Style Profile for ${wizardState.displayName}</h3>
        ${profile ? `
          <div class="persona-profile-grid">
            <div class="persona-profile-item">
              <strong>Writing Style:</strong>
              <p>${profile.writingStyle || 'N/A'}</p>
            </div>
            <div class="persona-profile-item">
              <strong>Tone:</strong>
              <p>${profile.tone || 'N/A'}</p>
            </div>
            <div class="persona-profile-item">
              <strong>Key Vocabulary:</strong>
              <p>${Array.isArray(profile.vocabulary) ? profile.vocabulary.join(', ') : 'N/A'}</p>
            </div>
            <div class="persona-profile-item">
              <strong>Signature Phrases:</strong>
              <p>${Array.isArray(profile.keyPhrases) ? profile.keyPhrases.map(p => `"${p}"`).join(', ') : 'N/A'}</p>
            </div>
            <div class="persona-profile-item">
              <strong>Philosophical Outlook:</strong>
              <p>${profile.philosophicalOutlook || 'N/A'}</p>
            </div>
            <div class="persona-profile-item">
              <strong>Communication Patterns:</strong>
              <p>${profile.communicationPatterns || 'N/A'}</p>
            </div>
          </div>
        ` : '<p>No style profile generated.</p>'}
      </div>

      <div class="persona-prompt-section">
        <h3>System Prompt</h3>
        <p class="persona-form-hint">You can edit this prompt to refine the persona's voice.</p>
        <textarea id="persona-prompt-editor" class="persona-prompt-editor" rows="12">${wizardState.systemPromptTemplate || ''}</textarea>
      </div>
    </div>
  `;
}

/**
 * Render footer buttons based on current step
 */
function renderFooter() {
  switch (wizardState.step) {
    case 1:
      return `
        <button id="persona-cancel-btn" class="persona-btn-secondary">Cancel</button>
        <button id="persona-next-btn" class="persona-btn-primary">Next</button>
      `;
    case 2:
      return `
        <button id="persona-cancel-btn" class="persona-btn-secondary">Cancel</button>
      `;
    case 3:
      return `
        <button id="persona-cancel-btn" class="persona-btn-secondary">Cancel</button>
        <button id="persona-save-btn" class="persona-btn-primary">Save Persona</button>
      `;
    default:
      return '';
  }
}

/**
 * Initialize wizard event listeners
 */
function initWizardEvents() {
  // Close button
  wizardElement.querySelector('#persona-wizard-close')?.addEventListener('click', closeWizard);

  // Overlay click to close
  wizardElement.addEventListener('click', (e) => {
    if (e.target === wizardElement) closeWizard();
  });

  bindFooterEvents();
  bindStep1Events();
}

/**
 * Bind footer button events
 */
function bindFooterEvents() {
  const cancelBtn = wizardElement.querySelector('#persona-cancel-btn');
  const nextBtn = wizardElement.querySelector('#persona-next-btn');
  const saveBtn = wizardElement.querySelector('#persona-save-btn');

  if (cancelBtn) cancelBtn.addEventListener('click', closeWizard);
  if (nextBtn) nextBtn.addEventListener('click', handleNext);
  if (saveBtn) saveBtn.addEventListener('click', handleSave);
}

/**
 * Bind Step 1 specific events
 */
function bindStep1Events() {
  // Source type toggle buttons
  const folderBtn = wizardElement.querySelector('#persona-source-folder');
  const filesBtn = wizardElement.querySelector('#persona-source-files');

  if (folderBtn) {
    folderBtn.addEventListener('click', () => {
      if (wizardState.sourceMode !== 'folder') {
        wizardState.sourceMode = 'folder';
        updateStep1Source();
      }
    });
  }

  if (filesBtn) {
    filesBtn.addEventListener('click', () => {
      if (wizardState.sourceMode !== 'files') {
        wizardState.sourceMode = 'files';
        updateStep1Source();
      }
    });
  }

  // Folder browse button
  const browseBtn = wizardElement.querySelector('#persona-browse-btn');
  if (browseBtn) {
    browseBtn.addEventListener('click', async () => {
      try {
        const result = await window.electronAPI.fileOpenFolder();
        if (result && result.path) {
          wizardState.rootPath = result.path;
          const pathInput = wizardElement.querySelector('#persona-path');
          if (pathInput) pathInput.value = result.path;
        }
      } catch (error) {
        console.error('[Persona Wizard] Browse failed:', error);
      }
    });
  }

  // File select button
  const selectFilesBtn = wizardElement.querySelector('#persona-select-files-btn');
  if (selectFilesBtn) {
    selectFilesBtn.addEventListener('click', async () => {
      try {
        const result = await window.electronAPI.fileSelectForPersona({
          extensions: ['.txt', '.md', '.text', '.rtf']
        });
        if (result && result.success) {
          wizardState.sourceFiles = result.files;
          // Set rootPath to parent of first file for catalog storage
          if (result.files.length > 0) {
            const firstFile = result.files[0];
            wizardState.rootPath = firstFile.substring(0, firstFile.lastIndexOf(/[/\\]/.test(firstFile) ? (firstFile.includes('\\') ? '\\' : '/') : '/'));
          }
          updateFilesList();
        }
      } catch (error) {
        console.error('[Persona Wizard] File selection failed:', error);
      }
    });
  }

  // Quality selector
  const container = wizardElement.querySelector('.quality-selector');
  if (container) {
    initQualitySelector(container, (tier) => {
      wizardState.qualityLevel = tier;
    });
  }
}

/**
 * Update Step 1 source section when toggle changes
 */
function updateStep1Source() {
  // Re-render just the source section
  const body = wizardElement.querySelector('#persona-wizard-body');
  if (body) {
    body.innerHTML = renderStep1();
    bindStep1Events();
  }
}

/**
 * Update the files list display
 */
function updateFilesList() {
  const listEl = wizardElement.querySelector('#persona-files-list');
  if (!listEl) return;

  if (wizardState.sourceFiles.length === 0) {
    listEl.innerHTML = '<div class="persona-file-item empty">No files selected</div>';
  } else {
    listEl.innerHTML = wizardState.sourceFiles.map(f => {
      const filename = f.split(/[/\\]/).pop();
      return `<div class="persona-file-item">${filename}</div>`;
    }).join('');
  }
}

/**
 * Navigate to a specific step
 */
function goToStep(step) {
  wizardState.step = step;

  // Update step indicators
  wizardElement.querySelectorAll('.persona-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle('active', s === step);
    el.classList.toggle('completed', s < step);
  });

  // Update body
  const body = wizardElement.querySelector('#persona-wizard-body');
  if (body) {
    switch (step) {
      case 1: body.innerHTML = renderStep1(); bindStep1Events(); break;
      case 2: body.innerHTML = renderStep2(); break;
      case 3: body.innerHTML = renderStep3(); break;
    }
  }

  // Update footer
  const footer = wizardElement.querySelector('#persona-wizard-footer');
  if (footer) {
    footer.innerHTML = renderFooter();
    bindFooterEvents();
  }
}

/**
 * Handle Next button (Step 1 -> Step 2)
 */
async function handleNext() {
  // Collect values from Step 1
  const nameInput = wizardElement.querySelector('#persona-name');
  const descInput = wizardElement.querySelector('#persona-desc');
  const pathInput = wizardElement.querySelector('#persona-path');

  wizardState.displayName = nameInput?.value?.trim() || '';
  wizardState.personaName = wizardState.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  wizardState.description = descInput?.value?.trim() || '';

  // Handle folder vs files mode
  if (wizardState.sourceMode === 'folder') {
    wizardState.rootPath = pathInput?.value?.trim() || '';
    // Collect extensions
    const extCheckboxes = wizardElement.querySelectorAll('.persona-ext-option input:checked');
    wizardState.extensions = Array.from(extCheckboxes).map(cb => cb.value);
  } else {
    // Files mode - extract extensions from selected files
    if (wizardState.sourceFiles.length > 0) {
      const firstFile = wizardState.sourceFiles[0];
      // Use parent directory as rootPath
      const sep = firstFile.includes('\\') ? '\\' : '/';
      wizardState.rootPath = firstFile.substring(0, firstFile.lastIndexOf(sep));
      // Extract unique extensions from selected files
      const exts = new Set();
      wizardState.sourceFiles.forEach(f => {
        const ext = f.substring(f.lastIndexOf('.'));
        if (ext) exts.add(ext.toLowerCase());
      });
      wizardState.extensions = Array.from(exts);
    }
  }

  // Get quality tier
  const container = wizardElement.querySelector('.quality-selector');
  if (container) {
    wizardState.qualityLevel = getSelectedTier(container);
  }

  // Validate
  if (!wizardState.displayName) {
    alert('Please enter a persona name.');
    return;
  }

  if (wizardState.sourceMode === 'folder') {
    if (!wizardState.rootPath) {
      alert('Please select a source folder.');
      return;
    }
    if (wizardState.extensions.length === 0) {
      alert('Please select at least one file extension.');
      return;
    }
  } else {
    if (wizardState.sourceFiles.length === 0) {
      alert('Please select at least one source file.');
      return;
    }
  }

  // Move to Step 2 and start indexing
  goToStep(2);
  await startIndexingAndAnalysis();
}

/**
 * Start the indexing and analysis process
 */
async function startIndexingAndAnalysis() {
  wizardState.isIndexing = true;
  wizardState.cancelled = false;

  try {
    // Phase 1: Create persona + catalog
    updateProgress('Creating persona...', 5);

    const createResult = await window.electronAPI.personaCreate({
      name: wizardState.personaName,
      displayName: wizardState.displayName,
      description: wizardState.description,
      rootPath: wizardState.rootPath,
      extensions: wizardState.extensions
    });

    if (!createResult.success) {
      throw new Error(createResult.error || 'Failed to create persona');
    }

    wizardState.catalogName = createResult.catalogName;
    if (wizardState.cancelled) return;

    // Phase 2: Index files
    updateProgress('Indexing files...', 10);

    // Listen for indexing progress
    const progressHandler = (data) => {
      if (data.catalogName === wizardState.catalogName && !wizardState.cancelled) {
        const percent = 10 + (data.percent || 0) * 0.5; // 10-60% range
        updateProgress(`Indexing: ${data.file || ''}`, percent);
      }
    };
    window.electronAPI.onVectordbIndexProgress(progressHandler);

    // Determine paths to index based on source mode
    const pathsToIndex = wizardState.sourceMode === 'files'
      ? wizardState.sourceFiles
      : [wizardState.rootPath];

    const indexResult = await window.electronAPI.indexingStart({
      catalogName: wizardState.catalogName,
      paths: pathsToIndex,
      extensions: wizardState.extensions,
      qualityLevel: wizardState.qualityLevel,
      includeSubfolders: wizardState.sourceMode === 'folder'
    });

    if (wizardState.cancelled) return;

    if (!indexResult.success) {
      window.electronAPI.removeVectordbIndexProgressListener();
      throw new Error(indexResult.error || 'Failed to start indexing');
    }

    // Wait for indexing to actually complete via taskComplete event
    await new Promise((resolve, reject) => {
      const completeHandler = (data) => {
        window.electronAPI.removeIndexingTaskCompleteListener();
        window.electronAPI.removeVectordbIndexProgressListener();
        if (wizardState.cancelled) {
          reject(new Error('Wizard was cancelled'));
        } else if (data.summary?.cancelled) {
          reject(new Error('Indexing was cancelled'));
        } else if (data.summary?.errors > 0 && data.summary?.indexed === 0) {
          reject(new Error('Indexing failed - no files were indexed'));
        } else {
          resolve(data);
        }
      };
      window.electronAPI.onIndexingTaskComplete(completeHandler);
    });

    if (wizardState.cancelled) return;

    // Phase 3: Analyze style
    wizardState.isAnalyzing = true;
    updateProgress('Analyzing writing style...', 65);

    const analyzeResult = await window.electronAPI.personaAnalyzeStyle({
      personaName: wizardState.personaName,
      catalogName: wizardState.catalogName,
      displayName: wizardState.displayName
    });

    if (wizardState.cancelled) return;

    if (!analyzeResult.success) {
      throw new Error(analyzeResult.error || 'Style analysis failed');
    }

    wizardState.styleProfile = analyzeResult.styleProfile;
    wizardState.systemPromptTemplate = analyzeResult.systemPromptTemplate;

    updateProgress('Complete!', 100);

    // Move to review step
    setTimeout(() => {
      if (!wizardState.cancelled) goToStep(3);
    }, 500);

  } catch (error) {
    console.error('[Persona Wizard] Error:', error);
    if (!wizardState.cancelled) {
      updateProgress(`Error: ${error.message}`, 0);
      // Re-enable cancel button
      const footer = wizardElement?.querySelector('#persona-wizard-footer');
      if (footer) {
        footer.innerHTML = `
          <button id="persona-cancel-btn" class="persona-btn-secondary">Close</button>
        `;
        footer.querySelector('#persona-cancel-btn')?.addEventListener('click', closeWizard);
      }
    }
  } finally {
    wizardState.isIndexing = false;
    wizardState.isAnalyzing = false;
  }
}

/**
 * Update progress display
 */
function updateProgress(text, percent) {
  const phaseEl = wizardElement?.querySelector('#persona-phase-text');
  const barEl = wizardElement?.querySelector('#persona-progress-bar');
  const detailEl = wizardElement?.querySelector('#persona-progress-detail');

  if (phaseEl) phaseEl.textContent = text;
  if (barEl) barEl.style.width = `${percent}%`;
  if (detailEl) detailEl.textContent = `${Math.round(percent)}%`;
}

/**
 * Handle Save button (Step 3)
 */
async function handleSave() {
  // Get edited system prompt
  const promptEditor = wizardElement.querySelector('#persona-prompt-editor');
  const editedPrompt = promptEditor?.value || wizardState.systemPromptTemplate;

  try {
    const result = await window.electronAPI.personaUpdate({
      name: wizardState.personaName,
      updates: {
        styleProfile: wizardState.styleProfile,
        systemPromptTemplate: editedPrompt
      }
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to save persona');
    }

    console.log('[Persona Wizard] Persona saved successfully');
    closeWizard();

    // Trigger persona list refresh if available
    document.dispatchEvent(new CustomEvent('persona:created', {
      detail: { name: wizardState.personaName }
    }));

  } catch (error) {
    console.error('[Persona Wizard] Save failed:', error);
    alert('Failed to save persona: ' + error.message);
  }
}

/**
 * Close the wizard
 */
function closeWizard() {
  wizardState.cancelled = true;

  // Cancel any in-progress indexing
  if (wizardState.isIndexing && wizardState.catalogName) {
    window.electronAPI.indexingCancel({ catalogName: wizardState.catalogName }).catch(() => {});
    window.electronAPI.removeIndexingTaskCompleteListener();
    window.electronAPI.removeVectordbIndexProgressListener();
  }

  if (wizardElement && wizardElement.parentNode) {
    wizardElement.parentNode.removeChild(wizardElement);
  }
  wizardElement = null;
}
