/**
 * Inline Markdown Input Component (CTRL-M)
 *
 * Opens a floating popup in WYSIWYG mode where the user can type raw markdown.
 * On Enter or blur, the markdown is parsed and inserted into the WYSIWYG editor
 * at the current cursor position using a marker-based strategy.
 */

let isVisible = false;
let editor = null;

/**
 * Initialize the inline markdown input component
 * @param {Object} editorInstance - Toast UI Editor instance
 */
export function initInlineMarkdownInput(editorInstance) {
  editor = editorInstance;
  createPopup();
  setupKeyboardShortcut();
}

/**
 * Create the popup DOM structure
 */
function createPopup() {
  if (document.getElementById('inline-md-input')) return;

  const popup = document.createElement('div');
  popup.id = 'inline-md-input';
  popup.className = 'inline-md-input hidden';
  popup.innerHTML = `
    <div class="inline-md-body">
      <textarea id="inline-md-textarea" rows="2" placeholder="Type raw markdown here..."></textarea>
      <div class="inline-md-hint">Enter to insert &middot; Shift+Enter for newline &middot; Esc to cancel</div>
    </div>
  `;

  document.body.appendChild(popup);

  const textarea = popup.querySelector('#inline-md-textarea');
  textarea.addEventListener('keydown', onTextareaKeydown);
  textarea.addEventListener('blur', onTextareaBlur);
}

/**
 * Register CTRL-M keyboard shortcut
 */
function setupKeyboardShortcut() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'm' && !e.shiftKey && !e.altKey) {
      e.preventDefault();

      // No-op if already in markdown tab
      if (editor && editor.isMarkdownMode()) {
        console.log('[INFO] InlineMarkdownInput: CTRL-M ignored — already in Markdown mode');
        return;
      }

      // Toggle if already visible
      if (isVisible) {
        hideInlineMarkdownInput();
        return;
      }

      showInlineMarkdownInput();
    }
  });
}

/**
 * Show the inline markdown input popup
 */
export function showInlineMarkdownInput() {
  const popup = document.getElementById('inline-md-input');
  if (!popup) return;

  // Get cursor position from the WYSIWYG editor's selection
  const sel = window.getSelection();
  let cursorTop = 200;
  let cursorLeft = 100;
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    let rect = range.getBoundingClientRect();

    // On empty lines the range rect is all zeros — fall back to the
    // containing block element (e.g. the <p>) which always has a position
    if (!rect || (rect.top === 0 && rect.height === 0)) {
      let node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      if (node && node.getBoundingClientRect) {
        rect = node.getBoundingClientRect();
      }
    }

    if (rect && rect.top !== 0) {
      // Offset so the textarea text aligns with the cursor line
      // body padding (8) + textarea border (1) + textarea padding (6) = 15
      cursorTop = rect.top - 15;
      cursorLeft = rect.left;
    }
  }

  // Clamp so it stays on screen
  const popupWidth = 380;
  const popupApproxHeight = 100;
  const maxLeft = window.innerWidth - popupWidth - 12;
  const maxTop = window.innerHeight - popupApproxHeight - 12;
  cursorLeft = Math.max(12, Math.min(cursorLeft, maxLeft));
  cursorTop = Math.max(12, Math.min(cursorTop, maxTop));

  popup.style.top = `${cursorTop}px`;
  popup.style.left = `${cursorLeft}px`;
  popup.classList.remove('hidden');
  isVisible = true;

  const textarea = document.getElementById('inline-md-textarea');
  if (textarea) {
    textarea.value = '';
    textarea.focus();
  }
}

/**
 * Hide the inline markdown input popup (cancel — no insertion)
 */
export function hideInlineMarkdownInput() {
  const popup = document.getElementById('inline-md-input');
  if (!popup) return;

  popup.classList.add('hidden');
  isVisible = false;

  // Return focus to editor
  if (editor) {
    editor.focus();
  }
}

/**
 * Handle keydown events inside the textarea
 */
function onTextareaKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    hideInlineMarkdownInput();
    return;
  }

  // Enter without Shift → submit
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitAndClose();
    return;
  }
  // Shift+Enter falls through to default (newline in textarea)
}

/**
 * Handle blur — submit if there's content, otherwise just close
 */
function onTextareaBlur(e) {
  if (!isVisible) return;

  // Small delay to allow click on close button to fire first
  setTimeout(() => {
    if (!isVisible) return;

    const textarea = document.getElementById('inline-md-textarea');
    const content = textarea?.value?.trim();
    if (content) {
      submitAndClose();
    } else {
      hideInlineMarkdownInput();
    }
  }, 150);
}

/**
 * Insert the user's markdown into the WYSIWYG editor and close the popup.
 *
 * Strategy (marker approach):
 * 1. Insert a unique marker at the WYSIWYG cursor position
 * 2. Serialize the whole editor to markdown (includes the marker)
 * 3. Replace the marker with the user's raw markdown
 * 4. Set the full markdown back — Toast UI re-renders everything
 */
function submitAndClose() {
  const textarea = document.getElementById('inline-md-textarea');
  const userMarkdown = textarea?.value?.trim();

  if (!userMarkdown || !editor) {
    hideInlineMarkdownInput();
    return;
  }

  try {
    // Generate a unique marker unlikely to collide with real content
    const marker = `INLINEMD${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

    // 1. Insert the marker at the current WYSIWYG cursor position
    editor.focus();
    editor.insertText(marker);

    // 2. Serialize editor to markdown (includes marker)
    const mdWithMarker = editor.getMarkdown();
    console.log('[DEBUG] InlineMarkdownInput: marker =', marker);
    console.log('[DEBUG] InlineMarkdownInput: markerFound =', mdWithMarker.includes(marker));

    // 3. Replace marker with user's markdown
    const newMd = mdWithMarker.replace(marker, userMarkdown);

    // 4. Re-render everything — setMarkdown triggers editor's 'change' event
    //    which handles mermaid diagrams, content tracking, and link handlers
    editor.setMarkdown(newMd);

    console.log('[INFO] InlineMarkdownInput: Inserted markdown via marker approach');
  } catch (err) {
    console.error('[ERROR] InlineMarkdownInput.submitAndClose:', err);
  }

  hideInlineMarkdownInput();
}
