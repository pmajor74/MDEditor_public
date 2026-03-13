const { contextBridge, ipcRenderer } = require('electron');

// Expose secure API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Config API
  configGet: (key) => ipcRenderer.invoke('config:get', key),
  configGetAll: () => ipcRenderer.invoke('config:getAll'),
  configGetAllFull: () => ipcRenderer.invoke('config:getAllFull'),
  configUpdate: (partial) => ipcRenderer.invoke('config:update', partial),
  configGetPath: () => ipcRenderer.invoke('config:getPath'),
  configOpenFolder: () => ipcRenderer.invoke('config:openFolder'),
  onConfigChanged: (callback) => {
    ipcRenderer.on('config:changed', (event, config) => callback(config));
  },

  // File operations
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: () => ipcRenderer.invoke('file:save'),
  saveFileAs: () => ipcRenderer.invoke('file:saveAs'),
  getFileState: () => ipcRenderer.invoke('file:getState'),

  // Event listeners for file operations initiated from menu
  onFileNew: (callback) => {
    ipcRenderer.on('file:new', (event) => callback());
  },
  onFileOpened: (callback) => {
    ipcRenderer.on('file:opened', (event, data) => callback(data));
  },
  onRequestContent: (callback) => {
    ipcRenderer.on('editor:requestContent', (event) => callback());
  },

  // Send content back to main process
  sendContent: (content) => {
    ipcRenderer.send('editor:content', content);
  },

  // HTML export
  onExportHtml: (callback) => {
    ipcRenderer.on('file:exportHtml', () => callback());
  },
  sendExportedHtml: (htmlContent) => {
    ipcRenderer.send('file:exportedHtml', htmlContent);
  },

  // Notify main process of content changes (for dirty state)
  notifyContentChanged: (data) => {
    ipcRenderer.send('editor:contentChanged', data || {});
  },

  // Theme handling
  onThemeChange: (callback) => {
    ipcRenderer.on('theme:change', (event, theme) => callback(theme));
  },

  // Get app configuration (production mode, splash duration, etc.)
  onAppConfig: (callback) => {
    ipcRenderer.on('app:config', (event, config) => callback(config));
  },

  // Remove listeners when no longer needed
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // ============================================
  // File Browser API
  // ============================================

  // Open folder dialog
  fileOpenFolder: () => ipcRenderer.invoke('file:openFolder'),

  // Select files for persona source (supports multiple files)
  fileSelectForPersona: (options) => ipcRenderer.invoke('file:selectForPersona', options),

  // Add a path to allowed roots (for restoring saved folders)
  pathValidatorAddRoot: (rootPath) => ipcRenderer.invoke('file:addAllowedRoot', rootPath),

  // Get directory contents
  fileGetDirectoryContents: (dirPath, options) =>
    ipcRenderer.invoke('file:getDirectoryContents', dirPath, options),

  // Read file
  fileReadFile: (filePath) => ipcRenderer.invoke('file:readBrowserFile', filePath),

  // Read PDF text (extract text from PDF)
  fileReadPdfText: (filePath) => ipcRenderer.invoke('file:readPdfText', filePath),

  // Write file
  fileWriteFile: (filePath, content) =>
    ipcRenderer.invoke('file:writeBrowserFile', filePath, content),

  // Create file
  fileCreateFile: (parentDir, filename, content) =>
    ipcRenderer.invoke('file:createFile', parentDir, filename, content),

  // Create folder
  fileCreateFolder: (parentDir, folderName) =>
    ipcRenderer.invoke('file:createFolder', parentDir, folderName),

  // Rename file/folder
  fileRename: (oldPath, newName) => ipcRenderer.invoke('file:rename', oldPath, newName),

  // Delete file/folder
  fileDelete: (targetPath) => ipcRenderer.invoke('file:delete', targetPath),

  // Get file/folder metadata
  fileGetMetadata: (targetPath) => ipcRenderer.invoke('file:getMetadata', targetPath),

  // Check if file is a text file (can be opened in editor)
  fileIsTextFile: (filePath) => ipcRenderer.invoke('file:isTextFile', filePath),

  // Get file browser config
  fileGetConfig: () => ipcRenderer.invoke('file:getConfig'),

  // Update file browser config
  fileUpdateConfig: (newConfig) => ipcRenderer.invoke('file:updateConfig', newConfig),

  // Get allowed roots
  fileGetAllowedRoots: () => ipcRenderer.invoke('file:getAllowedRoots'),

  // ============================================
  // File Search API
  // ============================================

  // Search files
  fileSearch: (options) => ipcRenderer.invoke('file:search', options),

  // Cancel search
  fileSearchCancel: (searchId) => ipcRenderer.invoke('file:searchCancel', searchId),

  // Get search config
  fileSearchGetConfig: () => ipcRenderer.invoke('file:searchGetConfig'),

  // Update search config
  fileSearchUpdateConfig: (newConfig) =>
    ipcRenderer.invoke('file:searchUpdateConfig', newConfig),

  // Search progress event listener
  onFileSearchProgress: (callback) => {
    ipcRenderer.on('file:searchProgress', (event, progress) => callback(progress));
  },

  // ============================================
  // Azure DevOps API
  // ============================================

  // Connection management
  azureConnect: (config) => ipcRenderer.invoke('azure:connect', config),
  azureDisconnect: () => ipcRenderer.invoke('azure:disconnect'),
  azureGetConnectionStatus: () => ipcRenderer.invoke('azure:getConnectionStatus'),
  azureLoadConfig: () => ipcRenderer.invoke('azure:loadConfig'),

  // Wiki operations
  azureGetWikis: () => ipcRenderer.invoke('azure:getWikis'),
  azureGetWikiTree: (params) => ipcRenderer.invoke('azure:getWikiTree', params),
  azureGetPageContent: (params) => ipcRenderer.invoke('azure:getPageContent', params),
  azureCheckPageChanged: (params) => ipcRenderer.invoke('azure:checkPageChanged', params),
  azureSavePage: (params) => ipcRenderer.invoke('azure:savePage', params),
  azureResolvePagePath: (params) => ipcRenderer.invoke('azure:resolvePagePath', params),

  // Favorites
  azureGetFavorites: () => ipcRenderer.invoke('azure:getFavorites'),
  azureAddFavorite: (favorite) => ipcRenderer.invoke('azure:addFavorite', favorite),
  azureRemoveFavorite: (params) => ipcRenderer.invoke('azure:removeFavorite', params),

  // Page CRUD operations
  azureCreatePage: (params) => ipcRenderer.invoke('azure:createPage', params),
  azureDeletePage: (params) => ipcRenderer.invoke('azure:deletePage', params),
  azureRenamePage: (params) => ipcRenderer.invoke('azure:renamePage', params),

  // Page history operations
  azureGetPageHistory: (params) => ipcRenderer.invoke('azure:getPageHistory', params),
  azureGetPageAtVersion: (params) => ipcRenderer.invoke('azure:getPageAtVersion', params),

  // Wiki search (Azure DevOps Search API)
  azureSearchWiki: (params) => ipcRenderer.invoke('azure:searchWiki', params),

  // Event listeners from main process (menu actions)
  onAzureShowConnectionDialog: (callback) => {
    ipcRenderer.on('azure:showConnectionDialog', () => callback());
  },
  onAzureDisconnected: (callback) => {
    ipcRenderer.on('azure:disconnected', () => callback());
  },
  onAzureToggleSidebar: (callback) => {
    ipcRenderer.on('azure:toggleSidebar', () => callback());
  },
  onAzureRefreshTree: (callback) => {
    ipcRenderer.on('azure:refreshTree', () => callback());
  },
  onAzureAddToFavorites: (callback) => {
    ipcRenderer.on('azure:addToFavorites', () => callback());
  },
  onAzureCacheCleared: (callback) => {
    ipcRenderer.on('azure:cacheCleared', () => callback());
  },

  // Find/Replace menu events
  onEditFind: (callback) => {
    ipcRenderer.on('edit:find', () => callback());
  },
  onEditReplace: (callback) => {
    ipcRenderer.on('edit:replace', () => callback());
  },

  // Settings menu event
  onShowSettings: (callback) => {
    ipcRenderer.on('view:showSettings', () => callback());
  },

  // Help menu events
  onShowKeyboardShortcuts: (callback) => {
    ipcRenderer.on('help:showKeyboardShortcuts', () => callback());
  },

  // Save coordination - main process asks renderer to handle Azure save
  onAzureRequestSave: (callback) => {
    ipcRenderer.on('azure:requestSave', async () => {
      const result = await callback();
      ipcRenderer.send('azure:saveResult', result);
    });
  },

  // Open external URL in default browser
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Wiki link navigation
  wikiOpenInNewTab: (pagePath) => ipcRenderer.invoke('wiki:openInNewTab', pagePath),
  wikiOpenInNewWindow: (pagePath) => ipcRenderer.invoke('wiki:openInNewWindow', pagePath),
  showLinkContextMenu: (linkInfo) => ipcRenderer.invoke('context:showLinkMenu', linkInfo),

  // Navigation request from main process (for new window)
  onNavigateToPage: (callback) => {
    ipcRenderer.on('navigate-to-page', (event, pagePath) => callback(pagePath));
  },

  // ============================================
  // Image Selection API
  // ============================================

  // Select an image file from the file system
  selectImageFile: () => ipcRenderer.invoke('image:selectFile'),

  // Resolve a local attachment path to a file:// URL
  resolveAttachmentPath: (filename) => ipcRenderer.invoke('attachment:resolvePath', filename),

  // Fetch an Azure attachment and return as data URL (handles authentication)
  fetchAzureAttachment: (filename) => ipcRenderer.invoke('attachment:fetchAzure', filename),

  // Upload an attachment (image) to Azure DevOps Wiki
  uploadAttachment: (params) => ipcRenderer.invoke('attachment:upload', params),

  // Upload an attachment from a file path
  uploadAttachmentFromPath: (params) => ipcRenderer.invoke('attachment:uploadFromPath', params),

  // Check if attachment upload is available (connected to Azure)
  isAttachmentUploadAvailable: () => ipcRenderer.invoke('attachment:isUploadAvailable'),

  // ============================================
  // LLM AI Copilot API (Multi-Provider Support)
  // ============================================

  // Get LLM configuration status (provider, model, configured status)
  geminiGetConfig: () => ipcRenderer.invoke('gemini:getConfig'),

  // Get available LLM providers and their configuration status
  llmGetProviders: () => ipcRenderer.invoke('llm:getProviders'),

  // Analyze document structure (for large document handling)
  llmAnalyzeDocument: (params) => ipcRenderer.invoke('llm:analyzeDocument', params),
  llmClassifyIntent: (params) => ipcRenderer.invoke('llm:classifyIntent', params),

  // Send a message to LLM and get a response (supports all providers)
  geminiSendMessage: (params) => ipcRenderer.invoke('gemini:sendMessage', params),

  // Validate markdown content
  geminiValidateMarkdown: (content) => ipcRenderer.invoke('gemini:validateMarkdown', content),

  // Create a backup of article content before AI modification
  geminiCreateBackup: (params) => ipcRenderer.invoke('gemini:createBackup', params),

  // Restore the most recent backup
  geminiRestoreBackup: (pagePath) => ipcRenderer.invoke('gemini:restoreBackup', pagePath),

  // Clear chat history
  geminiClearHistory: () => ipcRenderer.invoke('gemini:clearHistory'),

  // Event listener for AI sidebar toggle (from menu)
  onGeminiToggleSidebar: (callback) => {
    ipcRenderer.on('gemini:toggleSidebar', () => callback());
  },

  // ============================================
  // Documentation Generation API
  // ============================================

  // Generate documentation for catalogs
  docsGenerate: (params) => ipcRenderer.invoke('docs:generate', params),

  // Cancel ongoing documentation generation
  docsCancel: () => ipcRenderer.invoke('docs:cancel'),

  // Listen for documentation generation progress
  onDocsProgress: (callback) => {
    ipcRenderer.on('docs:progress', (event, progress) => callback(progress));
  },

  // Remove docs progress listener
  removeDocsProgressListener: () => {
    ipcRenderer.removeAllListeners('docs:progress');
  },

  // ============================================
  // Wiki Search API (AI-powered wiki search)
  // ============================================

  // Start a wiki search
  wikiSearchPages: (params) => ipcRenderer.invoke('wiki:searchPages', params),

  // Continue search after confirmation for large result sets
  wikiContinueSearch: (params) => ipcRenderer.invoke('wiki:continueSearch', params),

  // Cancel an ongoing search
  wikiCancelSearch: (params) => ipcRenderer.invoke('wiki:cancelSearch', params),

  // Extract search terms from query (for pre-confirmation display)
  wikiExtractSearchTerms: (params) => ipcRenderer.invoke('wiki:extractSearchTerms', params),

  // Listen for search progress updates
  onWikiSearchProgress: (callback) => {
    ipcRenderer.on('wiki:searchProgress', (event, progress) => callback(progress));
  },

  // Remove search progress listener
  removeWikiSearchProgressListener: () => {
    ipcRenderer.removeAllListeners('wiki:searchProgress');
  },

  // ============================================
  // Wiki Synthesis API (Map-Reduce)
  // ============================================

  // Start wiki synthesis (map-reduce)
  wikiSynthesize: (params) => ipcRenderer.invoke('wiki:synthesize', params),

  // Cancel ongoing synthesis
  wikiCancelSynthesis: () => ipcRenderer.invoke('wiki:cancelSynthesis'),

  // Listen for synthesis progress updates
  onWikiSynthesisProgress: (callback) => {
    ipcRenderer.on('wiki:synthesisProgress', (event, progress) => callback(progress));
  },

  // Remove synthesis progress listener
  removeWikiSynthesisProgressListener: () => {
    ipcRenderer.removeAllListeners('wiki:synthesisProgress');
  },

  // ============================================
  // Tab Management API
  // ============================================

  // Get all tabs
  tabsGetAll: () => ipcRenderer.invoke('tabs:getAll'),

  // Get active tab
  tabsGetActive: () => ipcRenderer.invoke('tabs:getActive'),

  // Get full session
  tabsGetSession: () => ipcRenderer.invoke('tabs:getSession'),

  // Create a new tab
  tabsCreate: (options) => ipcRenderer.invoke('tabs:create', options),

  // Switch to a tab
  tabsSwitch: (tabId) => ipcRenderer.invoke('tabs:switch', tabId),

  // Close a tab
  tabsClose: (tabId) => ipcRenderer.invoke('tabs:close', tabId),

  // Update tab content
  tabsUpdateContent: (params) => ipcRenderer.invoke('tabs:updateContent', params),

  // Reorder tabs
  tabsReorder: (newOrder) => ipcRenderer.invoke('tabs:reorder', newOrder),

  // Close other tabs
  tabsCloseOthers: (keepTabId) => ipcRenderer.invoke('tabs:closeOthers', keepTabId),

  // Close all tabs
  tabsCloseAll: () => ipcRenderer.invoke('tabs:closeAll'),

  // Mark tab as saved
  tabsMarkSaved: (params) => ipcRenderer.invoke('tabs:markSaved', params),

  // Update Azure info on tab
  tabsUpdateAzureInfo: (params) => ipcRenderer.invoke('tabs:updateAzureInfo', params),

  // Replace Azure tab content (for tab reuse)
  tabsReplaceAzureContent: (params) => ipcRenderer.invoke('tabs:replaceAzureContent', params),

  // Dialog for unsaved Azure changes
  showAzureSavePrompt: () => ipcRenderer.invoke('dialog:showAzureSavePrompt'),

  // Reload a tab's content from file (for external changes)
  tabsReloadFromFile: (tabId) => ipcRenderer.invoke('tabs:reloadFromFile', tabId),

  // Check a tab for external file changes
  tabsCheckExternalChanges: (tabId) => ipcRenderer.invoke('tabs:checkExternalChanges', tabId),

  // Clear external changes flag on a tab
  tabsClearExternalChanges: (tabId) => ipcRenderer.invoke('tabs:clearExternalChanges', tabId),

  // Sync content without marking dirty (for editor normalization after load)
  tabsSyncContent: (params) => ipcRenderer.invoke('tabs:syncContent', params),

  // Event listener for tab session loaded
  onTabsSessionLoaded: (callback) => {
    ipcRenderer.on('tabs:sessionLoaded', (event, session) => callback(session));
  },

  // Event listener for tabs updated
  onTabsUpdated: (callback) => {
    ipcRenderer.on('tabs:updated', (event, session) => callback(session));
  },

  // Event listener for tab switched
  onTabsSwitched: (callback) => {
    ipcRenderer.on('tabs:switched', (event, tab) => callback(tab));
  },

  // ============================================
  // Vector DB API
  // ============================================

  // Check if vector DB is available
  vectordbIsAvailable: () => ipcRenderer.invoke('vectordb:isAvailable'),

  // Get embedding provider info
  vectordbGetProviderInfo: () => ipcRenderer.invoke('vectordb:getProviderInfo'),

  // Get all collections
  vectordbGetCollections: () => ipcRenderer.invoke('vectordb:getCollections'),

  // Create a new collection
  vectordbCreateCollection: (params) => ipcRenderer.invoke('vectordb:createCollection', params),

  // Delete a collection
  vectordbDeleteCollection: (params) => ipcRenderer.invoke('vectordb:deleteCollection', params),

  // Index files in a collection
  vectordbIndexFiles: (params) => ipcRenderer.invoke('vectordb:indexFiles', params),

  // Add a file to a collection
  vectordbAddFile: (params) => ipcRenderer.invoke('vectordb:addFile', params),

  // Remove a file from a collection
  vectordbRemoveFile: (params) => ipcRenderer.invoke('vectordb:removeFile', params),

  // Search a collection
  vectordbSearch: (params) => ipcRenderer.invoke('vectordb:search', params),

  // Assemble rich context using code graph + vector search
  vectordbAssembleContext: (params) => ipcRenderer.invoke('vectordb:assembleContext', params),

  // Get collection stats
  vectordbGetStats: (params) => ipcRenderer.invoke('vectordb:getStats', params),

  // Rebuild collection index
  vectordbRebuildIndex: (params) => ipcRenderer.invoke('vectordb:rebuildIndex', params),

  // Cancel indexing
  vectordbCancelIndexing: (params) => ipcRenderer.invoke('vectordb:cancelIndexing', params),

  // Refresh catalog (smart refresh - detect and sync changes)
  vectordbRefreshCatalog: (params) => ipcRenderer.invoke('vectordb:refreshCatalog', params),

  // Rename catalog
  vectordbRenameCatalog: (params) => ipcRenderer.invoke('vectordb:renameCatalog', params),

  // Add root path to catalog
  vectordbAddRootPath: (params) => ipcRenderer.invoke('vectordb:addRootPath', params),

  // Remove root path from catalog
  vectordbRemoveRootPath: (params) => ipcRenderer.invoke('vectordb:removeRootPath', params),

  // Update catalog extensions
  vectordbUpdateExtensions: (params) => ipcRenderer.invoke('vectordb:updateExtensions', params),

  // Index progress listener
  onVectordbIndexProgress: (callback) => {
    ipcRenderer.on('vectordb:indexProgress', (event, progress) => callback(progress));
  },

  // Remove index progress listener
  removeVectordbIndexProgressListener: () => {
    ipcRenderer.removeAllListeners('vectordb:indexProgress');
  },

  // Get active indexing operations
  vectordbGetActiveIndexing: () => ipcRenderer.invoke('vectordb:getActiveIndexing'),

  // Find catalog by fuzzy name matching
  vectordbFindCatalog: (params) => ipcRenderer.invoke('vectordb:findCatalog', params),

  // Get catalog metadata (for detail view with file list)
  vectordbGetCatalogMeta: (params) => ipcRenderer.invoke('vectordb:getCatalogMeta', params),

  // Get file chunks for viewing
  vectordbGetFileChunks: (params) => ipcRenderer.invoke('vectordb:getFileChunks', params),

  // Listen for real-time indexing status updates
  onVectordbIndexingStatus: (callback) => {
    ipcRenderer.on('vectordb:indexingStatus', (event, status) => callback(status));
  },

  // Remove indexing status listener
  removeVectordbIndexingStatusListener: () => {
    ipcRenderer.removeAllListeners('vectordb:indexingStatus');
  },

  // Listen for catalog manager show command
  onShowCatalogManager: (callback) => {
    ipcRenderer.on('catalogs:showManager', () => callback());
  },

  // Listen for persona manager show command
  onShowPersonaManager: (callback) => {
    ipcRenderer.on('personas:showManager', () => callback());
  },

  // ============================================
  // Enhanced Indexing APIs
  // ============================================

  // Scan files for preview (returns file list without indexing)
  indexingScanPreview: (params) => ipcRenderer.invoke('indexing:scanPreview', params),

  // Start indexing with quality level
  indexingStart: (params) => ipcRenderer.invoke('indexing:start', params),

  // Pause indexing
  indexingPause: (params) => ipcRenderer.invoke('indexing:pause', params),

  // Resume indexing
  indexingResume: (params) => ipcRenderer.invoke('indexing:resume', params),

  // Cancel indexing
  indexingCancel: (params) => ipcRenderer.invoke('indexing:cancel', params),

  // Get incomplete tasks for crash recovery
  indexingGetIncomplete: () => ipcRenderer.invoke('indexing:getIncomplete'),

  // Discard incomplete task
  indexingDiscardTask: (params) => ipcRenderer.invoke('indexing:discardTask', params),

  // Estimate token cost
  indexingEstimateTokens: (params) => ipcRenderer.invoke('indexing:estimateTokens', params),

  // Listen for file status updates
  onIndexingFileStatus: (callback) => {
    ipcRenderer.on('indexing:fileStatus', (event, data) => callback(data));
  },
  removeIndexingFileStatusListener: () => {
    ipcRenderer.removeAllListeners('indexing:fileStatus');
  },

  // Listen for batch file discovery (all files at once)
  onIndexingFilesDiscovered: (callback) => {
    ipcRenderer.on('indexing:filesDiscovered', (event, data) => callback(data));
  },
  removeIndexingFilesDiscoveredListener: () => {
    ipcRenderer.removeAllListeners('indexing:filesDiscovered');
  },

  // Listen for LLM stream updates
  onIndexingLLMStream: (callback) => {
    ipcRenderer.on('indexing:llmStream', (event, data) => callback(data));
  },
  removeIndexingLLMStreamListener: () => {
    ipcRenderer.removeAllListeners('indexing:llmStream');
  },

  // Listen for phase change updates
  onIndexingPhaseChange: (callback) => {
    ipcRenderer.on('indexing:phaseChange', (event, data) => callback(data));
  },
  removeIndexingPhaseChangeListener: () => {
    ipcRenderer.removeAllListeners('indexing:phaseChange');
  },

  // Listen for token usage updates
  onIndexingTokenUpdate: (callback) => {
    ipcRenderer.on('indexing:tokenUpdate', (event, data) => callback(data));
  },
  removeIndexingTokenUpdateListener: () => {
    ipcRenderer.removeAllListeners('indexing:tokenUpdate');
  },

  // Listen for task completion
  onIndexingTaskComplete: (callback) => {
    ipcRenderer.on('indexing:taskComplete', (event, data) => callback(data));
  },
  removeIndexingTaskCompleteListener: () => {
    ipcRenderer.removeAllListeners('indexing:taskComplete');
  },

  // ============================================
  // Persona API
  // ============================================

  personaGetAll: () => ipcRenderer.invoke('persona:getAll'),
  personaGet: (name) => ipcRenderer.invoke('persona:get', name),
  personaCreate: (params) => ipcRenderer.invoke('persona:create', params),
  personaAnalyzeStyle: (params) => ipcRenderer.invoke('persona:analyzeStyle', params),
  personaDelete: (params) => ipcRenderer.invoke('persona:delete', params),
  personaUpdate: (params) => ipcRenderer.invoke('persona:update', params),

  // ============================================
  // Multi-Persona Conversation API
  // ============================================

  // Start a multi-persona conversation
  // Get available chat modes for multi-persona
  conversationGetChatModes: () => ipcRenderer.invoke('conversation:getChatModes'),

  conversationStart: (params) => ipcRenderer.invoke('conversation:start', params),

  // Get next turn from conversation
  conversationNextTurn: (conversationId) => ipcRenderer.invoke('conversation:nextTurn', conversationId),

  // Send user message/interjection to active conversation
  conversationUserMessage: (conversationId, message) =>
    ipcRenderer.invoke('conversation:userMessage', conversationId, message),

  // Stop an active conversation
  conversationStop: (conversationId) => ipcRenderer.invoke('conversation:stop', conversationId),

  // Get conversation state
  conversationGetState: (conversationId) => ipcRenderer.invoke('conversation:getState', conversationId),

  // ============================================
  // Transcription API
  // ============================================

  transcriptionStart: (filePath) => ipcRenderer.invoke('transcription:start', filePath),
  transcriptionCancel: () => ipcRenderer.invoke('transcription:cancel'),
  transcriptionValidate: () => ipcRenderer.invoke('transcription:validate'),
  transcriptionDownloadModel: (modelName) => ipcRenderer.invoke('transcription:downloadModel', modelName),
  onTranscriptionProgress: (callback) => {
    ipcRenderer.on('transcription:progress', (event, data) => callback(data));
  },
  onTranscriptionComplete: (callback) => {
    ipcRenderer.on('transcription:complete', (event, data) => callback(data));
  },
  onTranscriptionError: (callback) => {
    ipcRenderer.on('transcription:error', (event, data) => callback(data));
  },
  onTranscriptionText: (callback) => {
    ipcRenderer.on('transcription:text', (event, data) => callback(data));
  },
  transcriptionStartFolder: (filePaths) => ipcRenderer.invoke('transcription:startFolder', filePaths),
  onTranscriptionFileStart: (callback) => {
    ipcRenderer.on('transcription:fileStart', (event, data) => callback(data));
  },
  removeTranscriptionListeners: () => {
    ipcRenderer.removeAllListeners('transcription:progress');
    ipcRenderer.removeAllListeners('transcription:complete');
    ipcRenderer.removeAllListeners('transcription:error');
    ipcRenderer.removeAllListeners('transcription:text');
    ipcRenderer.removeAllListeners('transcription:fileStart');
  }
});

// Log that preload script has loaded (for debugging)
console.log('Preload script loaded successfully');
