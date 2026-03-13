/**
 * Rust Language Definition
 *
 * Patterns for identifying structural boundaries in Rust code.
 */

module.exports = {
  name: 'rust',
  extensions: ['.rs'],

  // Primary split points - top-level structures
  patterns: {
    // Module declaration
    modDecl: /^(?:pub\s+)?mod\s+(\w+)/m,

    // Function declaration
    funcDecl: /^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]+"\s+)?fn\s+(\w+)/m,

    // Struct declaration
    structDecl: /^(?:pub(?:\([^)]+\))?\s+)?struct\s+(\w+)/m,

    // Enum declaration
    enumDecl: /^(?:pub(?:\([^)]+\))?\s+)?enum\s+(\w+)/m,

    // Trait declaration
    traitDecl: /^(?:pub(?:\([^)]+\))?\s+)?(?:unsafe\s+)?trait\s+(\w+)/m,

    // Impl block
    implDecl: /^impl(?:<[^>]+>)?\s+(?:(\w+)(?:<[^>]+>)?\s+for\s+)?(\w+)/m,

    // Type alias
    typeAlias: /^(?:pub(?:\([^)]+\))?\s+)?type\s+(\w+)/m,

    // Const declaration
    constDecl: /^(?:pub(?:\([^)]+\))?\s+)?const\s+(\w+)/m,

    // Static declaration
    staticDecl: /^(?:pub(?:\([^)]+\))?\s+)?static\s+(?:mut\s+)?(\w+)/m,

    // Macro definition
    macroDecl: /^(?:pub(?:\([^)]+\))?\s+)?macro_rules!\s+(\w+)/m
  },

  // Secondary split points - for splitting within large structures
  secondaryPatterns: {
    // Method in impl block
    methodDecl: /^\s+(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/m,

    // Struct field
    structField: /^\s+(?:pub(?:\([^)]+\))?\s+)?(\w+)\s*:/m,

    // Enum variant
    enumVariant: /^\s+(\w+)(?:\s*[({]|,)/m
  },

  // Attribute patterns
  attributePattern: /^#!?\[[\w:(),\s="']+\]$/m,

  /**
   * Extract metadata from a code chunk
   * @param {string} code - Code chunk
   * @returns {Object} Extracted metadata
   */
  extractMetadata(code) {
    const metadata = {
      functionName: null,
      structName: null,
      traitName: null,
      moduleName: null,
      isPublic: false,
      isAsync: false,
      isUnsafe: false,
      type: null // 'mod', 'fn', 'struct', 'enum', 'trait', 'impl', 'type', 'const', 'static', 'macro'
    };

    const trimmed = code.trim();

    // Check modifiers
    metadata.isPublic = /^pub(?:\([^)]+\))?\s/.test(trimmed);
    metadata.isAsync = /\basync\s/.test(trimmed);
    metadata.isUnsafe = /\bunsafe\s/.test(trimmed);

    let match;

    // Module
    match = trimmed.match(/mod\s+(\w+)/);
    if (match) {
      metadata.moduleName = match[1];
      metadata.type = 'mod';
      return metadata;
    }

    // Macro
    match = trimmed.match(/macro_rules!\s+(\w+)/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'macro';
      return metadata;
    }

    // Trait
    match = trimmed.match(/trait\s+(\w+)/);
    if (match) {
      metadata.traitName = match[1];
      metadata.type = 'trait';
      return metadata;
    }

    // Impl block
    match = trimmed.match(/impl(?:<[^>]+>)?\s+(?:(\w+)(?:<[^>]+>)?\s+for\s+)?(\w+)/);
    if (match) {
      if (match[1]) {
        metadata.traitName = match[1];
      }
      metadata.structName = match[2];
      metadata.type = 'impl';
      return metadata;
    }

    // Struct
    match = trimmed.match(/struct\s+(\w+)/);
    if (match) {
      metadata.structName = match[1];
      metadata.type = 'struct';
      return metadata;
    }

    // Enum
    match = trimmed.match(/enum\s+(\w+)/);
    if (match) {
      metadata.structName = match[1];
      metadata.type = 'enum';
      return metadata;
    }

    // Type alias
    match = trimmed.match(/type\s+(\w+)/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'type';
      return metadata;
    }

    // Const
    match = trimmed.match(/const\s+(\w+)/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'const';
      return metadata;
    }

    // Static
    match = trimmed.match(/static\s+(?:mut\s+)?(\w+)/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'static';
      return metadata;
    }

    // Function
    match = trimmed.match(/fn\s+(\w+)/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'fn';
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
           trimmed.startsWith('///') ||
           trimmed.startsWith('//!');
  },

  /**
   * Check if a line is an attribute
   * @param {string} line - Line to check
   * @returns {boolean} True if line is an attribute
   */
  isAttribute(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('#[') || trimmed.startsWith('#![');
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
