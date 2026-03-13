/**
 * Tree-Sitter AST Parser for Code Chunking
 *
 * Uses web-tree-sitter (WASM-based) to parse source code into AST,
 * then extracts top-level structures as semantically meaningful chunks.
 * Falls back gracefully — returns null if parsing fails for any reason.
 */

const path = require('path');
const fs = require('fs');

// Lazy-loaded — avoids import cost until actually needed
let Parser = null;
let initialized = false;
const parserCache = new Map();

/**
 * Map file extensions to tree-sitter grammar names
 */
const EXTENSION_TO_GRAMMAR = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'tsx', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python', '.pyw': 'python', '.pyi': 'python',
  '.cs': 'c_sharp', '.csx': 'c_sharp',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.rb': 'ruby',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.lua': 'lua',
  '.php': 'php',
  '.scala': 'scala',
  '.swift': 'swift',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
  '.c': 'c', '.h': 'c',
};

/**
 * Node types considered top-level structures per grammar.
 * These are the AST node types that represent meaningful code units.
 */
const TOP_LEVEL_TYPES = {
  javascript: {
    structures: new Set([
      'function_declaration', 'generator_function_declaration',
      'class_declaration', 'lexical_declaration', 'variable_declaration',
      'export_statement', 'expression_statement'
    ]),
    preamble: new Set(['import_statement'])
  },
  typescript: {
    structures: new Set([
      'function_declaration', 'generator_function_declaration',
      'class_declaration', 'lexical_declaration', 'variable_declaration',
      'export_statement', 'expression_statement',
      'interface_declaration', 'type_alias_declaration', 'enum_declaration',
      'ambient_declaration', 'module'
    ]),
    preamble: new Set(['import_statement'])
  },
  tsx: {
    structures: new Set([
      'function_declaration', 'class_declaration', 'lexical_declaration',
      'variable_declaration', 'export_statement', 'expression_statement',
      'interface_declaration', 'type_alias_declaration', 'enum_declaration'
    ]),
    preamble: new Set(['import_statement'])
  },
  python: {
    structures: new Set([
      'function_definition', 'class_definition', 'decorated_definition',
      'expression_statement', 'assignment', 'if_statement'
    ]),
    preamble: new Set(['import_statement', 'import_from_statement'])
  },
  c_sharp: {
    structures: new Set([
      'class_declaration', 'interface_declaration', 'struct_declaration',
      'enum_declaration', 'namespace_declaration', 'record_declaration',
      'delegate_declaration'
    ]),
    preamble: new Set(['using_directive'])
  },
  java: {
    structures: new Set([
      'class_declaration', 'interface_declaration', 'enum_declaration',
      'annotation_type_declaration', 'record_declaration'
    ]),
    preamble: new Set(['import_declaration', 'package_declaration'])
  },
  go: {
    structures: new Set([
      'function_declaration', 'method_declaration', 'type_declaration',
      'var_declaration', 'const_declaration'
    ]),
    preamble: new Set(['import_declaration', 'package_clause'])
  },
  rust: {
    structures: new Set([
      'function_item', 'struct_item', 'enum_item', 'impl_item',
      'trait_item', 'type_item', 'const_item', 'static_item',
      'mod_item', 'macro_definition'
    ]),
    preamble: new Set(['use_declaration', 'extern_crate_declaration'])
  },
  kotlin: {
    structures: new Set([
      'function_declaration', 'class_declaration', 'object_declaration',
      'property_declaration', 'type_alias'
    ]),
    preamble: new Set(['import_header', 'package_header'])
  },
  ruby: {
    structures: new Set([
      'method', 'class', 'module', 'singleton_method'
    ]),
    preamble: new Set(['call']) // require statements
  },
  bash: {
    structures: new Set(['function_definition', 'command', 'pipeline']),
    preamble: new Set([])
  },
  c: {
    structures: new Set([
      'function_definition', 'struct_specifier', 'enum_specifier',
      'type_definition', 'declaration'
    ]),
    preamble: new Set(['preproc_include', 'preproc_define'])
  },
  cpp: {
    structures: new Set([
      'function_definition', 'class_specifier', 'struct_specifier',
      'enum_specifier', 'namespace_definition', 'type_definition',
      'declaration', 'template_declaration'
    ]),
    preamble: new Set(['preproc_include', 'preproc_define', 'using_declaration'])
  }
};

/**
 * Initialize web-tree-sitter (one-time async setup)
 */
async function initTreeSitter() {
  if (initialized) return;
  Parser = require('web-tree-sitter');
  await Parser.init();
  initialized = true;
}

