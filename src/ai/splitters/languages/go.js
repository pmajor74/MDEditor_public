/**
 * Go Language Definition
 *
 * Patterns for identifying structural boundaries in Go code.
 */

module.exports = {
  name: 'go',
  extensions: ['.go'],

  // Primary split points - top-level structures
  patterns: {
    // Package declaration
    package: /^package\s+(\w+)/m,

    // Function declaration
    funcDecl: /^func\s+(\w+)\s*\(/m,

    // Method declaration (receiver)
    methodDecl: /^func\s+\([^)]+\)\s+(\w+)\s*\(/m,

    // Type declaration (struct, interface, etc.)
    typeDecl: /^type\s+(\w+)\s+(?:struct|interface|func)/m,

    // Type alias
    typeAlias: /^type\s+(\w+)\s*=/m,

    // Const block
    constBlock: /^const\s*\(/m,

    // Var block
    varBlock: /^var\s*\(/m
  },

  // Secondary split points - for splitting within large structures
  secondaryPatterns: {
    // Interface method
    interfaceMethod: /^\s+(\w+)\s*\([^)]*\)/m,

    // Struct field
    structField: /^\s+(\w+)\s+[\w\[\]*]+/m
  },

  /**
   * Extract metadata from a code chunk
   * @param {string} code - Code chunk
   * @returns {Object} Extracted metadata
   */
  extractMetadata(code) {
    const metadata = {
      functionName: null,
      packageName: null,
      typeName: null,
      receiverType: null,
      isMethod: false,
      isExported: false,
      type: null // 'package', 'function', 'method', 'type', 'interface', 'struct', 'const', 'var'
    };

    const trimmed = code.trim();
    let match;

    // Package
    match = trimmed.match(/^package\s+(\w+)/m);
    if (match) {
      metadata.packageName = match[1];
      metadata.type = 'package';
      return metadata;
    }

    // Const block
    if (/^const\s*\(/.test(trimmed)) {
      metadata.type = 'const';
      return metadata;
    }

    // Var block
    if (/^var\s*\(/.test(trimmed)) {
      metadata.type = 'var';
      return metadata;
    }

    // Type declaration
    match = trimmed.match(/^type\s+(\w+)\s+(struct|interface)/m);
    if (match) {
      metadata.typeName = match[1];
      metadata.type = match[2];
      metadata.isExported = /^[A-Z]/.test(match[1]);
      return metadata;
    }

    // Type alias
    match = trimmed.match(/^type\s+(\w+)\s*=/m);
    if (match) {
      metadata.typeName = match[1];
      metadata.type = 'type';
      metadata.isExported = /^[A-Z]/.test(match[1]);
      return metadata;
    }

    // Method (function with receiver)
    match = trimmed.match(/^func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)/m);
    if (match) {
      metadata.receiverType = match[2];
      metadata.functionName = match[3];
      metadata.type = 'method';
      metadata.isMethod = true;
      metadata.isExported = /^[A-Z]/.test(match[3]);
      return metadata;
    }

    // Function
    match = trimmed.match(/^func\s+(\w+)/m);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'function';
      metadata.isExported = /^[A-Z]/.test(match[1]);
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
