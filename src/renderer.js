/**
 * AzureWikiEdit - Renderer Process
 */

import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/toastui-editor.css';
import './styles.css';
import splashLogoUrl from './assets/mcs.jpg';
import './styles/mermaid-visual-editor.css';
import { mermaidPlugin, MermaidNodeView, processPendingMermaidDiagrams, updateMermaidTheme } from './plugins/mermaid-plugin.js';
import { gridTablePlugin } from './plugins/grid-table-plugin.js';
import { azureImagePlugin, setAzureImageContext, setLocalFileContext, processPendingAttachments, markContextInitialized } from './plugins/azure-image-plugin.js';
import { tocPlugin, TocNodeView, setupWysiwygTocRendering, normalizeTocSyntax, preprocessToc, postprocessToc } from './plugins/toc-plugin.js';
import { showMermaidPicker } from './components/mermaid-picker.js';
import { showConnectionModal } from './components/azure-connection.js';
import {
  showSidebar,
  showSidebarConnecting,
  hideSidebar,
  toggleSidebar,
  refreshTree,
  addCurrentToFavorites,
  setOnPageSelect,
  setCurrentPagePath,
  highlightPathInTree,
  resetSidebar,
  setupHistoryCallbacks
} from './components/wiki-sidebar.js';
import { showSaveConflictDialog } from './components/save-conflict-dialog.js';
import {
  initAIChatSidebar,
  showAISidebar,
  hideAISidebar,
  toggleAISidebar
} from './components/ai-chat-sidebar.js';
import {
  initTabBar,
  updateTabs,
  scrollToActiveTab
} from './components/tab-bar.js';
import './components/tab-bar.css';
import { initFindReplace, show as showFindReplace } from './components/find-replace.js';
import { initInlineMarkdownInput } from './components/inline-markdown-input.js';
import { showKeyboardShortcutsDialog } from './components/keyboard-shortcuts-dialog.js';
import { exportToHtml } from './htmlExporter.js';
import * as networkStatus from './utils/networkStatus.js';
import { scrollEditorToTop } from './utils/scrollUtils.js';
import { unescapeMarkdown } from './utils/markdownUnescape.js';
import {
  pushPage as navPushPage,
  goBack as navGoBack,
  goForward as navGoForward,
  canGoBack as navCanGoBack,
  canGoForward as navCanGoForward,
  setNavigating as navSetNavigating,
  addListener as navAddListener
} from './navigation/navigationHistory.js';
import {
  showSettingsPanel,
  loadSettings,
  getSettings,
  saveSettings,
  onSettingsChange,
  applySettings
} from './components/settings-panel.js';
import { showImageInsertDialog, showUploadErrorDialog } from './components/image-insert-dialog.js';
import {
  initActivityBar,
  activatePanel,
  hideAllPanels,
  setActivePanel,
  hideCurrentPanel,
  togglePanel,
  PANELS
} from './components/activity-bar.js';
import {
  showBrowser as showFileBrowser,
  hideBrowser as hideFileBrowser,
  setOnFileSelect
} from './components/file-browser/file-browser.js';
import {
  showPanel as showSearchPanel,
  hidePanel as hideSearchPanel,
  setOnFileSelect as setSearchOnFileSelect
} from './components/search-panel/search-panel.js';

// Timestamp when splash was first shown (set on DOMContentLoaded)
let splashShownAt = 0;
// Production build splash duration override
let prodSplashDurationMs = 0;

/**
 * Dismiss the splash screen with a fade-out animation and reveal the app container.
 * Respects splashEnabled and splashDuration settings from localStorage.
 * In production builds, uses a longer splash duration set by main process.
 */
function dismissSplashScreen() {
  const splash = document.getElementById('splash-screen');
  const appContainer = document.getElementById('app-container');
  if (!splash) return;

  // Read splash settings from localStorage (config may not be loaded yet at startup)
  let splashDuration = 0;
  try {
    const stored = localStorage.getItem('app-settings');
    if (stored) {
      const parsed = JSON.parse(stored);
      splashDuration = parsed.splashDuration || 0;
    }
  } catch (_) { /* use default */ }

  // Production build override - use the longer duration
  if (prodSplashDurationMs > 0) {
    splashDuration = Math.max(splashDuration, prodSplashDurationMs);
  }

  const elapsed = Date.now() - splashShownAt;
  const remaining = Math.max(0, splashDuration - elapsed);

  // If a minimum duration is set, wait for the remainder before fading out
  setTimeout(() => {
    // Fade in the app container
    if (appContainer) {
      appContainer.classList.add('app-loaded');
    }

    // Fade out the splash
    splash.classList.add('fade-out');
    splash.addEventListener('transitionend', () => {
      splash.remove();
    }, { once: true });

    // Fallback removal if transitionend doesn't fire (e.g. reduced motion)
    setTimeout(() => {
      if (splash.parentNode) {
        splash.remove();
      }
    }, 1000);
  }, remaining);
}

let editor = null;
let azurePageState = null; // Track current Azure page for saves
let currentTabId = null; // Track current tab ID
let contentUpdateTimer = null; // Debounce timer for content updates
let mermaidDebounceTimer = null; // Debounce timer for mermaid/attachment processing
const CONTENT_UPDATE_DEBOUNCE_MS = 500;

// Upload progress indicator element
let uploadProgressIndicator = null;

/**
 * Convert a Blob to base64 string
 * @param {Blob} blob - The blob to convert
 * @returns {Promise<string>} Base64 data URL
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Show or hide the upload progress indicator
 * @param {boolean} show - Whether to show the indicator
 * @param {string} message - Optional message to display
 */
function showUploadProgress(show, message = 'Uploading image...') {
  if (show) {
    if (!uploadProgressIndicator) {
      uploadProgressIndicator = document.createElement('div');
      uploadProgressIndicator.className = 'upload-progress-indicator';
      uploadProgressIndicator.innerHTML = `
        <div class="upload-spinner"></div>
        <span class="upload-message">${message}</span>
      `;
      document.body.appendChild(uploadProgressIndicator);
    } else {
      uploadProgressIndicator.querySelector('.upload-message').textContent = message;
      uploadProgressIndicator.style.display = 'flex';
    }
  } else {
    if (uploadProgressIndicator) {
      uploadProgressIndicator.style.display = 'none';
    }
  }
}

// Suppress Toast UI Editor internal errors
// Use capture phase to intercept before error overlays can display them
window.addEventListener('error', (event) => {
  if (event.error && event.error.message) {
    // Suppress scroll sync errors with custom node views (Mermaid diagrams)
    if (event.error.message.includes("Cannot read properties of null (reading 'id')") &&
        event.error.stack && event.error.stack.includes('getParentNodeObj')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }
    // Suppress ProseMirror list/paragraph join errors (Toast UI Editor internal issue)
    // Occurs when trying to exit lists at document boundaries
    // e.g. "Cannot join orderedList onto paragraph"
    if (event.error.message.includes('Cannot join') && event.error.message.includes('onto')) {
      console.warn('[Editor] Suppressed ProseMirror join error:', event.error.message);
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }
  }
}, true); // Use capture phase

