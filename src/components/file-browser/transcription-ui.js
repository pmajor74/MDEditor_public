/**
 * Transcription UI Helper
 *
 * Manages the transcription toast/progress UI in the file browser.
 * Shows progress, handles cancellation, refreshes the file list on completion,
 * and streams transcribed text into a new editor tab in real-time.
 */

let toastElement = null;
let listenersAttached = false;

// Streaming tab state
let transcriptionTabId = null;
let accumulatedText = '';
let transcribingStarted = false;
let currentFileName = '';
let updateTimer = null;
const UPDATE_THROTTLE_MS = 500;

// Folder transcription state
let folderMode = false;
let folderName = '';
let totalFiles = 0;
let currentFileIndex = 0;

const STAGE_LABELS = {
  'validating': 'Preparing...',
  'downloading-binary': 'Downloading whisper.cpp...',
  'extracting-binary': 'Extracting whisper.cpp...',
  'downloading-model': 'Downloading model...',
  'converting': 'Converting audio...',
  'transcribing': 'Transcribing...'
};

/**
 * Start transcription for a file and show progress toast
 * @param {string} filePath - Path to the audio file
 * @param {Function} onRefresh - Callback to refresh the file browser
 */
export function startTranscription(filePath, onRefresh) {
  if (!window.electronAPI?.transcriptionStart) {
    alert('Transcription not available');
    return;
  }

  // Attach event listeners (once)
  if (!listenersAttached) {
    attachListeners(onRefresh);
    listenersAttached = true;
  }

  // Reset streaming state
  transcriptionTabId = null;
  accumulatedText = '';
  transcribingStarted = false;
  currentFileName = filePath.split(/[\\/]/).pop();

  // Show toast
  showToast(currentFileName);

  // Start transcription
  window.electronAPI.transcriptionStart(filePath).then((result) => {
    if (!result.success) {
      updateToastError(result.error || 'Failed to start transcription');
      resetStreamState();
    }
  }).catch((err) => {
    updateToastError(err.message || 'Failed to start transcription');
    resetStreamState();
  });
}

/**
 * Start transcription for all audio files in a folder
 * @param {string[]} filePaths - Paths to the audio files
 * @param {string} folder - Folder name for display
 * @param {Function} onRefresh - Callback to refresh the file browser
 */
export function startFolderTranscription(filePaths, folder, onRefresh) {
  if (!window.electronAPI?.transcriptionStartFolder) {
    alert('Folder transcription not available');
    return;
  }

  // Attach event listeners (once)
  if (!listenersAttached) {
    attachListeners(onRefresh);
    listenersAttached = true;
  }

  // Reset streaming state
  transcriptionTabId = null;
  accumulatedText = '';
  transcribingStarted = false;
  currentFileName = '';

  // Set folder mode state
  folderMode = true;
  folderName = folder;
  totalFiles = filePaths.length;
  currentFileIndex = 0;

  // Show toast
  showToast(`${folder} (0/${totalFiles})`);

  // Start folder transcription
  window.electronAPI.transcriptionStartFolder(filePaths).then((result) => {
    if (!result.success) {
      updateToastError(result.error || 'Failed to start folder transcription');
      resetStreamState();
    }
  }).catch((err) => {
    updateToastError(err.message || 'Failed to start folder transcription');
    resetStreamState();
  });
}

/**
 * Attach IPC event listeners for transcription events
 */
function attachListeners(onRefresh) {
  window.electronAPI.onTranscriptionFileStart((data) => {
    if (!folderMode) return;

    currentFileIndex = data.index;
    const fileName = data.fileName;

    // Append a markdown header for this file
    if (accumulatedText) {
      accumulatedText += '\n\n';
    }
    accumulatedText += `## ${fileName}\n\n`;

    // Sync to tab store
    if (transcriptionTabId) {
      window.electronAPI.tabsSyncContent({
        tabId: transcriptionTabId,
        content: accumulatedText
      }).catch(() => {});
      flushEditorUpdate();
    }

    // Update toast status and title
    updateToastStatus(`File ${data.index} of ${data.total}: ${fileName}`);
    updateToastTitle(`Transcribing: ${folderName} (${data.index}/${data.total})`);
  });

  window.electronAPI.onTranscriptionProgress(async (data) => {
    updateToastProgress(data);

    // When transcribing stage starts, create the streaming tab
    if (data.stage === 'transcribing' && !transcribingStarted) {
      transcribingStarted = true;
      await createTranscriptionTab();
    }
  });

  window.electronAPI.onTranscriptionText((segment) => {
    if (!segment.text) return;

    // Accumulate text with timestamp prefix
    const line = `[${formatTime(segment.startTime)} --> ${formatTime(segment.endTime)}]  ${segment.text}`;
    accumulatedText += (accumulatedText ? '\n' : '') + line;

    // Sync to tab store immediately (so tab-switch always shows latest)
    if (transcriptionTabId) {
      window.electronAPI.tabsSyncContent({
        tabId: transcriptionTabId,
        content: accumulatedText
      }).catch(() => { /* tab may have been closed */ });
    }

    // Throttle live editor updates
    scheduleEditorUpdate();
  });

  window.electronAPI.onTranscriptionComplete(async (data) => {
    showToastComplete(data);

    // Read the final .txt file for completeness (whisper may have produced more text)
    if (data.textFile && transcriptionTabId) {
      try {
        const result = await window.electronAPI.fileReadFile(data.textFile);
        if (result?.success && result.content && result.content.trim()) {
          accumulatedText = result.content.trim();
          await window.electronAPI.tabsSyncContent({
            tabId: transcriptionTabId,
            content: accumulatedText
          }).catch(() => {});
          flushEditorUpdate();
        }
      } catch {
        // File read failed, keep accumulated text
      }
    }

    const wasFolderMode = folderMode;
    const completedFiles = currentFileIndex;
    resetStreamState();
    if (onRefresh) {
      setTimeout(() => onRefresh(), 500);
    }

    // Show completion popup
    if (wasFolderMode) {
      alert(`Folder transcription complete!\n\n${completedFiles} file(s) transcribed.`);
    } else {
      alert('Transcription complete!');
    }
  });

  window.electronAPI.onTranscriptionError((data) => {
    updateToastError(data.error || 'Transcription failed');
    resetStreamState();
  });
}

