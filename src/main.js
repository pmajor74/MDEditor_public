// Config service replaces dotenv - loads config.json with .env migration fallback
const configService = require('./config/configService');

// Production build check - set via PROD_BUILD=true environment variable
const IS_PROD_BUILD = process.env.PROD_BUILD === 'true';
console.log(`[Main] Running in ${IS_PROD_BUILD ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// Azure DevOps integration
const azureClient = require('./azure/azureClient');
const configManager = require('./azure/configManager');

// Tab management
const tabManager = require('./tabs/tabManager');

// File browser integration (lightweight, always needed)
const fileSystemManager = require('./file-browser/fileSystemManager');
const fileSearchEngine = require('./file-browser/fileSearchEngine');

// Lazy-loaded AI modules (heavy - deferred until first use)
let _llmClient = null;
let _llmConfigManager = null;
let _markdownValidator = null;
let _backupManager = null;
let _editAgent = null;
let _wikiSearchAgent = null;
let _wikiSynthesisAgent = null;
let _vectorDB = null;
let _personaManager = null;
let _whisperService = null;

function getWhisperService() {
  if (!_whisperService) { _whisperService = require('./transcription/whisperService'); }
  return _whisperService;
}

function getLlmClient() {
  if (!_llmClient) { _llmClient = require('./ai/llmClient'); }
  return _llmClient;
}
function getLlmConfigManager() {
  if (!_llmConfigManager) { _llmConfigManager = require('./ai/llmConfigManager'); }
  return _llmConfigManager;
}
function getMarkdownValidator() {
  if (!_markdownValidator) { _markdownValidator = require('./ai/markdownValidator'); }
  return _markdownValidator;
}
function getBackupManager() {
  if (!_backupManager) { _backupManager = require('./ai/backupManager'); }
  return _backupManager;
}
function getEditAgent() {
  if (!_editAgent) { _editAgent = require('./ai/agents/editAgent'); }
  return _editAgent;
}
function getWikiSearchAgent() {
  if (!_wikiSearchAgent) { _wikiSearchAgent = require('./ai/wikiSearchAgent'); }
  return _wikiSearchAgent;
}
function getWikiSynthesisAgent() {
  if (!_wikiSynthesisAgent) { _wikiSynthesisAgent = require('./ai/wikiSynthesisAgent'); }
  return _wikiSynthesisAgent;
}
function getVectorDB() {
  if (!_vectorDB) { _vectorDB = require('./ai/vectordb'); }
  return _vectorDB;
}
function getPersonaManager() {
  if (!_personaManager) { _personaManager = require('./ai/persona/personaManager'); }
  return _personaManager;
}

// Debug logger — intercepts console.log/warn/error, writes to userData/debug.log
const debugLogger = require('./debugLogger');
debugLogger.init();

// Suppress EPIPE errors at the process level to prevent error dialogs
process.on('uncaughtException', (error) => {
  // Ignore EPIPE errors (broken pipe when output stream is closed)
  if (error.code === 'EPIPE' || (error.message && error.message.includes('EPIPE'))) {
    return;
  }
  // Log other errors but don't crash
  try {
    debugLogger.originalConsoleError('[Main] Uncaught exception:', error);
  } catch (e) {
    // Can't log, ignore
  }
});

process.stdout?.on('error', (err) => {
  if (err.code === 'EPIPE') return;
});

process.stderr?.on('error', (err) => {
  if (err.code === 'EPIPE') return;
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) {
  app.quit();
}

// File state management (legacy - now managed through tabManager)
let currentFilePath = null;
let isDirty = false;
let mainWindow = null;

// Update window title based on active tab
function updateWindowTitle() {
  if (!mainWindow) return;

  const activeTab = tabManager.getActiveTab();
  if (!activeTab) {
    mainWindow.setTitle('AzureWikiEdit');
    return;
  }

  const title = `${activeTab.title}${activeTab.isDirty ? '*' : ''} - AzureWikiEdit`;
  mainWindow.setTitle(title);
}

// Notify renderer of tab changes
function notifyTabsUpdated() {
  if (mainWindow?.webContents) {
    const session = tabManager.getSession();
    mainWindow.webContents.send('tabs:updated', session);
  }
}

// Create the main application window
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true, // Required for Chromium's built-in PDF viewer in iframes
    },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    deferVectorDBInit();
    preWarmAIModules();
  });

  // Safety fallback in case ready-to-show never fires
  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  }, 10000);
  mainWindow.once('ready-to-show', () => clearTimeout(showFallback));

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  updateWindowTitle();

  // Build and set the application menu
  const menuTemplate = buildMenuTemplate();
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  // Send theme info when window is ready and initialize tabs
  mainWindow.webContents.on('did-finish-load', async () => {
    mainWindow.webContents.send('theme:change', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

    // Send production mode status and recommended splash duration to renderer
    mainWindow.webContents.send('app:config', {
      isProdBuild: IS_PROD_BUILD,
      splashDurationMs: IS_PROD_BUILD ? 3000 : 0  // 3 seconds for prod, 0 for dev
    });

    // Initialize tab manager and send session to renderer
    await tabManager.initialize();
    const session = tabManager.getSession();
    mainWindow.webContents.send('tabs:sessionLoaded', session);
    updateWindowTitle();
  });

  // In production, prevent F12 from opening dev tools
  if (IS_PROD_BUILD) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') {
        event.preventDefault();
      }
    });
  }

  // Listen for system theme changes
  nativeTheme.on('updated', () => {
    mainWindow.webContents.send('theme:change', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  });

  // Prevent the window from navigating away when links are clicked
  // All link navigation is handled via IPC from the renderer
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow navigation to webpack dev server URLs (localhost)
    if (url.startsWith('http://localhost:')) {
      return;
    }
    // Prevent all other navigation - links are handled via IPC
    console.log('[Main] Preventing navigation to:', url);
    event.preventDefault();
  });

  // Also handle new-window events (target="_blank" links, etc.)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external URLs in the default browser
    console.log('[Main] Opening external URL:', url);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Spell check context menu
  mainWindow.webContents.on('context-menu', (event, params) => {
    const menuItems = [];

    // If right-clicking a misspelled word, show suggestions
    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length > 0) {
        params.dictionarySuggestions.forEach(suggestion => {
          menuItems.push({
            label: suggestion,
            click: () => mainWindow.webContents.replaceMisspelling(suggestion)
          });
        });
      } else {
        menuItems.push({ label: 'No suggestions', enabled: false });
      }

      menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'Add to Dictionary',
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      });
      menuItems.push({ type: 'separator' });
    }

    // Standard edit menu items
    if (params.isEditable) {
      menuItems.push(
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll' }
      );
    } else if (params.selectionText) {
      menuItems.push({ label: 'Copy', role: 'copy' });
    }

    // Only show menu if we have items
    if (menuItems.length > 0) {
      const menu = Menu.buildFromTemplate(menuItems);
      menu.popup();
    }
  });

  // Handle window close - only prompt for Azure tabs (local/untitled content persisted in session)
  mainWindow.on('close', async (event) => {
    const dirtyAzureTabs = tabManager.getDirtyAzureTabs();

    if (dirtyAzureTabs.length > 0) {
      event.preventDefault();

      // Show dialog only for Azure tabs that have unsaved remote changes
      const fileList = dirtyAzureTabs.map(t => t.title).join('\n  - ');
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Unsaved Azure Changes',
        message: `You have ${dirtyAzureTabs.length} unsaved Azure page(s):\n  - ${fileList}`,
        detail: 'Do you want to save your changes to Azure DevOps before closing?',
        buttons: ['Save All', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2
      });

      if (result.response === 0) {
        // Save all dirty Azure tabs
        let allSaved = true;
        for (const tab of dirtyAzureTabs) {
          const saved = await saveTabById(tab.id);
          if (!saved) {
            allSaved = false;
            break;
          }
        }
        if (allSaved) {
          await tabManager.flushSession();
          mainWindow.destroy();
        }
      } else if (result.response === 1) {
        // Discard all changes
        await tabManager.flushSession();
        mainWindow.destroy();
      }
      // Cancel - do nothing
    } else {
      // No unsaved Azure changes, but we still need to flush session
      // to remove Azure tabs before the window closes
      event.preventDefault();
      await tabManager.flushSession();
      mainWindow.destroy();
    }
  });
};

// Build the application menu
function buildMenuTemplate() {
  return [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: async () => {
            // Create a new untitled tab
            const newTab = await tabManager.createTab({ type: 'untitled' });
            notifyTabsUpdated();
            mainWindow.webContents.send('tabs:switched', newTab);
            updateWindowTitle();
          }
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            await openFile();
          }
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: async () => {
            const activeTab = tabManager.getActiveTab();
            if (activeTab) {
              await closeActiveTab();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => saveFile()
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => saveFileAs()
        },
        {
          label: 'Export as HTML...',
          click: () => exportAsHtml()
        },
        { type: 'separator' },
        {
          label: 'View Session Cache...',
          click: async () => {
            const sessionStore = require('./tabs/tabSessionStore');
            const tabsDir = sessionStore.getTabsDir();
            const result = await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Session Cache Location',
              message: 'Unsaved work is stored as individual files',
              detail: `Your unsaved tabs are stored as .md files in:\n\n${tabsDir}\n\nEach tab has its own cache file that you can browse and recover.`,
              buttons: ['Open in Explorer', 'Copy Path', 'Close'],
              defaultId: 2
            });

            if (result.response === 0) {
              // Open the tabs folder in Explorer
              const { shell } = require('electron');
              shell.openPath(tabsDir);
            } else if (result.response === 1) {
              // Copy path to clipboard
              const { clipboard } = require('electron');
              clipboard.writeText(tabsDir);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow.webContents.send('edit:find')
        },
        {
          label: 'Replace...',
          accelerator: 'CmdOrCtrl+H',
          click: () => mainWindow.webContents.send('edit:replace')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Dark Mode',
          click: () => {
            const newTheme = nativeTheme.themeSource === 'dark' ? 'light' :
                            nativeTheme.themeSource === 'light' ? 'dark' :
                            (nativeTheme.shouldUseDarkColors ? 'light' : 'dark');
            nativeTheme.themeSource = newTheme;
          }
        },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow.webContents.send('view:showSettings');
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle AI Copilot',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => {
            mainWindow.webContents.send('gemini:toggleSidebar');
          }
        },
        {
          label: 'Manage Catalogs...',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => {
            mainWindow.webContents.send('catalogs:showManager');
          }
        },
        {
          label: 'Manage Personas...',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            mainWindow.webContents.send('personas:showManager');
          }
        },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        // Dev tools only in development mode
        ...(IS_PROD_BUILD ? [] : [{ label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' }]),
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Azure DevOps',
      submenu: [
        {
          label: configManager.isConnected() ? 'Disconnect from Wiki' : 'Connect to Wiki...',
          click: () => {
            if (configManager.isConnected()) {
              configManager.clearConnection();
              mainWindow.webContents.send('azure:disconnected');
              rebuildMenu();
            } else {
              mainWindow.webContents.send('azure:showConnectionDialog');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Browse Wiki',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            mainWindow.webContents.send('azure:toggleSidebar');
          },
          enabled: configManager.isConnected()
        },
        {
          label: 'Refresh Wiki Tree',
          click: () => {
            mainWindow.webContents.send('azure:refreshTree');
          },
          enabled: configManager.isConnected()
        },
        {
          label: 'Clear Wiki Cache...',
          click: async () => {
            const result = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              title: 'Clear Wiki Cache',
              message: 'Clear all cached wiki data?',
              detail: 'This will remove all cached wiki tree data and page content. The wiki will be reloaded fresh from Azure DevOps on next access.\n\nThis is useful if the cache is out of date or corrupted.',
              buttons: ['Clear Cache', 'Cancel'],
              defaultId: 1,
              cancelId: 1
            });
            if (result.response === 0) {
              // Clear all wiki caches
              azureClient.clearWikiCache();
              // Notify renderer to refresh
              mainWindow.webContents.send('azure:cacheCleared');
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Cache Cleared',
                message: 'Wiki cache has been cleared.',
                detail: 'The wiki tree will reload fresh data on next access.'
              });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Add to Favorites',
          click: () => {
            mainWindow.webContents.send('azure:addToFavorites');
          },
          enabled: configManager.isConnected()
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            mainWindow.webContents.send('help:showKeyboardShortcuts');
          }
        },
        { type: 'separator' },
        {
          label: 'About AzureWikiEdit',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About AzureWikiEdit',
              message: 'AzureWikiEdit',
              detail: 'A desktop WYSIWYG editor for Azure DevOps Wiki markdown files.\n\nVersion 1.0.0\n\nDeveloped by Major Computing Systems Ltd.',
            });
          }
        }
      ]
    }
  ];
}

// Show dialog for unsaved changes
async function showUnsavedChangesDialog() {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Unsaved Changes',
    message: 'You have unsaved changes. Do you want to save them?',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2
  });

  if (result.response === 0) return 'save';
  if (result.response === 1) return 'discard';
  return 'cancel';
}

// Close the active tab
async function closeActiveTab() {
  const activeTab = tabManager.getActiveTab();
  if (!activeTab) return;

  if (activeTab.isDirty) {
    const choice = await showUnsavedChangesDialog();
    if (choice === 'cancel') return;
    if (choice === 'save') {
      const saved = await saveTabById(activeTab.id);
      if (!saved) return;
    }
  }

  const result = await tabManager.forceCloseTab(activeTab.id);
  if (result.closed) {
    notifyTabsUpdated();
    const newActiveTab = tabManager.getActiveTab();
    if (newActiveTab) {
      mainWindow.webContents.send('tabs:switched', newActiveTab);
    }
    updateWindowTitle();
  }
}

// Save a specific tab by ID
async function saveTabById(tabId) {
  const tab = tabManager.getTabById(tabId);
  if (!tab) return false;

  // Request content from renderer for this tab
  return new Promise((resolve) => {
    ipcMain.once('editor:content', async (event, content) => {
      if (tab.type === 'azure' && tab.azurePage) {
        // Azure save - handled by renderer
        mainWindow.webContents.send('azure:requestSave');
        // Wait for result
        ipcMain.once('azure:saveResult', async (event, result) => {
          if (result.success) {
            await tabManager.markTabSaved(tabId);
            notifyTabsUpdated();
            updateWindowTitle();
            resolve(true);
          } else {
            resolve(false);
          }
        });
      } else if (tab.type === 'local' && tab.filePath) {
        try {
          await fs.writeFile(tab.filePath, content, 'utf-8');
          // Update file mod time after save
          const stats = await fs.stat(tab.filePath);
          await tabManager.updateTabFileModTime(tabId, stats.mtimeMs);
          await tabManager.markTabSaved(tabId);
          notifyTabsUpdated();
          updateWindowTitle();
          resolve(true);
        } catch (error) {
          dialog.showErrorBox('Error Saving File', `Could not save file: ${error.message}`);
          resolve(false);
        }
      } else {
        // Untitled - need Save As
        const saveResult = await dialog.showSaveDialog(mainWindow, {
          defaultPath: 'untitled.md',
          filters: [
            { name: 'Markdown Files', extensions: ['md'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (saveResult.canceled) {
          resolve(false);
          return;
        }

        try {
          await fs.writeFile(saveResult.filePath, content, 'utf-8');
          // Get file mod time after save
          const stats = await fs.stat(saveResult.filePath);
          await tabManager.updateTabFileModTime(tabId, stats.mtimeMs);
          await tabManager.markTabSaved(tabId, saveResult.filePath);
          notifyTabsUpdated();
          updateWindowTitle();
          resolve(true);
        } catch (error) {
          dialog.showErrorBox('Error Saving File', `Could not save file: ${error.message}`);
          resolve(false);
        }
      }
    });

    mainWindow.webContents.send('editor:requestContent');
  });
}

// Open a file
async function openFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown Files', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];

  // Check if file is already open in a tab
  const existingTab = tabManager.findTabByFilePath(filePath);
  if (existingTab) {
    // Switch to existing tab
    await tabManager.switchTab(existingTab.id);
    notifyTabsUpdated();
    mainWindow.webContents.send('tabs:switched', existingTab);
    updateWindowTitle();
    return { content: existingTab.content, filePath };
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const stats = await fs.stat(filePath);

    // Create a new tab for the file with file modification time
    const newTab = await tabManager.createTab({
      type: 'local',
      filePath,
      content,
      fileModTime: stats.mtimeMs
    });

    notifyTabsUpdated();
    mainWindow.webContents.send('tabs:switched', newTab);
    updateWindowTitle();

    // Also send file:opened for backward compatibility
    mainWindow.webContents.send('file:opened', { content, filePath });
    return { content, filePath };
  } catch (error) {
    dialog.showErrorBox('Error Opening File', `Could not open file: ${error.message}`);
    return null;
  }
}

// Save the current file (or Azure page if editing one)
async function saveFile() {
  const activeTab = tabManager.getActiveTab();
  if (!activeTab) return false;

  // First check if we're editing an Azure page
  const azureResult = await tryAzureSave();
  if (azureResult !== null) {
    // Azure save was attempted
    if (azureResult) {
      await tabManager.markTabSaved(activeTab.id);
      notifyTabsUpdated();
      updateWindowTitle();
    }
    return azureResult;
  }

  // Not an Azure page, proceed with local file save
  return new Promise((resolve) => {
    if (activeTab.type !== 'local' || !activeTab.filePath) {
      saveFileAs().then(resolve);
      return;
    }

    // Request content from renderer
    ipcMain.once('editor:content', async (event, content) => {
      try {
        await fs.writeFile(activeTab.filePath, content, 'utf-8');
        // Update file mod time after save
        const stats = await fs.stat(activeTab.filePath);
        await tabManager.updateTabFileModTime(activeTab.id, stats.mtimeMs);
        await tabManager.markTabSaved(activeTab.id);
        notifyTabsUpdated();
        updateWindowTitle();
        resolve(true);
      } catch (error) {
        dialog.showErrorBox('Error Saving File', `Could not save file: ${error.message}`);
        resolve(false);
      }
    });

    mainWindow.webContents.send('editor:requestContent');
  });
}

// Attempt Azure save - returns null if not editing Azure page
async function tryAzureSave() {
  return new Promise((resolve) => {
    // Set up one-time listener for Azure save result
    ipcMain.once('azure:saveResult', (event, result) => {
      if (result.notAzure) {
        // Not editing an Azure page
        resolve(null);
      } else if (result.success) {
        isDirty = false;
        updateWindowTitle();
        resolve(true);
      } else {
        // Azure save failed or was cancelled
        resolve(false);
      }
    });

    // Ask renderer to save to Azure if applicable
    mainWindow.webContents.send('azure:requestSave');
  });
}

// Save file with a new name
async function saveFileAs() {
  const activeTab = tabManager.getActiveTab();

  return new Promise((resolve) => {
    // Request content from renderer first
    ipcMain.once('editor:content', async (event, content) => {
      const defaultPath = activeTab?.filePath || 'untitled.md';
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath,
        filters: [
          { name: 'Markdown Files', extensions: ['md'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result.canceled) {
        resolve(false);
        return;
      }

      try {
        await fs.writeFile(result.filePath, content, 'utf-8');
        // Get file mod time after save
        const stats = await fs.stat(result.filePath);

        if (activeTab) {
          await tabManager.updateTabFileModTime(activeTab.id, stats.mtimeMs);
          await tabManager.markTabSaved(activeTab.id, result.filePath);
          notifyTabsUpdated();
        }
        updateWindowTitle();
        resolve(true);
      } catch (error) {
        dialog.showErrorBox('Error Saving File', `Could not save file: ${error.message}`);
        resolve(false);
      }
    });

    mainWindow.webContents.send('editor:requestContent');
  });
}

// Export current document as self-contained HTML
async function exportAsHtml() {
  // Ask renderer to produce HTML
  mainWindow.webContents.send('file:exportHtml');
}

// IPC Handlers
ipcMain.handle('file:open', async () => {
  return await openFile();
});

ipcMain.handle('file:save', async () => {
  return await saveFile();
});

ipcMain.handle('file:saveAs', async () => {
  return await saveFileAs();
});

// Handle exported HTML from renderer
ipcMain.on('file:exportedHtml', async (event, htmlContent) => {
  const activeTab = tabManager.getActiveTab();
  const baseName = activeTab?.filePath
    ? path.basename(activeTab.filePath, path.extname(activeTab.filePath))
    : 'untitled';

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${baseName}.html`,
    filters: [
      { name: 'HTML Files', extensions: ['html', 'htm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled) return;

  try {
    await fs.writeFile(result.filePath, htmlContent, 'utf-8');
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Export Complete',
      message: 'HTML file exported successfully.',
      detail: result.filePath
    });
  } catch (error) {
    dialog.showErrorBox('Export Error', `Could not export HTML: ${error.message}`);
  }
});

