/**
 * C# Language Definition
 *
 * Patterns for identifying structural boundaries in C# code.
 */

module.exports = {
  name: 'csharp',
  extensions: ['.cs', '.csx'],

  // Primary split points - top-level structures
  patterns: {
    // Namespace declaration
    namespace: /^(?:\s*)namespace\s+([\w.]+)/m,

    // Class declaration
    classDecl: /^(?:\s*)(?:public|private|protected|internal|static|abstract|sealed|partial|\s)*class\s+(\w+)/m,

    // Interface declaration
    interfaceDecl: /^(?:\s*)(?:public|private|protected|internal|\s)*interface\s+(\w+)/m,

    // Struct declaration
    structDecl: /^(?:\s*)(?:public|private|protected|internal|readonly|\s)*struct\s+(\w+)/m,

    // Enum declaration
    enumDecl: /^(?:\s*)(?:public|private|protected|internal|\s)*enum\s+(\w+)/m,

    // Record declaration (C# 9+)
    recordDecl: /^(?:\s*)(?:public|private|protected|internal|sealed|\s)*record\s+(?:class|struct)?\s*(\w+)/m
  },

  // Secondary split points - for splitting within large structures
  secondaryPatterns: {
    // Method declaration
    methodDecl: /^(?:\s*)(?:public|private|protected|internal|static|virtual|override|abstract|async|partial|\s)*(?:[\w<>\[\],\s]+)\s+(\w+)\s*\([^)]*\)/m,

    // Property declaration
    propertyDecl: /^(?:\s*)(?:public|private|protected|internal|static|virtual|override|abstract|\s)*(?:[\w<>\[\],?]+)\s+(\w+)\s*\{/m,

    // Constructor
    constructor: /^(?:\s*)(?:public|private|protected|internal|static|\s)*(\w+)\s*\([^)]*\)\s*(?::\s*(?:base|this)\s*\([^)]*\))?\s*\{/m,

    // Event declaration
    eventDecl: /^(?:\s*)(?:public|private|protected|internal|static|\s)*event\s+[\w<>]+\s+(\w+)/m
  },

  // Attribute patterns
  attributePattern: /^\s*\[[\w\s,()."=]+\]\s*$/m,

  /**
   * Extract metadata from a code chunk
   * @param {string} code - Code chunk
   * @returns {Object} Extracted metadata
   */
  extractMetadata(code) {
    const metadata = {
      functionName: null,
      className: null,
      namespace: null,
      isPublic: false,
      isStatic: false,
      isAsync: false,
      type: null // 'namespace', 'class', 'interface', 'struct', 'enum', 'record', 'method', 'property', 'constructor'
    };

    const trimmed = code.trim();

    // Check modifiers
    metadata.isPublic = /\bpublic\b/.test(trimmed);
    metadata.isStatic = /\bstatic\b/.test(trimmed);
    metadata.isAsync = /\basync\b/.test(trimmed);

    let match;

    // Namespace
    match = trimmed.match(/namespace\s+([\w.]+)/);
    if (match) {
      metadata.namespace = match[1];
      metadata.type = 'namespace';
      return metadata;
    }

    // Interface
    match = trimmed.match(/interface\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'interface';
      return metadata;
    }

    // Record
    match = trimmed.match(/record\s+(?:class|struct)?\s*(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'record';
      return metadata;
    }

    // Struct
    match = trimmed.match(/struct\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'struct';
      return metadata;
    }

    // Enum
    match = trimmed.match(/enum\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'enum';
      return metadata;
    }

    // Class
    match = trimmed.match(/class\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'class';
      return metadata;
    }

    // Property (must check before method)
    match = trimmed.match(/(?:[\w<>\[\],?]+)\s+(\w+)\s*\{\s*(?:get|set)/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'property';
      return metadata;
    }

    // Constructor (class name followed by parentheses)
    const lines = code.split('\n');
    for (const line of lines) {
      const constructorMatch = line.match(/(?:public|private|protected|internal|static)?\s*(\w+)\s*\([^)]*\)\s*(?::|{)/);
      if (constructorMatch && !line.includes(' void ') && !line.includes(' async ')) {
        // Likely a constructor if method name matches potential class name pattern
        const potentialClassName = constructorMatch[1];
        if (/^[A-Z]/.test(potentialClassName)) {
          metadata.functionName = potentialClassName;
          metadata.type = 'constructor';
          return metadata;
        }
      }
    }

    // Method
    match = trimmed.match(/(?:[\w<>\[\],]+)\s+(\w+)\s*\(/);
    if (match && match[1] !== 'if' && match[1] !== 'for' && match[1] !== 'while' && match[1] !== 'switch') {
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
           trimmed.startsWith('*/') ||
           trimmed.startsWith('///');
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
