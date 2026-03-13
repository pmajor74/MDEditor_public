/**
 * Python Language Definition
 *
 * Patterns for identifying structural boundaries in Python code.
 */

module.exports = {
  name: 'python',
  extensions: ['.py', '.pyw', '.pyi', '.pyx'],

  // Primary split points - top-level structures
  patterns: {
    // Class declaration
    classDecl: /^class\s+(\w+)(?:\([^)]*\))?\s*:/m,

    // Function/method declaration
    funcDecl: /^(?:async\s+)?def\s+(\w+)\s*\(/m,

    // Decorated function/class
    decorated: /^@[\w.]+(?:\([^)]*\))?\s*\n(?:@[\w.]+(?:\([^)]*\))?\s*\n)*(?:async\s+)?(?:def|class)/m
  },

  // Secondary split points - for splitting within large structures
  secondaryPatterns: {
    // Method inside class (indented def)
    methodDef: /^\s{4,}(?:async\s+)?def\s+(\w+)\s*\(/m,

    // Nested class
    nestedClass: /^\s{4,}class\s+(\w+)/m,

    // Property decorator
    property: /^\s+@property\s*\n\s+def\s+(\w+)/m
  },

  // Patterns for identifying decorators
  decoratorPattern: /^@[\w.]+(?:\([^)]*\))?$/m,

  /**
   * Extract metadata from a code chunk
   * @param {string} code - Code chunk
   * @returns {Object} Extracted metadata
   */
  extractMetadata(code) {
    const metadata = {
      functionName: null,
      className: null,
      isAsync: false,
      isDecorated: false,
      decorators: [],
      type: null // 'class', 'function', 'method', 'property'
    };

    const lines = code.split('\n');
    const decorators = [];

    // Collect decorators
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('@')) {
        decorators.push(trimmed);
      } else if (trimmed && !trimmed.startsWith('#')) {
        break;
      }
    }

    metadata.decorators = decorators;
    metadata.isDecorated = decorators.length > 0;

    const trimmed = code.trim();
    metadata.isAsync = /async\s+def/.test(trimmed);

    let match;

    // Class
    match = trimmed.match(/class\s+(\w+)/);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'class';
      return metadata;
    }

    // Check if it's a property
    if (decorators.some(d => d.includes('@property') || d.includes('.setter') || d.includes('.getter'))) {
      match = trimmed.match(/def\s+(\w+)/);
      if (match) {
        metadata.functionName = match[1];
        metadata.type = 'property';
        return metadata;
      }
    }

    // Function/method
    match = trimmed.match(/def\s+(\w+)/);
    if (match) {
      metadata.functionName = match[1];
      // Check if indented (method) or top-level (function)
      const firstDefLine = lines.find(l => l.trim().startsWith('def') || l.trim().startsWith('async def'));
      if (firstDefLine && /^\s{4,}/.test(firstDefLine)) {
        metadata.type = 'method';
      } else {
        metadata.type = 'function';
      }
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
    return trimmed.startsWith('#');
  },

  /**
   * Check if a line is a docstring boundary
   * @param {string} line - Line to check
   * @returns {boolean} True if line is docstring
   */
  isDocstring(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('"""') || trimmed.startsWith("'''");
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
