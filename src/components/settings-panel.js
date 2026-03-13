/**
 * Settings Panel Component
 *
 * Modal panel for configuring app settings.
 * Settings are persisted via config.json through IPC,
 * with localStorage fallback for editor prefs on first load.
 */

import { buildAzureSection, buildLLMSection, buildTranscriptionSection, attachProviderToggle, collectConnectionSettings } from './settings-panel-sections.js';

const SETTINGS_KEY = 'app-settings';

// Default editor settings (subset shown in panel)
const defaultSettings = {
  editorFontSize: 14,
  tabSize: 4,
  autoSaveInterval: 0,
  theme: 'system',
  wikiCacheTTL: 5,
  imageInsertMode: 'ask',
  debugLogMode: 'session',
  splashEnabled: true,
  splashDuration: 0,
};

let currentSettings = { ...defaultSettings };
let safeConfig = null; // Full config from main process (masked secrets)
let onSettingsChangeCallback = null;

/**
 * Load settings - tries config.json via IPC first, falls back to localStorage
 * @returns {Object} Current editor settings
 */
export function loadSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      currentSettings = { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch (err) {
    console.error('[Settings] Failed to load settings:', err);
    currentSettings = { ...defaultSettings };
  }
  return { ...currentSettings };
}

/**
 * Load settings from config.json via IPC (async)
 */
async function loadSettingsFromConfig() {
  if (!window.electronAPI?.configGetAllFull) {
    return loadSettings();
  }
  try {
    safeConfig = await window.electronAPI.configGetAllFull();
    if (safeConfig?.editor) {
      currentSettings = {
        editorFontSize: safeConfig.editor.fontSize ?? defaultSettings.editorFontSize,
        tabSize: safeConfig.editor.tabSize ?? defaultSettings.tabSize,
        autoSaveInterval: safeConfig.editor.autoSaveInterval ?? defaultSettings.autoSaveInterval,
        theme: safeConfig.editor.theme ?? defaultSettings.theme,
        wikiCacheTTL: safeConfig.editor.wikiCacheTTL ?? defaultSettings.wikiCacheTTL,
        imageInsertMode: safeConfig.editor.imageInsertMode ?? defaultSettings.imageInsertMode,
        debugLogMode: safeConfig.editor.debugLogMode ?? defaultSettings.debugLogMode,
        splashEnabled: safeConfig.editor.splashEnabled ?? defaultSettings.splashEnabled,
        splashDuration: safeConfig.editor.splashDuration ?? defaultSettings.splashDuration,
      };
    }
  } catch (err) {
    console.error('[Settings] Failed to load from config service:', err);
    loadSettings(); // fallback to localStorage
  }
  return { ...currentSettings };
}

/**
 * Save settings - persists to config.json via IPC and localStorage
 * @param {Object} settings - Settings to save
 */
export function saveSettings(settings) {
  currentSettings = { ...currentSettings, ...settings };
  try {
    // Always save to localStorage as cache
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));

    // Also save to config.json if available
    if (window.electronAPI?.configUpdate) {
      window.electronAPI.configUpdate({
        editor: {
          fontSize: currentSettings.editorFontSize,
          tabSize: currentSettings.tabSize,
          autoSaveInterval: currentSettings.autoSaveInterval,
          theme: currentSettings.theme,
          wikiCacheTTL: currentSettings.wikiCacheTTL,
          imageInsertMode: currentSettings.imageInsertMode,
          debugLogMode: currentSettings.debugLogMode,
          splashEnabled: currentSettings.splashEnabled,
          splashDuration: currentSettings.splashDuration,
        }
      });
    }

    if (onSettingsChangeCallback) {
      onSettingsChangeCallback(currentSettings);
    }
  } catch (err) {
    console.error('[Settings] Failed to save settings:', err);
  }
}

/**
 * Get current settings
 */
export function getSettings() {
  return { ...currentSettings };
}

