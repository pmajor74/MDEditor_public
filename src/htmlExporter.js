/**
 * HTML Exporter - Converts markdown to a self-contained HTML file
 * Handles mermaid diagrams, grid tables, TOC, and image embedding.
 */

import { marked } from 'marked';
import mermaid from 'mermaid';
import { extractGridTables, parseGridTable, renderGridTableToHtml } from './plugins/grid-table-plugin.js';

// Initialize mermaid for export (light theme, no interaction)
let mermaidInitialized = false;
function ensureMermaidInit() {
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      flowchart: { useMaxWidth: true },
      sequence: { useMaxWidth: true }
    });
    mermaidInitialized = true;
  }
}

let mermaidIdCounter = 0;

/**
 * Extract mermaid code blocks from markdown, replacing with placeholders.
 * Returns { markdown, blocks } where blocks is an array of mermaid source strings.
 */
function extractMermaidBlocks(markdown) {
  const blocks = [];
  const result = markdown.replace(/```mermaid\s*\n([\s\S]*?)```/g, (match, code) => {
    const index = blocks.length;
    blocks.push(code.trim());
    return `<!--MERMAID_${index}-->`;
  });
  return { markdown: result, blocks };
}

/**
 * Extract grid tables from markdown, replacing with placeholders.
 * Returns { markdown, tables } where tables is an array of grid table content strings.
 */
function extractGridTableBlocks(markdown) {
  const tables = extractGridTables(markdown);
  if (tables.length === 0) return { markdown, tables: [] };

  const tableContents = [];
  // Process in reverse order so line offsets stay valid
  const lines = markdown.split('\n');
  const sortedTables = [...tables].sort((a, b) => b.startLine - a.startLine);

  for (const table of sortedTables) {
    const index = tableContents.length;
    tableContents.unshift(table.content);
    lines.splice(table.startLine, table.endLine - table.startLine + 1, `<!--GRIDTABLE_${tableContents.length - 1 - index}-->`);
  }

  // Fix indices - we unshifted so they're reversed
  const finalContents = [];
  const resultLines = lines.join('\n');
  // Re-extract to get correct ordering
  let reindexed = resultLines;
  const placeholderPattern = /<!--GRIDTABLE_(\d+)-->/g;
  let placeholderMatch;
  const placeholders = [];
  while ((placeholderMatch = placeholderPattern.exec(resultLines)) !== null) {
    placeholders.push(parseInt(placeholderMatch[1]));
  }

  // Rebuild with sequential indices
  let idx = 0;
  for (const origIdx of placeholders) {
    finalContents.push(tableContents[origIdx]);
    idx++;
  }

  // Replace original indices with sequential ones
  let seqIdx = 0;
  const finalMarkdown = resultLines.replace(/<!--GRIDTABLE_\d+-->/g, () => {
    return `<!--GRIDTABLE_${seqIdx++}-->`;
  });

  return { markdown: finalMarkdown, tables: finalContents };
}

/**
 * Generate a TOC from heading lines in the markdown.
 * Returns HTML string for the table of contents.
 */
function generateToc(markdown) {
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
    headings.push({ level, text, id });
  }

  if (headings.length === 0) return '';

  let html = '<nav class="toc"><h2>Contents</h2><ul>';
  for (const h of headings) {
    const indent = h.level - 1;
    html += `<li style="margin-left: ${indent * 16}px"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`;
  }
  html += '</ul></nav>';
  return html;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Add id attributes to headings in the HTML output for TOC anchor links.
 */
function addHeadingIds(html) {
  return html.replace(/<h([1-6])>(.*?)<\/h[1-6]>/g, (match, level, text) => {
    const plainText = text.replace(/<[^>]+>/g, '');
    const id = plainText
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
    return `<h${level} id="${id}">${text}</h${level}>`;
  });
}

/**
 * Render mermaid blocks to SVG strings.
 * Returns array of SVG HTML strings (or error messages).
 */
async function renderMermaidBlocks(blocks) {
  if (blocks.length === 0) return [];
  ensureMermaidInit();

  const results = [];
  for (const source of blocks) {
    try {
      const id = `mermaid-export-${mermaidIdCounter++}`;
      const { svg } = await mermaid.render(id, source);
      results.push(svg);
    } catch (err) {
      results.push(`<pre class="mermaid-error">Mermaid rendering error: ${escapeHtml(err.message)}\n\n${escapeHtml(source)}</pre>`);
    }
  }
  return results;
}

/**
 * Render grid table blocks to HTML table strings.
 */
function renderGridTables(tableBlocks) {
  return tableBlocks.map(content => {
    try {
      const parsed = parseGridTable(content);
      return renderGridTableToHtml(parsed);
    } catch (err) {
      return `<pre class="grid-table-error">Grid table parsing error: ${escapeHtml(err.message)}\n\n${escapeHtml(content)}</pre>`;
    }
  });
}

/**
 * Embed images as base64 data URIs.
 * Processes <img> tags in the HTML and replaces src with data URIs.
 */
