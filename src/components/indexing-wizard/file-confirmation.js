/**
 * File Confirmation Component
 * Folder-tree UI with checkboxes for reviewing/excluding files before indexing
 */

// Internal state for the tree
let treeData = [];
let allFiles = [];
let filterText = '';
let onChangeCallback = null;

/**
 * Create the file confirmation HTML shell
 * @returns {string} HTML string
 */
export function createFileConfirmationHTML() {
  return `
    <div class="file-confirmation">
      <div class="file-confirmation-header">
        <span class="file-confirmation-summary">0 files found</span>
        <div class="file-confirmation-actions">
          <button class="fc-select-all" type="button">Select All</button>
          <button class="fc-deselect-all" type="button">Deselect All</button>
        </div>
        <input class="fc-filter" type="text" placeholder="Filter files...">
      </div>
      <div class="file-confirmation-tree"></div>
      <div class="file-confirmation-footer">
        <span class="fc-selected-count">Selected: 0 of 0 files</span>
      </div>
    </div>
  `;
}

/**
 * Build a folder tree from a flat file list
 * @param {Array} files - Array of {path, name, rootPath, relativePath}
 * @returns {Array} Tree nodes
 */
function buildTree(files) {
  const roots = new Map(); // rootPath -> tree node

  for (const file of files) {
    const rootKey = file.rootPath;
    if (!roots.has(rootKey)) {
      const rootName = rootKey.split(/[\\/]/).pop() || rootKey;
      roots.set(rootKey, {
        name: rootName,
        path: rootKey,
        isDirectory: true,
        children: [],
        expanded: true,
        checked: true
      });
    }

    const root = roots.get(rootKey);
    const parts = file.relativePath.replace(/\\/g, '/').split('/');

    let currentNode = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let child = currentNode.children.find(c => c.isDirectory && c.name === parts[i]);
      if (!child) {
        child = {
          name: parts[i],
          path: file.rootPath + '/' + parts.slice(0, i + 1).join('/'),
          isDirectory: true,
          children: [],
          expanded: false,
          checked: true
        };
        currentNode.children.push(child);
      }
      currentNode = child;
    }

    // Add file leaf
    currentNode.children.push({
      name: file.name,
      path: file.path,
      relativePath: file.relativePath,
      rootPath: file.rootPath,
      isDirectory: false,
      checked: true,
      fileObj: file
    });
  }

  // Sort children: folders first, then alphabetically
  function sortChildren(node) {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortChildren);
    }
  }

  const result = Array.from(roots.values());
  result.forEach(sortChildren);

  // Compute file counts
  function computeCounts(node) {
    if (!node.isDirectory) return { total: 1, selected: node.checked ? 1 : 0 };
    let total = 0, selected = 0;
    for (const child of (node.children || [])) {
      const c = computeCounts(child);
      total += c.total;
      selected += c.selected;
    }
    node.fileCount = total;
    node.selectedCount = selected;
    return { total, selected };
  }
  result.forEach(computeCounts);

  return result;
}

/**
 * Render the tree into the container
 * @param {HTMLElement} container - Wizard container
 */
function renderTree(container) {
  const treeEl = container.querySelector('.file-confirmation-tree');
  if (!treeEl) return;

  const filter = filterText.toLowerCase();
  treeEl.innerHTML = '';

  function renderNode(node, depth) {
    // If filtering, only show matching files and their ancestor folders
    if (filter && !nodeMatchesFilter(node, filter)) return;

    const el = document.createElement('div');
    el.className = `fc-node ${node.isDirectory ? 'fc-folder' : 'fc-file'}`;
    el.style.paddingLeft = `${8 + depth * 20}px`;
    el.dataset.path = node.path;

    if (node.isDirectory) {
      const expandBtn = document.createElement('span');
      expandBtn.className = 'fc-expand-btn';
      expandBtn.textContent = node.expanded ? '\u25BC' : '\u25B6';
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        node.expanded = !node.expanded;
        renderTree(container);
      });
      el.appendChild(expandBtn);
    } else {
      // Spacer for alignment
      const spacer = document.createElement('span');
      spacer.className = 'fc-expand-btn';
      spacer.textContent = '';
      el.appendChild(spacer);
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'fc-checkbox';
    checkbox.checked = node.isDirectory ? isAllChecked(node) : node.checked;
    if (node.isDirectory && !isAllChecked(node) && !isNoneChecked(node)) {
      checkbox.indeterminate = true;
    }
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleNode(node, checkbox.checked);
      updateCounts(container);
      renderTree(container);
    });
    el.appendChild(checkbox);

    const icon = document.createElement('span');
    icon.className = 'fc-icon';
    icon.textContent = node.isDirectory ? '\uD83D\uDCC1' : '\uD83D\uDCC4';
    el.appendChild(icon);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'fc-name';
    nameSpan.textContent = node.isDirectory ? node.name + '/' : node.name;
    el.appendChild(nameSpan);

    if (node.isDirectory) {
      const countSpan = document.createElement('span');
      countSpan.className = 'fc-count';
      countSpan.textContent = `(${node.fileCount} files)`;
      el.appendChild(countSpan);
    }

    treeEl.appendChild(el);

    // Render children if expanded
    if (node.isDirectory && node.expanded) {
      for (const child of (node.children || [])) {
        renderNode(child, depth + 1);
      }
    }
  }

  for (const root of treeData) {
    renderNode(root, 0);
  }
}

