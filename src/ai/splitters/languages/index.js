/**
 * Language Registry
 *
 * Central registry for programming language definitions used by the code splitter.
 * Each language defines patterns for identifying structural boundaries.
 */

const javascript = require('./javascript');
const python = require('./python');
const csharp = require('./csharp');
const java = require('./java');
const powershell = require('./powershell');
const bash = require('./bash');
const go = require('./go');
const rust = require('./rust');

/**
 * All registered language definitions
 */
const languages = {
  javascript,
  python,
  csharp,
  java,
  powershell,
  bash,
  go,
  rust
};

/**
 * Extension to language mapping
 */
const extensionMap = new Map();

// Build extension map from language definitions
for (const [name, lang] of Object.entries(languages)) {
  for (const ext of lang.extensions) {
    extensionMap.set(ext.toLowerCase(), name);
  }
}

/**
 * Get language definition by file extension
 * @param {string} extension - File extension (with or without leading dot)
 * @returns {Object|null} Language definition or null if not found
 */
function getLanguage(extension) {
  // Normalize extension
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;

  const langName = extensionMap.get(ext);
  return langName ? languages[langName] : null;
}

/**
 * Get language name by file extension
 * @param {string} extension - File extension
 * @returns {string|null} Language name or null
 */
function getLanguageName(extension) {
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return extensionMap.get(ext) || null;
}

/**
 * Get list of all supported languages
 * @returns {string[]} Array of language names
 */
function getSupportedLanguages() {
  return Object.keys(languages);
}

/**
 * Get all supported extensions
 * @returns {string[]} Array of file extensions
 */
function getSupportedExtensions() {
  return Array.from(extensionMap.keys());
}

/**
 * Check if a file extension is supported
 * @param {string} extension - File extension
 * @returns {boolean} True if supported
 */
function isSupported(extension) {
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return extensionMap.has(ext);
}

module.exports = {
  languages,
  getLanguage,
  getLanguageName,
  getSupportedLanguages,
  getSupportedExtensions,
  isSupported
};
