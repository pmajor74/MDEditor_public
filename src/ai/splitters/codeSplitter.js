/**
 * Code Splitter
 *
 * Language-aware code splitter that respects function, class, and method boundaries.
 * Uses language definitions from the languages/ directory.
 */

const path = require('path');
const { BaseSplitter, DEFAULT_CONFIG } = require('./baseSplitter');
const { getLanguage, getLanguageName } = require('./languages');
const { estimateTokens } = require('./strategies/tokenEstimator');
const { splitToTargetSize } = require('./strategies/semanticChunker');
const treeSitterParser = require('./treeSitterParser');

/**
 * Code-specific default config overrides
 */
const CODE_CONFIG = {
  ...DEFAULT_CONFIG,
  targetChunkSize: 384,    // Smaller chunks for code
  overlapPercent: 20,      // More overlap for code context
  preserveComments: true,  // Keep comment blocks with their code
  preserveImports: true    // Keep imports together
};

/**
 * Language-aware code splitter
 */
class CodeSplitter extends BaseSplitter {
  /**
   * Create a new code splitter
   * @param {Object} config - Configuration overrides
   */
  constructor(config = {}) {
    super({ ...CODE_CONFIG, ...config });
    this.language = null;
    this.languageName = null;
  }

  getContentType() {
    return 'code';
  }

  /**
   * Split code content into chunks.
   * Tries tree-sitter AST parsing first, falls back to regex patterns.
   * @param {string} content - Code content
   * @param {string} filePath - Path to source file
   * @returns {Promise<Array<Object>>} Array of chunk objects
   */
  async split(content, filePath) {
    if (!content) return [];

    // Try tree-sitter AST parsing first
    if (treeSitterParser.isSupported(filePath)) {
      try {
        const astChunks = await treeSitterParser.parseCode(content, filePath);
        if (astChunks && astChunks.length > 0) {
          console.log(`[CodeSplitter] Tree-sitter produced ${astChunks.length} chunks for ${path.basename(filePath)}`);
          return this.processChunks(astChunks, filePath);
        }
      } catch (err) {
        console.warn(`[CodeSplitter] Tree-sitter failed for ${path.basename(filePath)}, using regex fallback:`, err.message);
      }
    }

    // Fall back to regex-based splitting
    const ext = path.extname(filePath);
    this.language = getLanguage(ext);
    this.languageName = getLanguageName(ext);

    if (!this.language) {
      return this.splitGeneric(content, filePath);
    }

    return this.splitWithLanguage(content, filePath);
  }

  /**
   * Split code using language-specific patterns
   * @param {string} content - Code content
   * @param {string} filePath - Source file path
   * @returns {Array<Object>} Chunk objects
   */
  splitWithLanguage(content, filePath) {
    const lines = content.split('\n');
    const chunks = [];
    const boundaries = [];

    // Find all structural boundaries
    for (const [patternName, pattern] of Object.entries(this.language.patterns)) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags + 'g');

      // Find matches and their line numbers
      let lineNum = 0;
      let charIndex = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineStart = charIndex;
        const lineEnd = charIndex + line.length;

        // Check if any match starts on this line
        regex.lastIndex = 0;
        if (regex.test(line)) {
          boundaries.push({
            line: i,
            patternName,
            isPrimary: true
          });
        }

