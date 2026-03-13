/**
 * Azure DevOps TOC Plugin for Toast UI Editor
 *
 * Handles the [[_TOC_]] syntax used in Azure DevOps Wiki.
 * Uses a code-block approach (same as mermaid-plugin) to protect TOC syntax
 * from CommonMark emphasis parsing. [[_TOC_]] is converted to a ```toc code
 * block internally, rendered as a live TOC in both preview and WYSIWYG modes,
 * and converted back to [[_TOC_]] on save.
 */

/**
 * Normalize incorrect TOC syntax variants to the correct [[_TOC_]] form.
 * LLMs frequently output [[*TOC*]] which the markdown parser renders as
 * italic text instead of matching as a TOC token.
 */
export function normalizeTocSyntax(markdown) {
  if (!markdown) return markdown;
  return markdown.replace(/\[\[\*TOC\*\]\]/g, '[[_TOC_]]');
}

/**
 * Pre-process markdown: convert [[_TOC_]] to a ```toc code block.
 * Code blocks are protected from emphasis parsing by CommonMark.
 */
export function preprocessToc(markdown) {
  if (!markdown) return markdown;
  if (markdown.includes('```toc')) return markdown;
  return markdown.replace(/\[\[_TOC_\]\]/g, '```toc\nTOC\n```');
}

/**
 * Post-process markdown: convert ```toc code block back to [[_TOC_]].
 */
export function postprocessToc(markdown) {
  if (!markdown) return markdown;
  return markdown.replace(/```toc\s*\n[^\n]*\n\s*```/g, '[[_TOC_]]');
}

/**
 * Recursively collect ALL text from an AST node and its children,
 * including text inside emphasis/strong nodes whose _underscores_
 * are consumed by the commonmark parser.
 */
function collectTextFromNode(node) {
  let text = '';
  if (node.literal) text += node.literal;
  let child = node.firstChild;
  while (child) {
    text += collectTextFromNode(child);
    child = child.next;
  }
  return text;
}

/**
 * Walk an AST tree from a root node and collect all heading nodes
 * with their level and text content.
 */
function collectHeadingsFromAST(root) {
  const headings = [];
  function walk(node) {
    if (node.type === 'heading') {
      const text = collectTextFromNode(node);
      if (text.trim()) {
        headings.push({ level: node.level || 1, text: text.trim() });
      }
    }
    let child = node.firstChild;
    while (child) {
      walk(child);
      child = child.next;
    }
  }
  walk(root);
  return headings;
}

/**
 * Generate a slug/anchor from heading text (Azure DevOps style).
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Build TOC HTML from a list of headings.
 */
function buildTocHtml(headings) {
  if (!headings.length) {
    return '<div class="toc-empty">No headings found</div>';
  }

  const minLevel = Math.min(...headings.map(h => h.level));
  let html = '<h3 class="toc-title">Contents</h3><ul>';

  for (const heading of headings) {
    const indent = heading.level - minLevel;
    const paddingLeft = indent * 16;
    const anchor = slugify(heading.text);
    html += `<li style="padding-left:${paddingLeft}px"><a href="#${anchor}">${escapeHtml(heading.text)}</a></li>`;
  }

  html += '</ul>';
  return html;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Check if a paragraph AST node represents [[_TOC_]].
 * Handles the case where underscores are consumed as emphasis markup.
 */
function isTocParagraph(node) {
  const text = collectTextFromNode(node).trim();
  return text === '[[_TOC_]]' || text === '[[TOC]]';
}

/**
 * Extract headings from markdown text using regex.
 */
function extractHeadingsFromMarkdown(markdown) {
  if (!markdown) return [];
  const headings = [];
  const lines = markdown.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }
  }
  return headings;
}

/**
 * TocNodeView - Custom ProseMirror NodeView for WYSIWYG rendering.
 * Renders ```toc code blocks as a live table of contents.
 * Follows the same pattern as MermaidNodeView.
 */
export class TocNodeView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Create outer container
    this.dom = document.createElement('nav');
    this.dom.className = 'azure-toc-rendered';
    this.dom.setAttribute('contenteditable', 'false');
    this.dom.setAttribute('data-toc-marker', 'true');

    this.renderToc();

    // Make heading links scroll to matching headings
    this.dom.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link) return;
      e.preventDefault();

      const targetText = link.textContent;
      const wwEl = document.querySelector('.toastui-editor-ww-container .ProseMirror');
      if (!wwEl) return;

      const headingEls = wwEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const el of headingEls) {
        if (el.textContent.trim() === targetText) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        }
      }
    });
  }

  renderToc() {
    const headings = [];
    // Walk the ProseMirror document to find heading nodes
    this.view.state.doc.descendants((docNode) => {
      if (docNode.type.name === 'heading') {
        const text = docNode.textContent.trim();
        if (text) {
          headings.push({ level: docNode.attrs.level || 1, text });
        }
      }
    });
    this.dom.innerHTML = buildTocHtml(headings);
  }

  update(node) {
    if (node.type.name !== 'codeBlock') return false;
    const language = (node.attrs.language || '').toLowerCase();
    if (language !== 'toc') return false;
    this.node = node;
    this.renderToc();
    return true;
  }

  selectNode() {
    this.dom.classList.add('selected');
  }

  deselectNode() {
    this.dom.classList.remove('selected');
  }

  stopEvent() {
    return true;
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    // No cleanup needed
  }
}

