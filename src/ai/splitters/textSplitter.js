/**
 * Text Splitter
 *
 * Fallback splitter for plain text files (.txt, .log, .csv, etc.)
 * Uses semantic chunking strategies for natural text splitting.
 */

const { BaseSplitter, DEFAULT_CONFIG } = require('./baseSplitter');
const { splitAtParagraphs, splitToTargetSize, mergeSmallChunks } = require('./strategies/semanticChunker');
const { estimateTokens } = require('./strategies/tokenEstimator');

/**
 * Text-specific default config
 */
const TEXT_CONFIG = {
  ...DEFAULT_CONFIG,
  targetChunkSize: 512,
  overlapPercent: 15
};

/**
 * Plain text splitter
 */
class TextSplitter extends BaseSplitter {
  constructor(config = {}) {
    super({ ...TEXT_CONFIG, ...config });
  }

  getContentType() {
    return 'prose';
  }

  /**
   * Split text content into chunks
   * @param {string} content - Text content
   * @param {string} filePath - Path to source file
   * @returns {Array<Object>} Array of chunk objects
   */
  split(content, filePath) {
    if (!content) return [];

    const lines = content.split('\n');
    const chunks = [];

    // First, try paragraph-based splitting
    const paragraphs = splitAtParagraphs(content);

    if (paragraphs.length === 0) {
      // No paragraphs - treat as single chunk
      chunks.push({
        content: content,
        startLine: 1,
        endLine: lines.length,
        metadata: {
          fileType: 'text',
          language: null,
          structureType: 'document',
          structureName: 'content'
        }
      });
      return this.processChunks(chunks, filePath);
    }

    // Group paragraphs into chunks based on token count
    let currentParagraphs = [];
    let currentStartLine = 1;
    let lineCounter = 1;
    let paragraphIndex = 0;

    for (const paragraph of paragraphs) {
      currentParagraphs.push(paragraph);

      const combinedContent = currentParagraphs.join('\n\n');
      const combinedTokens = estimateTokens(combinedContent, 'prose');

      // Count lines in this paragraph
      const paragraphLines = paragraph.split('\n').length;

      if (combinedTokens >= this.config.targetChunkSize) {
        // Check if current chunk is too large and needs splitting
        if (combinedTokens > this.config.maxChunkSize) {
          // Split the oversized content semantically
          const splitChunks = splitToTargetSize(
            combinedContent,
            this.config.targetChunkSize,
            this.config.maxChunkSize,
            'prose'
          );

          for (let i = 0; i < splitChunks.length; i++) {
            chunks.push({
              content: splitChunks[i],
              startLine: currentStartLine,
              endLine: lineCounter + paragraphLines,
              metadata: {
                fileType: 'text',
                language: null,
                structureType: 'paragraph',
                structureName: `section ${chunks.length + 1}`,
                subChunkIndex: i,
                subChunkTotal: splitChunks.length
              }
            });
          }
        } else {
          // Create chunk from current paragraphs
          chunks.push({
            content: combinedContent,
            startLine: currentStartLine,
            endLine: lineCounter + paragraphLines,
            metadata: {
              fileType: 'text',
              language: null,
              structureType: 'paragraph',
              structureName: `section ${chunks.length + 1}`
            }
          });
        }

        // Reset for next chunk
        currentParagraphs = [];
        currentStartLine = lineCounter + paragraphLines + 1;
      }

      lineCounter += paragraphLines + 1; // +1 for blank line between paragraphs
      paragraphIndex++;
    }

    // Don't forget remaining paragraphs
    if (currentParagraphs.length > 0) {
      const remainingContent = currentParagraphs.join('\n\n');
      const remainingTokens = estimateTokens(remainingContent, 'prose');

      if (remainingTokens > this.config.maxChunkSize) {
        // Split if too large
        const splitChunks = splitToTargetSize(
          remainingContent,
          this.config.targetChunkSize,
          this.config.maxChunkSize,
          'prose'
        );

        for (let i = 0; i < splitChunks.length; i++) {
          chunks.push({
            content: splitChunks[i],
            startLine: currentStartLine,
            endLine: lines.length,
            metadata: {
              fileType: 'text',
              language: null,
              structureType: 'paragraph',
              structureName: `section ${chunks.length + 1}`,
              subChunkIndex: i,
              subChunkTotal: splitChunks.length
            }
          });
        }
      } else {
        chunks.push({
          content: remainingContent,
          startLine: currentStartLine,
          endLine: lines.length,
          metadata: {
            fileType: 'text',
            language: null,
            structureType: 'paragraph',
            structureName: `section ${chunks.length + 1}`
          }
        });
      }
    }

    return this.processChunks(chunks, filePath);
  }
}

/**
 * Specialized splitter for log files
 * Groups log entries by timestamp blocks
 */
class LogSplitter extends BaseSplitter {
  constructor(config = {}) {
    super({ ...TEXT_CONFIG, ...config });
  }

  getContentType() {
    return 'prose';
  }