// Also handle unhandled promise rejections from scroll sync and list errors
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.message) {
    // Suppress scroll sync errors
    if (event.reason.message.includes("Cannot read properties of null (reading 'id')")) {
      event.preventDefault();
      return true;
    }
    // Suppress ProseMirror list/paragraph join errors
    if (event.reason.message.includes('Cannot join') && event.reason.message.includes('onto')) {
      console.warn('[Editor] Suppressed ProseMirror join error:', event.reason.message);
      event.preventDefault();
      return true;
    }
  }
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('AzureWikiEdit: Initializing...');

  // Handle splash screen based on settings
  splashShownAt = Date.now();
  let splashEnabled = true;
  try {
    const stored = localStorage.getItem('app-settings');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.splashEnabled === false) splashEnabled = false;
    }
  } catch (_) { /* use default */ }

  const splashEl = document.getElementById('splash-screen');
  const appContainerEl = document.getElementById('app-container');
  if (!splashEnabled) {
    // Skip splash entirely
    if (splashEl) splashEl.remove();
    if (appContainerEl) {
      appContainerEl.style.opacity = '1';
    }
  } else {
    // Set splash logo from webpack-resolved asset
    const splashLogo = document.getElementById('splash-logo');
    if (splashLogo) {
      splashLogo.src = splashLogoUrl;
    }
  }

  // Listen for app config from main process (includes production mode splash duration)
  if (window.electronAPI?.onAppConfig) {
    window.electronAPI.onAppConfig((config) => {
      console.log('[Renderer] App config received:', config.isProdBuild ? 'PRODUCTION' : 'DEVELOPMENT');
      if (config.splashDurationMs > 0) {
        prodSplashDurationMs = config.splashDurationMs;
      }
    });
  }

  try {
    editor = new Editor({
      el: document.querySelector('#editor'),
      height: '100%',
      initialEditType: 'wysiwyg',
      previewStyle: 'vertical',
      usageStatistics: false,
      plugins: [mermaidPlugin, gridTablePlugin, azureImagePlugin, tocPlugin,
        // Combined codeBlock NodeView factory - must be last to handle both mermaid and toc
        () => ({
          wysiwygNodeViews: {
            codeBlock: (node, view, getPos) => {
              const language = (node.attrs.language || '').toLowerCase();
              if (language === 'toc') {
                return new TocNodeView(node, view, getPos);
              }
              if (language === 'mermaid') {
                return new MermaidNodeView(node, view, getPos);
              }
              return null;
            }
          }
        })],
      customMarkdownRenderer: {
        bulletList(nodeInfo, context) {
          const result = context.origin();
          result.delim = '-';
          return result;
        },
        thematicBreak(nodeInfo, context) {
          const result = context.origin();
          result.delim = '---';
          return result;
        },
        emph(nodeInfo, context) {
          const result = context.origin();
          result.delim = '_';
          return result;
        },
      },
      toolbarItems: [
        // Primary actions - far left
        [{
          name: 'azureConnect',
          tooltip: 'Connect to Azure Wiki',
          className: 'toastui-editor-toolbar-icons azure-connect-icon',
          text: '☁',
          command: 'azureConnect'
        },
        {
          name: 'aiCopilot',
          tooltip: 'AI Copilot',
          className: 'toastui-editor-toolbar-icons ai-copilot-icon',
          text: '✨',
          command: 'openAICopilot'
        }],
        ['heading', 'bold', 'italic', 'strike'],
        ['hr', 'quote'],
        ['ul', 'ol', 'task', 'indent', 'outdent'],
        ['table', 'image', 'link'],
        ['code', 'codeblock'],
        // Custom diagram button
        [{
          name: 'mermaid',
          tooltip: 'Insert Mermaid Diagram',
          className: 'toastui-editor-toolbar-icons mermaid-toolbar-icon',
          text: '⬡',
          command: 'insertMermaid'
        },
        {
          name: 'previewToggle',
          tooltip: 'Toggle Preview Pane',
          className: 'toastui-editor-toolbar-icons preview-toggle-icon',
          text: '📖',
          command: 'togglePreview'
        }]
      ],
      initialValue: '',
      hooks: {
        // Handle image paste/drop - show dialog for user choice
        addImageBlobHook: async (blob, callback) => {
          try {
            // Get current settings
            const settings = getSettings();
            const isAzureConnected = await window.electronAPI.isAttachmentUploadAvailable();

            // Determine action based on settings
            let action = settings.imageInsertMode || 'ask';

            // If set to upload but not connected, show dialog
            if (action === 'upload' && !isAzureConnected) {
              console.log('[Image] Upload preferred but not connected, showing dialog');
              action = 'ask';
            }

            // Show dialog if needed
            if (action === 'ask') {
              const result = await showImageInsertDialog(blob, isAzureConnected);

              if (result.action === 'cancel') {
                console.log('[Image] User cancelled image insert');
                return; // Don't insert anything
              }

              action = result.action;

              // Remember the choice if requested
              if (result.remember) {
                console.log('[Image] Remembering choice:', action);
                saveSettings({ imageInsertMode: action });
              }
            }

            // Execute the chosen action
            if (action === 'upload' && isAzureConnected) {
              // Upload to Azure
              showUploadProgress(true);

              const dataUrl = await blobToBase64(blob);
              const base64Data = dataUrl.split(',')[1];

              const result = await window.electronAPI.uploadAttachment({
                filename: blob.name || `image-${Date.now()}.png`,
                data: base64Data,
                mimeType: blob.type || 'image/png'
              });

              showUploadProgress(false);

              if (result.success) {
                console.log('[Image Upload] Success:', result.path);
                callback(result.path, blob.name || 'image');
                showToast('Image uploaded to Azure', 'success');
              } else {
                // Upload failed - show error dialog with option to embed or cancel
                console.error('[Image Upload] Failed:', result.error);
                const errorResult = await showUploadErrorDialog(result.error, blob);
                if (errorResult.action === 'embed') {
                  console.log('[Image] User chose to embed as base64 after upload failure');
                  callback(dataUrl, blob.name || 'image');
                } else {
                  console.log('[Image] User cancelled after upload failure');
                  // Don't insert anything
                }
              }
            } else {
              // Embed as base64
              console.log('[Image] Embedding as base64');
              const dataUrl = await blobToBase64(blob);
              callback(dataUrl, blob.name || 'image');
            }
          } catch (error) {
            showUploadProgress(false);
            console.error('[Image Upload] Error:', error);
            // Show error dialog for exceptions too
            const errorResult = await showUploadErrorDialog(error.message, blob);
            if (errorResult.action === 'embed') {
              console.log('[Image] User chose to embed as base64 after error');
              const dataUrl = await blobToBase64(blob);
              callback(dataUrl, blob.name || 'image');
            } else {
              console.log('[Image] User cancelled after error');
              // Don't insert anything
            }
          }
        }
      }
    });

    console.log('AzureWikiEdit: Editor initialized successfully!');

    // Set up WYSIWYG TOC placeholder rendering
    setupWysiwygTocRendering(editor);

    // Fix over-escaping: Toast UI's common_escape() adds unnecessary backslashes
    // before . , - ( ) | _ [ ] + { } > ! # during WYSIWYG→Markdown conversion.
    // This hook cleans them up while preserving syntax-significant escapes.
    editor.on('beforeConvertWysiwygToMarkdown', unescapeMarkdown);

    // Wrap setMarkdown to normalize [[*TOC*]] → [[_TOC_]] and preprocess to ```toc block
    const originalSetMarkdown = editor.setMarkdown.bind(editor);
    editor.setMarkdown = (markdown, ...args) => {
      let processed = normalizeTocSyntax(markdown);
      // Always clean any ```toc blocks first to ensure [[_TOC_]] form
      processed = postprocessToc(processed);
      if (!editor.isMarkdownMode()) {
        // In WYSIWYG mode: convert [[_TOC_]] to ```toc code block for rendering
        processed = preprocessToc(processed);
      }
      return originalSetMarkdown(processed, ...args);
    };

    // Wrap getMarkdown to convert ```toc block back to [[_TOC_]] on output
    const originalGetMarkdown = editor.getMarkdown.bind(editor);
    // isSwitchingMode: bypass getMarkdown postprocessing so Toast UI's internal
    // changeMode reads raw ```toc blocks for proper ProseMirror code block parsing
    let isSwitchingMode = false;
    editor.getMarkdown = (...args) => {
      const raw = originalGetMarkdown(...args);
      if (isSwitchingMode) return raw;
      return postprocessToc(normalizeTocSyntax(raw));
    };

    // Wrap changeMode to postprocess TOC when switching to markdown.
    // WYSIWYG TOC rendering is handled by ProseMirror transformation in
    // setupWysiwygTocRendering (toc-plugin.js) via the changeMode event.
    const originalChangeMode = editor.changeMode.bind(editor);
    editor.changeMode = (mode, ...args) => {
      isSwitchingMode = true;
      try {
        const result = originalChangeMode(mode, ...args);
        if (mode === 'markdown') {
          // Defer postprocessing to let Toast UI settle after mode switch
          setTimeout(() => {
            const md = originalGetMarkdown();
            const postprocessed = postprocessToc(md);
            if (postprocessed !== md) {
              // Pass cursorToEnd=false to prevent scroll-to-bottom
              originalSetMarkdown(postprocessed, false);
            }
            isSwitchingMode = false;
          }, 50);
        } else {
          isSwitchingMode = false;
        }
        return result;
      } catch (e) {
        isSwitchingMode = false;
        throw e;
      }
    };

    // Safety net: catch any ```toc blocks that leak into markdown mode
    // This handles edge cases where isMarkdownMode() might return wrong during
    // async operations (e.g., AI sidebar interactions, dialog focus changes).
    // Suppressed during mode switches to avoid undoing intentional preprocessing.
    let isCleaningToc = false;
    editor.on('change', () => {
      if (editor.isMarkdownMode() && !isCleaningToc && !isSwitchingMode) {
        const md = originalGetMarkdown();
        if (md && md.includes('```toc')) {
          isCleaningToc = true;
          try {
            originalSetMarkdown(postprocessToc(md), false);
          } finally {
            isCleaningToc = false;
          }
        }
      }
    });

    // Store editor reference on DOM for plugins to access
    const editorEl = document.querySelector('#editor');
    if (editorEl) {
      editorEl.__editor = editor;
    }

    // Register custom mermaid insert command - opens template picker
    const insertMermaidTemplate = (template) => {
      // Switch to markdown mode, insert, then switch back
      const wasWysiwyg = !editor.isMarkdownMode();

      try {
        if (wasWysiwyg) {
          editor.changeMode('markdown');
        }

        // Check if document is empty or cursor is at the very beginning
        const currentContent = editor.getMarkdown().trim();
        const isEmptyOrStart = !currentContent || currentContent.length === 0;

        // Build the code block with proper spacing
        // For empty documents, we need actual paragraph content before and after
        // the code block so the cursor can be positioned in WYSIWYG mode
        let code;
        if (isEmptyOrStart) {
          // For empty documents, set the entire content with paragraphs around the code block
          // Use actual characters that won't be stripped to ensure paragraph nodes exist
          // The \u00A0 (non-breaking space) ensures the paragraph isn't collapsed
          code = `\u00A0\n\n\`\`\`mermaid\n${template.code}\n\`\`\`\n\n\u00A0\n`;
          editor.setMarkdown(code);
        } else {
          // Use setMarkdown instead of insertText to avoid cursor position issues
          // after mode switching - insertText relies on cursor which may be corrupted
          const mermaidBlock = `\`\`\`mermaid\n${template.code}\n\`\`\``;
          code = currentContent + '\n\n' + mermaidBlock + '\n\n';
          editor.setMarkdown(code);
        }

        if (wasWysiwyg) {
          try {
            editor.changeMode('wysiwyg');
            setTimeout(() => {
              processMermaidDiagrams();
            }, 300);
          } catch (modeError) {
            // Mode switch failed - stay in markdown mode
            console.warn('Could not switch back to WYSIWYG mode:', modeError.message);
            showToast('Diagram inserted. Staying in markdown mode for editing.', 'info');
          }
        }
      } catch (error) {
        console.error('Error inserting mermaid diagram:', error);
        showToast('Error inserting diagram. Try markdown mode.', 'error');
      }
    };

    editor.addCommand('markdown', 'insertMermaid', () => {
      showMermaidPicker(insertMermaidTemplate);
      return true;
    });

    editor.addCommand('wysiwyg', 'insertMermaid', () => {
      showMermaidPicker(insertMermaidTemplate);
      return true;
    });

    // Register Azure Connect/Disconnect toggle command
    editor.addCommand('markdown', 'azureConnect', () => {
      toggleAzureConnection();
      return true;
    });

    editor.addCommand('wysiwyg', 'azureConnect', () => {
      toggleAzureConnection();
      return true;
    });

    // Register AI Copilot command
    editor.addCommand('markdown', 'openAICopilot', () => {
      toggleAISidebar();
      return true;
    });

    editor.addCommand('wysiwyg', 'openAICopilot', () => {
      toggleAISidebar();
      return true;
    });

    // Register Preview Toggle command
    function updatePreviewToggleButton(style) {
      const btn = document.querySelector('.preview-toggle-icon');
      if (btn) {
        btn.classList.toggle('preview-active', style === 'vertical');
      }
    }

    editor.addCommand('markdown', 'togglePreview', () => {
      const current = editor.getCurrentPreviewStyle();
      const next = current === 'vertical' ? 'tab' : 'vertical';
      editor.changePreviewStyle(next);
      updatePreviewToggleButton(next);
      return true;
    });

    editor.addCommand('wysiwyg', 'togglePreview', () => {
      // No-op in WYSIWYG mode
      return true;
    });

    // --- Critical path: must run for editor to be interactive ---
    setupIPCListeners();
    setupKeyboardShortcuts();
    initTabBar({
      onSwitch: handleTabSwitch,
      onBack: navigateBack,
      onForward: navigateForward
    });
    processMermaidDiagrams();
    processPendingAttachments(document.querySelector('#editor'));

    // Unified editor change handler — replaces 3 separate listeners
    // (mermaid/attachment, content change tracking, link handler re-attachment)
    let linkHandlerTimer = null;
    editor.on('change', () => {
      // Mermaid/attachment processing (debounced 300ms)
      if (mermaidDebounceTimer) clearTimeout(mermaidDebounceTimer);
      mermaidDebounceTimer = setTimeout(() => {
        processMermaidDiagrams();
        processPendingAttachments(document.querySelector('#editor'));
      }, 300);

      // Content change tracking (debounced 500ms internally)
      handleContentChange();

      // Link handler re-attachment (debounced 500ms)
      if (linkHandlerTimer) clearTimeout(linkHandlerTimer);
      linkHandlerTimer = setTimeout(() => attachLinkHandlersToEditor(), 500);
    });

    // Activity bar must be immediate (wiki/file/search panel buttons)
    initActivityBar({
      onPanelChange: (panelId, isVisible) => {
        console.log(`[Activity Bar] Panel ${panelId} visibility: ${isVisible}`);
      },
      panelHandlers: {
        [PANELS.WIKI]: {
          show: async () => {
            const status = await window.electronAPI.azureGetConnectionStatus();
            if (status.connected) {
              showSidebar();
            } else {
              await quickConnectToWiki();
            }
          },
          hide: () => hideSidebar()
        },
        [PANELS.FILES]: {
          show: () => showFileBrowser(),
          hide: () => hideFileBrowser()
        },
        [PANELS.SEARCH]: {
          show: () => showSearchPanel(),
          hide: () => hideSearchPanel()
        }
      }
    });

    // Auto-open file browser if a folder was previously opened
    if (localStorage.getItem('file-browser-last-folder')) {
      activatePanel(PANELS.FILES);
    }

    // --- Deferred batch 1: editor helpers (non-critical input handlers) ---
    setTimeout(() => {
      setupHorizontalRuleHandler();
      setupTableNavigation();
      setupTableToolbar();
      setupBlockInsertHandlers();
      setupCodeBlockEscape();
      setupTaskListEscape();
      setupModeSwitchGuard();
      setupZoom();
      setupMarkdownPasteHandler();
      setupLinkHandlers();
    }, 100);

    // --- Deferred batch 2: secondary features ---
    setTimeout(() => {
      initFindReplace(editor);
      initInlineMarkdownInput(editor);
      initNetworkStatus();
      initSettings();
      initAzureImageContext();
      updateAICopilotButtonState();
    }, 200);

    // --- Deferred batch 3: sidebars & file browser callbacks ---
    setTimeout(() => {
      initAIChatSidebar({
        getEditorContent: () => editor.getMarkdown(),
        setEditorContent: (content) => {
          editor.setMarkdown(content);
          if (window.electronAPI?.notifyContentChanged) {
            window.electronAPI.notifyContentChanged();
          }
          setTimeout(() => processMermaidDiagrams(), 300);
        },
        getCurrentPagePath: () => azurePageState?.pagePath || ''
      });

      setOnFileSelect(async (fileData) => {
        console.log('[File Browser] Opening file:', fileData.path);

        if (fileData.isPdf) {
          // Create a PDF tab (no content in editor)
          // handleTabSwitch will call showPdfViewer via tabs:switched event
          await window.electronAPI.tabsCreate({
            title: fileData.name,
            content: '',
            filePath: fileData.path,
            metadata: { isPdf: true }
          });
          return;
        }

        const tab = await window.electronAPI.tabsCreate({
          title: fileData.name,
          content: fileData.content,
          filePath: fileData.path
        });
        if (tab && tab.id) {
          await window.electronAPI.tabsSwitch(tab.id);
        }
        if (editor) {
          editor.setMarkdown(fileData.content);
          setTimeout(() => processMermaidDiagrams(), 300);
        }
      });

      setSearchOnFileSelect(async (fileData) => {
        console.log('[Search Panel] Opening file:', fileData.path, 'line:', fileData.line);
        const tab = await window.electronAPI.tabsCreate({
          title: fileData.name,
          content: fileData.content,
          filePath: fileData.path
        });
        if (tab && tab.id) {
          await window.electronAPI.tabsSwitch(tab.id);
        }
        if (editor) {
          editor.setMarkdown(fileData.content);
          setTimeout(() => processMermaidDiagrams(), 300);
        }
      });

      // Dismiss splash screen after batch 3 completes
      dismissSplashScreen();
    }, 300);

  } catch (error) {
    console.error('AzureWikiEdit: Failed to initialize editor:', error);
    // Ensure splash is removed even on error
    dismissSplashScreen();
    document.body.innerHTML = `<div style="padding: 20px; color: red;">
      <h2>Editor failed to load</h2>
      <pre>${error.message}</pre>
    </div>`;
  }
});