/**
 * Register callback for settings changes
 */
export function onSettingsChange(callback) {
  onSettingsChangeCallback = callback;
}

/**
 * Build the settings panel HTML
 */
function buildSettingsHTML() {
  const azureHTML = safeConfig ? buildAzureSection(safeConfig.azure) : '';
  const llmHTML = safeConfig ? buildLLMSection(safeConfig.llm) : '';
  const transcriptionHTML = safeConfig ? buildTranscriptionSection(safeConfig.transcription) : '';

  return `
    <div class="settings-backdrop"></div>
    <div class="settings-dialog">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="settings-close" title="Close">&times;</button>
      </div>
      <div class="settings-body">
        <div class="settings-section">
          <h3>Editor</h3>

          <div class="settings-row">
            <label for="setting-font-size">Font Size</label>
            <div class="settings-control">
              <input type="range" id="setting-font-size" min="12" max="24" step="1" value="${currentSettings.editorFontSize}" />
              <span class="settings-value" id="font-size-value">${currentSettings.editorFontSize}px</span>
            </div>
          </div>

          <div class="settings-row">
            <label for="setting-tab-size">Tab Size</label>
            <div class="settings-control">
              <select id="setting-tab-size">
                <option value="2" ${currentSettings.tabSize === 2 ? 'selected' : ''}>2 spaces</option>
                <option value="4" ${currentSettings.tabSize === 4 ? 'selected' : ''}>4 spaces</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Auto-save</h3>

          <div class="settings-row">
            <label for="setting-auto-save">Auto-save Interval</label>
            <div class="settings-control">
              <select id="setting-auto-save">
                <option value="0" ${currentSettings.autoSaveInterval === 0 ? 'selected' : ''}>Off</option>
                <option value="30" ${currentSettings.autoSaveInterval === 30 ? 'selected' : ''}>30 seconds</option>
                <option value="60" ${currentSettings.autoSaveInterval === 60 ? 'selected' : ''}>1 minute</option>
                <option value="300" ${currentSettings.autoSaveInterval === 300 ? 'selected' : ''}>5 minutes</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Appearance</h3>

          <div class="settings-row">
            <label for="setting-theme">Theme</label>
            <div class="settings-control">
              <select id="setting-theme">
                <option value="system" ${currentSettings.theme === 'system' ? 'selected' : ''}>System</option>
                <option value="light" ${currentSettings.theme === 'light' ? 'selected' : ''}>Light</option>
                <option value="dark" ${currentSettings.theme === 'dark' ? 'selected' : ''}>Dark</option>
              </select>
            </div>
          </div>

          <div class="settings-row">
            <label for="setting-splash-enabled">Show Splash Screen</label>
            <div class="settings-control">
              <select id="setting-splash-enabled">
                <option value="true" ${currentSettings.splashEnabled ? 'selected' : ''}>On</option>
                <option value="false" ${!currentSettings.splashEnabled ? 'selected' : ''}>Off</option>
              </select>
            </div>
          </div>

          <div class="settings-row">
            <label for="setting-splash-duration">Splash Duration</label>
            <div class="settings-control">
              <input type="range" id="setting-splash-duration" min="0" max="5000" step="500" value="${currentSettings.splashDuration}" />
              <span class="settings-value" id="splash-duration-value">${currentSettings.splashDuration === 0 ? 'Auto' : (currentSettings.splashDuration / 1000).toFixed(1) + 's'}</span>
            </div>
          </div>
          <div class="settings-hint">
            Controls how long the startup splash screen is shown. "Auto" dismisses as soon as loading completes. Increase to keep the logo visible longer.
          </div>
        </div>

        <div class="settings-section">
          <h3>Cache</h3>

          <div class="settings-row">
            <label for="setting-cache-ttl">Wiki Cache TTL</label>
            <div class="settings-control">
              <input type="range" id="setting-cache-ttl" min="1" max="10" step="1" value="${currentSettings.wikiCacheTTL}" />
              <span class="settings-value" id="cache-ttl-value">${currentSettings.wikiCacheTTL} min</span>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Images</h3>

          <div class="settings-row">
            <label for="setting-image-insert">When pasting images</label>
            <div class="settings-control">
              <select id="setting-image-insert">
                <option value="ask" ${currentSettings.imageInsertMode === 'ask' ? 'selected' : ''}>Ask each time</option>
                <option value="upload" ${currentSettings.imageInsertMode === 'upload' ? 'selected' : ''}>Always upload to Azure</option>
                <option value="base64" ${currentSettings.imageInsertMode === 'base64' ? 'selected' : ''}>Always embed as Base64</option>
              </select>
            </div>
          </div>
          <div class="settings-hint">
            Upload to Azure stores images in /.attachments/ folder. Base64 embeds images directly in markdown.
          </div>
        </div>

        <div class="settings-section">
          <h3>Debug</h3>

          <div class="settings-row">
            <label for="setting-debug-log-mode">Debug Log Mode</label>
            <div class="settings-control">
              <select id="setting-debug-log-mode">
                <option value="session" ${currentSettings.debugLogMode === 'session' ? 'selected' : ''}>Session (clear on restart)</option>
                <option value="forever" ${currentSettings.debugLogMode === 'forever' ? 'selected' : ''}>Forever (append)</option>
                <option value="off" ${currentSettings.debugLogMode === 'off' ? 'selected' : ''}>Off</option>
              </select>
            </div>
          </div>
          <div class="settings-hint">
            When enabled, debug logs are written to a file in the app's user data folder. "Session" clears the log on each restart.
          </div>
        </div>

        ${azureHTML}
        ${llmHTML}
        ${transcriptionHTML}
      </div>
      <div class="settings-footer">
        <div class="settings-footer-left">
          <button class="settings-btn settings-btn-secondary" id="settings-open-folder" title="Open the folder containing config.json">Open Config Folder</button>
          <button class="settings-btn settings-btn-secondary" id="settings-reset">Reset to Defaults</button>
        </div>
        <button class="settings-btn settings-btn-primary" id="settings-done">Done</button>
      </div>
    </div>
  `;
}