/**
 * Check if a node or its descendants match the filter
 */
function nodeMatchesFilter(node, filter) {
  if (!node.isDirectory) {
    return node.name.toLowerCase().includes(filter) ||
           (node.relativePath && node.relativePath.toLowerCase().includes(filter));
  }
  if (node.name.toLowerCase().includes(filter)) return true;
  return (node.children || []).some(c => nodeMatchesFilter(c, filter));
}

/**
 * Check if all files under a directory are checked
 */
function isAllChecked(node) {
  if (!node.isDirectory) return node.checked;
  return (node.children || []).every(c => isAllChecked(c));
}

/**
 * Check if no files under a directory are checked
 */
function isNoneChecked(node) {
  if (!node.isDirectory) return !node.checked;
  return (node.children || []).every(c => isNoneChecked(c));
}

/**
 * Toggle a node and all descendants
 */
function toggleNode(node, checked) {
  if (!node.isDirectory) {
    node.checked = checked;
  } else {
    for (const child of (node.children || [])) {
      toggleNode(child, checked);
    }
  }
}

/**
 * Recompute file counts on tree nodes and update UI
 */
function updateCounts(container) {
  function recount(node) {
    if (!node.isDirectory) return { total: 1, selected: node.checked ? 1 : 0 };
    let total = 0, selected = 0;
    for (const child of (node.children || [])) {
      const c = recount(child);
      total += c.total;
      selected += c.selected;
    }
    node.fileCount = total;
    node.selectedCount = selected;
    return { total, selected };
  }

  let totalFiles = 0, selectedFiles = 0;
  for (const root of treeData) {
    const c = recount(root);
    totalFiles += c.total;
    selectedFiles += c.selected;
  }

  const summaryEl = container.querySelector('.file-confirmation-summary');
  if (summaryEl) summaryEl.textContent = `${totalFiles} files found`;

  const selectedEl = container.querySelector('.fc-selected-count');
  if (selectedEl) selectedEl.textContent = `Selected: ${selectedFiles} of ${totalFiles} files`;

  // Notify listener of selection change
  if (onChangeCallback) {
    onChangeCallback({ selected: selectedFiles, total: totalFiles });
  }
}

/**
 * Initialize the file confirmation tree
 * @param {HTMLElement} container - The wizard container element
 * @param {Array} files - Array of file objects from scanPreview
 * @param {Function} [onChange] - Called with {selected, total} on selection changes
 */
export function initFileConfirmation(container, files, onChange) {
  allFiles = files;
  filterText = '';
  onChangeCallback = onChange || null;
  treeData = buildTree(files);

  updateCounts(container);
  renderTree(container);

  // Setup filter input
  const filterInput = container.querySelector('.fc-filter');
  if (filterInput) {
    filterInput.value = '';
    filterInput.addEventListener('input', (e) => {
      filterText = e.target.value;
      // When filtering, expand all matching folders
      if (filterText) {
        expandMatchingNodes(treeData, filterText.toLowerCase());
      }
      renderTree(container);
    });
  }

  // Select All button
  const selectAllBtn = container.querySelector('.fc-select-all');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      treeData.forEach(root => toggleNode(root, true));
      updateCounts(container);
      renderTree(container);
    });
  }

  // Deselect All button
  const deselectAllBtn = container.querySelector('.fc-deselect-all');
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
      treeData.forEach(root => toggleNode(root, false));
      updateCounts(container);
      renderTree(container);
    });
  }
}

/**
 * Expand folders containing filter matches
 */
function expandMatchingNodes(nodes, filter) {
  for (const node of nodes) {
    if (node.isDirectory) {
      if (nodeMatchesFilter(node, filter)) {
        node.expanded = true;
      }
      expandMatchingNodes(node.children || [], filter);
    }
  }
}

/**
 * Get the list of confirmed (checked) file objects
 * @param {HTMLElement} container - The wizard container element
 * @returns {Array} Array of confirmed file objects
 */
export function getConfirmedFiles(container) {
  const confirmed = [];
  function collect(node) {
    if (!node.isDirectory) {
      if (node.checked && node.fileObj) {
        confirmed.push(node.fileObj);
      }
    } else {
      for (const child of (node.children || [])) {
        collect(child);
      }
    }
  }
  treeData.forEach(collect);
  return confirmed;
}

/**
 * Get file confirmation statistics
 * @param {HTMLElement} container - The wizard container element
 * @returns {{selected: number, total: number}}
 */
export function getFileConfirmationStats(container) {
  let total = 0, selected = 0;
  function count(node) {
    if (!node.isDirectory) {
      total++;
      if (node.checked) selected++;
    } else {
      for (const child of (node.children || [])) {
        count(child);
      }
    }
  }
  treeData.forEach(count);
  return { selected, total };
}