        charIndex = lineEnd + 1; // +1 for newline
      }
    }

    // Sort boundaries by line number
    boundaries.sort((a, b) => a.line - b.line);

    // Remove duplicates (multiple patterns matching same line)
    const uniqueBoundaries = [];
    let lastLine = -1;
    for (const boundary of boundaries) {
      if (boundary.line !== lastLine) {
        uniqueBoundaries.push(boundary);
        lastLine = boundary.line;
      }
    }

    // If no boundaries found, split generically
    if (uniqueBoundaries.length === 0) {
      return this.splitGeneric(content, filePath);
    }

    // Create chunks from boundaries
    let prevBoundary = 0;

    // Handle imports/preamble at the start
    if (uniqueBoundaries.length > 0 && uniqueBoundaries[0].line > 0) {
      const preambleEnd = uniqueBoundaries[0].line;
      const preambleContent = lines.slice(0, preambleEnd).join('\n');

      if (preambleContent.trim()) {
        chunks.push({
          content: preambleContent,
          startLine: 1,
          endLine: preambleEnd,
          metadata: {
            fileType: 'code',
            language: this.languageName,
            structureType: 'imports',
            structureName: 'imports/preamble'
          }
        });
      }
      prevBoundary = preambleEnd;
    }

    // Process each boundary
    for (let i = 0; i < uniqueBoundaries.length; i++) {
      const boundary = uniqueBoundaries[i];
      const nextBoundary = uniqueBoundaries[i + 1];

      const startLine = boundary.line;
      const endLine = nextBoundary ? nextBoundary.line : lines.length;

      const chunkLines = lines.slice(startLine, endLine);
      const chunkContent = chunkLines.join('\n');

      if (!chunkContent.trim()) continue;

      // Extract metadata using language definition
      const metadata = this.language.extractMetadata(chunkContent);

      chunks.push({
        content: chunkContent,
        startLine: startLine + 1, // 1-indexed
        endLine: endLine,
        metadata: {
          fileType: 'code',
          language: this.languageName,
          structureType: metadata.type || 'block',
          structureName: metadata.functionName || metadata.className || metadata.typeName || null,
          isExported: metadata.isExported || metadata.isPublic || false,
          isAsync: metadata.isAsync || false,
          ...metadata
        }
      });
    }

    // Process chunks (split large, merge small, add overlap)
    return this.processChunks(chunks, filePath);
  }

  /**
   * Split a large code chunk using secondary patterns or blank lines
   * @param {Object} chunk - Chunk object to split
   * @returns {Array<Object>} Array of smaller chunks
   */
  splitLargeChunk(chunk) {
    const tokens = this.estimateTokens(chunk.content);

    if (tokens <= this.config.maxChunkSize) {
      return [chunk];
    }

    const lines = chunk.content.split('\n');
    const subChunks = [];

    // Try to find secondary boundaries
    if (this.language && this.language.secondaryPatterns) {
      const boundaries = [0];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of Object.values(this.language.secondaryPatterns)) {
          if (pattern.test(line)) {
            if (boundaries[boundaries.length - 1] !== i) {
              boundaries.push(i);
            }
            break;
          }
        }
      }

      boundaries.push(lines.length);

      // Create sub-chunks from secondary boundaries
      for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        const subContent = lines.slice(start, end).join('\n');

        if (subContent.trim()) {
          subChunks.push({
            content: subContent,
            startLine: chunk.startLine + start,
            endLine: chunk.startLine + end - 1,
            metadata: {
              ...chunk.metadata,
              subChunkIndex: i,
              subChunkTotal: boundaries.length - 1
            }
          });
        }
      }

      // If secondary patterns produced reasonable chunks, use them
      if (subChunks.length > 1) {
        // Recursively check if any are still too large
        const result = [];
        for (const subChunk of subChunks) {
          const subTokens = this.estimateTokens(subChunk.content);
          if (subTokens > this.config.maxChunkSize) {
            // Fall back to blank-line splitting for this chunk
            result.push(...this.splitAtBlankLines(subChunk));
          } else {
            result.push(subChunk);
          }
        }
        return result;
      }
    }

    // Fall back to blank-line splitting
    return this.splitAtBlankLines(chunk);
  }

  /**
   * Split a chunk at blank line groups
   * @param {Object} chunk - Chunk to split
   * @returns {Array<Object>} Split chunks
   */
  splitAtBlankLines(chunk) {
    const lines = chunk.content.split('\n');
    const subChunks = [];
    let currentLines = [];
    let currentStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isBlank = line.trim().length === 0;

      currentLines.push(line);

      // Check if we should split here
      if (isBlank) {
        const currentContent = currentLines.join('\n');
        const currentTokens = this.estimateTokens(currentContent);

        if (currentTokens >= this.config.targetChunkSize) {
          // Split here
          subChunks.push({
            content: currentContent.trim(),
            startLine: chunk.startLine + currentStart,
            endLine: chunk.startLine + i,
            metadata: {
              ...chunk.metadata,
              subChunkIndex: subChunks.length
            }
          });
          currentLines = [];
          currentStart = i + 1;
        }
      }
    }

    // Don't forget remaining content
    if (currentLines.length > 0) {
      const remainingContent = currentLines.join('\n').trim();
      if (remainingContent) {
        subChunks.push({
          content: remainingContent,
          startLine: chunk.startLine + currentStart,
          endLine: chunk.endLine,
          metadata: {
            ...chunk.metadata,
            subChunkIndex: subChunks.length
          }
        });
      }
    }

    // Update subChunkTotal
    for (const sub of subChunks) {
      sub.metadata.subChunkTotal = subChunks.length;
    }

    return subChunks.length > 0 ? subChunks : [chunk];
  }

  /**
   * Generic splitting for unsupported languages
   * @param {string} content - Code content
   * @param {string} filePath - Source file path
   * @returns {Array<Object>} Chunk objects
   */
  splitGeneric(content, filePath) {
    const chunks = [];
    const lines = content.split('\n');

    // Find natural break points (blank lines, section comments)
    const breakPoints = [0];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : '';

      // Break on blank line after non-blank content
      if (line.trim() === '' && prevLine.trim() !== '') {
        // Check if we have enough content for a chunk
        const chunkContent = lines.slice(breakPoints[breakPoints.length - 1], i + 1).join('\n');
        const tokens = this.estimateTokens(chunkContent);

        if (tokens >= this.config.targetChunkSize * 0.75) {
          breakPoints.push(i + 1);
        }
      }
    }

    breakPoints.push(lines.length);

    // Create chunks from break points
    for (let i = 0; i < breakPoints.length - 1; i++) {
      const start = breakPoints[i];
      const end = breakPoints[i + 1];
      const chunkContent = lines.slice(start, end).join('\n');

      if (chunkContent.trim()) {
        chunks.push({
          content: chunkContent,
          startLine: start + 1,
          endLine: end,
          metadata: {
            fileType: 'code',
            language: this.languageName || 'unknown',
            structureType: 'block',
            structureName: null
          }
        });
      }
    }

    return this.processChunks(chunks, filePath);
  }
}

module.exports = {
  CodeSplitter,
  CODE_CONFIG
};