/**
 * Create and show the settings panel
 */
export async function showSettingsPanel() {
  const existing = document.getElementById('settings-panel');
  if (existing) existing.remove();

  // Load config from main process (async)
  await loadSettingsFromConfig();

  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.className = 'settings-panel';
  panel.innerHTML = buildSettingsHTML();
  document.body.appendChild(panel);

  attachSettingsListeners(panel);
  attachProviderToggle(panel);
  attachTranscriptionListeners(panel);

  requestAnimationFrame(() => {
    panel.classList.add('visible');
  });
}

/**
 * Hide the settings panel
 */
export function hideSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  if (panel) {
    // Save connection settings before closing
    saveConnectionSettings(panel);

    panel.classList.remove('visible');
    setTimeout(() => panel.remove(), 200);
  }
}

/**
 * Save Azure + LLM connection settings from the form
 */
async function saveConnectionSettings(panel) {
  if (!window.electronAPI?.configUpdate) return;
  try {
    const connectionUpdate = collectConnectionSettings(panel);
    await window.electronAPI.configUpdate(connectionUpdate);
  } catch (err) {
    console.error('[Settings] Failed to save connection settings:', err);
  }
}

/**
 * Attach event listeners to settings panel
 */
function attachSettingsListeners(panel) {
  panel.querySelector('.settings-close').addEventListener('click', hideSettingsPanel);
  panel.querySelector('.settings-backdrop').addEventListener('click', hideSettingsPanel);
  panel.querySelector('#settings-done').addEventListener('click', hideSettingsPanel);

  panel.querySelector('#settings-open-folder').addEventListener('click', () => {
    if (window.electronAPI?.configOpenFolder) {
      window.electronAPI.configOpenFolder();
    }
  });

  panel.querySelector('#settings-reset').addEventListener('click', () => {
    currentSettings = { ...defaultSettings };
    saveSettings(currentSettings);
    hideSettingsPanel();
    showSettingsPanel();
  });

  // Font size slider
  const fontSizeSlider = panel.querySelector('#setting-font-size');
  const fontSizeValue = panel.querySelector('#font-size-value');
  fontSizeSlider.addEventListener('input', (e) => {
    fontSizeValue.textContent = `${e.target.value}px`;
    saveSettings({ editorFontSize: parseInt(e.target.value, 10) });
  });

  panel.querySelector('#setting-tab-size').addEventListener('change', (e) => {
    saveSettings({ tabSize: parseInt(e.target.value, 10) });
  });

  panel.querySelector('#setting-auto-save').addEventListener('change', (e) => {
    saveSettings({ autoSaveInterval: parseInt(e.target.value, 10) });
  });

  panel.querySelector('#setting-theme').addEventListener('change', (e) => {
    saveSettings({ theme: e.target.value });
  });

  const cacheTTLSlider = panel.querySelector('#setting-cache-ttl');
  const cacheTTLValue = panel.querySelector('#cache-ttl-value');
  cacheTTLSlider.addEventListener('input', (e) => {
    cacheTTLValue.textContent = `${e.target.value} min`;
    saveSettings({ wikiCacheTTL: parseInt(e.target.value, 10) });
  });

  panel.querySelector('#setting-splash-enabled').addEventListener('change', (e) => {
    saveSettings({ splashEnabled: e.target.value === 'true' });
  });

  const splashDurationSlider = panel.querySelector('#setting-splash-duration');
  const splashDurationValue = panel.querySelector('#splash-duration-value');
  splashDurationSlider.addEventListener('input', (e) => {
    const ms = parseInt(e.target.value, 10);
    splashDurationValue.textContent = ms === 0 ? 'Auto' : (ms / 1000).toFixed(1) + 's';
    saveSettings({ splashDuration: ms });
  });

  panel.querySelector('#setting-image-insert').addEventListener('change', (e) => {
    saveSettings({ imageInsertMode: e.target.value });
  });

  panel.querySelector('#setting-debug-log-mode').addEventListener('change', (e) => {
    saveSettings({ debugLogMode: e.target.value });
  });

  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      hideSettingsPanel();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

/**
 * Attach event listeners for transcription settings
 */
function attachTranscriptionListeners(panel) {
  const downloadBtn = panel.querySelector('#settings-download-model');
  const statusSpan = panel.querySelector('#settings-download-status');
  if (!downloadBtn) return;

  downloadBtn.addEventListener('click', async () => {
    if (!window.electronAPI?.transcriptionDownloadModel) return;

    const modelName = panel.querySelector('#setting-model-name')?.value || 'medium';
    downloadBtn.disabled = true;
    if (statusSpan) statusSpan.textContent = 'Starting download...';

    try {
      const result = await window.electronAPI.transcriptionDownloadModel(modelName);
      if (result.success) {
        if (statusSpan) statusSpan.textContent = 'Download complete!';
      } else {
        if (statusSpan) statusSpan.textContent = result.error || 'Download failed';
      }
    } catch (err) {
      if (statusSpan) statusSpan.textContent = err.message || 'Download failed';
    } finally {
      downloadBtn.disabled = false;
    }
  });
}

/**
 * Apply settings to the editor
 */
export function applySettings(editor, settings) {
  if (!settings) return;

  const editorContents = document.querySelectorAll(
    '.toastui-editor-contents, .ProseMirror, .toastui-editor-md-container'
  );
  editorContents.forEach(el => {
    el.style.fontSize = `${settings.editorFontSize}px`;
  });

  if (settings.theme !== 'system') {
    const isDark = settings.theme === 'dark';
    if (isDark) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }

  console.log('[Settings] Applied settings:', settings);
}