// Set up Tab key navigation for tables
function setupTableNavigation() {
  editor.on('keydown', (editorType, ev) => {
    // Only handle Tab in WYSIWYG mode
    if (ev.key !== 'Tab' || editorType !== 'wysiwyg') {
      return;
    }

    // Get the WYSIWYG editor element
    const wwEditor = editor.getEditorElements().wwEditor;
    if (!wwEditor) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    // Walk up DOM to find if we're in a table cell
    let node = sel.anchorNode;
    let tableCell = null;

    while (node && node !== wwEditor) {
      if (node.nodeName === 'TD' || node.nodeName === 'TH') {
        tableCell = node;
        break;
      }
      node = node.parentNode;
    }

    // If not in a table cell, let default Tab behavior happen
    if (!tableCell) return;

    // Prevent default Tab behavior
    ev.preventDefault();

    const row = tableCell.parentNode;
    const table = row.closest('table');
    if (!table) return;

    const cells = Array.from(row.cells);
    const cellIndex = cells.indexOf(tableCell);
    const rows = Array.from(table.rows);
    const rowIndex = rows.indexOf(row);
    const isLastCellInRow = cellIndex === cells.length - 1;
    const isLastRow = rowIndex === rows.length - 1;

    if (ev.shiftKey) {
      // Shift+Tab: Move backwards
      if (cellIndex > 0) {
        // Move to previous cell in same row
        focusCell(cells[cellIndex - 1]);
      } else if (rowIndex > 0) {
        // Move to last cell of previous row
        const prevRow = rows[rowIndex - 1];
        focusCell(prevRow.cells[prevRow.cells.length - 1]);
      }
    } else {
      // Tab: Move forward
      if (!isLastCellInRow) {
        // Move to next cell in same row
        focusCell(cells[cellIndex + 1]);
      } else if (!isLastRow) {
        // Move to first cell of next row
        const nextRow = rows[rowIndex + 1];
        focusCell(nextRow.cells[0]);
      } else {
        // Last cell of last row: Add new row
        editor.exec('addRowToDown');
        // Focus will be set by the editor after row is added
        setTimeout(() => {
          const newRows = Array.from(table.rows);
          const newLastRow = newRows[newRows.length - 1];
          if (newLastRow && newLastRow.cells[0]) {
            focusCell(newLastRow.cells[0]);
          }
        }, 10);
      }
    }
  });
}

// Helper to focus a table cell and place cursor at end
function focusCell(cell) {
  if (!cell) return;

  const range = document.createRange();
  const sel = window.getSelection();

  // Place cursor at end of cell content
  if (cell.lastChild) {
    if (cell.lastChild.nodeType === Node.TEXT_NODE) {
      range.setStart(cell.lastChild, cell.lastChild.length);
    } else {
      range.selectNodeContents(cell.lastChild);
      range.collapse(false);
    }
  } else {
    range.selectNodeContents(cell);
    range.collapse(false);
  }

  sel.removeAllRanges();
  sel.addRange(range);
  cell.focus();
}

// Check if cursor is inside a table and return table info
function getTableContext() {
  const wwEditor = editor.getEditorElements().wwEditor;
  if (!wwEditor) return null;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  let node = sel.anchorNode;
  let tableCell = null;

  while (node && node !== wwEditor) {
    if (node.nodeName === 'TD' || node.nodeName === 'TH') {
      tableCell = node;
      break;
    }
    node = node.parentNode;
  }

  if (!tableCell) return null;

  const row = tableCell.parentNode;
  const table = row.closest('table');
  if (!table) return null;

  return { table, row, cell: tableCell };
}

// Set up contextual table toolbar
function setupTableToolbar() {
  const toolbar = document.getElementById('table-toolbar');
  if (!toolbar) return;

  // Wire up "Insert Before" button
  document.getElementById('btn-insert-before')?.addEventListener('click', () => {
    const ctx = getTableContext();
    if (ctx && ctx.table) {
      insertParagraphBeforeElement(ctx.table);
    }
  });

  // Wire up button click handlers
  document.getElementById('btn-add-row-above').addEventListener('click', () => {
    if (getTableContext()) {
      editor.exec('addRowToUp');
    }
  });

  document.getElementById('btn-add-row-below').addEventListener('click', () => {
    if (getTableContext()) {
      editor.exec('addRowToDown');
    }
  });

  document.getElementById('btn-delete-row').addEventListener('click', () => {
    if (getTableContext()) {
      editor.exec('removeRow');
    }
  });

  document.getElementById('btn-add-col-left').addEventListener('click', () => {
    if (getTableContext()) {
      editor.exec('addColumnToLeft');
    }
  });

  document.getElementById('btn-add-col-right').addEventListener('click', () => {
    if (getTableContext()) {
      editor.exec('addColumnToRight');
    }
  });

  document.getElementById('btn-delete-col').addEventListener('click', () => {
    if (getTableContext()) {
      editor.exec('removeColumn');
    }
  });

  document.getElementById('btn-delete-table').addEventListener('click', () => {
    const ctx = getTableContext();
    if (ctx) {
      editor.exec('removeTable');
      hideTableToolbar();
    }
  });

  // Listen for selection changes in WYSIWYG mode
  const wwEditor = editor.getEditorElements().wwEditor;
  if (wwEditor) {
    // Debounced table context check to avoid DOM walks on every keystroke
    let tableContextTimer = null;
    const debouncedCheckTableContext = () => {
      if (tableContextTimer) clearTimeout(tableContextTimer);
      tableContextTimer = setTimeout(checkTableContext, 150);
    };
    wwEditor.addEventListener('mouseup', debouncedCheckTableContext);
    wwEditor.addEventListener('keyup', debouncedCheckTableContext);

    // Also listen for clicks outside the editor to hide toolbar
    document.addEventListener('mousedown', (ev) => {
      if (!toolbar.contains(ev.target) && !wwEditor.contains(ev.target)) {
        hideTableToolbar();
      }
    });
  }

  // Also listen for editor mode changes
  editor.on('changeMode', (mode) => {
    if (mode === 'markdown') {
      hideTableToolbar();
    }
  });
}

function checkTableContext() {
  const ctx = getTableContext();
  if (ctx) {
    showTableToolbar();
  } else {
    hideTableToolbar();
  }
}

function showTableToolbar() {
  const toolbar = document.getElementById('table-toolbar');
  if (toolbar) {
    toolbar.classList.remove('hidden');
  }
}

function hideTableToolbar() {
  const toolbar = document.getElementById('table-toolbar');
  if (toolbar) {
    toolbar.classList.add('hidden');
  }
}

// Set up handlers for inserting content before block elements at top of document
function setupBlockInsertHandlers() {
  const wwEditor = editor.getEditorElements().wwEditor;
  if (!wwEditor) return;

  wwEditor.addEventListener('keydown', (e) => {
    // Handle Up arrow at start of document
    if (e.key === 'ArrowUp') {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      // Check if at very start of editor
      if (isAtDocumentStart(range, wwEditor)) {
        const proseMirror = wwEditor.querySelector('.ProseMirror');
        const firstChild = proseMirror?.firstElementChild;
        // If first element is a table or mermaid wrapper, insert paragraph before
        if (firstChild && (firstChild.tagName === 'TABLE' ||
            firstChild.classList?.contains('mermaid-wysiwyg-wrapper') ||
            firstChild.tagName === 'PRE')) {
          e.preventDefault();
          insertParagraphAtStart();
        }
      }
    }
  });
}

function isAtDocumentStart(range, container) {
  // Check if cursor is at the very beginning
  if (range.startOffset !== 0) return false;
  let node = range.startContainer;
  while (node && node !== container) {
    if (node.previousSibling) return false;
    node = node.parentNode;
  }
  return true;
}

function insertParagraphAtStart() {
  // Get current markdown, prepend newline, set back
  const markdown = editor.getMarkdown();
  editor.setMarkdown('\n' + markdown);
  // Move cursor to start
  editor.moveCursorToStart();
}

function insertParagraphBeforeElement(element) {
  // Create and insert a paragraph before the element
  const p = document.createElement('p');
  p.innerHTML = '<br>';
  element.parentNode.insertBefore(p, element);
  // Move cursor to the new paragraph
  const range = document.createRange();
  range.setStart(p, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Setup handler for horizontal rule to position cursor below after insertion
 */
function setupHorizontalRuleHandler() {
  if (!editor) return;

  // Listen for the hr command execution and move cursor after
  editor.on('command', (commandName) => {
    if (commandName === 'hr') {
      // After hr is inserted, move cursor to paragraph below
      setTimeout(() => {
        try {
          const pmView = editor.wwEditor?.view;
          if (!pmView) return;

          const { state } = pmView;
          const { $from } = state.selection;
          const currentPos = $from.pos;

          // The HR is inserted at or after the current cursor position
          // Find the first HR at or after the cursor
          let hrPos = null;
          let hrNode = null;

          state.doc.descendants((node, pos) => {
            if (node.type.name === 'thematicBreak' || node.type.name === 'horizontalRule') {
              // Find the first HR at or after cursor position (the one just inserted)
              if (hrPos === null && pos >= currentPos - 5) {
                hrPos = pos;
                hrNode = node;
                return false; // Stop searching
              }
            }
          });

          // If not found after cursor, find the closest HR before cursor
          if (hrPos === null) {
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'thematicBreak' || node.type.name === 'horizontalRule') {
                hrPos = pos;
                hrNode = node;
              }
            });
          }

          if (hrPos !== null && hrNode) {
            const afterHr = hrPos + hrNode.nodeSize;
            const paragraphType = getParagraphNodeType(state.schema);
            const TextSelection = getTextSelectionClass(state);

            if (paragraphType && TextSelection) {
              const tr = state.tr;

              // Check if there's content after the HR
              if (afterHr >= state.doc.content.size) {
                // Insert a new paragraph after the HR
                tr.insert(afterHr, paragraphType.create());
                tr.setSelection(TextSelection.create(tr.doc, afterHr + 1));
              } else {
                // Move to the start of the next block after the HR
                const $afterHr = tr.doc.resolve(afterHr);
                const nextPos = afterHr + ($afterHr.nodeAfter ? 1 : 0);
                tr.setSelection(TextSelection.create(tr.doc, Math.min(nextPos, tr.doc.content.size)));
              }

              pmView.dispatch(tr);
            }
          }
        } catch (err) {
          console.warn('HR cursor positioning error:', err.message);
        }
      }, 50);
    }
  });
}

/**
 * Get the paragraph node type from ProseMirror schema
 * Toast UI Editor may use 'paragraph' or other names
 */
function getParagraphNodeType(schema) {
  if (!schema || !schema.nodes) return null;

  // Try common paragraph node type names
  const nodeType = schema.nodes.paragraph || schema.nodes.para || schema.nodes.p;

  // Ensure we have a valid node type with create method
  if (!nodeType || typeof nodeType.create !== 'function') {
    return null;
  }

  return nodeType;
}

/**
 * Get TextSelection class from ProseMirror state
 * This is tricky because we don't have direct module access
 */
function getTextSelectionClass(state) {
  // Try to access TextSelection from prosemirror-state via state's prototype chain
  try {
    // The Selection class hierarchy is available on the state's selection
    // TextSelection should be accessible through the module that defines Selection
    const selectionProto = Object.getPrototypeOf(state.selection);
    if (selectionProto && selectionProto.constructor && selectionProto.constructor.create) {
      return selectionProto.constructor;
    }
  } catch (e) {
    // Fall through
  }
  return null;
}

/**
 * Setup keyboard handlers to escape from code blocks
 * - Enter twice at end: exit and create paragraph below
 * - ArrowUp at start: move to paragraph above or create one
 * - ArrowDown at end: move to paragraph below or create one
 */