ipcMain.handle('file:getState', () => {
  return {
    currentFilePath,
    isDirty,
    theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  };
});

// ============================================
// Config Service IPC Handlers
// ============================================

ipcMain.handle('config:get', (event, key) => {
  return configService.getConfigValue(key);
});

ipcMain.handle('config:getAll', () => {
  return configService.getSafeConfig();
});

ipcMain.handle('config:update', async (event, partial) => {
  const updated = await configService.updateConfig(partial);
  // Update debug logger mode if it changed
  if (partial?.editor?.debugLogMode) {
    debugLogger.setMode(partial.editor.debugLogMode);
  }
  // Invalidate LLM caches so providers pick up new settings (e.g. maxOutputTokens)
  getLlmConfigManager().invalidateCache();
  getLlmClient().invalidateCache();
  // Invalidate embedding provider cache so it picks up new config
  try {
    const vdb = getVectorDB();
    vdb.embeddingProvider?.invalidateCache();
  } catch (e) { /* vectordb not loaded yet */ }
  // Notify renderer of config change
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('config:changed', configService.getSafeConfig());
  }
  return configService.getSafeConfig();
});

ipcMain.handle('config:getPath', () => {
  return configService.getConfigPath();
});

ipcMain.handle('config:getAllFull', () => {
  return configService.getFullConfig();
});

ipcMain.handle('config:openFolder', () => {
  const configPath = configService.getConfigPath();
  shell.showItemInFolder(configPath);
});

// ============================================
// File Browser IPC Handlers
// ============================================

// Open folder dialog
ipcMain.handle('file:openFolder', async () => {
  return await fileSystemManager.openFolder(mainWindow);
});

// Select files for persona source (supports multiple files)
ipcMain.handle('file:selectForPersona', async (event, { extensions = ['.txt', '.md', '.text', '.rtf'] } = {}) => {
  const extList = extensions.map(e => e.replace(/^\./, ''));
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Text Files', extensions: extList },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false };
  }

  // Add parent directories to allowed roots for path validation
  const roots = new Set();
  for (const filePath of result.filePaths) {
    roots.add(path.dirname(filePath));
  }
  for (const root of roots) {
    fileSystemManager.addAllowedRoot(root);
  }

  return {
    success: true,
    files: result.filePaths,
    isMultiple: result.filePaths.length > 1
  };
});

// Add a path to the allowed roots (used when restoring saved folders)
ipcMain.handle('file:addAllowedRoot', (event, rootPath) => {
  if (rootPath && typeof rootPath === 'string') {
    fileSystemManager.addAllowedRoot(rootPath);
    return { success: true };
  }
  return { success: false, error: 'Invalid root path' };
});

// Get directory contents
ipcMain.handle('file:getDirectoryContents', async (event, dirPath, options = {}) => {
  return await fileSystemManager.getDirectoryContents(dirPath, options);
});

// Read file
ipcMain.handle('file:readBrowserFile', async (event, filePath) => {
  return await fileSystemManager.readFile(filePath);
});

// Read PDF text (extract text from PDF)
// Uses webpackIgnore to preserve native ESM import() for pdfjs-dist (which is ESM-only)
ipcMain.handle('file:readPdfText', async (event, filePath) => {
  try {
    const buffer = await fs.readFile(filePath);
    const uint8 = new Uint8Array(buffer);
    const pdfjs = await import(/* webpackIgnore: true */ 'pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: uint8 }).promise;
    const pageCount = doc.numPages;
    const textParts = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str).join(' ');
      textParts.push(`--- Page ${i} ---\n${text}`);
    }
    return { success: true, text: textParts.join('\n\n'), pageCount };
  } catch (err) {
    console.error('[Main] Failed to extract PDF text:', err);
    return { success: false, error: err.message };
  }
});