  /**
   * Split log content into chunks
   * @param {string} content - Log content
   * @param {string} filePath - Path to source file
   * @returns {Array<Object>} Array of chunk objects
   */
  split(content, filePath) {
    if (!content) return [];

    const lines = content.split('\n');
    const chunks = [];

    // Common timestamp patterns
    const timestampPatterns = [
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/,     // ISO format
      /^\[\d{4}-\d{2}-\d{2}/,                         // [2024-01-01
      /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/,            // MM/DD/YYYY HH:MM
      /^\w{3} \d{2} \d{2}:\d{2}:\d{2}/,             // Jan 01 00:00:00
      /^\[\d{2}:\d{2}:\d{2}\]/                       // [00:00:00]
    ];

    // Find log entry boundaries
    const boundaries = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of timestampPatterns) {
        if (pattern.test(line)) {
          boundaries.push(i);
          break;
        }
      }
    }

    // If no timestamp patterns found, fall back to text splitter
    if (boundaries.length === 0) {
      const textSplitter = new TextSplitter(this.config);
      return textSplitter.split(content, filePath);
    }

    boundaries.push(lines.length);

    // Group entries into chunks
    let currentLines = [];
    let currentStart = 0;

    for (let i = 0; i < boundaries.length - 1; i++) {
      const entryStart = boundaries[i];
      const entryEnd = boundaries[i + 1];
      const entryLines = lines.slice(entryStart, entryEnd);

      currentLines.push(...entryLines);

      const combinedContent = currentLines.join('\n');
      const combinedTokens = estimateTokens(combinedContent, 'prose');

      if (combinedTokens >= this.config.targetChunkSize) {
        chunks.push({
          content: combinedContent,
          startLine: currentStart + 1,
          endLine: entryEnd,
          metadata: {
            fileType: 'text',
            language: 'log',
            structureType: 'entries',
            structureName: `entries ${chunks.length + 1}`
          }
        });

        currentLines = [];
        currentStart = entryEnd;
      }
    }

    // Remaining entries
    if (currentLines.length > 0) {
      const remainingContent = currentLines.join('\n');
      if (remainingContent.trim()) {
        chunks.push({
          content: remainingContent,
          startLine: currentStart + 1,
          endLine: lines.length,
          metadata: {
            fileType: 'text',
            language: 'log',
            structureType: 'entries',
            structureName: `entries ${chunks.length + 1}`
          }
        });
      }
    }

    return this.processChunks(chunks, filePath);
  }
}

/**
 * Specialized splitter for CSV files
 * Groups rows into chunks while preserving header context
 */
class CsvSplitter extends BaseSplitter {
  constructor(config = {}) {
    super({ ...TEXT_CONFIG, ...config, overlapPercent: 5 }); // Less overlap for CSV
  }

  getContentType() {
    return 'config';
  }

  /**
   * Split CSV content into chunks
   * @param {string} content - CSV content
   * @param {string} filePath - Path to source file
   * @returns {Array<Object>} Array of chunk objects
   */
  split(content, filePath) {
    if (!content) return [];

    const lines = content.split('\n');
    const chunks = [];

    if (lines.length === 0) return [];

    // First line is assumed to be header
    const header = lines[0];
    const dataLines = lines.slice(1);

    // Include header with each chunk for context
    let currentLines = [];
    let currentStart = 2; // 1-indexed, after header

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      if (!line.trim()) continue;

      currentLines.push(line);

      // Create chunk content with header
      const chunkContent = header + '\n' + currentLines.join('\n');
      const chunkTokens = estimateTokens(chunkContent, 'config');

      if (chunkTokens >= this.config.targetChunkSize) {
        chunks.push({
          content: chunkContent,
          startLine: currentStart,
          endLine: currentStart + currentLines.length - 1,
          metadata: {
            fileType: 'text',
            language: 'csv',
            structureType: 'rows',
            structureName: `rows ${currentStart}-${currentStart + currentLines.length - 1}`,
            rowRange: [currentStart, currentStart + currentLines.length - 1],
            hasHeader: true
          }
        });

        currentStart = currentStart + currentLines.length;
        currentLines = [];
      }
    }

    // Remaining rows
    if (currentLines.length > 0) {
      const chunkContent = header + '\n' + currentLines.join('\n');
      chunks.push({
        content: chunkContent,
        startLine: currentStart,
        endLine: currentStart + currentLines.length - 1,
        metadata: {
          fileType: 'text',
          language: 'csv',
          structureType: 'rows',
          structureName: `rows ${currentStart}-${currentStart + currentLines.length - 1}`,
          rowRange: [currentStart, currentStart + currentLines.length - 1],
          hasHeader: true
        }
      });
    }

    // If no chunks created, return entire content
    if (chunks.length === 0) {
      chunks.push({
        content: content,
        startLine: 1,
        endLine: lines.length,
        metadata: {
          fileType: 'text',
          language: 'csv',
          structureType: 'document',
          structureName: 'data',
          hasHeader: true
        }
      });
    }

    return this.processChunks(chunks, filePath);
  }
}

module.exports = {
  TextSplitter,
  LogSplitter,
  CsvSplitter,
  TEXT_CONFIG
};
