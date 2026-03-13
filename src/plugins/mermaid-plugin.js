/**
 * Mermaid Plugin for Toast UI Editor
 *
 * Renders Mermaid diagrams in both WYSIWYG and preview panes.
 * Supports flowcharts, sequence diagrams, class diagrams, etc.
 */

import mermaid from 'mermaid';
import { showVisualMermaidEditor, canEditVisually } from '../components/mermaid-visual-editor/index.js';

// Track if mermaid is initialized
let mermaidInitialized = false;

// Initialize mermaid with configuration
function initMermaid(isDarkMode = false) {
  mermaid.initialize({
    startOnLoad: false,
    theme: isDarkMode ? 'dark' : 'default',
    securityLevel: 'loose',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true
    },
    sequence: {
      useMaxWidth: true
    },
    class: {
      useMaxWidth: true
    },
    classDiagram: {
      useMaxWidth: true
    },
    gantt: {
      useMaxWidth: true
    },
    // Ensure diagrams render at proper size
    maxTextSize: 90000,
    wrap: true
  });
  mermaidInitialized = true;
}

// Generate unique ID for mermaid diagrams
let mermaidId = 0;
function getUniqueId() {
  return `mermaid-diagram-${mermaidId++}`;
}

/**
 * Render a mermaid diagram from source code
 * Returns HTML string with SVG or error message
 */
async function renderMermaidToHtml(source) {
  if (!mermaidInitialized) {
    initMermaid();
  }

  const id = getUniqueId();

  try {
    const { svg } = await mermaid.render(id, source);
    return { success: true, html: svg };
  } catch (error) {
    console.error('Mermaid rendering error:', error);
    return {
      success: false,
      html: `<div class="mermaid-error-inline">Error: ${error.message || 'Invalid diagram'}</div>`
    };
  }
}

/**
 * MermaidNodeView - Custom ProseMirror NodeView for WYSIWYG rendering
 * Renders mermaid code blocks as SVG diagrams in the editor
 */
