/**
 * Extension Selector Component
 * Provides file extension group selection UI for indexing configuration.
 * Extracted from file-browser.js for reuse in the indexing wizard.
 */

// Extension preset groups for catalog indexing
export const EXTENSION_GROUPS = {
  'Programming Files': {
    extensions: [
      // JavaScript / TypeScript
      '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte',
      // Python
      '.py', '.pyw', '.pyi', '.pyx',
      // C# / .NET
      '.cs', '.csx', '.cshtml', '.razor', '.csproj', '.vbproj', '.fsproj', '.sln',
      // C / C++
      '.c', '.h', '.cpp', '.hpp', '.cc', '.hh',
      // Java / Kotlin / Scala
      '.java', '.kt', '.kts', '.scala', '.groovy', '.gradle',
      // Go
      '.go',
      // Rust
      '.rs',
      // Ruby
      '.rb', '.erb', '.rake', '.gemspec',
      // PHP
      '.php', '.phtml',
      // Swift / Objective-C
      '.swift', '.m', '.mm',
      // Shell / Scripts
      '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.psd1', '.bat', '.cmd',
      // Visual Basic
      '.vb', '.vbs', '.vba',
      // Lua / Perl / R
      '.lua', '.pl', '.pm', '.r', '.R',
      // SQL
      '.sql',
      // Web markup
      '.html', '.htm', '.xhtml', '.css', '.scss', '.sass', '.less'
    ],
    default: true,
    description: 'Source code files for all major programming languages'
  },
  'Document Files': {
    extensions: ['.pdf'],
    default: false,
    description: 'PDF documents (uses more resources for image extraction)'
  },
  'Text Files': {
    extensions: [
      // Documentation
      '.md', '.markdown', '.mdown', '.mkd', '.txt', '.rst', '.adoc', '.asciidoc',
      // Config / Data
      '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.config',
      '.xml', '.xsl', '.xslt', '.xsd', '.dtd',
      '.env', '.env.example', '.env.local',
      '.properties', '.plist',
      // Build / Project configs
      '.cmake', '.makefile', '.mak',
      '.dockerfile', '.containerfile',
      '.tf', '.tfvars', '.hcl',
      // Git / Editor configs
      '.gitignore', '.gitattributes', '.gitmodules',
      '.editorconfig', '.prettierrc', '.eslintrc', '.stylelintrc',
      // Other text formats
      '.csv', '.tsv', '.log', '.diff', '.patch',
      '.graphql', '.gql', '.proto', '.thrift',
      '.tex', '.bib',
      '.license', '.readme', '.changelog'
    ],
    default: true,
    description: 'Documentation, config, and data files'
  }
};

/**
 * Generate HTML for extension group checkboxes
 * @returns {string} HTML string
 */
export function generateExtensionGroupsHTML() {
  let html = '<div class="extension-groups">';
  for (const [name, group] of Object.entries(EXTENSION_GROUPS)) {
    const checked = group.default ? 'checked' : '';
    const extCount = group.extensions.length;
    html += `
      <div class="extension-group-item">
        <label class="extension-group-header">
          <input type="checkbox" class="extension-group-checkbox"
                 data-extensions="${group.extensions.join(',')}" ${checked}>
          <span class="group-name">${escapeHtml(name)}</span>
          <span class="group-count">(${extCount} types)</span>
          <button type="button" class="group-expand-btn" title="Show/hide extensions">&#x25BC;</button>
        </label>
        <div class="group-description">${escapeHtml(group.description)}</div>
        <div class="group-extensions-detail hidden">
          <div class="extensions-list">${escapeHtml(group.extensions.join('  '))}</div>
        </div>
      </div>
    `;
  }
  html += '</div>';
  html += `
    <div class="custom-extensions-section">
      <label class="custom-extensions-label">Custom Extensions</label>
      <input type="text" class="custom-extensions-input wizard-custom-extensions" placeholder=".graphql, .proto, .avsc">
      <span class="custom-extensions-hint">(comma-separated, include the dot)</span>
    </div>
    <div class="extension-counter">
      Selected: <span class="extension-count-value">0</span> extensions
    </div>
  `;
  return html;
}

/**
 * Collect selected extensions from a container
 * @param {HTMLElement} container - Container element
 * @returns {string[]} Array of extension strings
 */
export function collectSelectedExtensions(container) {
  const extensions = new Set();

  // Collect from checked groups
  container.querySelectorAll('.extension-group-checkbox:checked').forEach(cb => {
    cb.dataset.extensions.split(',').forEach(ext => extensions.add(ext));
  });

  // Collect from custom input
  const customInput = container.querySelector('.wizard-custom-extensions');
  if (customInput && customInput.value) {
    customInput.value.split(',')
      .map(ext => ext.trim())
      .filter(ext => ext.startsWith('.'))
      .forEach(ext => extensions.add(ext.toLowerCase()));
  }

  return Array.from(extensions);
}

/**
 * Update the extension counter in the container
 * @param {HTMLElement} container - Container element
 */
export function updateExtensionCounter(container) {
  const extensions = collectSelectedExtensions(container);
  const counter = container.querySelector('.extension-count-value');
  if (counter) {
    counter.textContent = extensions.length;
  }
}

/**
 * Setup event listeners for extension group UI
 * @param {HTMLElement} container - Container element
 */
export function setupExtensionListeners(container) {
  // Update counter when checkboxes change
  container.querySelectorAll('.extension-group-checkbox').forEach(cb => {
    cb.addEventListener('change', () => updateExtensionCounter(container));
  });

  // Update counter when custom input changes
  const customInput = container.querySelector('.wizard-custom-extensions');
  if (customInput) {
    customInput.addEventListener('input', () => updateExtensionCounter(container));
  }

  // Setup expand/collapse buttons for extension groups
  container.querySelectorAll('.group-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = btn.closest('.extension-group-item');
      const detail = item.querySelector('.group-extensions-detail');
      const isHidden = detail.classList.contains('hidden');
      detail.classList.toggle('hidden');
      btn.textContent = isHidden ? '\u25B2' : '\u25BC';
    });
  });

  // Initialize counter
  updateExtensionCounter(container);
}

/**
 * Escape HTML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