/**
 * Create a new editor tab for streaming transcription output
 */
async function createTranscriptionTab() {
  try {
    const title = folderMode
      ? `Transcribing: ${folderName} (0/${totalFiles})`
      : `Transcribing: ${currentFileName}`;
    const tab = await window.electronAPI.tabsCreate({
      type: 'untitled',
      title,
      content: ''
    });
    transcriptionTabId = tab.id;
  } catch (err) {
    console.warn('[TranscriptionUI] Failed to create tab:', err.message);
  }
}

/**
 * Schedule a throttled editor content update
 */
function scheduleEditorUpdate() {
  if (updateTimer) return; // already scheduled
  updateTimer = setTimeout(() => {
    flushEditorUpdate();
  }, UPDATE_THROTTLE_MS);
}

/**
 * Push accumulated content to the live editor
 */
function flushEditorUpdate() {
  if (updateTimer) {
    clearTimeout(updateTimer);
    updateTimer = null;
  }
  if (transcriptionTabId && window._transcriptionSetContent) {
    window._transcriptionSetContent(transcriptionTabId, accumulatedText);
  }
}

/**
 * Reset streaming state
 */
function resetStreamState() {
  if (updateTimer) {
    clearTimeout(updateTimer);
    updateTimer = null;
  }
  transcriptionTabId = null;
  accumulatedText = '';
  transcribingStarted = false;
  currentFileName = '';
  folderMode = false;
  folderName = '';
  totalFiles = 0;
  currentFileIndex = 0;
}

/**
 * Format timestamp for display (strip trailing milliseconds precision)
 * Input: "00:01:23.456" -> Output: "00:01:23"
 */
function formatTime(ts) {
  if (!ts) return '??:??:??';
  // Keep HH:MM:SS, drop .mmm
  const dotIndex = ts.indexOf('.');
  return dotIndex >= 0 ? ts.substring(0, dotIndex) : ts;
}

/**
 * Show the transcription toast
 */
function showToast(fileName) {
  removeToast();

  toastElement = document.createElement('div');
  toastElement.className = 'transcription-toast';
  toastElement.innerHTML = `
    <div class="transcription-toast-content">
      <div class="transcription-toast-header">
        <span class="transcription-toast-icon">&#x1f3a4;</span>
        <span class="transcription-toast-title">Transcribing: ${escapeHtml(fileName)}</span>
        <button class="transcription-toast-cancel" title="Cancel">&#x2715;</button>
      </div>
      <div class="transcription-toast-progress">
        <div class="transcription-toast-bar" style="width: 0%"></div>
      </div>
      <div class="transcription-toast-status">Preparing...</div>
    </div>
  `;

  toastElement.querySelector('.transcription-toast-cancel').addEventListener('click', () => {
    if (window.electronAPI?.transcriptionCancel) {
      window.electronAPI.transcriptionCancel();
    }
    removeToast();
  });

  document.body.appendChild(toastElement);
}

/**
 * Update the toast with progress info
 */
function updateToastProgress(data) {
  if (!toastElement) return;

  const bar = toastElement.querySelector('.transcription-toast-bar');
  const status = toastElement.querySelector('.transcription-toast-status');

  const label = STAGE_LABELS[data.stage] || data.stage || 'Processing...';
  const percent = data.percent || 0;

  if (bar) bar.style.width = `${percent}%`;
  if (status) status.textContent = percent > 0 ? `${label} ${percent}%` : label;
}

/**
 * Update just the toast status text
 */
function updateToastStatus(text) {
  if (!toastElement) return;
  const status = toastElement.querySelector('.transcription-toast-status');
  if (status) status.textContent = text;
}

/**
 * Update the toast title text
 */
function updateToastTitle(text) {
  if (!toastElement) return;
  const title = toastElement.querySelector('.transcription-toast-title');
  if (title) title.textContent = text;
}

/**
 * Show completion state on the toast
 */
function showToastComplete(data) {
  if (!toastElement) return;

  const bar = toastElement.querySelector('.transcription-toast-bar');
  const status = toastElement.querySelector('.transcription-toast-status');
  const cancelBtn = toastElement.querySelector('.transcription-toast-cancel');

  if (bar) {
    bar.style.width = '100%';
    bar.classList.add('transcription-toast-bar-done');
  }
  if (status) status.textContent = 'Transcription complete!';
  if (cancelBtn) cancelBtn.textContent = '\u2715';

  // Auto-remove after 4 seconds
  setTimeout(() => removeToast(), 4000);
}

/**
 * Show error state on the toast
 */
function updateToastError(errorMessage) {
  if (!toastElement) {
    showToast('Error');
  }

  const bar = toastElement.querySelector('.transcription-toast-bar');
  const status = toastElement.querySelector('.transcription-toast-status');

  if (bar) {
    bar.style.width = '100%';
    bar.classList.add('transcription-toast-bar-error');
  }
  if (status) {
    status.textContent = errorMessage;
    status.classList.add('transcription-toast-status-error');
  }

  // Auto-remove after 6 seconds
  setTimeout(() => removeToast(), 6000);
}

/**
 * Remove the toast from the DOM
 */
function removeToast() {
  if (toastElement) {
    toastElement.remove();
    toastElement = null;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