export class MermaidNodeView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Create the outer container
    this.dom = document.createElement('div');
    this.dom.className = 'mermaid-wysiwyg-wrapper';
    this.dom.setAttribute('tabindex', '0'); // Make focusable for keyboard events
    this.dom.setAttribute('contenteditable', 'false'); // Prevent editing
    // Add data attributes for Toast UI Editor scroll sync compatibility
    this.dom.setAttribute('data-nodeid', `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

    // Create toolbar with edit and delete buttons
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'mermaid-toolbar';
    this.toolbar.innerHTML = `
      <button class="mermaid-btn mermaid-btn-edit" title="Edit visually">✎ Edit</button>
      <button class="mermaid-btn mermaid-btn-delete" title="Delete diagram">✕ Delete</button>
    `;
    this.dom.appendChild(this.toolbar);

    // Create diagram container
    this.diagramContainer = document.createElement('div');
    this.diagramContainer.className = 'mermaid-wysiwyg-diagram';
    this.dom.appendChild(this.diagramContainer);

    // Create edit hint overlay
    this.editHint = document.createElement('div');
    this.editHint.className = 'mermaid-edit-hint';
    this.editHint.textContent = 'Click to select, double-click to edit';
    this.dom.appendChild(this.editHint);

    // Get the mermaid code from the node
    const code = this.getMermaidCode();
    this.renderDiagram(code);

    // Handle click to select
    this.dom.addEventListener('click', (e) => {
      e.preventDefault();
      this.selectThisNode();
    });

    // Handle double-click to open visual editor
    this.dom.addEventListener('dblclick', () => this.openVisualEditor());

    // Handle edit button click
    this.toolbar.querySelector('.mermaid-btn-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openVisualEditor();
    });

    // Handle delete button click
    this.toolbar.querySelector('.mermaid-btn-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteNode();
    });

    // Handle keyboard events when focused
    this.dom.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.deleteNode();
      } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
        // Insert paragraph below and move cursor there
        e.preventDefault();
        this.insertParagraphBelow();
      } else if (e.key === 'ArrowUp') {
        // Move cursor above the diagram
        e.preventDefault();
        this.moveCursorAbove();
      }
    });
  }

  insertParagraphBelow() {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;

    const { state } = this.view;
    const endPos = pos + this.node.nodeSize;
    const paragraphType = state.schema.nodes.paragraph;

    if (paragraphType) {
      const { TextSelection } = require('prosemirror-state');
      const tr = state.tr.insert(endPos, paragraphType.create());
      tr.setSelection(TextSelection.create(tr.doc, endPos + 1));
      this.view.dispatch(tr);
      this.view.focus();
    }
  }

  moveCursorAbove() {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;

    const { state } = this.view;
    const { TextSelection } = require('prosemirror-state');

    if (pos > 0) {
      // Move to position before this node
      const tr = state.tr.setSelection(TextSelection.create(state.doc, pos - 1));
      this.view.dispatch(tr);
      this.view.focus();
    } else {
      // We're at the start of the document, insert paragraph above
      const paragraphType = state.schema.nodes.paragraph;
      if (paragraphType) {
        const tr = state.tr.insert(0, paragraphType.create());
        tr.setSelection(TextSelection.create(tr.doc, 1));
        this.view.dispatch(tr);
        this.view.focus();
      }
    }
  }

  selectThisNode() {
    // Select this node in ProseMirror
    const pos = this.getPos();
    if (typeof pos === 'number') {
      const tr = this.view.state.tr.setSelection(
        this.view.state.schema.nodes.codeBlock
          ? require('prosemirror-state').NodeSelection.create(this.view.state.doc, pos)
          : this.view.state.tr.selection
      );
      this.view.dispatch(tr);
      this.dom.focus();
    }
  }

  deleteNode() {
    const pos = this.getPos();
    if (typeof pos === 'number') {
      const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
      this.view.dispatch(tr);
    }
  }

  getMermaidCode() {
    // Get text content from the code block node
    return this.node.textContent || '';
  }

  async renderDiagram(code) {
    if (!code.trim()) {
      this.diagramContainer.innerHTML = '<div class="mermaid-placeholder">Empty mermaid diagram</div>';
      return;
    }

    // Show loading state
    this.diagramContainer.innerHTML = '<div class="mermaid-loading">Rendering diagram...</div>';

    const result = await renderMermaidToHtml(code);
    this.diagramContainer.innerHTML = result.html;

    if (!result.success) {
      this.diagramContainer.classList.add('has-error');
    } else {
      this.diagramContainer.classList.remove('has-error');
    }
  }

  update(node) {
    // Only handle codeBlock nodes with mermaid language
    if (node.type.name !== 'codeBlock') return false;

    const language = node.attrs.language || '';
    if (language.toLowerCase() !== 'mermaid') return false;

    // Check if content changed
    const newCode = node.textContent || '';
    const oldCode = this.node.textContent || '';

    if (newCode !== oldCode) {
      this.node = node;
      this.renderDiagram(newCode);
    }

    return true;
  }

  selectNode() {
    this.dom.classList.add('selected');
  }

  deselectNode() {
    this.dom.classList.remove('selected');
  }

  stopEvent(event) {
    // Allow double-click to pass through for edit mode
    if (event.type === 'dblclick') return false;
    // Allow keyboard events for navigation and editing
    if (event.type === 'keydown') {
      const key = event.key;
      // Allow Delete, Backspace, Enter, and arrow keys
      if (key === 'Delete' || key === 'Backspace' || key === 'Enter' ||
          key === 'ArrowUp' || key === 'ArrowDown' ||
          key === 'ArrowLeft' || key === 'ArrowRight') {
        return false;
      }
    }
    // Block other events to prevent text editing
    return true;
  }

  ignoreMutation() {
    // Ignore mutations from our own rendering
    return true;
  }

  openEditMode() {
    // Switch to markdown mode to edit the code
    // This is a simple approach - could be enhanced with a modal editor
    const editorEl = document.querySelector('#editor');
    if (editorEl && editorEl.__editor) {
      try {
        editorEl.__editor.changeMode('markdown');
      } catch (error) {
        // Mode switch can fail with complex diagrams due to ProseMirror position mapping
        console.warn('Could not switch to markdown mode:', error.message);
        // Show a user-friendly message
        this.showEditError();
      }
    }
  }

  showEditError() {
    // Create a temporary toast notification
    const existing = document.querySelector('.mermaid-edit-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'mermaid-edit-toast toast-notification toast-warning show';
    toast.textContent = 'Cannot edit in WYSIWYG mode. Use View menu to switch to Markdown mode.';
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  openVisualEditor() {
    const code = this.getMermaidCode();

    // Check if this diagram can be edited visually
    if (!canEditVisually(code)) {
      this.showUnsupportedDiagramError();
      return;
    }

    // Open visual editor with callback to update the node
    showVisualMermaidEditor(code, (newCode) => {
      this.updateMermaidCode(newCode);
    });
  }

  showUnsupportedDiagramError() {
    const existing = document.querySelector('.mermaid-edit-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'mermaid-edit-toast toast-notification toast-warning show';
    toast.textContent = 'This diagram type cannot be edited visually. Only flowcharts and sequence diagrams are supported.';
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  updateMermaidCode(newCode) {
    // Remove code block markers if present
    let code = newCode.replace(/^```mermaid\s*/i, '').replace(/\s*```$/, '');

    const pos = this.getPos();
    if (typeof pos !== 'number') return;

    // Create a new code block node with the updated content
    const schema = this.view.state.schema;
    const codeBlockType = schema.nodes.codeBlock;

    if (codeBlockType) {
      const newNode = codeBlockType.create(
        { language: 'mermaid' },
        schema.text(code)
      );

      const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, newNode);
      this.view.dispatch(tr);
    }
  }

  destroy() {
    // Cleanup if needed
  }
}

/**
 * Toast UI Editor plugin for Mermaid
 */
export function mermaidPlugin(context, options = {}) {
  // Initialize with theme
  const isDarkMode = options.isDarkMode || false;
  initMermaid(isDarkMode);

  // HTML renderers for preview/markdown pane
  const toHTMLRenderers = {
    codeBlock(node, context) {
      const info = node.info || '';
      const code = node.literal || '';

      if (info.toLowerCase() === 'mermaid') {
        const escapedCode = code
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

        return {
          type: 'html',
          content: `<div class="mermaid-pending" data-mermaid-source="${escapedCode}"><div class="mermaid-container">Loading diagram...</div></div>`
        };
      }

      return context.origin();
    }
  };

  // WYSIWYG NodeViews for rendering in the editor
  const wysiwygNodeViews = {
    codeBlock: (node, view, getPos) => {
      const language = node.attrs.language || '';

      // Only handle mermaid code blocks
      if (language.toLowerCase() === 'mermaid') {
        return new MermaidNodeView(node, view, getPos);
      }

      // Return null to use default rendering for non-mermaid code blocks
      return null;
    }
  };

  return {
    toHTMLRenderers,
    wysiwygNodeViews
  };
}

/**
 * Process pending mermaid diagrams after DOM update
 * Call this after the editor updates the preview
 */
export async function processPendingMermaidDiagrams(container) {
  if (!container) return;

  const pendingDiagrams = container.querySelectorAll('.mermaid-pending');

  for (const element of pendingDiagrams) {
    if (!element.parentNode) continue;

    const source = element.getAttribute('data-mermaid-source');
    if (source) {
      const decodedSource = source
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');

      try {
        const result = await renderMermaidToHtml(decodedSource);
        if (element.parentNode) {
          element.outerHTML = `<div class="mermaid-container">${result.html}</div>`;
        }
      } catch (err) {
        console.warn('Mermaid processing skipped:', err.message);
      }
    }
  }
}

/**
 * Update mermaid theme (call when dark mode changes)
 */
export function updateMermaidTheme(isDarkMode) {
  mermaid.initialize({
    theme: isDarkMode ? 'dark' : 'default'
  });
}

export default mermaidPlugin;
