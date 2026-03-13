/**
 * Function Signature Extractor
 *
 * Extends tree-sitter AST walking to extract structured function/method
 * signatures including parameters, types, and JSDoc summaries.
 *
 * Supports: JS/TS, Python, C#, Go, Rust
 */

const path = require('path');
const { getGrammarName } = require('../splitters/treeSitterParser');

// Import language-specific signature extractors from refactored modules
const { extractJSSignatures } = require('./extractors/jsSignatureExtractor');
const { extractPythonSignatures, extractCSharpSignatures, extractGoSignatures, extractRustSignatures } = require('./extractors/otherLanguageSignatures');

// Lazy-loaded tree-sitter parser
let getParserFn = null;

async function loadParser() {
  if (!getParserFn) {
    const treeSitter = require('../splitters/treeSitterParser');
    getParserFn = treeSitter.getParser;
  }
  return getParserFn;
}

/**
 * Extract all function/method signatures from a source file
 * @param {string} content - Source code content
 * @param {string} filePath - Path to source file
 * @returns {Promise<Array<Object>|null>} Array of signatures or null if unsupported
 */
async function extractSignatures(content, filePath) {
  const grammarName = getGrammarName(filePath);
  if (!grammarName) return null;

  const extractor = SIGNATURE_EXTRACTORS[grammarName];
  if (!extractor) return null;

  const getParser = await loadParser();
  const parser = await getParser(grammarName);
  if (!parser) return null;

  let tree;
  try {
    tree = parser.parse(content);
  } catch (err) {
    console.warn(`[Signature] Parse error for ${filePath}:`, err.message);
    return null;
  }

  const lines = content.split('\n');

  try {
    const signatures = extractor(tree.rootNode, lines, filePath);
    return signatures;
  } catch (err) {
    console.warn(`[Signature] Extraction error for ${filePath}:`, err.message);
    return null;
  }
}

// ============================================
// Registry
// ============================================

const SIGNATURE_EXTRACTORS = {
  javascript: extractJSSignatures,
  typescript: extractJSSignatures,
  tsx: extractJSSignatures,
  python: extractPythonSignatures,
  c_sharp: extractCSharpSignatures,
  go: extractGoSignatures,
  rust: extractRustSignatures
};

/**
 * Check if signature extraction is supported for a file
 * @param {string} filePath - Source file path
 * @returns {boolean}
 */
function isSignatureSupported(filePath) {
  const grammar = getGrammarName(filePath);
  return grammar !== null && SIGNATURE_EXTRACTORS[grammar] !== undefined;
}

module.exports = {
  extractSignatures,
  isSignatureSupported
};
