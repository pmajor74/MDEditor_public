/**
 * JavaScript/TypeScript Language Definition
 *
 * Patterns for identifying structural boundaries in JS/TS code.
 */

module.exports = {
  name: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'],

  // Primary split points - top-level structures
  patterns: {
    // ES6 class declaration
    classDecl: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/m,

    // Function declaration
    funcDecl: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(/m,

    // Arrow function assigned to const/let
    arrowFunc: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>/m,

    // CommonJS module.exports
    moduleExport: /^module\.exports\s*=/m,

    // ES6 export default (object or function)
    exportDefault: /^export\s+default\s+(?:function|class|\{)/m,

    // Interface/Type declarations (TypeScript)
    interfaceDecl: /^(?:export\s+)?interface\s+(\w+)/m,
    typeDecl: /^(?:export\s+)?type\s+(\w+)\s*=/m,

    // Enum declarations (TypeScript)
    enumDecl: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/m
  },

  // Secondary split points - for splitting within large structures
  secondaryPatterns: {
    // Class method
    methodDef: /^\s+(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{/m,

    // Object method shorthand
    objectMethod: /^\s+(\w+)\s*\([^)]*\)\s*\{/m,

    // Property with function value
    propFunction: /^\s+(\w+)\s*:\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/m
  },

  // Patterns that indicate block boundaries
  blockPatterns: {
    openBrace: /\{/g,
    closeBrace: /\}/g,
    // Match complete block (rough - doesn't handle nested)
    functionBlock: /(?:function|=>)\s*\{[\s\S]*?\n\}/g
  },

  /**
   * Extract metadata from a code chunk
   * @param {string} code - Code chunk
   * @returns {Object} Extracted metadata
   */
  extractMetadata(code) {
    const metadata = {
      functionName: null,
      className: null,
      isExported: false,
      isAsync: false,
      isDefault: false,
      type: null // 'class', 'function', 'arrow', 'method', 'interface', 'type', 'enum'
    };

    const trimmed = code.trim();

    // Check for exports
    metadata.isExported = /^export\s/.test(trimmed);
    metadata.isDefault = /export\s+default/.test(trimmed);
    metadata.isAsync = /async\s+/.test(trimmed);

    // Try to identify the structure type
    let match;

    // Class
    match = trimmed.match(/class\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'class';
      return metadata;
    }

    // Interface (TypeScript)
    match = trimmed.match(/interface\s+(\w+)/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'interface';
      return metadata;
    }

    // Type (TypeScript)
    match = trimmed.match(/type\s+(\w+)\s*=/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'type';
      return metadata;
    }

    // Enum (TypeScript)
    match = trimmed.match(/enum\s+(\w+)/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'enum';
      return metadata;
    }

    // Function declaration
    match = trimmed.match(/function\s*\*?\s*(\w+)/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'function';
      return metadata;
    }

    // Arrow function
    match = trimmed.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'arrow';
      return metadata;
    }

    // Method definition
    match = trimmed.match(/^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\(/m);
    if (match && match[1] !== 'if' && match[1] !== 'for' && match[1] !== 'while') {
      metadata.functionName = match[1];
      metadata.type = 'method';
      return metadata;
    }

    return metadata;
  },

  /**
   * Check if a line is a comment
   * @param {string} line - Line to check
   * @returns {boolean} True if line is a comment
   */
  isComment(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('//') ||
           trimmed.startsWith('/*') ||
           trimmed.startsWith('*') ||
           trimmed.startsWith('*/');
  },

  /**
   * Check if a line is a blank line
   * @param {string} line - Line to check
   * @returns {boolean} True if blank
   */
  isBlank(line) {
    return line.trim().length === 0;
  }
};
