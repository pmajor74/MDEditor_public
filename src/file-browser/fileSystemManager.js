/**
 * File System Manager
 *
 * Core file operations for the file browser.
 * Runs in the main process with full Node.js fs access.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { validatePath, validatePathExists, sanitizeFilename, addAllowedRoot, getAllowedRoots } = require('./pathValidator');
const { getCache } = require('./directoryCache');

// Text-based file extensions that can be opened in the editor
// This list should match what can be cataloged/indexed
const TEXT_FILE_EXTENSIONS = [
  // Documentation / Markdown
  '.md', '.markdown', '.mdown', '.mkd', '.txt', '.rst', '.adoc', '.asciidoc',
  // Web
  '.html', '.htm', '.xhtml', '.css', '.scss', '.sass', '.less',
  // JavaScript / TypeScript
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte',
  // Python
  '.py', '.pyw', '.pyi', '.pyx', '.pxd',
  // C / C++ / C#
  '.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.cs', '.csx',
  // Java / Kotlin / Scala
  '.java', '.kt', '.kts', '.scala', '.groovy', '.gradle',
  // Ruby
  '.rb', '.erb', '.rake', '.gemspec',
  // PHP
  '.php', '.phtml', '.php3', '.php4', '.php5', '.phps',
  // Go
  '.go',
  // Rust
  '.rs',
  // Swift / Objective-C
  '.swift', '.m', '.mm',
  // Shell / Scripts
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.psd1', '.bat', '.cmd',
  // Visual Basic
  '.vb', '.vbs', '.vba',
  // Lua
  '.lua',
  // Perl
  '.pl', '.pm', '.pod',
  // R
  '.r', '.R', '.rmd', '.Rmd',
  // SQL
  '.sql',
  // Config / Data
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.config',
  '.xml', '.xsl', '.xslt', '.xsd', '.dtd',
  '.env', '.env.example', '.env.local', '.env.development', '.env.production',
  '.properties', '.plist',
  // Build / Project files
  '.cmake', '.make', '.makefile', '.mak',
  '.dockerfile', '.containerfile',
  '.tf', '.tfvars', '.hcl',
  '.gradle', '.sbt',
  '.csproj', '.vbproj', '.fsproj', '.sln',
  // Git
  '.gitignore', '.gitattributes', '.gitmodules',
  // Editor configs
  '.editorconfig', '.prettierrc', '.eslintrc', '.stylelintrc',
  // Documents
  '.pdf',
  // Other text formats
  '.csv', '.tsv', '.log', '.diff', '.patch',
  '.graphql', '.gql', '.proto', '.thrift', '.avsc',
  '.tex', '.bib', '.cls', '.sty',
  // License / Readme (no extension but common)
  '.license', '.licence', '.readme', '.changelog', '.authors', '.contributors',
  // Audio (for transcription feature)
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.wma'
];

// Configuration for file browser
const config = {
  // File extensions to show (empty = show all files)
  allowedExtensions: [],
  // Whether to show hidden files
  showHidden: false,
  // Maximum items per directory request
  pageSize: 200,
  // Sort order: 'name', 'modified', 'size'
  sortBy: 'name',
  // Sort direction: 'asc', 'desc'
  sortDirection: 'asc'
};

/**
 * Check if a file extension indicates a text file that can be opened in the editor
 * @param {string} filePath - File path or filename
 * @returns {boolean} True if file can be opened as text
 */
function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  // Check if extension is in our list
  if (TEXT_FILE_EXTENSIONS.includes(ext)) {
    return true;
  }

  // Check for common extensionless text files
  const extensionlessTextFiles = [
    'readme', 'license', 'licence', 'changelog', 'authors', 'contributors',
    'makefile', 'dockerfile', 'containerfile', 'vagrantfile', 'gemfile',
    'rakefile', 'procfile', 'brewfile', 'guardfile', 'podfile', 'fastfile',
    '.gitignore', '.gitattributes', '.gitmodules', '.dockerignore', '.npmignore',
    '.editorconfig', '.prettierrc', '.eslintrc', '.babelrc', '.nvmrc'
  ];

  if (extensionlessTextFiles.includes(basename)) {
    return true;
  }

  // If no extension and not a known text file, default to false
  if (!ext) {
    return false;
  }

  return false;
}

/**
 * Update configuration
 * @param {Object} newConfig - New configuration values
 */
function updateConfig(newConfig) {
  Object.assign(config, newConfig);
}

/**
 * Get current configuration
 * @returns {Object} Current config
 */
function getConfig() {
  return { ...config };
}

/**
 * Open folder dialog and add to allowed roots
 * @param {BrowserWindow} parentWindow - Parent window for dialog
 * @returns {Promise<Object>} Result with selected path
 */
async function openFolder(parentWindow) {
  const result = await dialog.showOpenDialog(parentWindow, {
    properties: ['openDirectory'],
    title: 'Select Folder'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, cancelled: true };
  }

  const folderPath = result.filePaths[0];

  // Add to allowed roots
  addAllowedRoot(folderPath);

  // Return the folder path
  return {
    success: true,
    path: folderPath
  };
}