function setupCodeBlockEscape() {
  const wwEditor = editor.getEditorElements().wwEditor;
  if (!wwEditor) return;

  let lastEnterTime = 0;

  wwEditor.addEventListener('keydown', (e) => {
    try {
      // Get ProseMirror view
      const pmView = editor.wwEditor?.view;
      if (!pmView) return;

      const { state } = pmView;
      const { selection } = state;
      const { $from } = selection;

      // Check if we're in a code block
      const codeBlock = $from.parent;
      if (codeBlock.type.name !== 'codeBlock') return;

      const isAtStart = $from.parentOffset === 0;
      const isAtEnd = $from.parentOffset === codeBlock.content.size;

      // Get paragraph node type and TextSelection class
      const paragraphType = getParagraphNodeType(state.schema);
      const TextSelection = getTextSelectionClass(state);
      if (!paragraphType || !TextSelection) return;

      // Handle double-Enter to exit at end
      if (e.key === 'Enter' && isAtEnd) {
        const now = Date.now();
        if (now - lastEnterTime < 500) {
          e.preventDefault();
          const pos = $from.after();
          const tr = state.tr.insert(pos, paragraphType.create());
          tr.setSelection(TextSelection.create(tr.doc, pos + 1));
          pmView.dispatch(tr);
          lastEnterTime = 0;
          return;
        }
        lastEnterTime = now;
      }

      // Handle ArrowUp at start - move above code block
      if (e.key === 'ArrowUp' && isAtStart) {
        e.preventDefault();
        const posBefore = $from.before();
        if (posBefore > 0) {
          const tr = state.tr.setSelection(TextSelection.create(state.doc, posBefore - 1));
          pmView.dispatch(tr);
        } else {
          const tr = state.tr.insert(0, paragraphType.create());
          tr.setSelection(TextSelection.create(tr.doc, 1));
          pmView.dispatch(tr);
        }
      }

      // Handle ArrowDown at end - move below code block
      if (e.key === 'ArrowDown' && isAtEnd) {
        e.preventDefault();
        const posAfter = $from.after();
        if (posAfter < state.doc.content.size) {
          const tr = state.tr.setSelection(TextSelection.create(state.doc, posAfter + 1));
          pmView.dispatch(tr);
        } else {
          const tr = state.tr.insert(posAfter, paragraphType.create());
          tr.setSelection(TextSelection.create(tr.doc, posAfter + 1));
          pmView.dispatch(tr);
        }
      }
    } catch (err) {
      // Silently fail - let default keyboard behavior happen
      console.warn('Code block escape handler error:', err.message);
    }
  });
}

/**
 * Setup keyboard handler to insert content above/below block elements at document boundaries
 * Handles ArrowUp at document start and ArrowDown at document end for lists and blockquotes
 */
function setupTaskListEscape() {
  const wwEditor = editor.getEditorElements().wwEditor;
  if (!wwEditor) return;

  wwEditor.addEventListener('keydown', (e) => {
    // Only handle ArrowUp and ArrowDown
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

    try {
      const pmView = editor.wwEditor?.view;
      if (!pmView) return;

      const { state } = pmView;
      const { $from } = state.selection;

      // Try to find a block element (list or blockquote) we're inside
      let blockInfo = null;

      // Check for lists
      let listItem = null;
      let list = null;
      let blockquote = null;
      let depth = $from.depth;

      while (depth > 0) {
        const node = $from.node(depth);
        const typeName = node.type.name;

        if (typeName === 'listItem' || typeName === 'taskListItem') {
          listItem = { node, depth };
        }
        if (typeName === 'bulletList' || typeName === 'orderedList' || typeName === 'taskList') {
          list = { node, depth };
          break;
        }
        if (typeName === 'blockquote' || typeName === 'blockQuote') {
          blockquote = { node, depth };
          break;
        }
        depth--;
      }

      // Handle list navigation
      if (list && listItem) {
        const isFirstItem = $from.index(list.depth) === 0;
        const itemStart = $from.start(listItem.depth);
        const isAtItemStart = $from.pos === itemStart;

        if (e.key === 'ArrowUp' && isFirstItem && isAtItemStart) {
          const listPos = $from.before(list.depth);
          if (listPos <= 1) {
            blockInfo = { pos: listPos, type: 'list', direction: 'up' };
          }
        }
      }

      // Handle blockquote navigation
      if (blockquote) {
        const quoteStart = $from.start(blockquote.depth);
        const quoteEnd = $from.end(blockquote.depth);
        const isAtStart = $from.pos <= quoteStart + 1; // Allow some tolerance
        const isAtEnd = $from.pos >= quoteEnd - 1;

        console.log('Blockquote nav:', {
          key: e.key,
          pos: $from.pos,
          quoteStart,
          quoteEnd,
          isAtStart,
          isAtEnd,
          quotePos: $from.before(blockquote.depth)
        });

        if (e.key === 'ArrowUp' && isAtStart) {
          const quotePos = $from.before(blockquote.depth);
          // If blockquote is at or near document start
          if (quotePos <= 1) {
            blockInfo = { pos: quotePos, type: 'blockquote', direction: 'up' };
          }
        }

        if (e.key === 'ArrowDown' && isAtEnd) {
          const quoteAfter = $from.after(blockquote.depth);
          if (quoteAfter >= state.doc.content.size - 1) {
            blockInfo = { pos: quoteAfter, type: 'blockquote', direction: 'down' };
          }
        }
      }

      if (!blockInfo) return;

      // Insert paragraph
      e.preventDefault();
      const paragraphType = getParagraphNodeType(state.schema);
      if (!paragraphType) return;

      const TextSelection = getTextSelectionClass(state);
      let tr;

      if (blockInfo.direction === 'up') {
        tr = state.tr.insert(0, paragraphType.create());
        if (TextSelection) {
          tr.setSelection(TextSelection.create(tr.doc, 1));
        }
      } else {
        const insertPos = state.doc.content.size;
        tr = state.tr.insert(insertPos, paragraphType.create());
        if (TextSelection) {
          tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
        }
      }

      pmView.dispatch(tr);
    } catch (err) {
      console.warn('Block navigation handler error:', err.message);
    }
  });
}

/**
 * Guard against mode switch errors
 * Overrides changeMode to handle ProseMirror position mapping errors
 */
function setupModeSwitchGuard() {
  if (!editor) return;

  // Toast UI internally binds: this.on('needChangeMode', this.changeMode.bind(this))
  // during addInitEvent(). That captured reference points to the prototype method,
  // bypassing any instance-level overrides (our TOC wrapper & scroll guard).
  // Fix: replace the listener so clicks on the mode switch tab route through
  // our full wrapper chain (TOC postprocessing + scroll restore + error handling).
  editor.off('needChangeMode');
  editor.on('needChangeMode', (mode) => {
    editor.changeMode(mode);
  });

  // Store the original changeMode method (which is already the TOC wrapper from init)
  const originalChangeMode = editor.changeMode.bind(editor);

  // Override with error-handling wrapper; scrolls to top after switch for consistency
  editor.changeMode = function(mode, withoutFocus) {
    const currentMarkdown = editor.getMarkdown();

    // If switching to wysiwyg with empty/whitespace-only content, ensure valid structure
    if (mode === 'wysiwyg' && (!currentMarkdown || currentMarkdown.trim() === '')) {
      editor.setMarkdown('\n');
    }

    try {
      // Pass withoutFocus=true to prevent Toast UI's internal cursor-to-end behavior
      const result = originalChangeMode(mode, true);
      scrollEditorToTop(editor, { delay: 150 });
      return result;
    } catch (err) {
      if (err.message && err.message.includes('out of range')) {
        console.warn('Mode switch error caught, attempting recovery:', err.message);

        try {
          const md = editor.getMarkdown();
          editor.setMarkdown(md.trim() + '\n\n');

          const retryResult = originalChangeMode(mode, true);
          scrollEditorToTop(editor, { delay: 150 });
          return retryResult;
        } catch (retryErr) {
          console.error('Mode switch recovery failed:', retryErr.message);
          showToast('Could not switch editor mode', 'error');
        }
      } else {
        throw err;
      }
    }
  };
}

/**
 * Setup paste handler for markdown mode to prevent automatic code block transformation
 * When pasting text with tabs/indentation, Toast UI Editor (via CodeMirror) would normally
 * convert it to code blocks. This handler intercepts paste events and inserts text as-is.
 */
function setupMarkdownPasteHandler() {
  const cmElement = document.querySelector('.toastui-editor-md-container .CodeMirror');
  if (cmElement && cmElement.CodeMirror) {
    attachMarkdownPasteListener(cmElement.CodeMirror);
    return;
  }
  // CodeMirror not ready — wait for mode switch instead of polling forever.
  // The editor starts in WYSIWYG mode, so CodeMirror won't exist until the
  // user switches to markdown mode.
  if (editor) {
    editor.on('changeMode', function onModeChange(mode) {
      if (mode === 'markdown') {
        const cm = document.querySelector('.toastui-editor-md-container .CodeMirror');
        if (cm && cm.CodeMirror) {
          attachMarkdownPasteListener(cm.CodeMirror);
          editor.off('changeMode', onModeChange);
        }
      }
    });
  }
}

/**
 * Attach the paste listener to a CodeMirror instance.
 * Prevents Toast UI Editor from converting pasted indented text into code blocks.
 */
function attachMarkdownPasteListener(cm) {
  // Guard against double-attach
  if (cm._pasteHandlerAttached) return;
  cm._pasteHandlerAttached = true;

  document.addEventListener('paste', (e) => {
    if (!cm.hasFocus()) return;
    if (e.clipboardData?.types?.includes('Files')) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;

    console.log('[Paste Handler] Intercepting paste in markdown mode');
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    cm.replaceSelection(text);
  }, true);

  console.log('[Paste Handler] Markdown paste handler initialized');
}

// Process mermaid diagrams in the editor
function processMermaidDiagrams() {
  // Get the editor container (includes both WYSIWYG and preview panes)
  const editorEl = document.querySelector('#editor');
  if (editorEl) {
    processPendingMermaidDiagrams(editorEl);
  }
}

// Set up keyboard shortcuts that the editor might intercept
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', async (e) => {
    // Ctrl+S or Cmd+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      e.stopPropagation();

      // Trigger save via the file API (this handles both local and Azure saves)
      if (window.electronAPI) {
        await window.electronAPI.saveFile();
      }
    }
  }, true); // Use capture phase to intercept before editor

  // Alt+Left / Alt+Right for navigation history
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateBack();
    } else if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      navigateForward();
    }
  });
}

/**
 * Set up CTRL+scroll wheel zoom for the editor
 * Zooms both markdown and WYSIWYG editor content areas
 */
