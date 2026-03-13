/**
 * Grid Table Plugin for Toast UI Editor
 *
 * Azure DevOps Wiki supports Grid Tables which have a different syntax
 * than standard markdown tables. This plugin renders them as visual
 * HTML tables while preserving the original formatting.
 *
 * Grid Table Example:
 * +--------+--------+
 * | Header | Header |
 * +========+========+
 * | Cell   | Cell   |
 * +--------+--------+
 */

// Pattern to detect grid tables (lines starting with + or |)
const GRID_TABLE_START = /^\+[-+=]+\+\s*$/;
const GRID_TABLE_ROW = /^\|.*\|\s*$/;
const GRID_TABLE_SEPARATOR = /^\+[-+=]+\+\s*$/;
const GRID_TABLE_HEADER_SEP = /^\+[=+]+\+\s*$/;

/**
 * Check if a text block contains a grid table
 */
export function containsGridTable(text) {
  if (!text) return false;
  const lines = text.split('\n');
  return lines.some(line => GRID_TABLE_START.test(line.trim()));
}

/**
 * Check if text is a complete grid table
 */
export function isGridTable(text) {
  if (!text) return false;
  const lines = text.trim().split('\n');
  if (lines.length < 3) return false;

  // First line must be a separator
  if (!GRID_TABLE_START.test(lines[0].trim())) return false;

  // Last line must be a separator
  if (!GRID_TABLE_SEPARATOR.test(lines[lines.length - 1].trim())) return false;

  // Must have at least one data row
  return lines.some(line => GRID_TABLE_ROW.test(line.trim()));
}

/**
 * Parse a grid table into structured data
 * @param {string} text - The grid table text
 * @returns {{ headers: string[], rows: string[][], hasHeaderSep: boolean }}
 */
export function parseGridTable(text) {
  const lines = text.trim().split('\n');
  const result = {
    headers: [],
    rows: [],
    hasHeaderSep: false
  };

  let headerSepIndex = -1;

  // Find header separator (line with === instead of ---)
  for (let i = 0; i < lines.length; i++) {
    if (GRID_TABLE_HEADER_SEP.test(lines[i].trim())) {
      headerSepIndex = i;
      result.hasHeaderSep = true;
      break;
    }
  }

  // Parse all data rows (lines starting with |)
  const dataRows = [];
  for (const line of lines) {
    if (GRID_TABLE_ROW.test(line.trim())) {
      // Extract cell contents
      const cells = line
        .trim()
        .slice(1, -1) // Remove leading and trailing |
        .split('|')
        .map(cell => cell.trim());
      dataRows.push(cells);
    }
  }

  if (result.hasHeaderSep && dataRows.length > 0) {
    // First row(s) before header separator are headers
    // Find how many rows are before the header separator
    let headerRowCount = 0;
    let rowIndex = 0;
    for (let i = 0; i < lines.length && i < headerSepIndex; i++) {
      if (GRID_TABLE_ROW.test(lines[i].trim())) {
        headerRowCount++;
      }
    }

    result.headers = dataRows.slice(0, headerRowCount).flat();
    result.rows = dataRows.slice(headerRowCount);
  } else {
    // No header separator - first row is header
    if (dataRows.length > 0) {
      result.headers = dataRows[0];
      result.rows = dataRows.slice(1);
    }
  }

  return result;
}

/**
 * Render parsed grid table as HTML
 * @param {{ headers: string[], rows: string[][], hasHeaderSep: boolean }} tableData
 * @returns {string} HTML table string
 */