/**
 * Toast UI Editor plugin for rendering TOC in preview and WYSIWYG modes.
 */
export function tocPlugin() {
  let currentParagraphIsToc = false;

  const toHTMLRenderers = {
    // Handle ```toc code blocks in preview
    codeBlock(node, context) {
      const language = (node.info || '').toLowerCase().trim();
      if (language !== 'toc') return context.origin();

      // Walk up to the document root to collect headings from the AST
      let root = node;
      while (root.parent) root = root.parent;
      const headings = collectHeadingsFromAST(root);

      return [
        { type: 'openTag', tagName: 'nav', classNames: ['azure-toc-rendered'], attributes: { contenteditable: 'false' } },
        { type: 'html', content: buildTocHtml(headings) },
        { type: 'closeTag', tagName: 'nav' }
      ];
    },

    // Handle [[_TOC_]] paragraphs that haven't been preprocessed yet.
    // Only intercept actual TOC paragraphs; all others use default rendering.
    paragraph(node, { entering, origin }) {
      if (entering && isTocParagraph(node)) {
        currentParagraphIsToc = true;

        let root = node;
        while (root.parent) root = root.parent;
        const headings = collectHeadingsFromAST(root);

        return [
          { type: 'openTag', tagName: 'nav', classNames: ['azure-toc-rendered'], attributes: { contenteditable: 'false' } },
          { type: 'html', content: buildTocHtml(headings) }
        ];
      }

      if (!entering && currentParagraphIsToc) {
        currentParagraphIsToc = false;
        return { type: 'closeTag', tagName: 'nav' };
      }

      // Delegate to default paragraph rendering
      return origin();
    }
  };

  return {
    toHTMLRenderers
  };
}

/**
 * Transform [[_TOC_]] / [[TOC]] paragraph nodes into ```toc code blocks
 * directly in ProseMirror after switching to WYSIWYG mode.
 * CommonMark emphasis parsing converts [[_TOC_]] into a paragraph with
 * emphasized "TOC" text. This function finds those paragraphs and replaces
 * them with codeBlock nodes that TocNodeView can render.
 */
function transformTocParagraphsToCodeBlocks(editor) {
  const pmView = editor.wwEditor?.view;
  if (!pmView) return;

  const { doc, schema } = pmView.state;
  const codeBlockType = schema.nodes.codeBlock;
  if (!codeBlockType) return;

  // Collect TOC paragraph positions (reverse order for safe replacement)
  const tocNodes = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph') {
      const text = node.textContent.trim();
      if (text === '[[_TOC_]]' || text === '[[TOC]]') {
        tocNodes.push({ pos, nodeSize: node.nodeSize });
      }
    }
  });

  if (tocNodes.length === 0) return;

  // Replace from end to start so earlier positions remain valid
  const tr = pmView.state.tr;
  for (let i = tocNodes.length - 1; i >= 0; i--) {
    const { pos, nodeSize } = tocNodes[i];
    const codeBlock = codeBlockType.create(
      { language: 'toc' },
      schema.text('TOC')
    );
    tr.replaceWith(pos, pos + nodeSize, codeBlock);
  }

  if (tr.docChanged) {
    // Save scroll position before dispatch - ProseMirror may auto-scroll
    // to keep the selection visible after the document structure changes.
    const wwContents = document.querySelector('.toastui-editor-ww-container .toastui-editor-contents');
    const savedScroll = wwContents ? wwContents.scrollTop : null;

    pmView.dispatch(tr);

    // Restore scroll position that ProseMirror may have changed
    if (wwContents && savedScroll !== null) {
      wwContents.scrollTop = savedScroll;
      requestAnimationFrame(() => { wwContents.scrollTop = savedScroll; });
    }
  }
}

/**
 * Set up WYSIWYG TOC rendering helpers.
 * Handles re-rendering TOC when headings change and mode switches.
 */
export function setupWysiwygTocRendering(editor) {
  if (!editor) return;

  let debounceTimer = null;

  function refreshTocElements() {
    const tocElements = document.querySelectorAll('.azure-toc-rendered[data-toc-marker]');
    if (!tocElements.length) return;

    // Get headings from editor content
    const markdown = editor.getMarkdown();
    const headings = extractHeadingsFromMarkdown(markdown);
    const html = buildTocHtml(headings);

    for (const el of tocElements) {
      el.innerHTML = html;
    }
  }

  // When switching to WYSIWYG, transform [[TOC]] paragraphs into code blocks
  // so TocNodeView can render them as a live table of contents
  editor.on('changeMode', (mode) => {
    if (mode === 'wysiwyg') {
      setTimeout(() => {
        transformTocParagraphsToCodeBlocks(editor);
        refreshTocElements();
      }, 100);
    }
  });

  // Refresh TOC content when headings change (debounced)
  editor.on('change', () => {
    if (!editor.isMarkdownMode()) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshTocElements, 500);
    }
  });
}

/**
 * Helper function to check if content contains TOC syntax
 */
export function containsToc(markdown) {
  if (!markdown) return false;
  return /\[\[_TOC_\]\]/g.test(markdown) || /```toc/.test(markdown);
}