function setupZoom() {
  const ZOOM_MIN = 50;   // 50%
  const ZOOM_MAX = 200;  // 200%
  const ZOOM_STEP = 10;  // 10% per scroll notch
  const STORAGE_KEY = 'azurewiki-editor-zoom';

  // Load saved zoom level or default to 100%
  let zoomLevel = parseInt(localStorage.getItem(STORAGE_KEY)) || 100;

  let isApplyingZoom = false;

  // Apply zoom to editor content areas
  function applyZoom(level) {
    isApplyingZoom = true;
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
    localStorage.setItem(STORAGE_KEY, zoomLevel);

    const scale = zoomLevel / 100;

    // Target all editor content areas (text-based, use font-size)
    const textSelectors = [
      '.toastui-editor-md-container .CodeMirror',     // Markdown editor (CodeMirror)
      '.toastui-editor-md-container .toastui-editor-md-preview', // Markdown preview
      '.toastui-editor-ww-container .ProseMirror',   // WYSIWYG editor (ProseMirror)
      '.toastui-editor-contents'                      // General content areas
    ];

    textSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        el.style.fontSize = `${scale}em`;
      });
    });

    // Target Mermaid diagrams (SVG-based, use transform scale)
    // We need to wrap the scaled content to preserve scrollable dimensions
    document.querySelectorAll('.mermaid-wysiwyg-diagram').forEach(el => {
      const svg = el.querySelector('svg');
      if (!svg) return;

      // Get original SVG dimensions
      const svgRect = svg.getBoundingClientRect();
      const originalWidth = svg.getAttribute('data-original-width') || svgRect.width;
      const originalHeight = svg.getAttribute('data-original-height') || svgRect.height;

      // Store original dimensions for future zoom calculations
      if (!svg.getAttribute('data-original-width')) {
        svg.setAttribute('data-original-width', svgRect.width / (parseFloat(svg.style.transform?.match(/scale\(([^)]+)\)/)?.[1]) || 1));
        svg.setAttribute('data-original-height', svgRect.height / (parseFloat(svg.style.transform?.match(/scale\(([^)]+)\)/)?.[1]) || 1));
      }

      // Apply scale transform to SVG
      svg.style.transform = `scale(${scale})`;
      svg.style.transformOrigin = 'top left';

      // Set wrapper dimensions to scaled size so scrolling works
      const scaledWidth = parseFloat(svg.getAttribute('data-original-width')) * scale;
      const scaledHeight = parseFloat(svg.getAttribute('data-original-height')) * scale;

      el.style.minWidth = `${scaledWidth}px`;
      el.style.minHeight = `${scaledHeight}px`;
      el.style.overflow = 'visible';

      // Let the wrapper scroll horizontally if needed
      const wrapper = el.closest('.mermaid-wysiwyg-wrapper');
      if (wrapper) {
        wrapper.style.overflowX = 'auto';
      }
    });

    // Also handle mermaid containers in markdown preview
    document.querySelectorAll('.mermaid-container svg').forEach(svg => {
      // Store original dimensions
      if (!svg.getAttribute('data-original-width')) {
        const rect = svg.getBoundingClientRect();
        svg.setAttribute('data-original-width', rect.width);
        svg.setAttribute('data-original-height', rect.height);
      }

      svg.style.transform = `scale(${scale})`;
      svg.style.transformOrigin = 'top left';

      // Update container dimensions
      const container = svg.closest('.mermaid-container');
      if (container) {
        const scaledWidth = parseFloat(svg.getAttribute('data-original-width')) * scale;
        const scaledHeight = parseFloat(svg.getAttribute('data-original-height')) * scale;
        container.style.minWidth = `${scaledWidth}px`;
        container.style.minHeight = `${scaledHeight}px`;
        container.style.overflowX = 'auto';
      }
    });

    // Show zoom indicator
    showZoomIndicator(zoomLevel);
    requestAnimationFrame(() => { isApplyingZoom = false; });
  }

  // Create and show zoom indicator
  function showZoomIndicator(level) {
    let indicator = document.getElementById('zoom-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'zoom-indicator';
      document.body.appendChild(indicator);
    }

    indicator.textContent = `${level}%`;
    indicator.classList.add('visible');

    // Clear existing timeout
    if (indicator._timeout) {
      clearTimeout(indicator._timeout);
    }

    // Hide after delay
    indicator._timeout = setTimeout(() => {
      indicator.classList.remove('visible');
    }, 1500);
  }

  // Reset zoom to 100%
  function resetZoom() {
    applyZoom(100);
  }

  // Handle CTRL+wheel zoom (RAF-throttled to avoid jank at high scroll rates)
  const editorEl = document.querySelector('#editor');
  if (editorEl) {
    let zoomRafPending = false;
    editorEl.addEventListener('wheel', (e) => {
      // Only handle CTRL+wheel (or Cmd+wheel on Mac)
      if (!e.ctrlKey && !e.metaKey) return;

      e.preventDefault();

      // Determine zoom direction and clamp immediately
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel + delta));
      if (!zoomRafPending) {
        zoomRafPending = true;
        requestAnimationFrame(() => {
          applyZoom(zoomLevel);
          zoomRafPending = false;
        });
      }
    }, { passive: false });
  }

  // Handle CTRL+0 to reset zoom
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      resetZoom();
    }
  });

  // Apply initial zoom level
  if (zoomLevel !== 100) {
    // Delay to ensure editor is fully loaded
    setTimeout(() => applyZoom(zoomLevel), 100);
  }

  // Watch for new mermaid diagrams being rendered and apply zoom to them
  let zoomMutationTimer = null;
  const observer = new MutationObserver((mutations) => {
    if (isApplyingZoom) return; // Skip mutations caused by our own zoom changes
    let hasNewMermaid = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if this is a mermaid SVG or contains one
          if (node.tagName === 'svg' || node.querySelector?.('svg')) {
            const parent = node.closest('.mermaid-wysiwyg-diagram, .mermaid-container');
            if (parent) {
              hasNewMermaid = true;
              break;
            }
          }
          // Check for mermaid wrapper/container being added
          if (node.classList?.contains('mermaid-wysiwyg-wrapper') ||
              node.classList?.contains('mermaid-container') ||
              node.classList?.contains('mermaid-wysiwyg-diagram')) {
            hasNewMermaid = true;
            break;
          }
        }
      }
      if (hasNewMermaid) break;
    }

    // Re-apply zoom if new mermaid content was added (debounced)
    if (hasNewMermaid && zoomLevel !== 100) {
      if (zoomMutationTimer) clearTimeout(zoomMutationTimer);
      zoomMutationTimer = setTimeout(() => applyZoom(zoomLevel), 200);
    }
  });

  // Start observing the editor for new mermaid diagrams
  if (editorEl) {
    observer.observe(editorEl, {
      childList: true,
      subtree: true
    });
  }

  // Expose zoom functions globally for debugging/menu access
  window.editorZoom = {
    zoomIn: () => applyZoom(zoomLevel + ZOOM_STEP),
    zoomOut: () => applyZoom(zoomLevel - ZOOM_STEP),
    reset: resetZoom,
    getLevel: () => zoomLevel
  };
}

// Flag to prevent dirty marking during tab switch content sync
let isSyncingContent = false;

/**
 * Handle switching to a different tab
 * @param {Object} tab - The tab object to switch to
 */
async function handleTabSwitch(tab) {
  if (!tab) return;

  console.log('[Renderer] Switching to tab:', tab.id, tab.title);

  // Update current tab ID
  currentTabId = tab.id;

  // Handle PDF tabs
  if (tab.metadata && tab.metadata.isPdf) {
    showPdfViewer(tab.filePath, tab.title);
    return;
  }

  // Hide PDF viewer if switching to a non-PDF tab
  hidePdfViewer();

  // Check for external changes on local file tabs
  if (tab.type === 'local' && tab.hasExternalChanges) {
    await showExternalChangeNotification(tab);
    return; // The notification handler will load content
  }

  // Set flag to prevent dirty marking during content sync
  isSyncingContent = true;

  // Load the tab's content into the editor
  editor.setMarkdown(tab.content || '');

  // After editor processes content, sync normalized content back to tab store
  // This prevents false dirty state from editor normalization (whitespace, newlines, etc.)
  setTimeout(async () => {
    const normalizedContent = editor.getMarkdown();
    await window.electronAPI.tabsSyncContent({ tabId: tab.id, content: normalizedContent });
    isSyncingContent = false;
  }, 50);

  // Update Azure page state and image context based on tab type
  if (tab.type === 'azure' && tab.azurePage) {
    azurePageState = {
      path: tab.azurePage.pagePath,
      eTag: tab.azurePage.eTag
    };
    setCurrentPagePath(tab.azurePage.pagePath);
    setLocalFileContext(null);

    // Sync the wiki sidebar to highlight the current page
    highlightPathInTree(tab.azurePage.pagePath);

    // Check for remote changes in background (don't block tab switch)
    checkAzureTabForRemoteChanges(tab);
  } else {
    azurePageState = null;
    setCurrentPagePath(null);
    // Set local file context for attachment resolution
    if (tab.type === 'local' && tab.filePath) {
      setLocalFileContext(tab.filePath);
    } else {
      setLocalFileContext(null);
    }

    // Clear wiki sidebar selection when switching to non-Azure tab
    highlightPathInTree(null);
  }

  // Process mermaid diagrams and pending attachments after content load
  setTimeout(() => {
    processMermaidDiagrams();
    processPendingAttachments(document.querySelector('#editor'));
  }, 100);

  // Scroll to top
  scrollEditorToTop(editor, { delay: 100 });
}

/**
 * Show the PDF viewer for a given file path
 */