// Write file
ipcMain.handle('file:writeBrowserFile', async (event, filePath, content) => {
  return await fileSystemManager.writeFile(filePath, content);
});

// Create file
ipcMain.handle('file:createFile', async (event, parentDir, filename, content = '') => {
  return await fileSystemManager.createFile(parentDir, filename, content);
});

// Create folder
ipcMain.handle('file:createFolder', async (event, parentDir, folderName) => {
  return await fileSystemManager.createFolder(parentDir, folderName);
});

// Rename file/folder
ipcMain.handle('file:rename', async (event, oldPath, newName) => {
  return await fileSystemManager.rename(oldPath, newName);
});

// Delete file/folder
ipcMain.handle('file:delete', async (event, targetPath) => {
  return await fileSystemManager.deleteItem(targetPath);
});

// Get file/folder metadata
ipcMain.handle('file:getMetadata', async (event, targetPath) => {
  return await fileSystemManager.getMetadata(targetPath);
});

// Check if file is a text file (can be opened in editor)
ipcMain.handle('file:isTextFile', (event, filePath) => {
  return fileSystemManager.isTextFile(filePath);
});

// Get file browser config
ipcMain.handle('file:getConfig', () => {
  return fileSystemManager.getConfig();
});

// Update file browser config
ipcMain.handle('file:updateConfig', (event, newConfig) => {
  fileSystemManager.updateConfig(newConfig);
  return fileSystemManager.getConfig();
});

// Get allowed roots
ipcMain.handle('file:getAllowedRoots', () => {
  return fileSystemManager.getAllowedRoots();
});

// ============================================
// File Search IPC Handlers
// ============================================

// Search files
ipcMain.handle('file:search', async (event, options) => {
  return await fileSearchEngine.search(options, (progress) => {
    // Send progress to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file:searchProgress', progress);
    }
  });
});

// Cancel search
ipcMain.handle('file:searchCancel', (event, searchId) => {
  fileSearchEngine.cancelSearch(searchId);
  return { success: true };
});

// Get search config
ipcMain.handle('file:searchGetConfig', () => {
  return fileSearchEngine.getConfig();
});

// Update search config
ipcMain.handle('file:searchUpdateConfig', (event, newConfig) => {
  fileSearchEngine.updateConfig(newConfig);
  return fileSearchEngine.getConfig();
});

// Track content changes from renderer
ipcMain.on('editor:contentChanged', async (event, { content, cursorPosition, scrollPosition } = {}) => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab && content !== undefined) {
    await tabManager.updateTabContent(activeTab.id, content, cursorPosition, scrollPosition);
    updateWindowTitle();
  }
});

// ============================================
// Tab Management IPC Handlers
// ============================================

// Get all tabs
ipcMain.handle('tabs:getAll', () => {
  return tabManager.getAllTabs();
});

// Get active tab
ipcMain.handle('tabs:getActive', () => {
  return tabManager.getActiveTab();
});

// Get full session
ipcMain.handle('tabs:getSession', () => {
  return tabManager.getSession();
});

// Create a new tab
ipcMain.handle('tabs:create', async (event, options = {}) => {
  const newTab = await tabManager.createTab(options);
  notifyTabsUpdated();
  updateWindowTitle();
  // Send tabs:switched so renderer loads content into editor
  mainWindow.webContents.send('tabs:switched', newTab);
  return newTab;
});

// Switch to a tab
ipcMain.handle('tabs:switch', async (event, tabId) => {
  const tab = await tabManager.switchTab(tabId);
  if (tab) {
    notifyTabsUpdated();
    updateWindowTitle();
    mainWindow.webContents.send('tabs:switched', tab);
  }
  return tab;
});

// Close a tab
ipcMain.handle('tabs:close', async (event, tabId) => {
  const result = await tabManager.closeTab(tabId);

  if (result.needsSave) {
    // Tab has unsaved changes, ask user
    const choice = await showUnsavedChangesDialog();
    if (choice === 'cancel') {
      return { closed: false, cancelled: true };
    }
    if (choice === 'save') {
      const saved = await saveTabById(tabId);
      if (!saved) return { closed: false };
    }
    // Force close after save or discard
    const forceResult = await tabManager.forceCloseTab(tabId);
    notifyTabsUpdated();
    if (forceResult.newActiveTabId) {
      const newTab = tabManager.getTabById(forceResult.newActiveTabId);
      if (newTab) {
        mainWindow.webContents.send('tabs:switched', newTab);
      }
    }
    updateWindowTitle();
    return forceResult;
  }

  notifyTabsUpdated();
  if (result.newActiveTabId) {
    const newTab = tabManager.getTabById(result.newActiveTabId);
    if (newTab) {
      mainWindow.webContents.send('tabs:switched', newTab);
    }
  }
  updateWindowTitle();
  return result;
});

// Update tab content
ipcMain.handle('tabs:updateContent', async (event, { tabId, content, cursorPosition, scrollPosition }) => {
  const tab = await tabManager.updateTabContent(tabId, content, cursorPosition, scrollPosition);
  updateWindowTitle();
  return tab;
});

// Reorder tabs
ipcMain.handle('tabs:reorder', async (event, newOrder) => {
  const order = await tabManager.reorderTabs(newOrder);
  notifyTabsUpdated();
  return order;
});

// Close other tabs
ipcMain.handle('tabs:closeOthers', async (event, keepTabId) => {
  const tabs = tabManager.getAllTabs();
  const tabsToClose = tabs.filter(t => t.id !== keepTabId);

  // Check for dirty tabs
  const dirtyTabs = tabsToClose.filter(t => t.isDirty);
  if (dirtyTabs.length > 0) {
    const fileList = dirtyTabs.map(t => t.title).join('\n  - ');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Unsaved Changes',
      message: `Close ${tabsToClose.length} tab(s)? ${dirtyTabs.length} have unsaved changes:\n  - ${fileList}`,
      buttons: ['Close All', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    });

    if (result.response === 1) {
      return { closed: false, cancelled: true };
    }
  }

  for (const tab of tabsToClose) {
    await tabManager.forceCloseTab(tab.id);
  }

  await tabManager.switchTab(keepTabId);
  notifyTabsUpdated();
  updateWindowTitle();
  return { closed: true };
});

// Close all tabs
ipcMain.handle('tabs:closeAll', async () => {
  const tabs = tabManager.getAllTabs();
  const dirtyTabs = tabs.filter(t => t.isDirty);

  if (dirtyTabs.length > 0) {
    const fileList = dirtyTabs.map(t => t.title).join('\n  - ');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Unsaved Changes',
      message: `Close all tabs? ${dirtyTabs.length} have unsaved changes:\n  - ${fileList}`,
      buttons: ['Close All', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    });

    if (result.response === 1) {
      return { closed: false, cancelled: true };
    }
  }

  for (const tab of tabs) {
    await tabManager.forceCloseTab(tab.id);
  }

  notifyTabsUpdated();
  const newTab = tabManager.getActiveTab();
  if (newTab) {
    mainWindow.webContents.send('tabs:switched', newTab);
  }
  updateWindowTitle();
  return { closed: true };
});

// Mark tab as saved
ipcMain.handle('tabs:markSaved', async (event, { tabId, filePath }) => {
  const tab = await tabManager.markTabSaved(tabId, filePath);
  notifyTabsUpdated();
  updateWindowTitle();
  return tab;
});

// Update Azure info on tab
ipcMain.handle('tabs:updateAzureInfo', async (event, { tabId, azurePage }) => {
  const tab = await tabManager.updateTabAzureInfo(tabId, azurePage);
  notifyTabsUpdated();
  return tab;
});

// Replace Azure tab content (for tab reuse)
ipcMain.handle('tabs:replaceAzureContent', async (event, { tabId, pagePath, eTag, content }) => {
  const tab = await tabManager.replaceAzureTab(tabId, { pagePath, eTag }, content);
  if (tab) {
    notifyTabsUpdated();
    updateWindowTitle();
    mainWindow.webContents.send('tabs:switched', tab);
  }
  return tab;
});

// Dialog for unsaved Azure changes
ipcMain.handle('dialog:showAzureSavePrompt', async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Unsaved Changes',
    message: 'You have unsaved changes to the current Azure Wiki page.\n\nDo you want to save before navigating?',
    buttons: ['Save to Azure', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2
  });
  if (result.response === 0) return 'save';
  if (result.response === 1) return 'discard';
  return 'cancel';
});

// Reload a tab's content from file (for external changes)
ipcMain.handle('tabs:reloadFromFile', async (event, tabId) => {
  const tab = tabManager.getTabById(tabId);
  if (!tab || tab.type !== 'local' || !tab.filePath) {
    return { success: false, error: 'Not a local file tab' };
  }

  try {
    const content = await fs.readFile(tab.filePath, 'utf-8');
    const stats = await fs.stat(tab.filePath);

    // Update tab content and file mod time
    await tabManager.updateTabContent(tabId, content);
    await tabManager.updateTabFileModTime(tabId, stats.mtimeMs);

    // Clear dirty flag since we just loaded from file
    await tabManager.markTabSaved(tabId);

    notifyTabsUpdated();
    return { success: true, content };
  } catch (error) {
    console.error('[Tabs] Error reloading file:', error.message);
    return { success: false, error: error.message };
  }
});

// Check a local file tab for external changes
ipcMain.handle('tabs:checkExternalChanges', async (event, tabId) => {
  const tab = tabManager.getTabById(tabId);
  if (!tab || tab.type !== 'local' || !tab.filePath) {
    return { hasExternalChanges: false };
  }

  try {
    const stats = await fs.stat(tab.filePath);
    const currentModTime = stats.mtimeMs;

    if (tab.fileModTime && currentModTime > tab.fileModTime) {
      await tabManager.markTabExternalChanges(tabId);
      return { hasExternalChanges: true };
    }
    return { hasExternalChanges: false };
  } catch (error) {
    // File might be deleted
    return { hasExternalChanges: false, fileDeleted: true };
  }
});

// Clear external changes flag on a tab
ipcMain.handle('tabs:clearExternalChanges', async (event, tabId) => {
  await tabManager.clearTabExternalChanges(tabId);
  notifyTabsUpdated();
  return { success: true };
});

// Sync content without marking dirty (for editor normalization after load)
ipcMain.handle('tabs:syncContent', async (event, { tabId, content }) => {
  // Update content but skip dirty marking - this is for syncing editor-normalized content
  const tab = await tabManager.updateTabContent(tabId, content, null, null, true);
  return tab;
});