export function renderGridTableToHtml(tableData) {
  const { headers, rows } = tableData;

  let html = '<table class="grid-table-rendered">';

  // Render header
  if (headers.length > 0) {
    html += '<thead><tr>';
    for (const header of headers) {
      html += `<th>${escapeHtml(header)}</th>`;
    }
    html += '</tr></thead>';
  }

  // Render body
  if (rows.length > 0) {
    html += '<tbody>';
    for (const row of rows) {
      html += '<tr>';
      for (const cell of row) {
        html += `<td>${escapeHtml(cell)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
  }

  html += '</table>';
  return html;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * GridTableNodeView - Custom ProseMirror NodeView for WYSIWYG rendering
 */
class GridTableNodeView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    // Create the outer container
    this.dom = document.createElement('div');
    this.dom.className = 'grid-table-wysiwyg-wrapper';

    // Create table container
    this.tableContainer = document.createElement('div');
    this.tableContainer.className = 'grid-table-wysiwyg-content';
    this.dom.appendChild(this.tableContainer);

    // Create edit hint overlay
    this.editHint = document.createElement('div');
    this.editHint.className = 'grid-table-edit-hint';
    this.editHint.textContent = 'Double-click to edit';
    this.dom.appendChild(this.editHint);

    // Create label
    this.label = document.createElement('div');
    this.label.className = 'grid-table-label';
    this.label.textContent = 'Grid Table (Azure DevOps)';
    this.dom.appendChild(this.label);

    // Get the grid table code and render
    const code = this.getGridTableCode();
    this.renderTable(code);

    // Handle double-click to edit
    this.dom.addEventListener('dblclick', () => this.openEditMode());
  }

  getGridTableCode() {
    return this.node.textContent || '';
  }

  renderTable(code) {
    if (!code.trim()) {
      this.tableContainer.innerHTML = '<div class="grid-table-empty">Empty grid table</div>';
      return;
    }

    if (!isGridTable(code)) {
      // Show raw code if not a valid grid table
      this.tableContainer.innerHTML = `<pre class="grid-table-raw">${escapeHtml(code)}</pre>`;
      return;
    }

    try {
      const tableData = parseGridTable(code);
      const html = renderGridTableToHtml(tableData);
      this.tableContainer.innerHTML = html;
    } catch (error) {
      console.error('Grid table parsing error:', error);
      this.tableContainer.innerHTML = `<div class="grid-table-error">Error parsing grid table</div>`;
    }
  }

  update(node) {
    // Only handle codeBlock nodes
    if (node.type.name !== 'codeBlock') return false;

    // Check if this is a grid table code block
    const code = node.textContent || '';
    if (!isGridTable(code)) return false;

    // Check if content changed
    const oldCode = this.node.textContent || '';
    if (code !== oldCode) {
      this.node = node;
      this.renderTable(code);
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
    // Block other events to prevent text editing
    return true;
  }

  ignoreMutation() {
    return true;
  }

  openEditMode() {
    const editorEl = document.querySelector('#editor');
    if (editorEl && editorEl.__editor) {
      editorEl.__editor.changeMode('markdown');
    }
  }

  destroy() {
    // Cleanup if needed
  }
}

/**
 * Toast UI Editor plugin for Grid Tables
 *
 * Note: We only use toHTMLRenderers (preview pane) to avoid conflicts
 * with Toast UI Editor's internal table selection handling.
 * WYSIWYG rendering would require deeper integration to avoid the
 * "Selection cannot be invoked without 'new'" error.
 */
export function gridTablePlugin() {
  const toHTMLRenderers = {
    // Override code block for grid tables
    codeBlock(node, context) {
      const info = node.info || '';
      const code = node.literal || '';

      // Check if this is a grid table (either marked as grid-table or auto-detected)
      if (info === 'grid-table' || (info === '' && isGridTable(code))) {
        try {
          const tableData = parseGridTable(code);
          const tableHtml = renderGridTableToHtml(tableData);

          return {
            type: 'html',
            content: `<div class="grid-table-preview">
              <div class="grid-table-label">Grid Table (Azure DevOps)</div>
              ${tableHtml}
            </div>`
          };
        } catch (error) {
          const escapedCode = escapeHtml(code);
          return {
            type: 'html',
            content: `<div class="grid-table-placeholder"><strong>Grid Table (Error)</strong>\n<pre>${escapedCode}</pre></div>`
          };
        }
      }

      return context.origin();
    }
  };

  return {
    toHTMLRenderers
  };
}

/**
 * Extract grid tables from markdown text
 */
export function extractGridTables(text) {
  const lines = text.split('\n');
  const tables = [];
  let currentTable = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (GRID_TABLE_START.test(line) && !inTable) {
      inTable = true;
      currentTable = [line];
    } else if (inTable) {
      if (GRID_TABLE_ROW.test(line) || GRID_TABLE_SEPARATOR.test(line)) {
        currentTable.push(line);
      } else if (line.trim() === '') {
        if (currentTable.length > 0) {
          tables.push({
            content: currentTable.join('\n'),
            startLine: i - currentTable.length,
            endLine: i - 1
          });
        }
        currentTable = [];
        inTable = false;
      } else {
        if (currentTable.length > 0) {
          tables.push({
            content: currentTable.join('\n'),
            startLine: i - currentTable.length,
            endLine: i - 1
          });
        }
        currentTable = [];
        inTable = false;
      }
    }
  }

  // Handle table at end of document
  if (currentTable.length > 0) {
    tables.push({
      content: currentTable.join('\n'),
      startLine: lines.length - currentTable.length,
      endLine: lines.length - 1
    });
  }

  return tables;
}

export default gridTablePlugin;