/**
 * Get directory contents with pagination
 * @param {string} dirPath - Directory path
 * @param {Object} options - Options (offset, limit, forceRefresh)
 * @returns {Promise<Object>} Directory contents
 */
async function getDirectoryContents(dirPath, options = {}) {
  const { offset = 0, limit = config.pageSize, forceRefresh = false } = options;

  // Validate path
  const validation = await validatePathExists(dirPath);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  const resolvedPath = validation.resolvedPath;
  const cache = getCache();

  // Check cache
  if (!forceRefresh) {
    const cached = cache.get(resolvedPath);
    if (cached) {
      // Apply pagination to cached data
      const paginatedItems = cached.items.slice(offset, offset + limit);
      return {
        success: true,
        path: resolvedPath,
        items: paginatedItems,
        total: cached.items.length,
        offset,
        limit,
        hasMore: offset + limit < cached.items.length,
        fromCache: true
      };
    }
  }

  try {
    // Read directory entries
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

    // Process entries
    const items = [];
    for (const entry of entries) {
      // Skip hidden files if configured
      if (!config.showHidden && entry.name.startsWith('.')) {
        continue;
      }

      const itemPath = path.join(resolvedPath, entry.name);
      const isDirectory = entry.isDirectory();

      // For files, check extension filter
      if (!isDirectory && config.allowedExtensions.length > 0) {
        const ext = path.extname(entry.name).toLowerCase();
        // Always show audio files (for transcription), even if not in allowedExtensions
        const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.wma'];
        if (!config.allowedExtensions.includes(ext) && !audioExts.includes(ext)) {
          continue;
        }
      }

      // Get stats for sorting by date/size
      let stats = null;
      try {
        stats = await fs.stat(itemPath);
      } catch (err) {
        // Skip items we can't stat (permissions, etc.)
        continue;
      }

      items.push({
        name: entry.name,
        path: itemPath,
        isDirectory,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        created: stats.birthtime.toISOString()
      });
    }

    // Sort items (folders first, then by configured sort)
    items.sort((a, b) => {
      // Folders first
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }

      // Then by configured sort
      let comparison = 0;
      switch (config.sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          break;
        case 'modified':
          comparison = new Date(a.modified) - new Date(b.modified);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
      }

      return config.sortDirection === 'desc' ? -comparison : comparison;
    });

    // Cache the full result
    cache.set(resolvedPath, { items });

    // Apply pagination
    const paginatedItems = items.slice(offset, offset + limit);

    return {
      success: true,
      path: resolvedPath,
      items: paginatedItems,
      total: items.length,
      offset,
      limit,
      hasMore: offset + limit < items.length,
      fromCache: false
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to read directory: ${err.message}`
    };
  }
}

/**
 * Read file contents
 * @param {string} filePath - File path
 * @returns {Promise<Object>} File contents
 */
async function readFile(filePath) {
  const validation = await validatePathExists(filePath);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  try {
    const stats = await fs.stat(validation.resolvedPath);
    if (stats.isDirectory()) {
      return { success: false, error: 'Path is a directory, not a file' };
    }

    const content = await fs.readFile(validation.resolvedPath, 'utf-8');
    return {
      success: true,
      path: validation.resolvedPath,
      content,
      size: stats.size,
      modified: stats.mtime.toISOString()
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to read file: ${err.message}`
    };
  }
}

/**
 * Write file contents
 * @param {string} filePath - File path
 * @param {string} content - Content to write
 * @returns {Promise<Object>} Result
 */
async function writeFile(filePath, content) {
  const validation = validatePath(filePath);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  try {
    await fs.writeFile(validation.resolvedPath, content, 'utf-8');

    // Invalidate cache for parent directory
    const cache = getCache();
    cache.invalidateWithParents(validation.resolvedPath);

    return {
      success: true,
      path: validation.resolvedPath
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to write file: ${err.message}`
    };
  }
}

/**
 * Create a new file
 * @param {string} parentDir - Parent directory path
 * @param {string} filename - New filename
 * @param {string} content - Initial content (optional)
 * @returns {Promise<Object>} Result
 */
async function createFile(parentDir, filename, content = '') {
  // Validate parent directory
  const dirValidation = await validatePathExists(parentDir);
  if (!dirValidation.isValid) {
    return { success: false, error: dirValidation.error };
  }

  // Sanitize filename
  const filenameValidation = sanitizeFilename(filename);
  if (!filenameValidation.isValid) {
    return { success: false, error: filenameValidation.error };
  }

  const filePath = path.join(dirValidation.resolvedPath, filenameValidation.sanitized);

  // Check if file already exists
  try {
    await fs.access(filePath);
    return { success: false, error: 'File already exists' };
  } catch {
    // File doesn't exist, good to proceed
  }

  try {
    await fs.writeFile(filePath, content, 'utf-8');

    // Invalidate cache
    const cache = getCache();
    cache.invalidate(dirValidation.resolvedPath);

    return {
      success: true,
      path: filePath,
      name: filenameValidation.sanitized
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to create file: ${err.message}`
    };
  }
}

