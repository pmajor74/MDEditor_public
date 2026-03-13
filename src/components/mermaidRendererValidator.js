/**
 * Renderer-side Mermaid Validator
 *
 * Uses the actual mermaid library (which runs in browser context) to validate
 * mermaid diagram syntax. This catches errors that pattern-based validation misses.
 */

import mermaid from 'mermaid';

// Initialize mermaid for validation
let initialized = false;

function initMermaid() {
  if (initialized) return;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    suppressErrorRendering: true
  });

  initialized = true;
}

/**
 * Extract mermaid code blocks from markdown content
 * @param {string} content - Markdown content
 * @returns {Array} Array of {code, startIndex, endIndex} objects
 */
export function extractMermaidBlocks(content) {
  const blocks = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      code: match[1].trim(),
      fullMatch: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }

  return blocks;
}

/**
 * Validate a single mermaid diagram using the actual mermaid parser
 * @param {string} code - Mermaid diagram code (without the code fence)
 * @returns {Promise<Object>} {isValid: boolean, error: string|null}
 */
export async function validateMermaidSyntax(code) {
  if (!code || code.trim().length === 0) {
    return { isValid: false, error: 'Empty mermaid diagram' };
  }

  try {
    initMermaid();

    // Use mermaid's parse function to validate syntax
    // This throws an error if the syntax is invalid
    await mermaid.parse(code);

    return { isValid: true, error: null };
  } catch (error) {
    // Extract meaningful error message
    const errorMessage = extractErrorMessage(error);
    return {
      isValid: false,
      error: errorMessage
    };
  }
}

/**
 * Extract a clean, helpful error message from mermaid parse errors
 */
function extractErrorMessage(error) {
  const errorStr = error.message || String(error);

  // Try to extract the most useful part of the error
  // Mermaid errors often include a lot of noise

  // Pattern: "Parse error on line X: ..."
  const parseErrorMatch = errorStr.match(/Parse error on line (\d+):[^\n]*/i);
  if (parseErrorMatch) {
    return parseErrorMatch[0];
  }

  // Pattern: "Lexical error on line X: ..."
  const lexicalErrorMatch = errorStr.match(/Lexical error on line (\d+):[^\n]*/i);
  if (lexicalErrorMatch) {
    return lexicalErrorMatch[0];
  }

  // Pattern: "Expecting X, got Y"
  const expectingMatch = errorStr.match(/Expecting [^,]+, got '[^']+'/i);
  if (expectingMatch) {
    return expectingMatch[0];
  }

  // Return first 200 chars if no pattern matched
  return errorStr.substring(0, 200);
}

/**
 * Validate all mermaid blocks in markdown content
 * @param {string} content - Full markdown content
 * @returns {Promise<Object>} {isValid: boolean, errors: Array, hasBlocks: boolean}
 */
export async function validateMermaidInContent(content) {
  const blocks = extractMermaidBlocks(content);

  if (blocks.length === 0) {
    return { isValid: true, errors: [], hasBlocks: false };
  }

  const errors = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const result = await validateMermaidSyntax(block.code);

    if (!result.isValid) {
      errors.push({
        blockIndex: i + 1,
        error: result.error,
        codePreview: block.code.substring(0, 100) + (block.code.length > 100 ? '...' : '')
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    hasBlocks: true,
    blockCount: blocks.length
  };
}

/**
 * Format validation errors for display
 * @param {Array} errors - Array of error objects
 * @returns {string} Formatted error message
 */
export function formatErrors(errors) {
  if (!errors || errors.length === 0) return '';

  return errors.map(err =>
    `Mermaid Block ${err.blockIndex}: ${err.error}`
  ).join('\n');
}

export default {
  validateMermaidSyntax,
  validateMermaidInContent,
  extractMermaidBlocks,
  formatErrors
};
