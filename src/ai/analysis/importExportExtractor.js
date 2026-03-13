/**
 * Import/Export Extractor
 *
 * Reuses tree-sitter AST infrastructure from treeSitterParser.js to extract
 * structured import/export data from source files. No LLM calls needed.
 *
 * Supports: JS/TS, Python, C#, Go, Rust
 * Falls back gracefully for unsupported languages.
 */

const path = require('path');
const { getGrammarName, isSupported } = require('../splitters/treeSitterParser');

// Import language-specific extractors from refactored modules
const { jsImportExportExtractor } = require('./extractors/jsImportExportExtractor');
const { pythonExtractor, csharpExtractor, goExtractor, rustExtractor } = require('./extractors/otherLanguageExtractors');

// Lazy-loaded tree-sitter
let getParserFn = null;

async function loadParser() {
  if (!getParserFn) {
    // Import getParser from treeSitterParser (we export it in Phase 1E)
    const treeSitter = require('../splitters/treeSitterParser');
    getParserFn = treeSitter.getParser;
  }
  return getParserFn;
}

/**
 * Extract imports and exports from a source file
 * @param {string} content - Source code content
 * @param {string} filePath - Path to source file
 * @returns {Promise<Object|null>} Extracted data or null if unsupported
 */
async function extractImportsExports(content, filePath) {
  const grammarName = getGrammarName(filePath);
  if (!grammarName) return null;

  const extractor = EXTRACTORS[grammarName];
  if (!extractor) return null;

  const getParser = await loadParser();
  const parser = await getParser(grammarName);
  if (!parser) return null;

  let tree;
  try {
    tree = parser.parse(content);
  } catch (err) {
    console.warn(`[ImportExport] Parse error for ${filePath}:`, err.message);
    return null;
  }

  const rootNode = tree.rootNode;

  try {
    const imports = extractor.extractImports(rootNode, content);
    const exports = extractor.extractExports(rootNode, content);

    return {
      filePath: filePath.replace(/\\/g, '/'),
      imports,
      exports
    };
  } catch (err) {
    console.warn(`[ImportExport] Extraction error for ${filePath}:`, err.message);
    return null;
  }
}

// ============================================
// Extractor Registry
// ============================================

const EXTRACTORS = {
  javascript: jsImportExportExtractor,
  typescript: jsImportExportExtractor,
  tsx: jsImportExportExtractor,
  python: pythonExtractor,
  c_sharp: csharpExtractor,
  go: goExtractor,
  rust: rustExtractor
};

/**
 * Check if import/export extraction is supported for a file
 * @param {string} filePath - Source file path
 * @returns {boolean}
 */
function isExtractionSupported(filePath) {
  const grammar = getGrammarName(filePath);
  return grammar !== null && EXTRACTORS[grammar] !== undefined;
}

module.exports = {
  extractImportsExports,
  isExtractionSupported
};
