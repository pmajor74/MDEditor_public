/**
 * File Icons
 *
 * Maps file extensions to icon SVGs for the file browser.
 */

// SVG icons as strings (compact inline SVGs)
const ICONS = {
  folder: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,

  folderOpen: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>`,

  file: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`,

  markdown: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.56 18H3.44C2.65 18 2 17.37 2 16.59V7.41C2 6.63 2.65 6 3.44 6h17.12c.79 0 1.44.63 1.44 1.41v9.18c0 .78-.65 1.41-1.44 1.41zM6.81 15.19v-3.68l1.73 2.19 1.73-2.19v3.68h1.73V8.81h-1.73l-1.73 2.19-1.73-2.19H5.08v6.38h1.73zm8.88 0l2.59-3.19h-1.73V8.81H14.8v3.19h-1.73l2.62 3.19z"/></svg>`,

  text: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`,

  code: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`,

  image: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`,

  json: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h2v2H5v5a2 2 0 01-2 2 2 2 0 012 2v5h2v2H5c-1.07-.27-2-.9-2-2v-4a2 2 0 00-2-2H0v-2h1a2 2 0 002-2V5a2 2 0 012-2m14 0a2 2 0 012 2v4a2 2 0 002 2h1v2h-1a2 2 0 00-2 2v4a2 2 0 01-2 2h-2v-2h2v-5a2 2 0 012-2 2 2 0 01-2-2V5h-2V3h2m-7 12a1 1 0 011 1 1 1 0 01-1 1 1 1 0 01-1-1 1 1 0 011-1m-4 0a1 1 0 011 1 1 1 0 01-1 1 1 1 0 01-1-1 1 1 0 011-1m8 0a1 1 0 011 1 1 1 0 01-1 1 1 1 0 01-1-1 1 1 0 011-1z"/></svg>`,

  config: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94 0 .31.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,

  audio: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`
};

// Extension to icon mapping
const EXTENSION_MAP = {
  // Markdown
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdown': 'markdown',
  '.mkd': 'markdown',

  // Text
  '.txt': 'text',
  '.text': 'text',
  '.rtf': 'text',

  // Code
  '.js': 'code',
  '.jsx': 'code',
  '.ts': 'code',
  '.tsx': 'code',
  '.py': 'code',
  '.java': 'code',
  '.c': 'code',
  '.cpp': 'code',
  '.cs': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.rb': 'code',
  '.php': 'code',
  '.html': 'code',
  '.css': 'code',
  '.scss': 'code',
  '.less': 'code',
  '.vue': 'code',
  '.svelte': 'code',

  // Data
  '.json': 'json',
  '.xml': 'code',
  '.yaml': 'config',
  '.yml': 'config',
  '.toml': 'config',
  '.ini': 'config',
  '.env': 'config',

  // Images
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.webp': 'image',
  '.ico': 'image',
  '.bmp': 'image',

  // Audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
  '.m4a': 'audio',
  '.wma': 'audio'
};

// Icon colors by type
const ICON_COLORS = {
  folder: '#dcb67a',
  folderOpen: '#dcb67a',
  file: '#9e9e9e',
  markdown: '#519aba',
  text: '#9e9e9e',
  code: '#f0db4f',
  image: '#26a69a',
  json: '#f0db4f',
  config: '#f44336',
  audio: '#e91e63'
};

/**
 * Get icon SVG for a file
 * @param {string} filename - Filename or path
 * @param {boolean} isDirectory - Whether it's a directory
 * @param {boolean} isExpanded - Whether directory is expanded
 * @returns {string} SVG string
 */
function getFileIcon(filename, isDirectory = false, isExpanded = false) {
  if (isDirectory) {
    return isExpanded ? ICONS.folderOpen : ICONS.folder;
  }

  // Get extension
  const ext = filename.includes('.') ?
    '.' + filename.split('.').pop().toLowerCase() :
    '';

  const iconType = EXTENSION_MAP[ext] || 'file';
  return ICONS[iconType] || ICONS.file;
}

/**
 * Get icon color for a file
 * @param {string} filename - Filename or path
 * @param {boolean} isDirectory - Whether it's a directory
 * @returns {string} CSS color
 */
function getFileIconColor(filename, isDirectory = false) {
  if (isDirectory) {
    return ICON_COLORS.folder;
  }

  const ext = filename.includes('.') ?
    '.' + filename.split('.').pop().toLowerCase() :
    '';

  const iconType = EXTENSION_MAP[ext] || 'file';
  return ICON_COLORS[iconType] || ICON_COLORS.file;
}

/**
 * Get icon type name for a file
 * @param {string} filename - Filename or path
 * @param {boolean} isDirectory - Whether it's a directory
 * @returns {string} Icon type name
 */
function getIconType(filename, isDirectory = false) {
  if (isDirectory) {
    return 'folder';
  }

  const ext = filename.includes('.') ?
    '.' + filename.split('.').pop().toLowerCase() :
    '';

  return EXTENSION_MAP[ext] || 'file';
}

export {
  getFileIcon,
  getFileIconColor,
  getIconType,
  ICONS,
  ICON_COLORS
};