/**
 * Get or create a cached parser for a grammar
 * @param {string} grammarName - Tree-sitter grammar name
 * @returns {Parser|null} Parser instance or null if unavailable
 */
async function getParser(grammarName) {
  if (parserCache.has(grammarName)) return parserCache.get(grammarName);

  await initTreeSitter();

  // Locate WASM file from tree-sitter-wasms package
  let wasmPath;
  try {
    const pkgDir = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
    wasmPath = path.join(pkgDir, 'out', `tree-sitter-${grammarName}.wasm`);
  } catch {
    return null;
  }

  if (!fs.existsSync(wasmPath)) return null;

  const wasmBuffer = fs.readFileSync(wasmPath);
  const lang = await Parser.Language.load(wasmBuffer);
  const parser = new Parser();
  parser.setLanguage(lang);

  parserCache.set(grammarName, parser);
  return parser;
}

/**
 * Get the grammar name for a file extension
 * @param {string} filePath - Source file path
 * @returns {string|null} Grammar name or null
 */
function getGrammarName(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_GRAMMAR[ext] || null;
}

/**
 * Check if tree-sitter parsing is available for a file
 * @param {string} filePath - Source file path
 * @returns {boolean}
 */
function isSupported(filePath) {
  const grammar = getGrammarName(filePath);
  return grammar !== null && TOP_LEVEL_TYPES[grammar] !== undefined;
}

/**
 * Extract a human-readable name from an AST node.
 * Searches child nodes for identifier/name patterns.
 * @param {SyntaxNode} node - AST node
 * @returns {string|null}
 */
function extractNodeName(node) {
  // Common child field names for identifiers across languages
  const nameFields = ['name', 'declarator', 'pattern'];

  for (const field of nameFields) {
    const child = node.childForFieldName(field);
    if (child) {
      // For declarators that wrap an identifier (e.g., variable_declarator)
      if (child.type.includes('declarator') || child.type.includes('pattern')) {
        const id = child.childForFieldName('name');
        if (id) return id.text;
      }
      if (child.type === 'identifier' || child.type === 'type_identifier' ||
          child.type === 'property_identifier') {
        return child.text;
      }
      // For lexical_declaration -> variable_declarator -> name
      if (child.namedChildCount > 0) {
        const firstNamed = child.firstNamedChild;
        if (firstNamed) {
          const nameNode = firstNamed.childForFieldName('name');
          if (nameNode) return nameNode.text;
          if (firstNamed.type === 'identifier') return firstNamed.text;
        }
      }
      return child.text.split(/[\s({]/)[0]; // Take first word
    }
  }

  // Fallback: look for first identifier child
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child.type === 'identifier' || child.type === 'type_identifier') {
      return child.text;
    }
  }

  return null;
}

/**
 * Determine the structural type of an AST node (class, function, interface, etc.)
 * @param {SyntaxNode} node - AST node
 * @returns {string} Structure type
 */
function getStructureType(node) {
  const type = node.type;

  if (type.includes('class')) return 'class';
  if (type.includes('interface')) return 'interface';
  if (type.includes('enum')) return 'enum';
  if (type.includes('struct')) return 'struct';
  if (type.includes('trait')) return 'trait';
  if (type.includes('impl')) return 'impl';
  if (type.includes('function') || type.includes('method')) return 'function';
  if (type.includes('type_alias') || type.includes('type_item') || type.includes('type_definition')) return 'type';
  if (type.includes('namespace') || type.includes('module') || type.includes('mod_item')) return 'module';
  if (type.includes('const') || type.includes('static')) return 'constant';
  if (type.includes('variable') || type.includes('lexical') || type.includes('assignment')) return 'variable';
  if (type.includes('decorated')) return 'decorated';
  if (type.includes('export')) return 'export';
  if (type.includes('template')) return 'template';
  if (type.includes('macro')) return 'macro';

  return 'block';
}

/**
 * Check if an AST node represents an export
 * @param {SyntaxNode} node - AST node
 * @returns {boolean}
 */
function isExported(node) {
  if (node.type === 'export_statement') return true;
  // Check parent
  if (node.parent && node.parent.type === 'export_statement') return true;
  // Check for 'pub' modifier in Rust/etc
  const text = node.text.substring(0, 50);
  return /^(?:export|pub)\s/.test(text);
}

/**
 * Check if an AST node represents an async function
 * @param {SyntaxNode} node - AST node
 * @returns {boolean}
 */
function isAsync(node) {
  const text = node.text.substring(0, 100);
  return /\basync\b/.test(text);
}

/**
 * Find the row where leading comments start for a node.
 * Looks backwards from the node's start to include doc comments.
 * @param {SyntaxNode} node - AST node
 * @param {string[]} lines - Source lines
 * @param {number} minRow - Don't look before this row
 * @returns {number} Start row including comments
 */
