/**
 * Scroll Utilities
 *
 * Shared scroll-to-top for editor mode switches.
 * Targets all scrollable containers in Toast UI Editor.
 */

/**
 * Scroll all editor containers to the top.
 * @param {Object} editor - Toast UI Editor instance
 * @param {Object} options
 * @param {number} [options.delay=0] - Delay in ms before scrolling
 */
export function scrollEditorToTop(editor, { delay = 0 } = {}) {
  const doScroll = () => {
    if (!editor) return;

    // WYSIWYG containers
    const wwEditor = editor.getEditorElements?.()?.wwEditor;
    if (wwEditor) wwEditor.scrollTop = 0;

    const wwContainer = document.querySelector('.toastui-editor-ww-container');
    if (wwContainer) wwContainer.scrollTop = 0;

    const proseMirror = document.querySelector('.ProseMirror');
    if (proseMirror) proseMirror.scrollTop = 0;

    document.querySelectorAll('.toastui-editor-contents').forEach(el => {
      el.scrollTop = 0;
    });

    // Markdown container + CodeMirror
    const mdContainer = document.querySelector('.toastui-editor-md-container');
    if (mdContainer) mdContainer.scrollTop = 0;

    const cmElement = document.querySelector('.toastui-editor-md-container .CodeMirror');
    if (cmElement?.CodeMirror) {
      cmElement.CodeMirror.scrollTo(0, 0);
    }
  };

  if (delay > 0) {
    setTimeout(doScroll, delay);
  } else {
    doScroll();
  }
}
