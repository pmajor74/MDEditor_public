/**
 * PowerShell Language Definition
 *
 * Patterns for identifying structural boundaries in PowerShell code.
 */

module.exports = {
  name: 'powershell',
  extensions: ['.ps1', '.psm1', '.psd1'],

  // Primary split points - top-level structures
  patterns: {
    // Function declaration
    funcDecl: /^(?:\s*)function\s+([\w-]+)\s*(?:\([^)]*\))?\s*\{/im,

    // Filter declaration
    filterDecl: /^(?:\s*)filter\s+([\w-]+)\s*\{/im,

    // Workflow declaration (PowerShell Workflow)
    workflowDecl: /^(?:\s*)workflow\s+([\w-]+)\s*\{/im,

    // Configuration declaration (DSC)
    configDecl: /^(?:\s*)configuration\s+([\w-]+)\s*\{/im,

    // Class declaration (PowerShell 5+)
    classDecl: /^(?:\s*)class\s+(\w+)/im,

    // Enum declaration (PowerShell 5+)
    enumDecl: /^(?:\s*)enum\s+(\w+)/im
  },

  // Secondary split points - for splitting within large structures
  secondaryPatterns: {
    // Begin/Process/End blocks
    beginBlock: /^(?:\s*)begin\s*\{/im,
    processBlock: /^(?:\s*)process\s*\{/im,
    endBlock: /^(?:\s*)end\s*\{/im,

    // Nested function
    nestedFunc: /^(?:\s{4,})function\s+([\w-]+)/im,

    // Class method
    methodDecl: /^(?:\s+)(?:\[[\w\[\]]+\]\s*)?(\w+)\s*\([^)]*\)\s*\{/m
  },

  // Parameter block pattern
  paramBlockPattern: /^(?:\s*)param\s*\(/im,

  // Comment-based help pattern
  helpPattern: /<#[\s\S]*?#>/g,

  /**
   * Extract metadata from a code chunk
   * @param {string} code - Code chunk
   * @returns {Object} Extracted metadata
   */
  extractMetadata(code) {
    const metadata = {
      functionName: null,
      className: null,
      isAdvancedFunction: false,
      hasParamBlock: false,
      hasCmdletBinding: false,
      type: null // 'function', 'filter', 'workflow', 'configuration', 'class', 'enum'
    };

    const trimmed = code.trim();

    // Check for advanced function indicators
    metadata.hasParamBlock = /\bparam\s*\(/i.test(trimmed);
    metadata.hasCmdletBinding = /\[CmdletBinding/i.test(trimmed);
    metadata.isAdvancedFunction = metadata.hasCmdletBinding;

    let match;

    // Class
    match = trimmed.match(/class\s+(\w+)/i);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'class';
      return metadata;
    }

    // Enum
    match = trimmed.match(/enum\s+(\w+)/i);
    if (match) {
      metadata.className = match[1];
      metadata.type = 'enum';
      return metadata;
    }

    // Configuration (DSC)
    match = trimmed.match(/configuration\s+([\w-]+)/i);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'configuration';
      return metadata;
    }

    // Workflow
    match = trimmed.match(/workflow\s+([\w-]+)/i);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'workflow';
      return metadata;
    }

    // Filter
    match = trimmed.match(/filter\s+([\w-]+)/i);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'filter';
      return metadata;
    }

    // Function
    match = trimmed.match(/function\s+([\w-]+)/i);
    if (match) {
      metadata.functionName = match[1];
      metadata.type = 'function';
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
    return trimmed.startsWith('#') ||
           trimmed.startsWith('<#') ||
           trimmed.endsWith('#>');
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