function findCommentStart(node, lines, minRow) {
  let startRow = node.startPosition.row;
  let lastNonBlank = startRow;

  for (let row = startRow - 1; row >= minRow; row--) {
    const line = lines[row].trim();
    if (line === '') {
      // Allow one blank line between comment and code
      if (lastNonBlank === row + 1 || lastNonBlank === startRow) {
        continue;
      }
      break;
    }
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') ||
        line.startsWith('*/') || line.startsWith('#') || line.startsWith('///') ||
        line.startsWith('/**') || line.startsWith('@')) {
      startRow = row;
      lastNonBlank = row;
    } else {
      break;
    }
  }

  return startRow;
}

/**
 * Parse source code and extract structural chunks using tree-sitter AST.
 *
 * @param {string} content - Source code content
 * @param {string} filePath - Path to source file (for language detection)
 * @returns {Array<Object>|null} Array of chunk objects, or null if parsing fails/unsupported
 */
async function parseCode(content, filePath) {
  const grammarName = getGrammarName(filePath);
  if (!grammarName) return null;

  const typeConfig = TOP_LEVEL_TYPES[grammarName];
  if (!typeConfig) return null;

  let parser;
  try {
    parser = await getParser(grammarName);
    if (!parser) return null;
  } catch (err) {
    console.warn(`[TreeSitter] Failed to load parser for ${grammarName}:`, err.message);
    return null;
  }

  let tree;
  try {
    tree = parser.parse(content);
  } catch (err) {
    console.warn(`[TreeSitter] Parse error for ${filePath}:`, err.message);
    return null;
  }

  const rootNode = tree.rootNode;
  const lines = content.split('\n');

  // Separate preamble nodes (imports) from structure nodes
  const preambleNodes = [];
  const structureNodes = [];

  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const child = rootNode.namedChild(i);
    if (child.type === 'comment') continue; // Handle comments separately
    if (typeConfig.preamble.has(child.type)) {
      preambleNodes.push(child);
    } else if (typeConfig.structures.has(child.type)) {
      structureNodes.push(child);
    }
  }

  // If no structures found, let the regex splitter handle it
  if (structureNodes.length === 0) return null;

  const chunks = [];

  // Build preamble chunk
  let preambleText = '';
  let preambleEndRow = -1;
  if (preambleNodes.length > 0) {
    const firstRow = preambleNodes[0].startPosition.row;
    const lastRow = preambleNodes[preambleNodes.length - 1].endPosition.row;
    preambleEndRow = lastRow;

    // Include any leading comments (shebang, file-level doc comments)
    let actualStart = findCommentStart(preambleNodes[0], lines, 0);
    preambleText = lines.slice(actualStart, lastRow + 1).join('\n').trim();

    if (preambleText) {
      chunks.push({
        content: preambleText,
        startLine: actualStart + 1,
        endLine: lastRow + 1,
        metadata: {
          fileType: 'code',
          language: grammarName,
          structureType: 'imports',
          structureName: 'imports/preamble'
        }
      });
    }
  }

  // Build structure chunks
  for (let i = 0; i < structureNodes.length; i++) {
    const node = structureNodes[i];
    const endRow = node.endPosition.row;

    // Find start including doc comments
    const minRow = i > 0
      ? structureNodes[i - 1].endPosition.row + 1
      : preambleEndRow + 1;
    const startRow = findCommentStart(node, lines, Math.max(0, minRow));

    const chunkContent = lines.slice(startRow, endRow + 1).join('\n');
    if (!chunkContent.trim()) continue;

    // For export_statement, dig into the inner declaration
    let targetNode = node;
    if (node.type === 'export_statement' && node.namedChildCount > 0) {
      // Find the declaration inside the export
      for (let j = 0; j < node.namedChildCount; j++) {
        const inner = node.namedChild(j);
        if (inner.type !== 'comment' && inner.type !== 'decorator') {
          targetNode = inner;
          break;
        }
      }
    }

    const structureType = getStructureType(targetNode);
    const structureName = extractNodeName(targetNode) || extractNodeName(node);

    chunks.push({
      content: chunkContent,
      startLine: startRow + 1,
      endLine: endRow + 1,
      metadata: {
        fileType: 'code',
        language: grammarName,
        structureType,
        structureName: structureName || null,
        isExported: isExported(node),
        isAsync: isAsync(node),
        preamble: preambleText || undefined
      }
    });
  }

  return chunks.length > 0 ? chunks : null;
}

module.exports = {
  parseCode,
  isSupported,
  getGrammarName,
  getParser
};