// Rebuild menu (to update enabled states)
function rebuildMenu() {
  const menuTemplate = buildMenuTemplate();
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

// ============================================
// Azure DevOps IPC Handlers
// ============================================

// Connect to Azure DevOps
ipcMain.handle('azure:connect', async (event, { org, project, pat, wikiId, wikiName, rootPath }) => {
  console.log('[IPC] azure:connect called with:', { org, project, wikiId, wikiName, rootPath });
  try {
    const result = await azureClient.validateConnection(org, project, pat);
    if (!result.success) {
      console.log('[IPC] Connection validation failed:', result.error);
      return result;
    }

    // Only store connection if we have wikiId (complete connection)
    // This prevents storing incomplete connections during the 2-step flow
    if (wikiId) {
      configManager.setConnection(org, project, pat, wikiId, wikiName, rootPath || '/');
      console.log('[IPC] Connection stored with wikiId:', wikiId, 'rootPath:', rootPath || '/');
      rebuildMenu();
    } else {
      console.log('[IPC] Credentials validated (no wikiId, not storing yet)');
    }

    return { success: true };
  } catch (error) {
    console.error('[IPC] azure:connect error:', error.message);
    return { success: false, error: error.message };
  }
});

// Disconnect from Azure DevOps
ipcMain.handle('azure:disconnect', () => {
  const conn = configManager.getConnection();
  if (conn.org) {
    azureClient.clearWikiCache(conn.org);
  }
  configManager.clearConnection();
  rebuildMenu();
  return { success: true };
});

// Get connection status
ipcMain.handle('azure:getConnectionStatus', () => {
  return configManager.getConnection();
});

// Load env config
ipcMain.handle('azure:loadConfig', async () => {
  return await configManager.loadEnvConfig();
});

// Get list of wikis
ipcMain.handle('azure:getWikis', async () => {
  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }
  try {
    const wikis = await azureClient.getWikis(conn.org, conn.project, conn.pat);
    return { success: true, wikis };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Resolve page path from page ID (used when loading from URL)
ipcMain.handle('azure:resolvePagePath', async (event, { org, project, pat, wikiId, pageId }) => {
  // Use current connection if params not provided
  const conn = configManager.getConnection();
  const effectiveOrg = org || conn.org;
  const effectiveProject = project || conn.project;
  const effectivePat = pat || conn.pat;
  const effectiveWikiId = wikiId || conn.wikiId;

  console.log('[IPC] azure:resolvePagePath called with pageId:', pageId);

  if (!effectiveOrg || !effectiveProject || !effectivePat || !effectiveWikiId) {
    return { success: false, error: 'Not connected to Azure Wiki' };
  }

  try {
    const page = await azureClient.getPageById(effectiveOrg, effectiveProject, effectivePat, effectiveWikiId, pageId);
    console.log('[IPC] Resolved page path:', page?.path);
    return { success: true, path: page?.path || '/' };
  } catch (error) {
    console.error('[IPC] azure:resolvePagePath error:', error.message);
    return { success: false, error: error.message, path: '/' };
  }
});

// Get wiki page tree
ipcMain.handle('azure:getWikiTree', async (event, { wikiId, path, forceRefresh, recursionLevel }) => {
  const conn = configManager.getConnection();
  console.log('[IPC] azure:getWikiTree called with:', { wikiId, path, forceRefresh, recursionLevel });
  console.log('[IPC] Connection state:', {
    connected: conn.connected,
    org: conn.org,
    project: conn.project,
    wikiId: conn.wikiId,
    rootPath: conn.rootPath
  });
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }
  try {
    // Use rootPath from connection if no path specified
    const treePath = path || conn.rootPath || '/';
    const effectiveWikiId = wikiId || conn.wikiId;
    // Default to 'oneLevel' for lazy loading, use 'full' only when explicitly requested
    const effectiveRecursionLevel = recursionLevel || 'oneLevel';
    console.log('[IPC] Using wikiId:', effectiveWikiId, 'treePath:', treePath, 'forceRefresh:', forceRefresh, 'recursionLevel:', effectiveRecursionLevel);
    const pages = await azureClient.getWikiPages(conn.org, conn.project, conn.pat, effectiveWikiId, treePath, forceRefresh, effectiveRecursionLevel);
    return { success: true, pages };
  } catch (error) {
    console.error('[IPC] azure:getWikiTree error:', error.message);
    return { success: false, error: error.message };
  }
});

// Check if a wiki page has changed remotely (compare local eTag with remote)
ipcMain.handle('azure:checkPageChanged', async (event, { pagePath, localETag }) => {
  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }
  try {
    // Always skip cache to get the actual remote state
    const result = await azureClient.getPageContent(
      conn.org, conn.project, conn.pat, conn.wikiId, pagePath, true
    );
    if (result.eTag && localETag && result.eTag !== localETag) {
      return { success: true, changed: true, content: result.content, eTag: result.eTag };
    }
    return { success: true, changed: false };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get page content
ipcMain.handle('azure:getPageContent', async (event, { wikiId, pagePath }) => {
  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }
  try {
    const result = await azureClient.getPageContent(conn.org, conn.project, conn.pat, wikiId || conn.wikiId, pagePath);
    configManager.setCurrentPage(wikiId || conn.wikiId, pagePath, result.eTag);
    return { success: true, ...result };
  } catch (error) {
    // If page not found (404), invalidate the parent folder's wiki tree cache
    // This ensures deleted pages are removed from the tree on next refresh
    if (error.statusCode === 404 || error.message.includes('404')) {
      console.log('[IPC] Page not found, invalidating parent folder cache:', pagePath);
      const effectiveWikiId = wikiId || conn.wikiId;

      // Calculate parent path
      const pathParts = pagePath.split('/').filter(p => p);
      pathParts.pop();  // Remove the page name to get parent folder
      const parentPath = pathParts.length > 0 ? '/' + pathParts.join('/') : '/';

      // Invalidate both recursion level variants of the parent folder cache
      azureClient.invalidateWikiCache(conn.org, conn.project, effectiveWikiId, `${parentPath}:oneLevel`);
      azureClient.invalidateWikiCache(conn.org, conn.project, effectiveWikiId, `${parentPath}:full`);
      console.log('[IPC] Invalidated wiki cache for parent:', parentPath);

      return { success: false, error: error.message, pageDeleted: true };
    }
    return { success: false, error: error.message };
  }
});

// Save page to Azure DevOps
ipcMain.handle('azure:savePage', async (event, { wikiId, pagePath, content }) => {
  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }

  const currentPage = configManager.getCurrentPage();

  try {
    // Check for conflicts
    if (currentPage.eTag) {
      const hasConflict = await azureClient.checkForConflict(
        conn.org, conn.project, conn.pat,
        wikiId || conn.wikiId, pagePath, currentPage.eTag
      );

      if (hasConflict) {
        return { success: false, conflict: true, error: 'Remote page has been modified' };
      }
    }

    const result = await azureClient.updatePageContent(
      conn.org, conn.project, conn.pat,
      wikiId || conn.wikiId, pagePath, content, currentPage.eTag
    );

    // Update stored eTag after successful save
    if (result && result.eTag) {
      configManager.setCurrentPage(wikiId || conn.wikiId, pagePath, result.eTag);
    }

    return { success: true, page: result.page, eTag: result.eTag };
  } catch (error) {
    // Check for 412 Precondition Failed (concurrent edit conflict)
    if (error.statusCode === 412) {
      return { success: false, conflict: true, error: 'Remote page has been modified' };
    }
    return { success: false, error: error.message };
  }
});

// Favorites management
ipcMain.handle('azure:getFavorites', async () => {
  return await configManager.loadFavorites();
});

ipcMain.handle('azure:addFavorite', async (event, favorite) => {
  return await configManager.addFavorite(favorite);
});

ipcMain.handle('azure:removeFavorite', async (event, { org, project, wikiId, path }) => {
  return await configManager.removeFavorite(org, project, wikiId, path);
});

// ============================================
// Wiki Page CRUD Operations
// ============================================

// Create a new wiki page
ipcMain.handle('azure:createPage', async (event, { pagePath, content }) => {
  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }

  try {
    console.log('[IPC] Creating page:', pagePath);
    const result = await azureClient.createPage(
      conn.org, conn.project, conn.pat,
      conn.wikiId, pagePath, content || ''
    );

    // Invalidate wiki tree cache to show the new page
    azureClient.invalidateWikiCache(conn.org, conn.project, conn.wikiId);

    return { success: true, page: result };
  } catch (error) {
    console.error('[IPC] Create page error:', error.message);
    return { success: false, error: error.message };
  }
});

// Delete a wiki page
ipcMain.handle('azure:deletePage', async (event, { pagePath }) => {
  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }

  try {
    console.log('[IPC] Deleting page:', pagePath);
    await azureClient.deletePage(
      conn.org, conn.project, conn.pat,
      conn.wikiId, pagePath
    );

    // Invalidate wiki tree cache
    azureClient.invalidateWikiCache(conn.org, conn.project, conn.wikiId);

    return { success: true };
  } catch (error) {
    console.error('[IPC] Delete page error:', error.message);
    return { success: false, error: error.message };
  }
});

// Rename a wiki page (create new, copy content, delete old)
ipcMain.handle('azure:renamePage', async (event, { oldPath, newPath }) => {
  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }

  try {
    console.log('[IPC] Renaming page:', oldPath, '->', newPath);

    // Step 1: Get content from old page
    const oldContent = await azureClient.getPageContent(
      conn.org, conn.project, conn.pat,
      conn.wikiId, oldPath
    );

    // Step 2: Create new page with content
    await azureClient.createPage(
      conn.org, conn.project, conn.pat,
      conn.wikiId, newPath, oldContent.content || ''
    );

    // Step 3: Delete old page
    await azureClient.deletePage(
      conn.org, conn.project, conn.pat,
      conn.wikiId, oldPath
    );

    // Invalidate wiki tree cache
    azureClient.invalidateWikiCache(conn.org, conn.project, conn.wikiId);

    return { success: true, newPath };
  } catch (error) {
    console.error('[IPC] Rename page error:', error.message);
    return { success: false, error: error.message };
  }
});

// Get page revision history
ipcMain.handle('azure:getPageHistory', async (event, { pagePath }) => {
  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }

  try {
    console.log('[IPC] Getting page history:', pagePath);
    const commits = await azureClient.getPageHistory(
      conn.org, conn.project, conn.pat,
      conn.wikiId, pagePath
    );
    return { success: true, commits };
  } catch (error) {
    console.error('[IPC] Get page history error:', error.message);
    return { success: false, error: error.message };
  }
});

// Get page content at a specific version
ipcMain.handle('azure:getPageAtVersion', async (event, { pagePath, commitId }) => {
  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }

  try {
    console.log('[IPC] Getting page at version:', pagePath, commitId?.substring(0, 7));
    const result = await azureClient.getPageAtVersion(
      conn.org, conn.project, conn.pat,
      conn.wikiId, pagePath, commitId
    );
    console.log('[IPC] Page at version result:', {
      hasContent: !!result.content,
      contentLength: result.content?.length,
      contentPreview: result.content?.substring(0, 100)
    });
    return { success: true, content: result.content, commitId: result.commitId };
  } catch (error) {
    console.error('[IPC] Get page at version error:', error.message);
    return { success: false, error: error.message };
  }
});

// Search wiki pages
ipcMain.handle('azure:searchWiki', async (event, { searchText, top, skip }) => {
  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected' };
  }

  try {
    console.log('[IPC] Searching wiki:', searchText);
    const result = await azureClient.searchWiki(
      conn.org, conn.project, conn.pat,
      conn.wikiId, searchText, top, skip
    );
    return { success: true, ...result };
  } catch (error) {
    console.error('[IPC] Wiki search error:', error.message);
    return { success: false, error: error.message };
  }
});

// Open external URL in default browser
ipcMain.handle('shell:openExternal', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================
// Wiki Link Navigation IPC Handlers
// ============================================

// Open a wiki page in a new tab
ipcMain.handle('wiki:openInNewTab', async (event, pagePath) => {
  console.log('[Wiki] Opening in new tab:', pagePath);

  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected to Azure Wiki' };
  }

  try {
    // Fetch page content from Azure
    const result = await azureClient.getPageContent(
      conn.org, conn.project, conn.pat,
      conn.wikiId, pagePath
    );

    if (!result.success && result.error) {
      console.error('[Wiki] Failed to load page:', result.error);
      return { success: false, error: result.error };
    }

    // Create a new Azure tab for the page
    const newTab = await tabManager.createTab({
      type: 'azure',
      azurePage: { pagePath, eTag: result.eTag },
      content: result.content || ''
    });

    // Update Azure info on the tab
    await tabManager.updateTabAzureInfo(newTab.id, { pagePath, eTag: result.eTag });

    // Notify renderer of the new tab
    notifyTabsUpdated();
    mainWindow.webContents.send('tabs:switched', newTab);
    updateWindowTitle();

    return { success: true, tabId: newTab.id };
  } catch (error) {
    console.error('[Wiki] Error opening in new tab:', error.message);
    return { success: false, error: error.message };
  }
});

// Open wiki page in a new Electron window
ipcMain.handle('wiki:openInNewWindow', async (event, pagePath) => {
  console.log('[Wiki] Opening in new window:', pagePath);

  const conn = configManager.getConnection();
  if (!conn.connected) {
    return { success: false, error: 'Not connected to Azure Wiki' };
  }

  try {
    // Create new window with same settings as main window
    const newWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    // Load the app
    newWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

    // Once loaded, navigate to the wiki page
    newWindow.webContents.once('did-finish-load', () => {
      newWindow.webContents.send('navigate-to-page', pagePath);
    });

    return { success: true };
  } catch (error) {
    console.error('[Wiki] Error opening in new window:', error.message);
    return { success: false, error: error.message };
  }
});

