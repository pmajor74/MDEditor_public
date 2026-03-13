/**
 * Splitter Factory
 *
 * Unified interface for all document splitters.
 * Routes files to appropriate splitter based on type and extension.
 */

const path = require('path');

// Import all splitters
const { EnhancedMarkdownSplitter } = require('./markdownSplitter');
const { CodeSplitter } = require('./codeSplitter');
const { ConfigSplitter, FORMAT_MAP } = require('./configSplitter');
const { TextSplitter, LogSplitter, CsvSplitter } = require('./textSplitter');
const { BaseSplitter, DEFAULT_CONFIG } = require('./baseSplitter');
const { PdfSplitter } = require('./pdfSplitter');
const { isSupported: isCodeSupported } = require('./languages');

/**
 * File type classification by extension
 */
const FILE_TYPES = {
  markdown: ['.md', '.markdown', '.mdx', '.mdown', '.mkd'],
  code: {
    javascript: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'],
    python: ['.py', '.pyw', '.pyi', '.pyx'],
    csharp: ['.cs', '.csx'],
    java: ['.java'],
    kotlin: ['.kt', '.kts'],
    powershell: ['.ps1', '.psm1', '.psd1'],
    bash: ['.sh', '.bash', '.zsh', '.ksh', '.fish'],
    go: ['.go'],
    rust: ['.rs'],
    cpp: ['.cpp', '.c', '.h', '.hpp', '.cc', '.cxx'],
    ruby: ['.rb', '.rake', '.gemspec'],
    php: ['.php', '.phtml'],
    swift: ['.swift'],
    scala: ['.scala', '.sc'],
    r: ['.r', '.R'],
    lua: ['.lua'],
    perl: ['.pl', '.pm'],
    sql: ['.sql'],
    graphql: ['.graphql', '.gql']
  },
  config: ['.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties', '.xml'],
  text: ['.txt', '.rst', '.adoc', '.asciidoc'],
  log: ['.log'],
  csv: ['.csv', '.tsv'],
  pdf: ['.pdf']
};

/**
 * Build extension-to-type lookup map
 */
function buildExtensionMap() {
  const map = new Map();

  // Markdown
  for (const ext of FILE_TYPES.markdown) {
    map.set(ext.toLowerCase(), { type: 'markdown', language: null });
  }

  // Code - nested by language
  for (const [language, extensions] of Object.entries(FILE_TYPES.code)) {
    for (const ext of extensions) {
      map.set(ext.toLowerCase(), { type: 'code', language });
    }
  }

  // Config
  for (const ext of FILE_TYPES.config) {
    map.set(ext.toLowerCase(), { type: 'config', language: null });
  }

  // Text
  for (const ext of FILE_TYPES.text) {
    map.set(ext.toLowerCase(), { type: 'text', language: null });
  }

  // Log
  for (const ext of FILE_TYPES.log) {
    map.set(ext.toLowerCase(), { type: 'log', language: null });
  }

  // CSV
  for (const ext of FILE_TYPES.csv) {
    map.set(ext.toLowerCase(), { type: 'csv', language: null });
  }

  // PDF
  for (const ext of FILE_TYPES.pdf) {
    map.set(ext.toLowerCase(), { type: 'pdf', language: null });
  }

  return map;
}

const EXTENSION_MAP = buildExtensionMap();

/**
 * Get file type info from extension
 * @param {string} extension - File extension (with or without leading dot)
 * @returns {{type: string, language: string|null}} File type and language
 */
function getFileType(extension) {
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return EXTENSION_MAP.get(ext) || { type: 'text', language: null };
}

/**
 * Create appropriate splitter for a file
 * @param {string} filePath - Path to file
 * @param {Object} config - Splitter configuration
 * @returns {BaseSplitter} Splitter instance
 */
function createSplitter(filePath, config = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const { type, language } = getFileType(ext);

  // Apply file-type-specific config overrides
  const effectiveConfig = {
    ...DEFAULT_CONFIG,
    ...config
  };

  // Apply type-specific overrides from config
  if (config.fileTypeOverrides && config.fileTypeOverrides[type]) {
    Object.assign(effectiveConfig, config.fileTypeOverrides[type]);
  }

  switch (type) {
    case 'markdown':
      return new EnhancedMarkdownSplitter(effectiveConfig);

    case 'code':
      return new CodeSplitter(effectiveConfig);

    case 'config':
      return new ConfigSplitter(effectiveConfig);

    case 'log':
      return new LogSplitter(effectiveConfig);

    case 'csv':
      return new CsvSplitter(effectiveConfig);

    case 'pdf':
      return new PdfSplitter(effectiveConfig);

    case 'text':
    default:
      return new TextSplitter(effectiveConfig);
  }
}

/**
 * Split a document into chunks using the appropriate splitter.
 * Async because code splitting may use tree-sitter (WASM-based).
 * @param {string} content - Document content
 * @param {string} filePath - Path to source file
 * @param {Object} config - Splitter configuration
 * @returns {Promise<Array<Object>>} Array of chunk objects
 */
async function splitDocument(content, filePath, config = {}, options = {}) {
  const splitter = createSplitter(filePath, config);
  return await splitter.split(content, filePath, options);
}

/**
 * Check if a file type is supported for advanced splitting
 * @param {string} extension - File extension
 * @returns {boolean} True if supported
 */
function isSupported(extension) {
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return EXTENSION_MAP.has(ext);
}

/**
 * Get list of all supported extensions
 * @returns {string[]} Array of supported extensions
 */
function getSupportedExtensions() {
  return Array.from(EXTENSION_MAP.keys());
}

/**
 * Get list of all supported file types
 * @returns {string[]} Array of file types
 */
function getSupportedTypes() {
  return ['markdown', 'code', 'config', 'text', 'log', 'csv', 'pdf'];
}

/**
 * Get configuration defaults
 * @returns {Object} Default configuration
 */
function getDefaultConfig() {
  return { ...DEFAULT_CONFIG };
}

module.exports = {
  // Main API
  splitDocument,
  createSplitter,
  getFileType,
  isSupported,

  // Info exports
  getSupportedExtensions,
  getSupportedTypes,
  getDefaultConfig,

  // Direct splitter access
  EnhancedMarkdownSplitter,
  CodeSplitter,
  ConfigSplitter,
  TextSplitter,
  LogSplitter,
  CsvSplitter,
  PdfSplitter,
  BaseSplitter,

  // Constants
  FILE_TYPES,
  DEFAULT_CONFIG
};
