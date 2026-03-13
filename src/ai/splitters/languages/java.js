/**
 * Java Language Definition
 *
 * Patterns for identifying structural boundaries in Java code.
 */

module.exports = {
  name: 'java',
  extensions: ['.java'],

  // Primary split points - top-level structures
  patterns: {
    // Package declaration
    package: /^package\s+([\w.]+);/m,

    // Class declaration
    classDecl: /^(?:\s*)(?:public|private|protected|static|final|abstract|\s)*class\s+(\w+)/m,

    // Interface declaration
    interfaceDecl: /^(?:\s*)(?:public|private|protected|static|\s)*interface\s+(\w+)/m,

    // Enum declaration
    enumDecl: /^(?:\s*)(?:public|private|protected|\s)*enum\s+(\w+)/m,

    // Annotation type declaration
    annotationDecl: /^(?:\s*)(?:public|private|protected|\s)*@interface\s+(\w+)/m,

    // Record declaration (Java 14+)
    recordDecl: /^(?:\s*)(?:public|private|protected|final|\s)*record\s+(\w+)/m
  },

  // Secondary split points - for splitting within large structures
  secondaryPatterns: {
    // Method declaration
    methodDecl: /^(?:\s*)(?:public|private|protected|static|final|abstract|synchronized|native|\s)*(?:<[\w\s,?]+>\s+)?(?:[\w<>\[\],?]+)\s+(\w+)\s*\([^)]*\)/m,

    // Constructor
    constructor: /^(?:\s*)(?:public|private|protected|\s)*(\w+)\s*\([^)]*\)\s*(?:throws[\w\s,]+)?\s*\{/m,

    // Static/instance initializer blocks
    initBlock: /^(?:\s*)(?:static\s*)?\{/m
  },

  // Annotation pattern
  annotationPattern: /^\s*@\w+(?:\([^)]*\))?\s*$/m,

  /**
   * Extract metadata from a code chunk
   * @param {string} code - Code chunk
   * @returns {Object} Extracted metadata
   */
  extractMetadata(code) {
    const metadata = {
      functionName: null,
      className: null,
      packageName: null,
      isPublic: false,
      isStatic: false,
      isFinal: false,
      isAbstract: false,
      type: null // 'package', 'class', 'interface', 'enum', 'annotation', 'record', 'method', 'constructor'
    };

    const trimmed = code.trim();

    // Check modifiers
    metadata.isPublic = /\bpublic\b/.test(trimmed);
    metadata.isStatic = /\bstatic\b/.test(trimmed);
    metadata.isFinal = /\bfinal\b/.test(trimmed);
    metadata.isAbstract = /\babstract\b/.test(trimmed);

    let match;

    // Package
    match = trimmed.match(/package\s+([\w.]+);/);
    if (match) {
      metadata.packageName = match[1];
      metadata.type = 'package';
      return metadata;
    }

    // Annotation type
    match = trimmed.match(/@interface\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'annotation';
      return metadata;
    }

    // Interface
    match = trimmed.match(/interface\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'interface';
      return metadata;
    }

    // Enum
    match = trimmed.match(/enum\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'enum';
      return metadata;
    }

    // Record
    match = trimmed.match(/record\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'record';
      return metadata;
    }

    // Class
    match = trimmed.match(/class\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'class';
      return metadata;
    }

    // Constructor (class name followed by parentheses, no return type)
    const lines = code.split('\n');
    for (const line of lines) {
      // Skip annotations
      if (line.trim().startsWith('@')) continue;

      const constructorMatch = line.match(/(?:public|private|protected)?\s*(\w+)\s*\([^)]*\)\s*(?:throws[\w\s,]+)?\s*\{/);
      if (constructorMatch) {
        const potentialClassName = constructorMatch[1];
        // Constructors start with uppercase, don't have return type keywords before them
        if (/^[A-Z]/.test(potentialClassName) &&
            !line.includes(' void ') &&
            !line.includes(' int ') &&
            !line.includes(' String ') &&
            !line.includes(' boolean ')) {
          metadata.functionName = potentialClassName;
          metadata.type = 'constructor';
          return metadata;
        }
      }
    }

    // Method
    match = trimmed.match(/(?:[\w<>\[\],?]+)\s+(\w+)\s*\(/);
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