// Show context menu for links
ipcMain.handle('context:showLinkMenu', async (event, linkInfo) => {
  const { href, isInternal } = linkInfo;

  return new Promise((resolve) => {
    const menuItems = [];

    if (isInternal) {
      menuItems.push({
        label: 'Open',
        click: () => resolve('open')
      });
      menuItems.push({
        label: 'Open in New Tab',
        click: () => resolve('newTab')
      });
      menuItems.push({
        label: 'Open in New Window',
        click: () => resolve('newWindow')
      });
      menuItems.push({
        label: 'Open in Browser',
        click: () => resolve('openExternal')
      });
    } else {
      menuItems.push({
        label: 'Open in Browser',
        click: () => resolve('openExternal')
      });
    }

    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Copy URL',
      click: () => resolve('copy')
    });

    const menu = Menu.buildFromTemplate(menuItems);

    // Handle menu close without selection
    menu.on('menu-will-close', () => {
      // Give time for click handler to fire
      setTimeout(() => resolve(null), 100);
    });

    menu.popup({
      window: mainWindow,
      callback: () => {
        // Menu closed
      }
    });
  });
});

// ============================================
// Image Selection IPC Handler
// ============================================

ipcMain.handle('image:selectFile', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false };
    }

    const filePath = result.filePaths[0];
    const stats = await fs.stat(filePath);

    // Check file size (20MB max)
    if (stats.size > 20 * 1024 * 1024) {
      return { success: false, error: 'Image too large. Maximum size is 20MB.' };
    }

    // Read file and convert to base64
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');

    // Determine MIME type from extension
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mimeTypes = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp'
    };

    return {
      success: true,
      image: {
        data: base64,
        mimeType: mimeTypes[ext] || 'image/png',
        name: path.basename(filePath)
      }
    };
  } catch (error) {
    console.error('[Image] Error selecting image:', error.message);
    return { success: false, error: error.message };
  }
});

// ============================================
// Attachment Resolution IPC Handler
// ============================================

/**
 * Resolve a local attachment path to a file:// URL
 * Uses the current active tab's file path to find the .attachments folder
 */
ipcMain.handle('attachment:resolvePath', async (event, filename) => {
  try {
    if (!filename) {
      return { success: false, error: 'No filename provided' };
    }

    // Get the active tab to find the current file path
    const activeTab = tabManager.getActiveTab();
    if (!activeTab || !activeTab.filePath) {
      console.log('[Attachment] No active tab or no file path - cannot resolve attachment');
      return { success: false, error: 'No local file context' };
    }

    // Get the directory containing the markdown file
    const fileDir = path.dirname(activeTab.filePath);

    // Construct path to the .attachments folder
    const attachmentPath = path.join(fileDir, '.attachments', filename);

    // Check if the file exists
    try {
      await fs.access(attachmentPath);
    } catch (accessError) {
      console.log('[Attachment] File not found:', attachmentPath);
      return { success: false, error: 'Attachment file not found' };
    }

    // Convert to file:// URL (handle Windows paths)
    const fileUrl = `file:///${attachmentPath.replace(/\\/g, '/')}`;

    console.log('[Attachment] Resolved:', filename, '->', fileUrl);
    return { success: true, url: fileUrl };
  } catch (error) {
    console.error('[Attachment] Error resolving path:', error.message);
    return { success: false, error: error.message };
  }
});

// ============================================
// Azure Attachment Fetch IPC Handler
// ============================================

/**
 * Fetch an Azure DevOps wiki attachment with authentication
 * Returns a data URL that can be used directly in img src
 */
ipcMain.handle('attachment:fetchAzure', async (event, filename) => {
  try {
    if (!filename) {
      return { success: false, error: 'No filename provided' };
    }

    // Get connection info for authentication
    const conn = configManager.getConnection();
    if (!conn.connected || !conn.pat || !conn.org || !conn.project || !conn.wikiId) {
      console.log('[Attachment] Not connected to Azure - cannot fetch attachment');
      return { success: false, error: 'Not connected to Azure' };
    }

    // Use the Azure client to fetch the attachment
    const result = await azureClient.getAttachment(
      conn.org,
      conn.project,
      conn.wikiId,
      filename,
      conn.pat
    );

    if (result.success) {
      console.log('[Attachment] Successfully fetched Azure attachment:', filename);
      return { success: true, dataUrl: result.dataUrl };
    }

    console.log('[Attachment] Azure fetch failed:', result.error);
    return { success: false, error: result.error };
  } catch (error) {
    console.error('[Attachment] Error fetching Azure attachment:', error.message);
    return { success: false, error: error.message };
  }
});

// ============================================
// Attachment Upload IPC Handlers
// ============================================

/**
 * Check if attachment upload is available (connected to Azure with valid wiki)
 */
ipcMain.handle('attachment:isUploadAvailable', async () => {
  const conn = configManager.getConnection();
  return conn.connected && !!conn.wikiId && !!conn.pat;
});

/**
 * Upload an attachment (image) to Azure DevOps Wiki
 * Accepts base64 encoded data from renderer
 */
ipcMain.handle('attachment:upload', async (event, { filename, data, mimeType }) => {
  const conn = configManager.getConnection();
  if (!conn.connected || !conn.wikiId) {
    return { success: false, error: 'Not connected to Azure Wiki' };
  }

  try {
    // Validate mime type (only allow images)
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedMimeTypes.includes(mimeType)) {
      return { success: false, error: `Unsupported file type: ${mimeType}. Only PNG, JPG, GIF, and WebP are allowed.` };
    }

    // Generate unique filename
    const uniqueFilename = azureClient.generateUniqueFilename(filename || 'image', mimeType);

    // Calculate size from base64 (base64 is ~4/3 of original size)
    const estimatedSize = Math.ceil(data.length * 3 / 4);
    console.log('[IPC] Uploading attachment:', uniqueFilename, `(~${estimatedSize} bytes)`);

    // Upload to Azure - pass base64 string directly (Azure expects base64 in body)
    const result = await azureClient.uploadAttachment(
      conn.org,
      conn.project,
      conn.pat,
      conn.wikiId,
      uniqueFilename,
      data  // Pass base64 string directly, not buffer
    );

    return result;
  } catch (error) {
    console.error('[IPC] Attachment upload error:', error.message);
    return { success: false, error: error.message };
  }
});

/**
 * Upload an attachment from a file path (for file picker)
 */
ipcMain.handle('attachment:uploadFromPath', async (event, { filePath }) => {
  const conn = configManager.getConnection();
  if (!conn.connected || !conn.wikiId) {
    return { success: false, error: 'Not connected to Azure Wiki' };
  }

  try {
    // Read file and convert to base64
    const buffer = await fs.readFile(filePath);
    const base64Data = buffer.toString('base64');
    const filename = path.basename(filePath);

    // Determine mime type from extension
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mimeTypes = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp'
    };
    const mimeType = mimeTypes[ext];

    if (!mimeType) {
      return { success: false, error: `Unsupported file type: .${ext}. Only PNG, JPG, GIF, and WebP are allowed.` };
    }

    // Generate unique filename
    const uniqueFilename = azureClient.generateUniqueFilename(filename, mimeType);

    console.log('[IPC] Uploading attachment from file:', uniqueFilename, `(${buffer.length} bytes)`);

    // Upload to Azure - pass base64 string directly (Azure expects base64 in body)
    const result = await azureClient.uploadAttachment(
      conn.org,
      conn.project,
      conn.pat,
      conn.wikiId,
      uniqueFilename,
      base64Data
    );

    return result;
  } catch (error) {
    console.error('[IPC] Attachment upload from file error:', error.message);
    return { success: false, error: error.message };
  }
});

// ============================================
// LLM AI Copilot IPC Handlers (Multi-Provider)
// ============================================

// Get LLM configuration status
ipcMain.handle('gemini:getConfig', () => {
  return getLlmConfigManager().getSafeConfig();
});

// Get available providers
ipcMain.handle('llm:getProviders', () => {
  return getLlmConfigManager().getAvailableProviders();
});

// Get document analysis
ipcMain.handle('llm:analyzeDocument', (event, { content }) => {
  return getEditAgent().analyzeDocument(content);
});

