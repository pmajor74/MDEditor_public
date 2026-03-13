/**
 * Find/Replace Modal Component
 *
 * Provides in-app find and replace functionality for the markdown editor.
 * Supports case sensitivity, whole word matching, and regex.
 */

let isVisible = false;
let editor = null;
let matches = [];
let currentMatchIndex = -1;
let searchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false
};
let matchRanges = []; // DOM Range objects for WYSIWYG CSS Highlight API

/**
 * Initialize the Find/Replace component
 * @param {Object} editorInstance - Toast UI Editor instance
 */
export function initFindReplace(editorInstance) {
  editor = editorInstance;
  createModal();
  setupKeyboardShortcuts();
}

/**
 * Create the modal HTML structure
 */
function createModal() {
  // Check if modal already exists
  if (document.getElementById('find-replace-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'find-replace-modal';
  modal.className = 'find-replace-modal hidden';
  modal.innerHTML = `
    <div class="find-replace-header">
      <span class="find-replace-title">Find and Replace</span>
      <button class="find-replace-close" title="Close (Escape)">&times;</button>
    </div>
    <div class="find-replace-body">
      <div class="find-replace-row">
        <input type="text" id="find-input" placeholder="Find..." autocomplete="off" />
        <span class="match-count" id="match-count"></span>
      </div>
      <div class="find-replace-row">
        <input type="text" id="replace-input" placeholder="Replace with..." autocomplete="off" />
      </div>
      <div class="find-replace-options">
        <label class="find-option">
          <input type="checkbox" id="find-case-sensitive" />
          <span>Case sensitive</span>
        </label>
        <label class="find-option">
          <input type="checkbox" id="find-whole-word" />
          <span>Whole word</span>
        </label>
        <label class="find-option">
          <input type="checkbox" id="find-regex" />
          <span>Regex</span>
        </label>
      </div>
      <div class="find-replace-actions">
        <div class="find-actions">
          <button id="find-prev" title="Previous (Shift+F3)">&#9650; Prev</button>
          <button id="find-next" title="Next (F3 or Enter)">Next &#9660;</button>
        </div>
        <div class="replace-actions">
          <button id="replace-one" title="Replace current match">Replace</button>
          <button id="replace-all" title="Replace all matches">Replace All</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Attach event listeners
  modal.querySelector('.find-replace-close').addEventListener('click', hide);
  modal.querySelector('#find-input').addEventListener('input', onSearchInput);
  modal.querySelector('#find-input').addEventListener('keydown', onFindKeydown);
  modal.querySelector('#replace-input').addEventListener('keydown', onReplaceKeydown);
  modal.querySelector('#find-next').addEventListener('click', findNext);
  modal.querySelector('#find-prev').addEventListener('click', findPrevious);
  modal.querySelector('#replace-one').addEventListener('click', replaceOne);
  modal.querySelector('#replace-all').addEventListener('click', replaceAll);

  // Option checkboxes
  modal.querySelector('#find-case-sensitive').addEventListener('change', (e) => {
    searchOptions.caseSensitive = e.target.checked;
    performSearch();
  });
  modal.querySelector('#find-whole-word').addEventListener('change', (e) => {
    searchOptions.wholeWord = e.target.checked;
    performSearch();
  });
  modal.querySelector('#find-regex').addEventListener('change', (e) => {
    searchOptions.regex = e.target.checked;
    performSearch();
  });

  // Close on click outside
  modal.addEventListener('mousedown', (e) => {
    if (e.target === modal) {
      hide();
    }
  });
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+F - Open Find
    if (e.ctrlKey && e.key === 'f' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      show();
    }

    // Ctrl+H - Open Find/Replace with focus on replace
    if (e.ctrlKey && e.key === 'h' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      show(true);
    }

    // Escape - Close modal
    if (e.key === 'Escape' && isVisible) {
      e.preventDefault();
      hide();
    }

    // F3 - Find next (when modal is open)
    if (e.key === 'F3' && isVisible) {
      e.preventDefault();
      if (e.shiftKey) {
        findPrevious();
      } else {
        findNext();
      }
    }
  });
}

/**
 * Show the Find/Replace modal
 * @param {boolean} focusReplace - Focus replace input instead of find
 */
export function show(focusReplace = false) {
  const modal = document.getElementById('find-replace-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  isVisible = true;

  const findInput = document.getElementById('find-input');
  const replaceInput = document.getElementById('replace-input');

  // Get selected text from editor and populate find input
  if (editor) {
    const selection = editor.getSelectedText ? editor.getSelectedText() : '';
    if (selection && selection.length < 100) {
      findInput.value = selection;
    }
  }

  // Focus appropriate input
  if (focusReplace && replaceInput) {
    replaceInput.focus();
    replaceInput.select();
  } else if (findInput) {
    findInput.focus();
    findInput.select();
  }

  // Perform initial search if there's text
  if (findInput.value) {
    performSearch();
  }
}

/**
 * Hide the Find/Replace modal
 */
export function hide() {
  const modal = document.getElementById('find-replace-modal');
  if (!modal) return;

  modal.classList.add('hidden');
  isVisible = false;
  clearHighlights();

  // Return focus to editor
  if (editor) {
    editor.focus();
  }
}

/**
 * Handle input in search field
 */
function onSearchInput() {
  performSearch();
}

/**
 * Handle keydown in find input
 */
function onFindKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) {
      findPrevious();
    } else {
      findNext();
    }
  }
}

/**
 * Handle keydown in replace input
 */
function onReplaceKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    replaceOne();
  }
}

/**
 * Build regex from search options
 * @param {string} searchText - Text to search for
 * @returns {RegExp|null} Compiled regex or null on error
 */
function buildSearchRegex(searchText) {
  if (!searchText) return null;

  try {
    let pattern = searchText;

    if (!searchOptions.regex) {
      // Escape regex special characters for literal search
      pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    if (searchOptions.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }

    const flags = searchOptions.caseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  } catch (error) {
    console.warn('[Find/Replace] Invalid regex:', error.message);
    return null;
  }
}

/**
 * Get the text content to search in based on editor mode
 * In WYSIWYG mode, we need to search the visible text, not markdown
 * @returns {string} The content to search in
 */
function getSearchableContent() {
  if (!editor) return '';

  // In WYSIWYG mode, get the plain text from the HTML content
  if (!editor.isMarkdownMode()) {
    // Get the WYSIWYG editor's ProseMirror view
    const wwEditor = editor.getEditorElements().wwEditor;
    if (wwEditor) {
      // Get text content from the contenteditable div
      return wwEditor.textContent || '';
    }
    // Fallback: strip HTML tags from getHTML()
    const html = editor.getHTML ? editor.getHTML() : '';
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.textContent || '';
  }

  // In markdown mode, search the markdown source
  return editor.getMarkdown();
}

/**
 * Perform search and highlight matches
 */
function performSearch() {
  const findInput = document.getElementById('find-input');
  const matchCount = document.getElementById('match-count');
  const searchText = findInput?.value || '';

  matches = [];
  currentMatchIndex = -1;

  if (!searchText || !editor) {
    if (matchCount) matchCount.textContent = '';
    return;
  }

  const regex = buildSearchRegex(searchText);
  if (!regex) {
    if (matchCount) matchCount.textContent = 'Invalid regex';
    return;
  }

  // Get editor content based on current mode
  const content = getSearchableContent();

  // Find all matches
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0]
    });

    // Prevent infinite loop for zero-length matches
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
  }

  // Build DOM ranges for WYSIWYG CSS Highlight API
  buildWysiwygRanges();

  // Update match count
  if (matchCount) {
    matchCount.textContent = matches.length > 0 ? `${matches.length} matches` : 'No matches';
  }

  // Highlight first match if any
  if (matches.length > 0) {
    currentMatchIndex = 0;
    highlightCurrentMatch();
  }
}

/**
 * Find next match
 */
function findNext() {
  if (matches.length === 0) {
    performSearch();
    return;
  }

  currentMatchIndex = (currentMatchIndex + 1) % matches.length;
  highlightCurrentMatch();
}

/**
 * Find previous match
 */
function findPrevious() {
  if (matches.length === 0) {
    performSearch();
    return;
  }

  currentMatchIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
  highlightCurrentMatch();
}

/**
 * Build DOM Range objects for all matches in WYSIWYG mode.
 * Used by the CSS Custom Highlight API to visually highlight matches
 * without creating a native selection (which would steal focus).
 */
function buildWysiwygRanges() {
  matchRanges = [];
  if (!editor || editor.isMarkdownMode()) return;

  const wwEditor = editor.getEditorElements().wwEditor;
  if (!wwEditor) return;

  const walker = document.createTreeWalker(wwEditor, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  let charCount = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    textNodes.push({ node, start: charCount, end: charCount + node.textContent.length });
    charCount += node.textContent.length;
  }

  for (const match of matches) {
    try {
      let startNode = null, startOffset = 0;
      let endNode = null, endOffset = 0;

      for (const tn of textNodes) {
        if (!startNode && tn.end > match.start) {
          startNode = tn.node;
          startOffset = match.start - tn.start;
        }
        if (!endNode && tn.end >= match.end) {
          endNode = tn.node;
          endOffset = match.end - tn.start;
          break;
        }
      }

      if (startNode && endNode) {
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        matchRanges.push(range);
      } else {
        matchRanges.push(null);
      }
    } catch (e) {
      console.warn('[Find/Replace] Could not build range for match:', e.message);
      matchRanges.push(null);
    }
  }
}

/**
 * Apply CSS Custom Highlight API highlights for WYSIWYG mode.
 * All matches get a yellow highlight; the current match gets orange.
 */
function applyWysiwygHighlights() {
  if (!CSS.highlights) return;

  const otherRanges = [];
  const currentRanges = [];

  for (let i = 0; i < matchRanges.length; i++) {
    if (!matchRanges[i]) continue;
    if (i === currentMatchIndex) {
      currentRanges.push(matchRanges[i]);
    } else {
      otherRanges.push(matchRanges[i]);
    }
  }

  if (otherRanges.length > 0) {
    CSS.highlights.set('find-matches', new Highlight(...otherRanges));
  } else {
    CSS.highlights.delete('find-matches');
  }

  if (currentRanges.length > 0) {
    CSS.highlights.set('find-current', new Highlight(...currentRanges));
  } else {
    CSS.highlights.delete('find-current');
  }
}

/**
 * Highlight the current match in the editor and scroll to it.
 * Uses CSS Custom Highlight API in WYSIWYG mode to avoid stealing
 * focus from the find input (which would break Enter-to-navigate).
 */
function highlightCurrentMatch() {
  if (currentMatchIndex < 0 || currentMatchIndex >= matches.length) return;
  if (!editor) return;

  const match = matches[currentMatchIndex];

  // Update match count display
  const matchCount = document.getElementById('match-count');
  if (matchCount) {
    matchCount.textContent = `${currentMatchIndex + 1}/${matches.length}`;
  }

  try {
    if (!editor.isMarkdownMode()) {
      // WYSIWYG mode: use CSS Custom Highlight API for visual highlighting
      applyWysiwygHighlights();

      // Scroll to the current match
      const range = matchRanges[currentMatchIndex];
      if (range && range.startContainer && range.startContainer.parentElement) {
        range.startContainer.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      // Markdown mode: use editor selection to scroll to match
      const content = getSearchableContent();

      const beforeMatch = content.substring(0, match.start);
      const lines = beforeMatch.split('\n');
      const line = lines.length;
      const column = lines[lines.length - 1].length + 1;

      const matchContent = content.substring(0, match.end);
      const matchLines = matchContent.split('\n');
      const endLine = matchLines.length;
      const endColumn = matchLines[matchLines.length - 1].length + 1;

      if (editor.setSelection) {
        editor.setSelection([line, column], [endLine, endColumn]);
      }
    }
  } catch (error) {
    console.warn('[Find/Replace] Could not highlight match:', error.message);
  }

  // Keep focus on find input so Enter continues to navigate matches
  const findInput = document.getElementById('find-input');
  if (findInput) findInput.focus();
}

/**
 * Clear all highlights
 */
function clearHighlights() {
  matches = [];
  matchRanges = [];
  currentMatchIndex = -1;

  // Clear CSS Custom Highlight API highlights
  if (CSS.highlights) {
    CSS.highlights.delete('find-matches');
    CSS.highlights.delete('find-current');
  }

  const matchCount = document.getElementById('match-count');
  if (matchCount) {
    matchCount.textContent = '';
  }
}

/**
 * Replace the current match
 */
function replaceOne() {
  if (currentMatchIndex < 0 || currentMatchIndex >= matches.length) return;
  if (!editor) return;

  const replaceInput = document.getElementById('replace-input');
  const replaceText = replaceInput?.value || '';
  const findInput = document.getElementById('find-input');
  const searchText = findInput?.value || '';

  const match = matches[currentMatchIndex];
  const wasWysiwyg = !editor.isMarkdownMode();

  if (wasWysiwyg) {
    // WYSIWYG mode: The safest approach is to work on the markdown source
    // since direct DOM manipulation doesn't sync with ProseMirror's state
    const content = editor.getMarkdown();
    const regex = buildSearchRegex(searchText);
    if (!regex) return;

    // Find and replace only the nth occurrence (currentMatchIndex)
    let occurrence = 0;
    const newContent = content.replace(regex, (matchStr) => {
      if (occurrence === currentMatchIndex) {
        occurrence++;
        return replaceText;
      }
      occurrence++;
      return matchStr;
    });

    // Temporarily switch to markdown mode, apply change, switch back
    editor.changeMode('markdown');
    editor.setMarkdown(newContent);

    setTimeout(() => {
      editor.changeMode('wysiwyg');
      // Re-search after mode switch settles
      setTimeout(performSearch, 100);
    }, 50);
  } else {
    // Markdown mode: use string replacement based on exact position
    const content = editor.getMarkdown();
    const newContent = content.substring(0, match.start) + replaceText + content.substring(match.end);
    editor.setMarkdown(newContent);

    // Re-search to update matches (positions have shifted)
    performSearch();
  }
}

/**
 * Replace all matches
 */
function replaceAll() {
  if (matches.length === 0) return;
  if (!editor) return;

  const findInput = document.getElementById('find-input');
  const replaceInput = document.getElementById('replace-input');
  const searchText = findInput?.value || '';
  const replaceText = replaceInput?.value || '';

  if (!searchText) return;

  const regex = buildSearchRegex(searchText);
  if (!regex) return;

  const replacedCount = matches.length;
  const wasWysiwyg = !editor.isMarkdownMode();

  // For replace all, always work on markdown source for reliability
  // This ensures consistent behavior across modes and proper replacement
  // Note: In WYSIWYG mode, we search visible text but replace in markdown
  // This is intentional - the user sees the visible text and that's what we match
  // But the replacement needs to happen in the source markdown

  // Get markdown content and build a regex for markdown mode
  const content = editor.getMarkdown();

  // In WYSIWYG mode, we searched visible text, so the found text should still
  // exist in markdown (though possibly with formatting around it)
  // The regex will find and replace all occurrences in the markdown source
  const newContent = content.replace(regex, replaceText);

  if (wasWysiwyg) {
    // Temporarily switch to markdown mode for the replacement
    editor.changeMode('markdown');
  }

  editor.setMarkdown(newContent);

  // Switch back to WYSIWYG if that was the original mode
  if (wasWysiwyg) {
    setTimeout(() => {
      editor.changeMode('wysiwyg');
      // Re-search after mode switch settles
      setTimeout(performSearch, 100);
    }, 50);
  } else {
    // Re-search to show no matches
    setTimeout(performSearch, 100);
  }

  // Clear matches and show result
  clearHighlights();
  const matchCount = document.getElementById('match-count');
  if (matchCount) {
    matchCount.textContent = `${replacedCount} replaced`;
  }
}

/**
 * Check if modal is visible
 * @returns {boolean} True if visible
 */
export function isModalVisible() {
  return isVisible;
}