function showPdfViewer(filePath, fileName) {
  const container = document.getElementById('pdf-viewer-container');
  const editorEl = document.getElementById('editor');
  const frame = document.getElementById('pdf-viewer-frame');
  const textPanel = document.getElementById('pdf-viewer-text');
  const filenameEl = container.querySelector('.pdf-viewer-filename');
  const toggleTextBtn = container.querySelector('.pdf-viewer-toggle-text');
  const togglePdfBtn = container.querySelector('.pdf-viewer-toggle-pdf');

  // Hide editor, show PDF viewer
  editorEl.style.display = 'none';
  container.classList.remove('hidden');

  // Set filename
  filenameEl.textContent = fileName;

  // Reset to PDF view
  frame.classList.remove('hidden');
  frame.style.display = '';
  textPanel.classList.add('hidden');
  toggleTextBtn.classList.remove('hidden');
  togglePdfBtn.classList.add('hidden');

  // Load PDF via custom protocol (file:// and data: URLs don't work in Electron iframes)
  const encodedPath = encodeURIComponent(filePath.replace(/\\/g, '/'));
  frame.src = `local-pdf://${encodedPath}`;

  // Wire toggle buttons (replace old listeners by cloning)
  const newToggleText = toggleTextBtn.cloneNode(true);
  toggleTextBtn.parentNode.replaceChild(newToggleText, toggleTextBtn);
  newToggleText.addEventListener('click', async () => {
    newToggleText.textContent = 'Extracting...';
    newToggleText.disabled = true;
    try {
      const result = await window.electronAPI.fileReadPdfText(filePath);
      if (result.success) {
        textPanel.textContent = result.text;
        frame.style.display = 'none';
        textPanel.classList.remove('hidden');
        newToggleText.classList.add('hidden');
        container.querySelector('.pdf-viewer-toggle-pdf').classList.remove('hidden');
      } else {
        alert('Failed to extract text: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Failed to extract text: ' + err.message);
    } finally {
      newToggleText.textContent = 'View as Text';
      newToggleText.disabled = false;
    }
  });

  const newTogglePdf = container.querySelector('.pdf-viewer-toggle-pdf');
  const freshTogglePdf = newTogglePdf.cloneNode(true);
  newTogglePdf.parentNode.replaceChild(freshTogglePdf, newTogglePdf);
  freshTogglePdf.addEventListener('click', () => {
    textPanel.classList.add('hidden');
    frame.style.display = '';
    freshTogglePdf.classList.add('hidden');
    container.querySelector('.pdf-viewer-toggle-text').classList.remove('hidden');
  });
}

/**
 * Hide the PDF viewer and restore the editor
 */
function hidePdfViewer() {
  const container = document.getElementById('pdf-viewer-container');
  const editorEl = document.getElementById('editor');
  const frame = document.getElementById('pdf-viewer-frame');

  if (!container.classList.contains('hidden')) {
    container.classList.add('hidden');
    frame.src = '';
    editorEl.style.display = '';
  }
}

/**
 * Show notification when a file has external changes
 * @param {Object} tab - The tab with external changes
 */
async function showExternalChangeNotification(tab) {
  const reload = confirm(
    `"${tab.title}" has been modified externally.\n\n` +
    `Do you want to reload from disk?\n\n` +
    `- Click OK to reload (your in-editor changes will be lost)\n` +
    `- Click Cancel to keep your version`
  );

  // Set sync flag to prevent dirty marking
  isSyncingContent = true;

  if (reload) {
    const result = await window.electronAPI.tabsReloadFromFile(tab.id);
    if (result.success) {
      editor.setMarkdown(result.content || '');
      // Sync normalized content after reload
      setTimeout(async () => {
        const normalizedContent = editor.getMarkdown();
        await window.electronAPI.tabsSyncContent({ tabId: tab.id, content: normalizedContent });
        isSyncingContent = false;
      }, 50);
      showToast('File reloaded from disk', 'success');
    } else {
      showToast('Failed to reload file: ' + (result.error || 'Unknown error'), 'error');
      // Load the cached content anyway
      editor.setMarkdown(tab.content || '');
      setTimeout(() => { isSyncingContent = false; }, 50);
    }
  } else {
    // User chose to keep their version - clear the external changes flag
    await window.electronAPI.tabsClearExternalChanges(tab.id);
    editor.setMarkdown(tab.content || '');
    // Sync normalized content
    setTimeout(async () => {
      const normalizedContent = editor.getMarkdown();
      await window.electronAPI.tabsSyncContent({ tabId: tab.id, content: normalizedContent });
      isSyncingContent = false;
    }, 50);
    showToast('Keeping your version', 'info');
  }

  // Update Azure page state
  if (tab.type === 'azure' && tab.azurePage) {
    azurePageState = {
      path: tab.azurePage.pagePath,
      eTag: tab.azurePage.eTag
    };
    setCurrentPagePath(tab.azurePage.pagePath);
  } else {
    azurePageState = null;
    setCurrentPagePath(null);
  }

  // Process mermaid diagrams after content load
  setTimeout(() => processMermaidDiagrams(), 100);

  // Scroll to top
  scrollEditorToTop(editor, { delay: 100 });
}

/**
 * Check if an Azure wiki tab's page has been modified remotely.
 * Auto-connects to Azure if not already connected.
 * Runs in background (non-blocking).
 * @param {Object} tab - The Azure tab to check
 */
async function checkAzureTabForRemoteChanges(tab) {
  if (!tab.azurePage?.pagePath || !tab.azurePage?.eTag) return;

  try {
    // Ensure we're connected first
    const status = await window.electronAPI.azureGetConnectionStatus();
    if (!status.connected) {
      await quickConnectToWiki();
      // Re-check connection after attempt
      const newStatus = await window.electronAPI.azureGetConnectionStatus();
      if (!newStatus.connected) return;
    }

    // Check if page has changed remotely
    const result = await window.electronAPI.azureCheckPageChanged({
      pagePath: tab.azurePage.pagePath,
      localETag: tab.azurePage.eTag
    });

    // Only show notification if this tab is still the active one
    if (result.success && result.changed && currentTabId === tab.id) {
      await showAzureRemoteChangeNotification(tab, result.content, result.eTag);
    }
  } catch (error) {
    console.warn('[Renderer] Failed to check Azure page for changes:', error);
  }
}

/**
 * Show notification when a wiki page has been modified on Azure DevOps
 * @param {Object} tab - The tab with remote changes
 * @param {string} remoteContent - The latest content from Azure
 * @param {string} remoteETag - The latest eTag from Azure
 */
async function showAzureRemoteChangeNotification(tab, remoteContent, remoteETag) {
  const reload = confirm(
    `"${tab.title}" has been modified on Azure DevOps.\n\n` +
    `Do you want to reload the latest version?\n\n` +
    `- Click OK to reload (your in-editor changes will be lost)\n` +
    `- Click Cancel to keep your version`
  );

  if (reload) {
    isSyncingContent = true;
    editor.setMarkdown(remoteContent || '');

    // Update tab with new eTag and content
    await window.electronAPI.tabsUpdateAzureInfo({
      tabId: tab.id,
      azurePage: { pagePath: tab.azurePage.pagePath, eTag: remoteETag }
    });
    await window.electronAPI.tabsUpdateContent({
      tabId: tab.id,
      content: remoteContent || ''
    });

    azurePageState = { path: tab.azurePage.pagePath, eTag: remoteETag };

    setTimeout(async () => {
      const normalizedContent = editor.getMarkdown();
      await window.electronAPI.tabsSyncContent({ tabId: tab.id, content: normalizedContent });
      isSyncingContent = false;
    }, 50);

    showToast('Page reloaded from Azure DevOps', 'success');
    setTimeout(() => processMermaidDiagrams(), 300);
  } else {
    showToast('Keeping your local version', 'info');
  }
}

/**
 * Debounced content update handler
 */
function handleContentChange() {
  if (!currentTabId) return;

  // Skip if we're in the middle of syncing content (prevents false dirty state)
  if (isSyncingContent) return;

  // Clear existing timer
  if (contentUpdateTimer) {
    clearTimeout(contentUpdateTimer);
  }

  // Debounce the update
  contentUpdateTimer = setTimeout(() => {
    // Double-check sync flag in case it changed during debounce
    if (isSyncingContent) return;

    const content = editor.getMarkdown();
    window.electronAPI.notifyContentChanged({
      content,
      tabId: currentTabId
    });
  }, CONTENT_UPDATE_DEBOUNCE_MS);
}

function setupIPCListeners() {
  if (!window.electronAPI) {
    console.warn('electronAPI not available');
    return;
  }

  // Handle new file (legacy - tabs handle this now, but keep for compatibility)
  window.electronAPI.onFileNew(() => {
    // This is now handled by tab creation
    // Just clear editor for new untitled tab
  });

  // Handle file opened (legacy - for backwards compatibility)
  window.electronAPI.onFileOpened(({ content }) => {
    // Content is now set by tab switching
    // Just set content if received directly
    isSyncingContent = true;
    editor.setMarkdown(content);
    // Sync normalized content after load
    setTimeout(async () => {
      if (currentTabId) {
        const normalizedContent = editor.getMarkdown();
        await window.electronAPI.tabsSyncContent({ tabId: currentTabId, content: normalizedContent });
      }
      isSyncingContent = false;
    }, 50);
    azurePageState = null;
    setCurrentPagePath(null);
    scrollEditorToTop(editor, { delay: 100 });
  });

  // Handle save request
  window.electronAPI.onRequestContent(() => {
    window.electronAPI.sendContent(editor.getMarkdown());
  });

  // Handle HTML export request
  window.electronAPI.onExportHtml(async () => {
    const markdown = editor.getMarkdown();
    const htmlContent = await exportToHtml(markdown);
    window.electronAPI.sendExportedHtml(htmlContent);
  });

  // Handle theme changes
  window.electronAPI.onThemeChange((theme) => {
    const isDark = theme === 'dark';
    if (isDark) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    // Update mermaid theme and re-render diagrams
    updateMermaidTheme(isDark);
    processMermaidDiagrams();
  });

  // Content change tracking is handled by the unified editor.on('change') handler

  // ============================================
  // Tab Management Events
  // ============================================

  // Handle session loaded on startup
  window.electronAPI.onTabsSessionLoaded((session) => {
    console.log('[Renderer] Tab session loaded:', session.tabs.length, 'tabs');
    updateTabs(session);

    // Load the active tab content
    if (session.activeTabId) {
      const activeTab = session.tabs.find(t => t.id === session.activeTabId);
      if (activeTab) {
        handleTabSwitch(activeTab);
      }
    }
  });

  // Handle tabs updated
  window.electronAPI.onTabsUpdated((session) => {
    updateTabs(session);
    scrollToActiveTab();
  });

  // Handle tab switched (from main process)
  window.electronAPI.onTabsSwitched((tab) => {
    handleTabSwitch(tab);
  });

  // ============================================
  // Azure DevOps Integration
  // ============================================

  // Show connection dialog
  window.electronAPI.onAzureShowConnectionDialog(() => {
    showConnectionModal(onAzureConnectionUpdate);
  });

  // Handle disconnect
  window.electronAPI.onAzureDisconnected(() => {
    azurePageState = null;
    setAzureImageContext({ isAzureMode: false });
    resetSidebar();
    hideCurrentPanel();
    updateAzureToolbarButton(false);
  });

  // Toggle sidebar (via menu or keyboard shortcut)
  window.electronAPI.onAzureToggleSidebar(() => {
    togglePanel(PANELS.WIKI);
  });

  // Navigate to page request from main process (for new window)
  window.electronAPI.onNavigateToPage?.((pagePath) => {
    console.log('[Renderer] Navigate to page requested:', pagePath);
    navigateToAzurePage(pagePath);
  });

  // Refresh tree
  window.electronAPI.onAzureRefreshTree(() => {
    refreshTree();
  });

  // Cache cleared - refresh tree with force to get fresh data
  window.electronAPI.onAzureCacheCleared(() => {
    console.log('[Renderer] Wiki cache cleared, refreshing tree');
    refreshTree(true);
  });

  // Add to favorites
  window.electronAPI.onAzureAddToFavorites(() => {
    addCurrentToFavorites();
  });

  // Handle Find/Replace menu items
  window.electronAPI.onEditFind(() => {
    showFindReplace(false);
  });

  window.electronAPI.onEditReplace(() => {
    showFindReplace(true);
  });

  // Handle Settings menu item
  window.electronAPI.onShowSettings(() => {
    showSettingsPanel();
  });

  // Handle Keyboard Shortcuts menu item
  window.electronAPI.onShowKeyboardShortcuts(() => {
    showKeyboardShortcutsDialog();
  });

  // Set up page selection handler for sidebar
  setOnPageSelect(navigateToAzurePage);

  // Listen for wiki link clicks from AI chat sidebar
  document.addEventListener('ai-chat-open-wiki-page', (e) => {
    const { path } = e.detail;
    if (path) {
      console.log('[Renderer] AI chat wiki link clicked:', path);
      navigateToAzurePage(path);
    }
  });

  // Set up history panel callbacks
  setupHistoryCallbacks({
    onRestore: (content) => {
      if (editor) {
        editor.setMarkdown(content);
        showToast('Version restored', 'success');
      }
    },
    getCurrentContent: () => {
      return editor ? editor.getMarkdown() : '';
    }
  });

  // Handle save request from main process (for Azure pages)
  window.electronAPI.onAzureRequestSave(async () => {
    if (isAzurePageActive()) {
      return await saveToAzure();
    }
    return { success: false, notAzure: true };
  });

  // ============================================
  // Transcription Streaming
  // ============================================

  // Global callback for transcription-ui.js to push streamed text into the editor
  window._transcriptionSetContent = (tabId, content) => {
    if (currentTabId !== tabId) return; // only update if transcription tab is active
    isSyncingContent = true;
    editor.setMarkdown(content);
    // Auto-scroll to bottom so user sees newest text
    const editorEl = document.querySelector('.toastui-editor-md-container .ProseMirror');
    if (editorEl) {
      editorEl.scrollTop = editorEl.scrollHeight;
    }
    setTimeout(() => { isSyncingContent = false; }, 50);
  };
}

/**
 * Handle connection modal callbacks
 */
function onAzureConnectionUpdate(event) {
  console.log('Azure connection event:', event);

  switch (event.type) {
    case 'connecting':
      // Use hideAllPanels + setActivePanel directly instead of activatePanel
      // to avoid re-triggering the async WIKI show handler (which calls
      // quickConnectToWiki again, causing re-entrancy)
      hideAllPanels();
      setActivePanel(PANELS.WIKI);
      showSidebarConnecting();
      break;

    case 'connected':
      // Connection successful - refresh the tree
      console.log('Connected to Azure DevOps:', event);
      // Update Azure image context for attachment URL resolution
      if (event.org && event.project && event.wikiId) {
        setAzureImageContext({
          isAzureMode: true,
          org: event.org,
          project: event.project,
          wikiId: event.wikiId
        });
      }
      refreshTree();
      updateAzureToolbarButton(true);
      break;

    case 'error':
      // Connection failed - hide sidebar
      console.error('Connection failed:', event.error);
      hideCurrentPanel();
      setAzureImageContext({ isAzureMode: false });
      break;

    case 'cancelled':
      // User cancelled - hide sidebar
      console.log('Connection cancelled');
      hideCurrentPanel();
      break;

    default:
      // Legacy support: if no type, assume it's a successful connection
      console.log('Connected to Azure DevOps:', event);
      activatePanel(PANELS.WIKI);
  }
}

/**
 * Toggle Azure Wiki connection
 * If connected: disconnect and close sidebar
 * If disconnected: connect (auto or via modal)
 */
async function toggleAzureConnection() {
  const status = await window.electronAPI.azureGetConnectionStatus();

  if (status.connected) {
    // Already connected - disconnect
    console.log('Disconnecting from Azure Wiki');
    await window.electronAPI.azureDisconnect();
    azurePageState = null;
    setAzureImageContext({ isAzureMode: false });
    resetSidebar();
    hideCurrentPanel();
    updateAzureToolbarButton(false);
    showToast('Disconnected from Azure Wiki', 'info');
  } else {
    // Not connected - connect
    await quickConnectToWiki();
  }
}

/**
 * Quick connect to Azure Wiki
 * Auto-connects if .env has complete config, otherwise shows modal
 */
async function quickConnectToWiki() {
  // Check if we have complete config in .env
  const config = await window.electronAPI.azureLoadConfig();

  if (config && config.org && config.project && config.pat && config.wikiId) {
    // Full config available - auto-connect
    console.log('Auto-connecting with .env config');
    showSidebarConnecting();

    try {
      // First validate credentials
      let result = await window.electronAPI.azureConnect({
        org: config.org,
        project: config.project,
        pat: config.pat
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to connect');
      }

      // Resolve page path if we have pageId
      let rootPath = config.rootPath || '/';
      if (config.pageId && rootPath === '/') {
        const pathResult = await window.electronAPI.azureResolvePagePath({
          org: config.org,
          project: config.project,
          pat: config.pat,
          wikiId: config.wikiId,
          pageId: config.pageId
        });
        if (pathResult.success && pathResult.path) {
          rootPath = pathResult.path;
        }
      }

      // Complete connection with wikiId
      result = await window.electronAPI.azureConnect({
        org: config.org,
        project: config.project,
        pat: config.pat,
        wikiId: config.wikiId,
        wikiName: config.wikiId,
        rootPath
      });

      if (result.success) {
        // Update Azure image context for attachment URL resolution
        setAzureImageContext({
          isAzureMode: true,
          org: config.org,
          project: config.project,
          wikiId: config.wikiId
        });
        refreshTree();
        updateAzureToolbarButton(true);
      } else {
        throw new Error(result.error || 'Failed to complete connection');
      }
    } catch (error) {
      console.error('Auto-connect failed:', error);
      hideCurrentPanel();
      setAzureImageContext({ isAzureMode: false });
      updateAzureToolbarButton(false);
      showToast('Connection failed: ' + error.message, 'error');
    }
  } else {
    // Incomplete config - show modal
    console.log('Incomplete .env config, showing modal');
    showConnectionModal(onAzureConnectionUpdate);
  }
}

/**
 * Update the Azure toolbar button appearance based on connection state
 * @param {boolean} isConnected - Whether connected to Azure
 */
function updateAzureToolbarButton(isConnected) {
  const button = document.querySelector('.azure-connect-icon');
  if (!button) return;

  if (isConnected) {
    button.classList.add('connected');
    button.setAttribute('title', 'Disconnect from Azure Wiki');
    button.textContent = '☁'; // Same icon but styled differently via CSS
  } else {
    button.classList.remove('connected');
    button.setAttribute('title', 'Connect to Azure Wiki');
    button.textContent = '☁';
  }
}

/**
 * Load a wiki page from Azure DevOps
 */
async function loadAzurePage(pagePath) {
  console.log('Loading Azure page:', pagePath);

  try {
    const session = await window.electronAPI.tabsGetSession();

    // Check if page is already open in a tab
    const existingTab = session?.tabs.find(t =>
      t.type === 'azure' && t.azurePage?.pagePath === pagePath
    );
    if (existingTab) {
      await window.electronAPI.tabsSwitch(existingTab.id);
      return;
    }

    // Determine if we should reuse current tab
    const activeTab = session?.tabs.find(t => t.id === session.activeTabId);
    let shouldReuse = false;
    let targetTabId = null;

    if (activeTab && activeTab.type === 'azure') {
      if (activeTab.isDirty) {
        const choice = await window.electronAPI.showAzureSavePrompt();
        if (choice === 'cancel') return;
        if (choice === 'save') {
          const saveResult = await saveToAzure();
          if (!saveResult.success) {
            showToast('Failed to save current page, aborting navigation', 'error');
            return;
          }
        }
      }
      shouldReuse = true;
      targetTabId = activeTab.id;
    }

    // Fetch page content from Azure
    const result = await window.electronAPI.azureGetPageContent({ pagePath });
    if (!result.success) {
      console.error('Failed to load page:', result.error);
      showToast(`Failed to load page: ${result.error}`, 'error');
      return;
    }

    if (shouldReuse && targetTabId) {
      // Reuse existing Azure tab
      await window.electronAPI.tabsReplaceAzureContent({
        tabId: targetTabId,
        pagePath,
        eTag: result.eTag,
        content: result.content || ''
      });
    } else {
      // Create new tab
      const newTab = await window.electronAPI.tabsCreate({
        type: 'azure',
        azurePage: { pagePath, eTag: result.eTag },
        content: result.content || ''
      });
      await window.electronAPI.tabsUpdateAzureInfo({
        tabId: newTab.id,
        azurePage: { pagePath, eTag: result.eTag }
      });
    }

    azurePageState = { path: pagePath, eTag: result.eTag };
    setCurrentPagePath(pagePath);
    setLocalFileContext(null);
    processMermaidDiagrams();
    setTimeout(() => processPendingAttachments(document.querySelector('#editor')), 100);

    scrollEditorToTop(editor, { delay: 300 });

    console.log('Page loaded:', pagePath, 'eTag:', result.eTag);
  } catch (error) {
    console.error('Error loading page:', error);
    showToast(`Error loading page: ${error.message}`, 'error');
  }
}

/**
 * Navigate to an Azure page with universal dirty check.
 * Use this instead of calling loadAzurePage directly from user-initiated actions.
 * @param {string} pagePath - Azure wiki page path
 */
async function navigateToAzurePage(pagePath) {
  // Check if ANY tab is dirty (not just Azure tabs)
  const session = await window.electronAPI.tabsGetSession();
  const activeTab = session?.tabs.find(t => t.id === session.activeTabId);

  if (activeTab?.isDirty) {
    if (activeTab.type === 'azure') {
      // Azure dirty check is handled inside loadAzurePage
    } else {
      // Non-Azure dirty tab - ask user
      const proceed = confirm(
        'You have unsaved changes in the current tab.\n\n' +
        'Navigate away? Your changes will be preserved in the tab.'
      );
      if (!proceed) return;
    }
  }

  await loadAzurePage(pagePath);

  // Record in navigation history after successful load
  if (azurePageState?.path) {
    navPushPage(azurePageState.path);
  }
}

/**
 * Navigate back in wiki history
 */
async function navigateBack() {
  const pagePath = navGoBack();
  if (!pagePath) return;

  navSetNavigating(true);
  try {
    await loadAzurePage(pagePath);
  } finally {
    navSetNavigating(false);
  }
}

/**
 * Navigate forward in wiki history
 */
async function navigateForward() {
  const pagePath = navGoForward();
  if (!pagePath) return;

  navSetNavigating(true);
  try {
    await loadAzurePage(pagePath);
  } finally {
    navSetNavigating(false);
  }
}

/**
 * Save current content to Azure DevOps
 */
async function saveToAzure() {
  if (!azurePageState) {
    console.warn('No Azure page loaded');
    return { success: false, error: 'No Azure page loaded' };
  }

  const content = editor.getMarkdown();

  try {
    const result = await window.electronAPI.azureSavePage({
      pagePath: azurePageState.path,
      content
    });

    if (result.success) {
      azurePageState.eTag = result.eTag;
      showToast('Saved to Azure DevOps', 'success');
      return { success: true };
    } else if (result.conflict) {
      // Fetch current remote content to show in diff
      let remoteContent = '';
      try {
        const remoteResult = await window.electronAPI.azureGetPageContent({
          pagePath: azurePageState.path,
          skipCache: true // Force fresh fetch
        });
        if (remoteResult.success) {
          remoteContent = remoteResult.content || '';
        }
      } catch (e) {
        console.warn('Could not fetch remote content for conflict view:', e);
      }

      // Show conflict dialog with diff
      const conflictResult = await showSaveConflictDialog({
        localContent: content,
        remoteContent: remoteContent,
        pagePath: azurePageState.path
      });

      if (conflictResult.action === 'overwrite') {
        // Force save with new eTag
        const forceResult = await window.electronAPI.azureSavePage({
          pagePath: azurePageState.path,
          content
        });

        if (forceResult.success) {
          azurePageState.eTag = forceResult.eTag;
          showToast('Saved to Azure DevOps (overwrote remote changes)', 'success');
          return { success: true };
        } else {
          showToast(`Failed to save: ${forceResult.error}`, 'error');
          return { success: false, error: forceResult.error };
        }
      } else if (conflictResult.action === 'reload') {
        // Reload the page from server
        await loadAzurePage(azurePageState.path);
        showToast('Page reloaded from server - your changes were discarded', 'warning');
        return { success: false, error: 'User chose to reload' };
      } else {
        showToast('Save cancelled - conflict detected', 'warning');
        return { success: false, error: 'Conflict - save cancelled' };
      }
    } else {
      showToast(`Failed to save: ${result.error}`, 'error');
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('Error saving to Azure:', error);
    showToast(`Error saving: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

/**
 * Check if we're editing an Azure page
 */
function isAzurePageActive() {
  return azurePageState !== null;
}

/**
 * Simple toast notification
 */
function showToast(message, type = 'info') {
  // Remove any existing toast
  const existing = document.querySelector('.toast-notification');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Animate in
  setTimeout(() => toast.classList.add('show'), 10);

  // Remove after delay
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Initialize Azure image context from current connection status
 * Called on startup to restore image context if already connected
 */
async function initAzureImageContext() {
  try {
    const status = await window.electronAPI.azureGetConnectionStatus();
    if (status?.connected && status.org && status.project && status.wikiId) {
      setAzureImageContext({
        isAzureMode: true,
        org: status.org,
        project: status.project,
        wikiId: status.wikiId
      });
      console.log('[Renderer] Restored Azure image context from connection status');
    } else {
      // Not connected to Azure, but mark context as initialized
      // so local file resolution can proceed
      markContextInitialized();
      console.log('[Renderer] No Azure connection, context initialized for local mode');
    }
  } catch (error) {
    console.warn('Failed to initialize Azure image context:', error);
    // Still mark as initialized so local files work
    markContextInitialized();
  }
}

/**
 * Update AI Copilot toolbar button state based on LLM configuration
 */
async function updateAICopilotButtonState() {
  try {
    const config = await window.electronAPI.geminiGetConfig();
    const copilotButton = document.querySelector('.ai-copilot-icon');

    if (copilotButton) {
      if (!config.isConfigured) {
        // Disable the button
        copilotButton.classList.add('disabled');
        copilotButton.setAttribute('title', 'AI Copilot disabled - Set LLM_PROVIDER and API key in .env to enable');
        copilotButton.style.opacity = '0.4';
        copilotButton.style.cursor = 'not-allowed';

        // Prevent the command from executing when disabled
        copilotButton.addEventListener('click', (e) => {
          if (copilotButton.classList.contains('disabled')) {
            e.preventDefault();
            e.stopPropagation();
          }
        }, true);
      } else {
        // Enable the button
        copilotButton.classList.remove('disabled');
        copilotButton.setAttribute('title', 'AI Copilot');
        copilotButton.style.opacity = '1';
        copilotButton.style.cursor = 'pointer';
      }
    }
  } catch (error) {
    console.warn('Failed to check AI Copilot configuration:', error);
  }
}

// Expose saveToAzure for keyboard shortcut handling
window.saveToAzure = saveToAzure;
window.isAzurePageActive = isAzurePageActive;

// ============================================
// Link Click Handling for Wiki Navigation
// ============================================

/**
 * Set up link click handlers for the editor
 * Intercepts link clicks in rendered markdown to route appropriately
 */
function setupLinkHandlers() {
  // Wait for editor to fully initialize then attach handlers
  setTimeout(() => {
    attachLinkHandlersToEditor();
  }, 500);

  // Re-attachment on content change is handled by the unified editor.on('change') handler
}

/**
 * Attach click/contextmenu listeners to editor content areas
 */
function attachLinkHandlersToEditor() {
  // Target both WYSIWYG and preview panes
  const contentAreas = document.querySelectorAll(
    '.toastui-editor-contents, .toastui-editor-md-preview, .ProseMirror'
  );

  contentAreas.forEach(area => {
    // Only attach once per element
    if (area._linkHandlersAttached) return;
    area._linkHandlersAttached = true;

    area.addEventListener('click', handleLinkClick, true);
    area.addEventListener('auxclick', handleLinkClick, true); // Middle click
    area.addEventListener('contextmenu', handleLinkContextMenu, true);
  });
}

/**
 * Classify a link as internal wiki, external, or anchor
 * @param {string} href - The link href
 * @returns {string} - 'internal-wiki', 'external', 'anchor', or 'unknown'
 */
function classifyLink(href) {
  if (!href) return 'invalid';

  // Anchor/hash link
  if (href.startsWith('#')) {
    return 'anchor';
  }

  // Relative wiki paths (start with / but not //)
  if (href.startsWith('/') && !href.startsWith('//')) {
    return 'internal-wiki';
  }

  // Relative paths like ./Page or ../Page
  if (href.startsWith('./') || href.startsWith('../')) {
    return 'internal-wiki';
  }

  // Azure DevOps wiki URL
  if (href.includes('dev.azure.com') && href.includes('_wiki')) {
    return 'internal-wiki';
  }

  // External URL
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return 'external';
  }

  // Bare paths without protocol could be wiki pages
  if (!href.includes('://') && !href.includes('@')) {
    return 'internal-wiki';
  }

  return 'unknown';
}

/**
 * Parse an Azure DevOps wiki URL to extract page path or page ID
 * @param {string} href - The full URL
 * @returns {{path: string|null, pageId: string|null}} - The page path and/or page ID
 */
function parseAzureWikiUrl(href) {
  try {
    const url = new URL(href);

    // Check for pagePath query parameter (this is reliable)
    const pagePath = url.searchParams.get('pagePath');
    if (pagePath) {
      return { path: decodeURIComponent(pagePath), pageId: null };
    }

    // Extract page ID from URL path format: /_wiki/wikis/WikiName/pageId/...
    // Example: https://dev.azure.com/org/project/_wiki/wikis/Wiki.wiki/9661/How-To-Do-Something
    // We only extract the page ID - the URL slug is NOT reliable for determining actual path
    const pathMatch = href.match(/_wiki\/wikis\/[^/]+\/(\d+)/);
    if (pathMatch) {
      const pageId = pathMatch[1];
      console.log('[Link] Extracted page ID from Azure URL:', pageId);
      return { path: null, pageId: pageId };
    }

    // Handle path-based format without page ID (generated by wiki synthesis)
    // Example: https://dev.azure.com/org/project/_wiki/wikis/Wiki.wiki/Path-With-Hyphens/Sub-Page
    // Convert hyphens back to spaces to get the actual wiki path
    const pathBasedMatch = href.match(/_wiki\/wikis\/[^/]+(\/.+)$/);
    if (pathBasedMatch) {
      const urlPath = pathBasedMatch[1];
      // Convert hyphens to spaces in each path segment
      const wikiPath = urlPath
        .split('/')
        .map(segment => segment.replace(/-/g, ' '))
        .join('/');
      console.log('[Link] Extracted path from URL:', urlPath, '-> wiki path:', wikiPath);
      return { path: wikiPath, pageId: null };
    }

    return { path: null, pageId: null };
  } catch (e) {
    console.error('[Link] Error parsing Azure wiki URL:', e);
    return { path: null, pageId: null };
  }
}

/**
 * Resolve a relative wiki path to absolute
 * @param {string} href - Relative path
 * @returns {string} - Absolute wiki path
 */
function resolveWikiPath(href) {
  const currentPath = azurePageState?.path || '/';

  // Already absolute
  if (href.startsWith('/')) {
    return href;
  }

  // Get parent directory of current page
  const currentDir = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';

  if (href.startsWith('./')) {
    return currentDir + '/' + href.substring(2);
  }

  if (href.startsWith('../')) {
    const parentDir = currentDir.substring(0, currentDir.lastIndexOf('/')) || '/';
    return parentDir + '/' + href.substring(3);
  }

  // Bare path - relative to current directory
  return currentDir + '/' + href;
}

/**
 * Resolve a page ID to its full path via the Azure API
 * @param {string} pageId - The page ID
 * @returns {Promise<string|null>} - The resolved path or null
 */
async function resolvePageIdToPath(pageId) {
  try {
    const result = await window.electronAPI.azureResolvePagePath({
      pageId: pageId
    });
    if (result.success && result.path) {
      console.log('[Link] Resolved page ID', pageId, 'to path:', result.path);
      return result.path;
    }
    console.warn('[Link] Failed to resolve page ID:', pageId, result.error);
    return null;
  } catch (error) {
    console.error('[Link] Error resolving page ID:', error);
    return null;
  }
}

/**
 * Handle link click events
 * @param {MouseEvent} event
 */
async function handleLinkClick(event) {
  // Find the clicked anchor element
  const anchor = event.target.closest('a');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  const linkType = classifyLink(href);
  console.log('[Link] Click detected:', href, 'type:', linkType);

  // Determine if this should open in new tab
  const openInNewTab = event.ctrlKey || event.metaKey || event.button === 1;

  switch (linkType) {
    case 'external':
      event.preventDefault();
      event.stopPropagation();
      console.log('[Link] Opening external URL in browser:', href);
      window.electronAPI.openExternal(href);
      break;

    case 'internal-wiki':
      event.preventDefault();
      event.stopPropagation();

      // Use helper function to get page path
      let pagePath = await getPagePathFromHref(href);

      // URL-decode the path - Toast UI encodes markdown link paths
      if (pagePath) {
        try {
          pagePath = decodeURIComponent(pagePath);
        } catch (e) {
          console.warn('[Link] Failed to decode path:', e);
        }
      }

      if (pagePath) {
        console.log('[Link] Navigating to wiki page:', pagePath, openInNewTab ? '(new tab)' : '(same tab)');
        if (openInNewTab) {
          window.electronAPI.wikiOpenInNewTab(pagePath);
        } else {
          navigateToAzurePage(pagePath);
        }
      } else {
        console.warn('[Link] Could not resolve wiki path from:', href);
        showToast('Could not resolve wiki link', 'warning');
      }
      break;

    case 'anchor':
      // Let browser handle anchor navigation
      break;

    default:
      // Unknown link type - open externally to be safe
      event.preventDefault();
      event.stopPropagation();
      console.log('[Link] Unknown link type, opening externally:', href);
      window.electronAPI.openExternal(href);
      break;
  }
}

/**
 * Handle right-click context menu on links
 * @param {MouseEvent} event
 */
function handleLinkContextMenu(event) {
  const anchor = event.target.closest('a');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  event.preventDefault();
  event.stopPropagation();

  const linkType = classifyLink(href);
  const isInternal = linkType === 'internal-wiki';

  console.log('[Link] Context menu for:', href, 'type:', linkType);

  // Show context menu via main process
  window.electronAPI.showLinkContextMenu({
    href,
    isInternal,
    x: event.clientX,
    y: event.clientY
  }).then(async (action) => {
    if (!action) return;

    console.log('[Link] Context menu action:', action);

    switch (action) {
      case 'open':
        if (isInternal) {
          let pagePath = await getPagePathFromHref(href);
          // URL-decode the path - Toast UI encodes markdown link paths
          if (pagePath) {
            try {
              pagePath = decodeURIComponent(pagePath);
            } catch (e) {
              console.warn('[Link] Failed to decode path:', e);
            }
          }
          if (pagePath) {
            navigateToAzurePage(pagePath);
          } else {
            showToast('Could not resolve wiki link', 'warning');
          }
        } else {
          window.electronAPI.openExternal(href);
        }
        break;

      case 'newTab':
        if (isInternal) {
          let pagePath = await getPagePathFromHref(href);
          // URL-decode the path - Toast UI encodes markdown link paths
          if (pagePath) {
            try {
              pagePath = decodeURIComponent(pagePath);
            } catch (e) {
              console.warn('[Link] Failed to decode path:', e);
            }
          }
          if (pagePath) {
            window.electronAPI.wikiOpenInNewTab(pagePath);
          } else {
            showToast('Could not resolve wiki link', 'warning');
          }
        }
        break;

      case 'newWindow':
        if (isInternal) {
          let pagePath = await getPagePathFromHref(href);
          // URL-decode the path - Toast UI encodes markdown link paths
          if (pagePath) {
            try {
              pagePath = decodeURIComponent(pagePath);
            } catch (e) {
              console.warn('[Link] Failed to decode path:', e);
            }
          }
          if (pagePath) {
            window.electronAPI.wikiOpenInNewWindow(pagePath);
          } else {
            showToast('Could not resolve wiki link', 'warning');
          }
        }
        break;

      case 'openExternal':
        // Works for both internal and external links
        window.electronAPI.openExternal(href);
        break;

      case 'copy':
        navigator.clipboard.writeText(href).then(() => {
          showToast('Link copied to clipboard', 'success');
        }).catch(() => {
          showToast('Failed to copy link', 'error');
        });
        break;
    }
  });
}

/**
 * Get the page path from an href, handling both Azure URLs and relative paths
 * @param {string} href - The link href
 * @returns {Promise<string|null>} - The page path or null
 */
async function getPagePathFromHref(href) {
  if (href.includes('dev.azure.com')) {
    const parsed = parseAzureWikiUrl(href);

    // If we have a page ID, always use API to resolve the correct path
    // The URL slug is not reliable for determining the actual page path
    if (parsed.pageId) {
      console.log('[Link] Resolving page ID via API:', parsed.pageId);
      return await resolvePageIdToPath(parsed.pageId);
    }

    // Fall back to pagePath query parameter if available (this is reliable)
    if (parsed.path) {
      return parsed.path;
    }

    return null;
  } else {
    return resolveWikiPath(href);
  }
}

// ============================================
// Network Status Monitoring
// ============================================

/**
 * Initialize network status monitoring
 * Creates status indicator and sets up listeners
 */
function initNetworkStatus() {
  // Create the network status indicator element
  const indicator = document.createElement('div');
  indicator.id = 'network-status';
  indicator.className = 'network-status';
  indicator.innerHTML = `
    <span class="network-status-dot"></span>
    <span class="network-status-text">Online</span>
    <span class="network-queue-badge" style="display: none;">0</span>
  `;
  document.body.appendChild(indicator);

  // Initialize network status module
  const status = networkStatus.init();
  console.log('[Network] Initial status:', status);

  // Subscribe to status changes
  networkStatus.subscribe((newStatus, data) => {
    updateNetworkIndicator(newStatus, data);
  });

  // Listen for queue processing event
  window.addEventListener('network:processQueue', handleQueueProcessing);

  // If there are queued saves from a previous session, show indicator
  if (status.queueSize > 0) {
    updateNetworkIndicator('queued', { queueSize: status.queueSize });
  }
}

/**
 * Update the network status indicator UI
 * @param {string} status - Network status ('online', 'offline', 'syncing', 'queued', 'synced')
 * @param {Object} data - Additional data { queueSize }
 */
function updateNetworkIndicator(status, data = {}) {
  const indicator = document.getElementById('network-status');
  if (!indicator) return;

  const textEl = indicator.querySelector('.network-status-text');
  const badgeEl = indicator.querySelector('.network-queue-badge');

  // Remove all status classes
  indicator.classList.remove('online', 'offline', 'syncing', 'queued', 'visible');

  switch (status) {
    case 'online':
      indicator.classList.add('online', 'visible');
      textEl.textContent = 'Back Online';
      badgeEl.style.display = 'none';
      // Hide after 3 seconds
      setTimeout(() => {
        if (indicator.classList.contains('online')) {
          indicator.classList.remove('visible');
        }
      }, 3000);
      break;

    case 'offline':
      indicator.classList.add('offline', 'visible');
      textEl.textContent = 'Offline';
      badgeEl.style.display = 'none';
      break;

    case 'syncing':
      indicator.classList.add('syncing', 'visible');
      textEl.textContent = 'Syncing...';
      if (data.queueSize > 0) {
        badgeEl.textContent = data.queueSize;
        badgeEl.style.display = 'inline';
      } else {
        badgeEl.style.display = 'none';
      }
      break;

    case 'queued':
      indicator.classList.add('queued', 'visible');
      textEl.textContent = 'Pending Saves';
      if (data.queueSize > 0) {
        badgeEl.textContent = data.queueSize;
        badgeEl.style.display = 'inline';
      }
      break;

    case 'synced':
      indicator.classList.add('online', 'visible');
      textEl.textContent = 'All Synced';
      badgeEl.style.display = 'none';
      // Hide after 3 seconds
      setTimeout(() => {
        indicator.classList.remove('visible');
      }, 3000);
      break;

    default:
      indicator.classList.remove('visible');
  }
}

/**
 * Handle processing of the queued saves when coming back online
 * @param {CustomEvent} event
 */
async function handleQueueProcessing(event) {
  const { queue } = event.detail;
  if (!queue || queue.length === 0) return;

  console.log('[Network] Processing', queue.length, 'queued saves');

  for (const item of queue) {
    try {
      console.log('[Network] Retrying save for:', item.pagePath);

      // Attempt to save via Azure API
      const result = await window.electronAPI.azureSavePage({
        wikiId: item.wikiId,
        pagePath: item.pagePath,
        content: item.content
      });

      if (result.success) {
        // Remove from queue on success
        networkStatus.removeFromQueue(item.wikiId, item.pagePath);
        console.log('[Network] Successfully synced:', item.pagePath);
      } else {
        console.warn('[Network] Failed to sync:', item.pagePath, result.error);
      }
    } catch (error) {
      console.error('[Network] Error syncing:', item.pagePath, error);
    }
  }
}

/**
 * Queue a failed save for later retry
 * @param {Object} saveData - { wikiId, pagePath, content }
 */
export function queueFailedSave(saveData) {
  return networkStatus.queueSave(saveData);
}

/**
 * Check if we're currently online
 * @returns {boolean}
 */
export function isOnline() {
  return networkStatus.getIsOnline();
}

// ============================================
// Settings Management
// ============================================

/**
 * Initialize settings - load and apply, set up change listener
 */
function initSettings() {
  // Load and apply settings on startup
  const settings = loadSettings();
  setTimeout(() => {
    applySettings(editor, settings);
  }, 500); // Wait for editor to fully initialize

  // Listen for settings changes
  onSettingsChange((newSettings) => {
    applySettings(editor, newSettings);
  });

  console.log('[Settings] Initialized with:', settings);
}