// Classify user message intent using LLM
ipcMain.handle('llm:classifyIntent', async (event, { message, hasActivePersona }) => {
  console.log('[LLM] classifyIntent called:', message?.substring(0, 80));

  if (!getLlmConfigManager().isConfigured()) {
    return { success: false, intent: null };
  }

  try {
    const config = getLlmConfigManager().getActiveConfig();
    const providerFactory = require('./ai/providers');
    const model = providerFactory.createModel(config.provider, {
      ...config,
      maxOutputTokens: 20  // Minimal tokens - we only need one word
    });

    const { SystemMessage, HumanMessage } = require('@langchain/core/messages');
    const personaNote = hasActivePersona
      ? '\n- A persona (writing style agent) is currently active. The user may be asking the persona to write content OR just chatting conversationally.'
      : '';

    const response = await model.invoke([
      new SystemMessage(
        `You are an intent classifier. Classify the user's message into exactly one category. Respond with ONLY the category word, nothing else.

Categories:
- "create" — The user wants a NEW document, article, guide, report, tutorial, or other substantial written content produced and saved. This includes requests like "write me an article about X", "draft a guide on Y", "create a document about Z".
- "edit" — The user wants to modify, update, fix, or change the CURRENT document they have open. This INCLUDES requests to draw, generate, or create diagrams, charts, flowcharts, mermaid diagrams, tables, or any visual/structural content that should be inserted into the current document. Examples: "draw me a diagram of X", "create a flowchart showing Y", "generate a sequence diagram", "add a table".
- "qa" — The user is asking a question, requesting an explanation, or having a conversation that does NOT require creating or editing a document. This includes poems, jokes, short creative requests meant as chat replies, and general discussion.${personaNote}

Respond with exactly one word: create, edit, or qa`
      ),
      new HumanMessage(message)
    ]);

    const intent = (response?.content || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (['create', 'edit', 'qa'].includes(intent)) {
      console.log('[LLM] Classified intent:', intent);
      return { success: true, intent };
    }

    console.log('[LLM] Unexpected intent response:', response?.content);
    return { success: false, intent: null };
  } catch (error) {
    console.error('[LLM] classifyIntent error:', error.message);
    return { success: false, intent: null };
  }
});

// Send message to LLM (supports all providers)
ipcMain.handle('gemini:sendMessage', async (event, { message, articleContent, images, mode, ragContext, visualVerifyMermaid, personaName, chatHistory }) => {
  console.log('[LLM] sendMessage called');
  console.log('[LLM] message:', message);
  console.log('[LLM] mode:', mode || 'edit');
  console.log('[LLM] articleContent type:', typeof articleContent);
  console.log('[LLM] articleContent:', articleContent ? `"${articleContent.substring(0, 100)}..."` : 'empty/null');
  console.log('[LLM] images:', images ? `${images.length} image(s)` : 'none');
  console.log('[LLM] ragContext:', ragContext ? `${ragContext.length} chunks` : 'none');
  console.log('[LLM] personaName:', personaName || 'none');

  if (!getLlmConfigManager().isConfigured()) {
    const config = getLlmConfigManager().getSafeConfig();
    return {
      success: false,
      error: `${config.provider.toUpperCase()} API key not configured. Check your .env file.`
    };
  }

  // Resolve persona if specified
  let persona = null;
  if (personaName) {
    persona = getPersonaManager().getPersona(personaName);
    if (persona) {
      console.log('[LLM] Using persona:', persona.displayName);
    }
  }

  try {
    console.log('[LLM] Calling editAgent.processEditRequest...');
    // Use the edit agent for smart document editing or Q&A
    const result = await getEditAgent().processEditRequest(message, articleContent, {
      images: images || [],
      mode: mode || 'edit',
      ragContext: ragContext || null,
      visualVerifyMermaid: visualVerifyMermaid || false,
      persona: persona || null,
      chatHistory: chatHistory || null
    });

    console.log('[LLM] Result received:', result ? 'success' : 'null');

    // Check if this is a create document response
    if (result.createDocument) {
      console.log('[LLM] Returning create document response');
      return {
        success: true,
        createDocument: true,
        title: result.title,
        content: result.content,
        summary: result.summary
      };
    }

    // Check if this is a Q&A response (text only, no article update)
    if (result.text && !result.updatedArticle) {
      console.log('[LLM] Returning Q&A text response');
      return {
        success: true,
        text: result.text,
        updatedArticle: null,
        changeSummary: null
      };
    }

    // Check if LLM is asking for clarification
    if (result.needsClarification) {
      console.log('[LLM] Returning clarification request');
      return {
        success: true,
        needsClarification: true,
        clarificationQuestion: result.clarificationQuestion,
        options: result.options,
        context: result.context
      };
    }

    return {
      success: true,
      updatedArticle: result.updatedArticle,
      changeSummary: result.changeSummary
    };
  } catch (error) {
    console.error('[LLM] API error:', error.message);
    console.error('[LLM] Error stack:', error.stack);
    return { success: false, error: error.message };
  }
});

// Validate markdown content
ipcMain.handle('gemini:validateMarkdown', (event, content) => {
  return getMarkdownValidator().validateMarkdown(content);
});

// Create backup before AI modification
ipcMain.handle('gemini:createBackup', async (event, { content, pagePath }) => {
  try {
    const filename = await getBackupManager().createBackup(content, pagePath);
    return { success: true, filename };
  } catch (error) {
    console.error('[Backup] Error creating backup:', error.message);
    return { success: false, error: error.message };
  }
});

// Restore from backup
ipcMain.handle('gemini:restoreBackup', async (event, pagePath) => {
  try {
    const content = await getBackupManager().getLatestBackup(pagePath);
    if (content === null) {
      return { success: false, error: 'No backup found' };
    }
    return { success: true, content };
  } catch (error) {
    console.error('[Backup] Error restoring backup:', error.message);
    return { success: false, error: error.message };
  }
});

// Clear chat history
ipcMain.handle('gemini:clearHistory', () => {
  getLlmClient().clearHistory();
  return { success: true };
});

// ============================================
// Persona IPC Handlers
// ============================================

ipcMain.handle('persona:getAll', async () => {
  try {
    const personas = getPersonaManager().getPersonas();
    return { success: true, personas };
  } catch (error) {
    console.error('[Persona] getAll error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('persona:get', async (event, name) => {
  try {
    const persona = getPersonaManager().getPersona(name);
    if (!persona) return { success: false, error: `Persona "${name}" not found` };
    return { success: true, persona };
  } catch (error) {
    console.error('[Persona] get error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('persona:create', async (event, { name, displayName, description, rootPath, extensions }) => {
  try {
    const pm = getPersonaManager();
    const result = await pm.createPersona(name, { displayName, description, rootPath, extensions });

    // Also create the vector DB catalog
    const vdb = getVectorDB();
    await vdb.indexManager.createCatalog(result.catalogName, rootPath, {
      extensions: extensions || ['.md', '.txt', '.text', '.rtf'],
      description: `Persona: ${displayName}`,
      displayName: `${displayName} (Persona)`
    });

    return { success: true, catalogName: result.catalogName };
  } catch (error) {
    console.error('[Persona] create error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('persona:analyzeStyle', async (event, { personaName, catalogName, displayName }) => {
  try {
    const config = getLlmConfigManager().getActiveConfig();
    const providerFactory = require('./ai/providers');
    const model = providerFactory.createModel(config.provider, config);

    const analyzer = require('./ai/persona/personaStyleAnalyzer');
    const { styleProfile, systemPromptTemplate } = await analyzer.analyzeStyle(catalogName, model, displayName);

    // Save to persona metadata
    await getPersonaManager().updatePersona(personaName, { styleProfile, systemPromptTemplate });

    return { success: true, styleProfile, systemPromptTemplate };
  } catch (error) {
    console.error('[Persona] analyzeStyle error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('persona:delete', async (event, { name, deleteCatalog }) => {
  try {
    const pm = getPersonaManager();
    const result = await pm.deletePersona(name);

    if (deleteCatalog && result.catalogName) {
      try {
        const vdb = getVectorDB();
        await vdb.indexManager.deleteCatalog(result.catalogName);
      } catch (catErr) {
        console.warn('[Persona] Failed to delete catalog:', catErr.message);
      }
    }

    return { success: true };
  } catch (error) {
    console.error('[Persona] delete error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('persona:update', async (event, { name, updates }) => {
  try {
    await getPersonaManager().updatePersona(name, updates);
    return { success: true };
  } catch (error) {
    console.error('[Persona] update error:', error.message);
    return { success: false, error: error.message };
  }
});

// ============================================
// Multi-Persona Conversation IPC Handlers
// ============================================

// Store active conversation orchestrators
const activeConversations = new Map();
const conversationGenerators = new Map();

// Get available chat modes for multi-persona conversations
ipcMain.handle('conversation:getChatModes', () => {
  const { CHAT_MODES } = require('./ai/agents/conversationOrchestrator');
  return Object.values(CHAT_MODES);
});

ipcMain.handle('conversation:start', async (event, { personaNames, message, documentContext, mode, chatMode }) => {
  try {
    if (!getLlmConfigManager().isConfigured()) {
      return { success: false, error: 'LLM not configured. Check your .env file.' };
    }

    const { createOrchestrator } = require('./ai/agents/conversationOrchestrator');
    const orchestrator = await createOrchestrator(personaNames, {
      chatMode: chatMode || 'roundRobin'
    });

    // Start the conversation
    orchestrator.startConversation(message, documentContext, mode);

    // Store orchestrator and create generator
    activeConversations.set(orchestrator.conversationId, orchestrator);
    const generator = orchestrator.runConversationLoop();
    conversationGenerators.set(orchestrator.conversationId, generator);

    console.log('[Conversation] Started:', orchestrator.conversationId);

    return {
      success: true,
      conversationId: orchestrator.conversationId,
      personas: orchestrator.personas.map(p => ({
        name: p.name,
        displayName: p.displayName
      }))
    };
  } catch (error) {
    console.error('[Conversation] Start error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('conversation:nextTurn', async (event, conversationId) => {
  try {
    const generator = conversationGenerators.get(conversationId);
    if (!generator) {
      return { type: 'error', message: 'Conversation not found', fatal: true };
    }

    const { value, done } = await generator.next();

    if (done) {
      // Clean up
      activeConversations.delete(conversationId);
      conversationGenerators.delete(conversationId);
      return null;
    }

    return value;
  } catch (error) {
    console.error('[Conversation] NextTurn error:', error.message);
    return { type: 'error', message: error.message, fatal: true };
  }
});

ipcMain.handle('conversation:userMessage', async (event, conversationId, message) => {
  try {
    const orchestrator = activeConversations.get(conversationId);
    if (!orchestrator) {
      return { success: false, error: 'Conversation not found' };
    }

    orchestrator.handleUserInterjection(message);
    return { success: true };
  } catch (error) {
    console.error('[Conversation] UserMessage error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('conversation:stop', async (event, conversationId) => {
  try {
    const orchestrator = activeConversations.get(conversationId);
    if (!orchestrator) {
      return { success: false, error: 'Conversation not found' };
    }

    const result = await orchestrator.stop();

    // Clean up
    activeConversations.delete(conversationId);
    conversationGenerators.delete(conversationId);

    console.log('[Conversation] Stopped:', conversationId);

    return { success: true, ...result };
  } catch (error) {
    console.error('[Conversation] Stop error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('conversation:getState', async (event, conversationId) => {
  try {
    const orchestrator = activeConversations.get(conversationId);
    if (!orchestrator) {
      return { success: false, error: 'Conversation not found' };
    }

    return { success: true, state: orchestrator.getState() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================
// Transcription IPC Handlers
// ============================================

ipcMain.handle('transcription:start', async (event, filePath) => {
  try {
    const whisper = getWhisperService();
    if (whisper.isRunning()) {
      return { success: false, error: 'A transcription is already in progress' };
    }

    const config = configService.getConfig().transcription || {};

    // Run transcription asynchronously, sending progress events to renderer
    whisper.transcribe({
      filePath,
      config,
      onProgress: (progress) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('transcription:progress', progress);
        }
      },
      onText: (segment) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('transcription:text', segment);
        }
      }
    }).then((result) => {
      if (mainWindow && mainWindow.webContents) {
        if (result.success) {
          mainWindow.webContents.send('transcription:complete', result);
        } else {
          mainWindow.webContents.send('transcription:error', { error: result.error });
        }
      }
    }).catch((err) => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('transcription:error', { error: err.message });
      }
    });

    return { success: true, message: 'Transcription started' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('transcription:startFolder', async (event, filePaths) => {
  try {
    const whisper = getWhisperService();
    if (whisper.isRunning()) {
      return { success: false, error: 'A transcription is already in progress' };
    }

    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: 'No files provided' };
    }

    const config = configService.getConfig().transcription || {};
    const total = filePaths.length;

    // Run folder transcription asynchronously
    const pathModule = require('path');
    (async () => {
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const fileName = pathModule.basename(filePath);

        // Send file-start event
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('transcription:fileStart', {
            fileName,
            index: i + 1,
            total
          });
        }

        try {
          const result = await whisper.transcribe({
            filePath,
            config,
            onProgress: (progress) => {
              if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('transcription:progress', progress);
              }
            },
            onText: (segment) => {
              if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('transcription:text', segment);
              }
            }
          });

          if (!result.success) {
            console.error(`[Transcription] File failed: ${fileName}:`, result.error);
            // If cancelled, stop the batch
            if (result.error === 'Cancelled') break;
          }
        } catch (err) {
          console.error(`[Transcription] File error: ${fileName}:`, err.message);
        }
      }

      // Send completion
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('transcription:complete', { folderMode: true });
      }
    })();

    return { success: true, message: 'Folder transcription started' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('transcription:cancel', () => {
  try {
    getWhisperService().cancel();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('transcription:validate', async () => {
  try {
    const config = configService.getConfig().transcription || {};
    return await getWhisperService().validate(config);
  } catch (error) {
    return { ready: false, error: error.message };
  }
});

ipcMain.handle('transcription:downloadModel', async (event, modelName) => {
  try {
    const whisper = getWhisperService();
    const modelPath = await whisper.downloadModel(modelName, (progress) => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('transcription:progress', progress);
      }
    });
    return { success: true, modelPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================
// Documentation Generation IPC Handlers
// ============================================

ipcMain.handle('docs:generate', async (event, { catalogNames }) => {
  try {
    if (!getLlmConfigManager().isConfigured()) {
      return { success: false, error: 'LLM not configured. Check your .env file.' };
    }

    const docAgent = require('./ai/agents/docAgent');
    const result = await docAgent.generateDocumentation({
      catalogNames,
      vectorStore: getVectorDB().vectorStore,
      indexManager: getVectorDB().indexManager,
      onProgress: (progress) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('docs:progress', progress);
        }
      }
    });

    return result;
  } catch (error) {
    console.error('[Docs] Generation error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('docs:cancel', () => {
  try {
    const docAgent = require('./ai/agents/docAgent');
    docAgent.cancelGeneration();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================
// Wiki Search IPC Handlers
// ============================================

// Auto-connect to Azure DevOps using .env credentials if not already connected
async function autoConnectAzure() {
  try {
    const config = await configManager.loadEnvConfig();
    if (!config.org || !config.project || !config.pat || !config.wikiId) {
      return null;
    }
    const result = await azureClient.validateConnection(config.org, config.project, config.pat);
    if (!result.success) {
      return null;
    }
    configManager.setConnection(config.org, config.project, config.pat, config.wikiId, config.wikiId, config.rootPath || '/');
    rebuildMenu();
    return configManager.getConnection();
  } catch (e) {
    console.error('[Auto-Connect] Failed:', e.message);
    return null;
  }
}

// Start a wiki search
ipcMain.handle('wiki:searchPages', async (event, { query, stopBeforeFetch = false }) => {
  console.log('[Wiki Search] Starting search for:', query, 'stopBeforeFetch:', stopBeforeFetch);

  // Check if LLM is configured
  if (!getLlmConfigManager().isConfigured()) {
    return {
      success: false,
      error: 'LLM not configured. Please configure your API key in .env file.'
    };
  }

  // Check Azure connection (auto-connect if needed)
  let connection = configManager.getConnection();
  if (!connection.connected) {
    connection = await autoConnectAzure();
    if (!connection) {
      return {
        success: false,
        error: 'Not connected to Azure DevOps. Please connect first.'
      };
    }
  }

  try {
    // Get full wiki tree
    const wikiTree = await azureClient.getWikiPages(
      connection.org,
      connection.project,
      connection.pat,
      connection.wikiId,
      '/',
      false,
      'full'
    );

    // Create getPageContent function for the agent
    const getPageContent = async (pagePath) => {
      return await azureClient.getPageContent(
        connection.org,
        connection.project,
        connection.pat,
        connection.wikiId,
        pagePath
      );
    };

    // Progress callback that sends updates to renderer
    const onProgress = (progress) => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('wiki:searchProgress', progress);
      }
    };

    // Run the search
    const result = await getWikiSearchAgent().searchWikiPages({
      query,
      wikiTree,
      getPageContent,
      onProgress,
      stopBeforeFetch
    });

    return result;

  } catch (error) {
    console.error('[Wiki Search] Error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
});

// Continue search after confirmation
ipcMain.handle('wiki:continueSearch', async (event, { query, keywords, pages, maxPages }) => {
  console.log('[Wiki Search] Continuing search with', pages.length, 'pages, maxPages:', maxPages);

  let connection = configManager.getConnection();
  if (!connection.connected) {
    connection = await autoConnectAzure();
    if (!connection) {
      return { success: false, error: 'Not connected to Azure DevOps.' };
    }
  }

  const getPageContent = async (pagePath) => {
    return await azureClient.getPageContent(
      connection.org,
      connection.project,
      connection.pat,
      connection.wikiId,
      pagePath
    );
  };

  const onProgress = (progress) => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('wiki:searchProgress', progress);
    }
  };

  return await getWikiSearchAgent().continueSearch({
    query,
    keywords,
    pages,
    maxPages,
    getPageContent,
    onProgress
  });
});

// Cancel an ongoing search
ipcMain.handle('wiki:cancelSearch', async (event, { mode }) => {
  console.log('[Wiki Search] Cancel requested, mode:', mode);
  getWikiSearchAgent().cancelSearch(mode);
  return { success: true };
});

// Extract search terms from query (for pre-confirmation display)
ipcMain.handle('wiki:extractSearchTerms', async (event, { query, allowLlm = false }) => {
  console.log('[Wiki Search] Extracting search terms for:', query);

  try {
    // Use quick extraction - prefers quoted terms, optionally falls back to LLM
    const result = await getWikiSearchAgent().quickExtractSearchTerms(query, allowLlm);

    if (result) {
      return {
        success: true,
        keywords: result.keywords,
        intent: result.intent,
        source: result.source
      };
    }

    // No extraction possible without LLM
    return {
      success: false,
      error: 'No quoted terms found and LLM extraction disabled'
    };
  } catch (error) {
    console.error('[Wiki Search] Error extracting terms:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
});

// Synthesize content from wiki pages (Map-Reduce)
ipcMain.handle('wiki:synthesize', async (event, { query, pages, maxPages, currentPageContent }) => {
  console.log('[Wiki Synthesis] Starting synthesis for:', query, 'with', pages?.length, 'pages, max:', maxPages);

  // Check if LLM is configured
  if (!getLlmConfigManager().isConfigured()) {
    return {
      success: false,
      error: 'LLM not configured. Please configure your API key in .env file.'
    };
  }

  // Check Azure connection (auto-connect if needed)
  let connection = configManager.getConnection();
  if (!connection.connected) {
    connection = await autoConnectAzure();
    if (!connection) {
      return {
        success: false,
        error: 'Not connected to Azure DevOps. Please connect first.'
      };
    }
  }

  try {
    // Create getPageContent function
    const getPageContent = async (pagePath) => {
      return await azureClient.getPageContent(
        connection.org,
        connection.project,
        connection.pat,
        connection.wikiId,
        pagePath
      );
    };

    // Create getAttachment function for images
    const getAttachment = async (filename) => {
      return await azureClient.getAttachment(
        connection.org,
        connection.project,
        connection.wikiId,
        filename,
        connection.pat
      );
    };

    // Progress callback
    const onProgress = (progress) => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('wiki:synthesisProgress', progress);
      }
    };

    // Run synthesis with connection info for URL generation
    const result = await getWikiSynthesisAgent().synthesizeFromPages({
      query,
      pages,
      maxPages,
      getPageContent,
      getAttachment,
      currentPageContent,
      onProgress,
      // Connection info for generating proper Azure DevOps wiki URLs
      connectionInfo: {
        org: connection.org,
        project: connection.project,
        wikiId: connection.wikiId
      }
    });

    return result;

  } catch (error) {
    console.error('[Wiki Synthesis] Error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
});

// Cancel ongoing synthesis
ipcMain.handle('wiki:cancelSynthesis', async () => {
  console.log('[Wiki Synthesis] Cancel requested');
  getWikiSynthesisAgent().cancelSynthesis();
  return { success: true };
});

// ============================================
// Vector DB IPC Handlers
// ============================================

// Check if vector DB is available (with on-demand init retry)
ipcMain.handle('vectordb:isAvailable', async () => {
  const vdb = getVectorDB();
  if (typeof vdb.isAvailable !== 'function') {
    return false;
  }
  if (!vdb.isAvailable()) {
    // Attempt (re-)init if not yet initialized
    try {
      const userDataPath = app.getPath('userData');
      await vdb.initialize(userDataPath);
    } catch (e) {
      console.error('[Main] VectorDB on-demand init failed:', e.message);
      console.error('[Main] VectorDB on-demand init stack:', e.stack);
    }
  }
  return vdb.isAvailable();
});

// Get embedding provider info
ipcMain.handle('vectordb:getProviderInfo', () => {
  try {
    const vdb = getVectorDB();
    if (!vdb.embeddingProvider) {
      return { error: vdb.getLoadError?.() || vdb.getInitError?.() || 'Vector DB module failed to load' };
    }
    const info = vdb.embeddingProvider.getProviderInfo();
    // Include init/load errors even when provider exists
    const loadErr = vdb.getLoadError?.();
    const initErr = vdb.getInitError?.();
    if (loadErr) info.error = loadErr;
    else if (initErr) info.error = initErr;
    info.initialized = vdb.isInitialized?.() ?? false;
    info.configured = vdb.embeddingProvider.isConfigured?.() ?? false;
    return info;
  } catch (error) {
    return { error: error.message };
  }
});

// Get all collections
ipcMain.handle('vectordb:getCollections', async () => {
  try {
    const collections = await getVectorDB().indexManager.getCollections();
    return { success: true, collections };
  } catch (error) {
    console.error('[Vector DB] Get collections error:', error.message);
    return { success: false, error: error.message };
  }
});

// Create a new collection
ipcMain.handle('vectordb:createCollection', async (event, { name, rootPath, options }) => {
  try {
    const collection = await getVectorDB().indexManager.createCollection(name, rootPath, options);
    // Start watching the collection folder
    getVectorDB().fileWatcher.watchCollection(name);
    return { success: true, collection };
  } catch (error) {
    console.error('[Vector DB] Create collection error:', error.message);
    return { success: false, error: error.message };
  }
});

// Delete a collection
ipcMain.handle('vectordb:deleteCollection', async (event, { name }) => {
  try {
    // Stop watching first
    await getVectorDB().fileWatcher.unwatchCollection(name);
    const success = await getVectorDB().indexManager.deleteCollection(name);
    return { success };
  } catch (error) {
    console.error('[Vector DB] Delete collection error:', error.message);
    return { success: false, error: error.message };
  }
});

// Index files in a collection
ipcMain.handle('vectordb:indexFiles', async (event, { collectionName, options }) => {
  try {
    const progressCallback = (progress) => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('vectordb:indexProgress', {
          collection: collectionName,
          ...progress
        });
      }
    };

    const result = await getVectorDB().indexManager.indexFiles(collectionName, options, progressCallback);
    return { success: true, ...result };
  } catch (error) {
    console.error('[Vector DB] Index files error:', error.message);
    return { success: false, error: error.message };
  }
});

// Add a file to a collection
ipcMain.handle('vectordb:addFile', async (event, { collectionName, filePath, content }) => {
  try {
    const result = await getVectorDB().indexManager.addFile(collectionName, filePath, content);
    return { success: true, ...result };
  } catch (error) {
    console.error('[Vector DB] Add file error:', error.message);
    return { success: false, error: error.message };
  }
});

// Remove files from a collection
ipcMain.handle('vectordb:removeFile', async (event, { collectionName, filePath }) => {
  try {
    const result = await getVectorDB().indexManager.removeFile(collectionName, filePath);
    return { success: true, ...result };
  } catch (error) {
    console.error('[Vector DB] Remove file error:', error.message);
    return { success: false, error: error.message };
  }
});

// Search a collection
ipcMain.handle('vectordb:search', async (event, { collectionName, query, options }) => {
  try {
    const results = await getVectorDB().indexManager.search(collectionName, query, options);
    return { success: true, results };
  } catch (error) {
    console.error('[Vector DB] Search error:', error.message);
    return { success: false, error: error.message };
  }
});

// Assemble rich context using code graph + vector search
ipcMain.handle('vectordb:assembleContext', async (event, { query, catalogNames, options }) => {
  try {
    const { assembleContext } = require('./ai/rag/contextAssembler');
    const result = await assembleContext({
      query,
      catalogNames,
      vectorStore: getVectorDB().vectorStore,
      indexManager: getVectorDB().indexManager,
      searchOptions: options
    });
    return { success: true, ...result };
  } catch (error) {
    console.error('[Vector DB] Context assembly error:', error.message);
    return { success: false, error: error.message };
  }
});

// Get collection stats
ipcMain.handle('vectordb:getStats', async (event, { collectionName }) => {
  try {
    const stats = await getVectorDB().vectorStore.getCollectionStats(collectionName);
    const meta = getVectorDB().indexManager.getCollectionMeta(collectionName);
    return { success: true, stats, meta };
  } catch (error) {
    console.error('[Vector DB] Get stats error:', error.message);
    return { success: false, error: error.message };
  }
});

// Rebuild a collection index
ipcMain.handle('vectordb:rebuildIndex', async (event, { collectionName }) => {
  try {
    const progressCallback = (progress) => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('vectordb:indexProgress', {
          collection: collectionName,
          ...progress
        });
      }
    };

    const result = await getVectorDB().indexManager.rebuildCollection(collectionName, progressCallback);
    return { success: true, ...result };
  } catch (error) {
    console.error('[Vector DB] Rebuild index error:', error.message);
    return { success: false, error: error.message };
  }
});

// Cancel indexing
ipcMain.handle('vectordb:cancelIndexing', async (event, { collectionName }) => {
  getVectorDB().indexManager.cancelIndexing(collectionName);
  return { success: true };
});

// Refresh catalog (smart refresh - detect and sync changes)
ipcMain.handle('vectordb:refreshCatalog', async (event, { catalogName }) => {
  try {
    const progressCallback = (progress) => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('vectordb:indexProgress', {
          catalog: catalogName,
          ...progress
        });
      }
    };

    const result = await getVectorDB().indexManager.refreshCatalog(catalogName, progressCallback);
    return { success: true, ...result };
  } catch (error) {
    console.error('[Main] Refresh catalog error:', error.message);
    return { success: false, error: error.message };
  }
});

// Rename catalog
ipcMain.handle('vectordb:renameCatalog', async (event, { oldName, newName }) => {
  try {
    const result = await getVectorDB().indexManager.renameCatalog(oldName, newName);
    return { success: true, ...result };
  } catch (error) {
    console.error('[Main] Rename catalog error:', error.message);
    return { success: false, error: error.message };
  }
});

// Add root path to catalog
ipcMain.handle('vectordb:addRootPath', async (event, { catalogName, rootPath }) => {
  try {
    const result = await getVectorDB().indexManager.addRootPath(catalogName, rootPath);
    return { success: true, ...result };
  } catch (error) {
    console.error('[Main] Add root path error:', error.message);
    return { success: false, error: error.message };
  }
});

// Remove root path from catalog
ipcMain.handle('vectordb:removeRootPath', async (event, { catalogName, rootPath }) => {
  try {
    const result = await getVectorDB().indexManager.removeRootPath(catalogName, rootPath);
    return { success: true, ...result };
  } catch (error) {
    console.error('[Main] Remove root path error:', error.message);
    return { success: false, error: error.message };
  }
});

// Update catalog extensions (merge with existing)
ipcMain.handle('vectordb:updateExtensions', async (event, { catalogName, extensions }) => {
  try {
    const result = await getVectorDB().indexManager.updateCatalogExtensions(catalogName, extensions);
    return { success: true, ...result };
  } catch (error) {
    console.error('[Main] Update extensions error:', error.message);
    return { success: false, error: error.message };
  }
});

// Get active indexing operations
ipcMain.handle('vectordb:getActiveIndexing', async () => {
  try {
    return getVectorDB().indexManager.getActiveIndexingOps();
  } catch (error) {
    console.error('[Main] Get active indexing error:', error.message);
    return {};
  }
});

// Find catalog by fuzzy name matching
ipcMain.handle('vectordb:findCatalog', async (event, { query }) => {
  try {
    const result = await getVectorDB().indexManager.findCatalog(query);
    return { success: true, result };
  } catch (error) {
    console.error('[Main] Find catalog error:', error.message);
    return { success: false, error: error.message };
  }
});

// Get catalog metadata (for detail view)
ipcMain.handle('vectordb:getCatalogMeta', async (event, { catalogName }) => {
  try {
    const meta = getVectorDB().indexManager.getCatalogMeta(catalogName);
    if (!meta) {
      return { success: false, error: 'Catalog not found' };
    }
    return { success: true, meta };
  } catch (error) {
    console.error('[Main] Get catalog meta error:', error.message);
    return { success: false, error: error.message };
  }
});

// Get file chunks for viewing
ipcMain.handle('vectordb:getFileChunks', async (event, { catalogName, filePath }) => {
  try {
    const chunks = await getVectorDB().vectorStore.getFileChunks(catalogName, filePath);
    return { success: true, chunks };
  } catch (error) {
    console.error('[Main] Get file chunks error:', error.message);
    return { success: false, error: error.message };
  }
});

// ============================================
// Enhanced Indexing IPC Handlers
// ============================================

// Lazy-loaded modules for enhanced indexing
let enhancedIndexer = null;
let indexTaskPersistence = null;

function getEnhancedIndexer() {
  if (!enhancedIndexer) {
    enhancedIndexer = require('./ai/indexing/enhancedIndexer');
  }
  return enhancedIndexer;
}

function getTaskPersistence() {
  if (!indexTaskPersistence) {
    indexTaskPersistence = require('./ai/vectordb/indexTaskPersistence');
  }
  return indexTaskPersistence;
}

// Scan files for preview (returns file list without starting indexing)
ipcMain.handle('indexing:scanPreview', async (event, options) => {
  try {
    const { paths, extensions, respectGitignore = true } = options;
    const indexer = getEnhancedIndexer();

    const files = await indexer.scanFiles(paths, extensions, { respectGitignore });

    return { success: true, files };
  } catch (error) {
    console.error('[Indexing] Scan preview error:', error.message);
    return { success: false, error: error.message };
  }
});

// Start enhanced indexing with quality level
ipcMain.handle('indexing:start', async (event, options) => {
  try {
    const {
      catalogName,
      qualityLevel,
      paths,
      extensions,
      isNewCatalog,
      includeSubfolders,
      preScannedFiles
    } = options;

    const indexer = getEnhancedIndexer();
    const persistence = getTaskPersistence();
    const splitterFactory = require('./ai/splitters');

    // Create or update catalog
    if (isNewCatalog) {
      const rootPath = paths[0];
      await getVectorDB().indexManager.createCatalog(catalogName, rootPath, {
        extensions,
        recursive: includeSubfolders
      });

      // Add additional root paths
      for (let i = 1; i < paths.length; i++) {
        await getVectorDB().indexManager.addRootPath(catalogName, paths[i]);
      }
    }

    // Create persistence task
    const taskId = await persistence.createTask({
      catalogName,
      qualityLevel,
      rootPaths: paths,
      extensions,
      includeSubfolders
    });

    // Set up callbacks
    const callbacks = {
      onFileStatus: (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:fileStatus', data);
        }
        persistence.updateFileStatus(taskId, data.filePath, data);
      },
      onFilesDiscovered: (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:filesDiscovered', data);
        }
      },
      onLLMStream: (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:llmStream', data);
        }
      },
      onPhaseChange: (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:phaseChange', data);
        }
      },
      onTokenUpdate: (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:tokenUpdate', data);
        }
        persistence.updateTokenUsage(taskId, data.inputTokens || 0, data.outputTokens || 0);
      },
      onComplete: async (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:taskComplete', data);
        }
        // Don't overwrite 'cancelled' status with 'completed'
        if (!data.summary?.cancelled) {
          await persistence.markCompleted(taskId, data.summary);
        }
      }
    };

    // Start indexing in background
    persistence.markStarted(taskId, 0);

    // Run indexing asynchronously
    indexer.indexWithQuality(
      {
        catalogName,
        qualityLevel,
        rootPaths: paths,
        extensions,
        taskId,
        preScannedFiles
      },
      callbacks,
      {
        indexManager: getVectorDB().indexManager,
        vectorStore: getVectorDB().vectorStore,
        llmClient: qualityLevel === 'high' ? getLlmClient() : null,
        splitterFactory
      }
    ).catch(async (error) => {
      console.error('[Indexing] Error:', error);
      await persistence.markFailed(taskId, error.message);
    });

    return { success: true, taskId };

  } catch (error) {
    console.error('[Indexing] Start error:', error.message);
    return { success: false, error: error.message };
  }
});

// Pause indexing
ipcMain.handle('indexing:pause', async (event, { taskId }) => {
  try {
    const persistence = getTaskPersistence();
    await persistence.markPaused(taskId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Resume indexing
ipcMain.handle('indexing:resume', async (event, { taskId }) => {
  try {
    const persistence = getTaskPersistence();
    const task = persistence.getTask(taskId);

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    const indexer = getEnhancedIndexer();
    const splitterFactory = require('./ai/splitters');
    const resumePoint = persistence.getResumePoint(taskId);

    // Set up callbacks same as start
    const callbacks = {
      onFileStatus: (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:fileStatus', data);
        }
        persistence.updateFileStatus(taskId, data.filePath, data);
      },
      onFilesDiscovered: (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:filesDiscovered', data);
        }
      },
      onLLMStream: (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:llmStream', data);
        }
      },
      onPhaseChange: (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:phaseChange', data);
        }
      },
      onTokenUpdate: (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:tokenUpdate', data);
        }
        persistence.updateTokenUsage(taskId, data.inputTokens || 0, data.outputTokens || 0);
      },
      onComplete: async (data) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('indexing:taskComplete', data);
        }
        // Don't overwrite 'cancelled' status with 'completed'
        if (!data.summary?.cancelled) {
          await persistence.markCompleted(taskId, data.summary);
        }
      }
    };

    // Resume indexing
    persistence.updateStatus(taskId, 'in_progress');

    indexer.indexWithQuality(
      {
        catalogName: task.catalogName,
        qualityLevel: task.qualityLevel,
        rootPaths: task.config.rootPaths,
        extensions: task.config.extensions,
        taskId,
        resumeFromFile: resumePoint
      },
      callbacks,
      {
        indexManager: getVectorDB().indexManager,
        vectorStore: getVectorDB().vectorStore,
        llmClient: task.qualityLevel === 'high' ? getLlmClient() : null,
        splitterFactory
      }
    ).catch(async (error) => {
      console.error('[Indexing] Resume error:', error);
      await persistence.markFailed(taskId, error.message);
    });

    return { success: true };

  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Cancel indexing
ipcMain.handle('indexing:cancel', async (event, { taskId }) => {
  try {
    // Cancel in the enhanced indexer (handles wizard-initiated indexing)
    const indexer = getEnhancedIndexer();
    indexer.cancelTask(taskId);

    // Also cancel in the index manager (handles its own cancellation tokens)
    const persistence = getTaskPersistence();
    const task = persistence.getTask(taskId);

    if (task) {
      await getVectorDB().indexManager.cancelIndexing(task.catalogName);
      await persistence.updateStatus(taskId, 'cancelled');
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get incomplete tasks (for crash recovery)
ipcMain.handle('indexing:getIncomplete', async () => {
  try {
    const persistence = getTaskPersistence();
    const tasks = persistence.getIncompleteTasks();
    return { success: true, tasks };
  } catch (error) {
    return { success: false, error: error.message, tasks: [] };
  }
});

// Discard incomplete task
ipcMain.handle('indexing:discardTask', async (event, { taskId }) => {
  try {
    const persistence = getTaskPersistence();
    await persistence.deleteTask(taskId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Estimate token cost for high quality indexing
ipcMain.handle('indexing:estimateTokens', async (event, { paths, extensions }) => {
  try {
    const indexer = getEnhancedIndexer();
    // Rough estimation based on file count
    const estimate = indexer.estimateTokenCost(paths.map(p => ({ contentLength: 3000 })));
    return { success: true, estimate };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Deferred vector DB initialization (runs after window is shown)
function deferVectorDBInit() {
  // Initialize persona manager immediately (lightweight — just reads JSON)
  try {
    const userDataPath = app.getPath('userData');
    getPersonaManager().initialize(userDataPath).then(() => {
      console.log('[Main] Persona Manager initialized');
    }).catch(err => {
      console.error('[Main] Persona Manager initialization failed:', err.message);
    });
  } catch (err) {
    console.error('[Main] Persona Manager init error:', err.message);
  }

  // Defer heavy vector DB init
  setTimeout(async () => {
    try {
      const vdb = getVectorDB();
      const userDataPath = app.getPath('userData');
      await vdb.initialize(userDataPath);

      // Set up status broadcaster for real-time indexing status updates
      vdb.indexManager.setStatusBroadcaster((status) => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('vectordb:indexingStatus', status);
        }
      });

      // Initialize task persistence for crash recovery
      const taskPersistence = getTaskPersistence();
      await taskPersistence.initialize(userDataPath);

      console.log('[Main] Vector DB initialized (deferred)');
    } catch (error) {
      console.error('[Main] Vector DB initialization failed:', error.message);
      // Non-fatal - app can continue without vector DB
    }
  }, 3000);
}

// Pre-warm AI modules in background after window is visible
function preWarmAIModules() {
  setTimeout(() => { try { getLlmConfigManager(); } catch (e) { /* ignore */ } }, 5000);
  setTimeout(() => { try { getLlmClient(); } catch (e) { /* ignore */ } }, 6000);
  setTimeout(() => { try { getEditAgent(); } catch (e) { /* ignore */ } }, 7000);
}

// Register custom protocol for serving local PDF files in iframes
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-pdf', privileges: { stream: true, bypassCSP: true } }
]);

// App lifecycle
app.whenReady().then(async () => {
  // Register handler for local-pdf:// protocol (serves local files for iframe PDF viewer)
  protocol.handle('local-pdf', async (request) => {
    let filePath = decodeURIComponent(request.url.replace('local-pdf://', ''));
    // Ensure proper file:/// URL format on Windows (needs three slashes before drive letter)
    if (/^[A-Za-z]:/.test(filePath)) {
      filePath = '/' + filePath;
    }
    return net.fetch('file://' + filePath);
  });

  // Initialize config service (loads config.json or migrates from .env)
  await configService.loadConfig();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Prevent closing with unsaved Azure changes and flush session
// Always prevent quit so we can properly flush session (which removes Azure tabs)
app.on('before-quit', async (event) => {
  event.preventDefault();

  // Shutdown vector DB (only if it was loaded)
  try {
    if (_vectorDB) await _vectorDB.shutdown();
  } catch (error) {
    console.error('[Main] Vector DB shutdown error:', error.message);
  }

  const dirtyAzureTabs = tabManager.getDirtyAzureTabs();
  if (dirtyAzureTabs.length > 0 && mainWindow) {
    const fileList = dirtyAzureTabs.map(t => t.title).join('\n  - ');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Unsaved Azure Changes',
      message: `You have ${dirtyAzureTabs.length} unsaved Azure page(s):\n  - ${fileList}`,
      detail: 'Do you want to save your changes to Azure DevOps before closing?',
      buttons: ['Save All', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2
    });

    if (result.response === 0) {
      let allSaved = true;
      for (const tab of dirtyAzureTabs) {
        const saved = await saveTabById(tab.id);
        if (!saved) {
          allSaved = false;
          break;
        }
      }
      if (allSaved) {
        await tabManager.flushSession();
        app.exit();
      }
    } else if (result.response === 1) {
      await tabManager.flushSession();
      app.exit();
    }
    // Cancel (response === 2) - don't exit, user cancelled
  } else {
    // No dirty Azure tabs - flush session (removes Azure tabs) and exit
    await tabManager.flushSession();
    app.exit();
  }
});