/**
 * Create a new folder
 * @param {string} parentDir - Parent directory path
 * @param {string} folderName - New folder name
 * @returns {Promise<Object>} Result
 */
async function createFolder(parentDir, folderName) {
  // Validate parent directory
  const dirValidation = await validatePathExists(parentDir);
  if (!dirValidation.isValid) {
    return { success: false, error: dirValidation.error };
  }

  // Sanitize folder name
  const nameValidation = sanitizeFilename(folderName);
  if (!nameValidation.isValid) {
    return { success: false, error: nameValidation.error };
  }

  const folderPath = path.join(dirValidation.resolvedPath, nameValidation.sanitized);

  // Check if folder already exists
  try {
    await fs.access(folderPath);
    return { success: false, error: 'Folder already exists' };
  } catch {
    // Folder doesn't exist, good to proceed
  }

  try {
    await fs.mkdir(folderPath);

    // Invalidate cache
    const cache = getCache();
    cache.invalidate(dirValidation.resolvedPath);

    return {
      success: true,
      path: folderPath,
      name: nameValidation.sanitized
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to create folder: ${err.message}`
    };
  }
}

/**
 * Rename a file or folder
 * @param {string} oldPath - Current path
 * @param {string} newName - New name
 * @returns {Promise<Object>} Result
 */
async function rename(oldPath, newName) {
  const validation = await validatePathExists(oldPath);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  // Sanitize new name
  const nameValidation = sanitizeFilename(newName);
  if (!nameValidation.isValid) {
    return { success: false, error: nameValidation.error };
  }

  const parentDir = path.dirname(validation.resolvedPath);
  const newPath = path.join(parentDir, nameValidation.sanitized);

  // Validate new path is within allowed roots
  const newValidation = validatePath(newPath);
  if (!newValidation.isValid) {
    return { success: false, error: newValidation.error };
  }

  // Check if target already exists
  try {
    await fs.access(newPath);
    return { success: false, error: 'A file or folder with that name already exists' };
  } catch {
    // Target doesn't exist, good to proceed
  }

  try {
    await fs.rename(validation.resolvedPath, newPath);

    // Invalidate cache
    const cache = getCache();
    cache.invalidate(parentDir);

    return {
      success: true,
      oldPath: validation.resolvedPath,
      newPath,
      newName: nameValidation.sanitized
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to rename: ${err.message}`
    };
  }
}

/**
 * Delete a file or folder
 * @param {string} targetPath - Path to delete
 * @returns {Promise<Object>} Result
 */
async function deleteItem(targetPath) {
  const validation = await validatePathExists(targetPath);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  try {
    const stats = await fs.stat(validation.resolvedPath);

    if (stats.isDirectory()) {
      await fs.rm(validation.resolvedPath, { recursive: true });
    } else {
      await fs.unlink(validation.resolvedPath);
    }

    // Invalidate cache
    const cache = getCache();
    cache.invalidateWithParents(validation.resolvedPath);

    return {
      success: true,
      path: validation.resolvedPath
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to delete: ${err.message}`
    };
  }
}

/**
 * Get file/folder metadata
 * @param {string} targetPath - Path to get metadata for
 * @returns {Promise<Object>} Metadata
 */
async function getMetadata(targetPath) {
  const validation = await validatePathExists(targetPath);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  try {
    const stats = await fs.stat(validation.resolvedPath);

    return {
      success: true,
      path: validation.resolvedPath,
      name: path.basename(validation.resolvedPath),
      isDirectory: stats.isDirectory(),
      size: stats.size,
      modified: stats.mtime.toISOString(),
      created: stats.birthtime.toISOString(),
      accessed: stats.atime.toISOString()
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to get metadata: ${err.message}`
    };
  }
}

/**
 * Check if path exists and is accessible
 * @param {string} targetPath - Path to check
 * @returns {Promise<Object>} Result
 */
async function exists(targetPath) {
  const validation = validatePath(targetPath);
  if (!validation.isValid) {
    return { success: true, exists: false, error: validation.error };
  }

  try {
    await fs.access(validation.resolvedPath);
    const stats = await fs.stat(validation.resolvedPath);
    return {
      success: true,
      exists: true,
      isDirectory: stats.isDirectory(),
      path: validation.resolvedPath
    };
  } catch {
    return {
      success: true,
      exists: false,
      path: validation.resolvedPath
    };
  }
}

module.exports = {
  updateConfig,
  getConfig,
  openFolder,
  getDirectoryContents,
  readFile,
  writeFile,
  createFile,
  createFolder,
  rename,
  deleteItem,
  getMetadata,
  exists,
  addAllowedRoot,
  getAllowedRoots,
  isTextFile,
  TEXT_FILE_EXTENSIONS
};
