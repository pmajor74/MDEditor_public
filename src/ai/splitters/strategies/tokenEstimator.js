/**
 * Token Estimator
 *
 * Fast token estimation for chunking decisions.
 * Uses content-type calibrated ratios for better accuracy.
 */

/**
 * Content type calibration ratios
 * Based on empirical testing with various content types
 */
const CALIBRATION_RATIOS = {
  code: 3.5,      // Code has more punctuation/symbols
  prose: 4.2,    // Natural language prose
  config: 3.8,   // Configuration files (JSON, YAML)
  markdown: 4.0, // Markdown with mixed content
  default: 4.0   // Fallback ratio
};

/**
 * Estimate token count for text content
 * @param {string} text - Text to estimate tokens for
 * @param {string} contentType - Content type hint: 'code', 'prose', 'config', 'markdown'
 * @returns {number} Estimated token count
 */
function estimateTokens(text, contentType = 'default') {
  if (!text) return 0;

  const ratio = CALIBRATION_RATIOS[contentType] || CALIBRATION_RATIOS.default;
  return Math.ceil(text.length / ratio);
}

/**
 * Estimate tokens with auto-detection of content type
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokensAuto(text) {
  if (!text) return 0;

  const contentType = detectContentType(text);
  return estimateTokens(text, contentType);
}

/**
 * Detect content type based on text characteristics
 * @param {string} text - Text to analyze
 * @returns {string} Detected content type
 */
function detectContentType(text) {
  if (!text || text.length < 20) return 'default';

  const sample = text.substring(0, Math.min(1000, text.length));

  // Check for code indicators
  const codeIndicators = [
    /function\s+\w+\s*\(/,           // JavaScript function
    /def\s+\w+\s*\(/,                // Python function
    /class\s+\w+/,                   // Class definition
    /import\s+[\w{]/,                // Import statement
    /const\s+\w+\s*=/,               // Const declaration
    /let\s+\w+\s*=/,                 // Let declaration
    /var\s+\w+\s*=/,                 // Var declaration
    /=>\s*\{/,                       // Arrow function
    /public\s+(class|void|static)/,  // Java/C# public
    /private\s+(class|void|static)/, // Java/C# private
    /\}\s*else\s*\{/,                // Control flow
    /^\s*#include/m,                 // C/C++ include
    /^\s*using\s+\w+;/m,             // C# using
    /^\s*package\s+\w+/m,            // Java package
  ];

  const codeMatches = codeIndicators.filter(regex => regex.test(sample)).length;
  if (codeMatches >= 2) return 'code';

  // Check for config indicators
  const configIndicators = [
    /^\s*\{[\s\n]*"[\w]+"\s*:/m,     // JSON object
    /^\s*\[\s*\{/m,                  // JSON array
    /^[\w_]+\s*=\s*.+$/m,            // INI/ENV style
    /^\s*[\w_-]+:\s*.+$/m,           // YAML style
    /^\s*\[[\w\s.-]+\]\s*$/m,        // INI section
  ];

  const configMatches = configIndicators.filter(regex => regex.test(sample)).length;
  if (configMatches >= 2) return 'config';

  // Check for markdown indicators
  const markdownIndicators = [
    /^#{1,6}\s+.+$/m,                // Headers
    /^\s*[-*+]\s+.+$/m,              // Lists
    /\[.+\]\(.+\)/,                  // Links
    /```[\s\S]*?```/,                // Code blocks
    /^\s*>\s+.+$/m,                  // Blockquotes
  ];

  const markdownMatches = markdownIndicators.filter(regex => regex.test(sample)).length;
  if (markdownMatches >= 2) return 'markdown';

  // Default to prose for natural language text
  // Check for sentence-like structure
  const sentenceCount = (sample.match(/[.!?]\s+[A-Z]/g) || []).length;
  const paragraphCount = (sample.match(/\n\n/g) || []).length;

  if (sentenceCount > 3 || paragraphCount > 2) return 'prose';

  return 'default';
}

/**
 * Calculate target overlap tokens based on chunk size and percentage
 * @param {number} chunkTokens - Size of chunk in tokens
 * @param {number} overlapPercent - Overlap percentage (0-100)
 * @returns {number} Number of overlap tokens
 */
function calculateOverlapTokens(chunkTokens, overlapPercent = 15) {
  return Math.ceil(chunkTokens * (overlapPercent / 100));
}

/**
 * Estimate character count needed for target token count
 * @param {number} targetTokens - Target token count
 * @param {string} contentType - Content type hint
 * @returns {number} Estimated character count
 */
function tokensToChars(targetTokens, contentType = 'default') {
  const ratio = CALIBRATION_RATIOS[contentType] || CALIBRATION_RATIOS.default;
  return Math.floor(targetTokens * ratio);
}

module.exports = {
  estimateTokens,
  estimateTokensAuto,
  detectContentType,
  calculateOverlapTokens,
  tokensToChars,
  CALIBRATION_RATIOS
};