async function embedImages(html) {
  const imgRegex = /<img\s+[^>]*src="([^"]+)"[^>]*>/g;
  const matches = [];
  let imgMatch;

  while ((imgMatch = imgRegex.exec(html)) !== null) {
    matches.push({ fullMatch: imgMatch[0], src: imgMatch[1], index: imgMatch.index });
  }

  if (matches.length === 0) return html;

  // Process each image
  for (const m of matches) {
    const src = m.src;
    let dataUrl = null;

    try {
      if (src.startsWith('data:')) {
        // Already a data URI, skip
        continue;
      } else if (src.includes('.attachments/') || src.startsWith('.attachments/')) {
        // Azure attachment - try to fetch via IPC
        const filename = src.split('.attachments/').pop();
        try {
          dataUrl = await window.electronAPI.fetchAzureAttachment(filename);
        } catch (e) {
          console.warn('Could not fetch Azure attachment:', filename, e);
        }
      } else if (src.startsWith('http://') || src.startsWith('https://')) {
        // Remote URL - fetch and convert to base64
        try {
          const response = await fetch(src);
          if (response.ok) {
            const blob = await response.blob();
            dataUrl = await blobToDataUrl(blob);
          }
        } catch (e) {
          console.warn('Could not fetch remote image:', src, e);
        }
      }
    } catch (e) {
      console.warn('Image embedding failed for:', src, e);
    }

    if (dataUrl) {
      html = html.replace(m.fullMatch, m.fullMatch.replace(src, dataUrl));
    }
  }

  return html;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Extract title from HTML (first h1) or return a default.
 */
function extractTitle(html) {
  const match = html.match(/<h1[^>]*>(.*?)<\/h1>/);
  if (match) {
    return match[1].replace(/<[^>]+>/g, '');
  }
  return 'Exported Document';
}

/**
 * Get the CSS styles for the exported HTML document.
 */
function getExportStyles() {
  return `
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.6;
      color: #333;
      background: #fff;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
      color: #1a1a1a;
    }
    h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #eaecef; }
    h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #eaecef; }
    h3 { font-size: 1.25em; }
    a { color: #0366d6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    p { margin-top: 0; margin-bottom: 16px; }
    img { max-width: 100%; height: auto; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 16px;
    }
    table th, table td {
      border: 1px solid #dfe2e5;
      padding: 8px 12px;
      text-align: left;
    }
    table th {
      background-color: #f6f8fa;
      font-weight: 600;
    }
    table tr:nth-child(even) {
      background-color: #f9f9f9;
    }
    pre {
      background: #f6f8fa;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 85%;
      line-height: 1.45;
    }
    code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 85%;
    }
    pre code {
      background: none;
      padding: 0;
      border-radius: 0;
      font-size: 100%;
    }
    blockquote {
      margin: 0 0 16px 0;
      padding: 0 16px;
      color: #6a737d;
      border-left: 4px solid #dfe2e5;
    }
    hr {
      border: 0;
      border-top: 1px solid #eaecef;
      margin: 24px 0;
    }
    ul, ol {
      margin-top: 0;
      margin-bottom: 16px;
      padding-left: 2em;
    }
    li + li {
      margin-top: 4px;
    }
    input[type="checkbox"] {
      margin-right: 6px;
    }
    .mermaid-diagram {
      text-align: center;
      margin: 16px 0;
    }
    .mermaid-diagram svg {
      max-width: 100%;
      height: auto;
    }
    .mermaid-error {
      color: #d73a49;
      border: 1px solid #d73a49;
      border-radius: 6px;
      padding: 12px;
    }
    .grid-table-error {
      color: #d73a49;
      border: 1px solid #d73a49;
      border-radius: 6px;
      padding: 12px;
    }
    .toc {
      background: #f6f8fa;
      border: 1px solid #eaecef;
      border-radius: 6px;
      padding: 16px 24px;
      margin-bottom: 24px;
    }
    .toc h2 {
      margin-top: 0;
      padding-bottom: 0;
      border-bottom: none;
      font-size: 1.1em;
    }
    .toc ul {
      list-style: none;
      padding-left: 0;
      margin-bottom: 0;
    }
    .toc li {
      padding: 2px 0;
    }
    .toc a {
      color: #0366d6;
    }
  `;
}

/**
 * Main export function.
 * Converts markdown to a self-contained HTML document.
 * @param {string} markdown - The raw markdown content
 * @returns {Promise<string>} - Complete HTML document string
 */
export async function exportToHtml(markdown) {
  // 1. Extract special blocks (mermaid and grid tables) and replace with placeholders
  const mermaidResult = extractMermaidBlocks(markdown);
  let processedMd = mermaidResult.markdown;

  const gridResult = extractGridTableBlocks(processedMd);
  processedMd = gridResult.markdown;

  // 2. Generate TOC and replace [[_TOC_]]
  const toc = generateToc(markdown); // Use original markdown for heading extraction
  processedMd = processedMd.replace(/\[\[_TOC_\]\]/g, '<!--TOC_PLACEHOLDER-->');

  // 3. Convert markdown to HTML using marked
  marked.setOptions({
    gfm: true,
    breaks: true
  });
  let html = marked.parse(processedMd);

  // 4. Replace TOC placeholder
  html = html.replace(/<!--TOC_PLACEHOLDER-->/g, toc);

  // 5. Add heading IDs for TOC anchor links
  html = addHeadingIds(html);

  // 6. Render mermaid diagrams and replace placeholders
  const mermaidSvgs = await renderMermaidBlocks(mermaidResult.blocks);
  for (let i = 0; i < mermaidSvgs.length; i++) {
    html = html.replace(
      new RegExp(`<!--MERMAID_${i}-->`, 'g'),
      `<div class="mermaid-diagram">${mermaidSvgs[i]}</div>`
    );
  }

  // 7. Render grid tables and replace placeholders
  const gridHtmls = renderGridTables(gridResult.tables);
  for (let i = 0; i < gridHtmls.length; i++) {
    html = html.replace(
      new RegExp(`<!--GRIDTABLE_${i}-->`, 'g'),
      gridHtmls[i]
    );
  }

  // 8. Embed images as base64 data URIs
  html = await embedImages(html);

  // 9. Extract title
  const title = extractTitle(html);

  // 10. Wrap in full HTML document
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${getExportStyles()}</style>
</head>
<body>
${html}
</body>
</html>`;

  return fullHtml;
}
