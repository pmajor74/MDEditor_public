/**
 * Bash/Shell Language Definition
 *
 * Patterns for identifying structural boundaries in shell scripts.
 */

module.exports = {
  name: 'bash',
  extensions: ['.sh', '.bash', '.zsh', '.ksh', '.fish'],

  // Primary split points - top-level structures
  patterns: {
    // Function declaration (standard)
    funcDecl: /^(?:\s*)(\w+)\s*\(\)\s*\{/m,

    // Function declaration (function keyword)
    funcKeyword: /^(?:\s*)function\s+(\w+)\s*(?:\(\))?\s*\{/m,

    // Main script sections often marked by comments
    sectionComment: /^#{2,}\s*(.+)\s*#{2,}$/m
  },

  // Secondary split points - for splitting within large structures
  secondaryPatterns: {
    // Case statement
    caseStmt: /^(?:\s*)case\s+.+\s+in/m,

    // If statement
    ifStmt: /^(?:\s*)if\s+/m,

    // For/while loops
    loopStmt: /^(?:\s*)(?:for|while|until)\s+/m
  },

  /**
   * Extract metadata from a code chunk
   * @param {string} code - Code chunk
   * @returns {Object} Extracted metadata
   */
  extractMetadata(code) {
    const metadata = {
      functionName: null,
      type: null // 'function', 'section'
    };

    const trimmed = code.trim();
    let match;

    // Function with keyword
    match = trimmed.match(/function\s+(\w+)/);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'function';
      return metadata;
    }

    // Function without keyword
    match = trimmed.match(/^(\w+)\s*\(\)\s*\{/m);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'function';
      return metadata;
    }

    // Section comment
    match = trimmed.match(/^#{2,}\s*(.+?)\s*#{0,}$/m);
    if (match) {
      metadata.functionName = match[1].trim();
      metadata.type = 'section';
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
    return trimmed.startsWith('#') && !trimmed.startsWith('#!');
  },

  /**
   * Check if a line is a shebang
   * @param {string} line - Line to check
   * @returns {boolean} True if line is a shebang
   */
  isShebang(line) {
    return line.trim().startsWith('#!');
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
