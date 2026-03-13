/**
 * Base Splitter Class
 *
 * Abstract base class providing shared functionality for all splitters:
 * - Configuration management
 * - Overlap handling
 * - Small chunk merging
 * - Large chunk splitting
 * - Chunk ID generation
 */

const crypto = require('crypto');
const { estimateTokens, calculateOverlapTokens, tokensToChars } = require('./strategies/tokenEstimator');
const { splitToTargetSize, mergeSmallChunks } = require('./strategies/semanticChunker');

/**
 * Default configuration for all splitters
 */
const DEFAULT_CONFIG = {
  targetChunkSize: 512,      // Target tokens per chunk
  maxChunkSize: 1024,        // Force split above this
  minChunkSize: 50,          // Merge chunks below this
  overlapPercent: 15,        // ~77 tokens overlap at 512 target
  preserveCodeBlocks: true,  // Don't split inside code blocks
  preserveMermaid: true,     // Don't split inside mermaid diagrams

  // Per-type overrides (applied in factory)
  fileTypeOverrides: {
    code: { targetChunkSize: 384, overlapPercent: 20 },
    config: { targetChunkSize: 256, overlapPercent: 10 }
  }
};

/**
 * Base class for all content splitters
 */
class BaseSplitter {
  /**
   * Create a new splitter instance
   * @param {Object} config - Configuration overrides
   */
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Split content into chunks (must be implemented by subclasses)
   * @param {string} content - Content to split
   * @param {string} filePath - Path to source file
   * @returns {Array<Object>} Array of chunk objects
   */
  split(content, filePath) {
    throw new Error('split() must be implemented by subclass');
  }

  /**
   * Get content type for token estimation
   * @returns {string} Content type
   */
  getContentType() {
    return 'default';
  }

  /**
   * Generate a unique ID for a chunk
   * @param {string} filePath - Source file path
   * @param {number} index - Chunk index
   * @returns {string} Unique chunk ID
   */
  generateChunkId(filePath, index) {
    const hash = crypto.createHash('md5').update(filePath).digest('hex').substring(0, 8);
    return `${hash}_${index}`;
  }

  /**
   * Estimate token count for text
   * @param {string} text - Text to estimate
   * @returns {number} Estimated tokens
   */
  estimateTokens(text) {
    return estimateTokens(text, this.getContentType());
  }

  /**
   * Add overlap between chunks for context preservation
   * @param {Array<Object>} chunks - Array of chunk objects with 'content' property
   * @returns {Array<Object>} Chunks with overlap added
   */
  addOverlap(chunks) {
    if (!chunks || chunks.length <= 1) return chunks;
    if (this.config.overlapPercent <= 0) return chunks;

    const overlappedChunks = [];
    const overlapTokens = calculateOverlapTokens(this.config.targetChunkSize, this.config.overlapPercent);
    const overlapChars = tokensToChars(overlapTokens, this.getContentType());

    for (let i = 0; i < chunks.length; i++) {
      const chunk = { ...chunks[i] };
      let content = chunk.content;
      let overlapBefore = '';
      let overlapAfter = '';

      // Add overlap from previous chunk (end of previous)
      if (i > 0) {
        const prevContent = chunks[i - 1].content;
        if (prevContent.length > overlapChars) {
          overlapBefore = prevContent.substring(prevContent.length - overlapChars);
          // Try to start at a word boundary
          const firstSpace = overlapBefore.indexOf(' ');
          if (firstSpace > 0 && firstSpace < overlapChars / 2) {
            overlapBefore = overlapBefore.substring(firstSpace + 1);
          }
        } else {
          overlapBefore = prevContent;
        }
      }

      // Add overlap from next chunk (start of next)
      if (i < chunks.length - 1) {
        const nextContent = chunks[i + 1].content;
        if (nextContent.length > overlapChars) {
          overlapAfter = nextContent.substring(0, overlapChars);
          // Try to end at a word boundary
          const lastSpace = overlapAfter.lastIndexOf(' ');
          if (lastSpace > overlapChars / 2) {
            overlapAfter = overlapAfter.substring(0, lastSpace);
          }
        } else {
          overlapAfter = nextContent;
        }
      }

      // Store overlap in metadata only - keep chunk content clean
      // Embedding generation uses overlap for context, but stored text stays clean
      chunk.content = content;
      chunk.metadata = {
        ...chunk.metadata,
        hasOverlap: overlapBefore.length > 0 || overlapAfter.length > 0,
        overlapBefore: overlapBefore || '',
        overlapAfter: overlapAfter || '',
        overlapTokensBefore: overlapBefore ? this.estimateTokens(overlapBefore) : 0,
        overlapTokensAfter: overlapAfter ? this.estimateTokens(overlapAfter) : 0
      };

      overlappedChunks.push(chunk);
    }

    return overlappedChunks;
  }

  /**
   * Merge chunks that are too small
   * @param {Array<Object>} chunks - Array of chunk objects
   * @returns {Array<Object>} Array with small chunks merged
   */
  mergeSmallChunks(chunks) {
    if (!chunks || chunks.length <= 1) return chunks;

    const merged = [];
    let current = null;

    for (const chunk of chunks) {
      const chunkTokens = this.estimateTokens(chunk.content);

      if (!current) {
        current = { ...chunk };
      } else {
        const currentTokens = this.estimateTokens(current.content);

        if (currentTokens < this.config.minChunkSize || chunkTokens < this.config.minChunkSize) {
          // Merge chunks
          current.content = current.content + '\n\n' + chunk.content;
          current.endLine = chunk.endLine;

          // Merge metadata
          if (chunk.metadata) {
            current.metadata = {
              ...current.metadata,
              // Keep first chunk's structural info, update end line
              endLine: chunk.metadata.endLine || chunk.endLine
            };
          }
        } else {
          // Current chunk is big enough, save and start new
          merged.push(current);
          current = { ...chunk };
        }
      }
    }

    // Don't forget the last one
    if (current) {
      merged.push(current);
    }

    return merged;
  }

  /**
   * Split a chunk that exceeds maximum size
   * @param {Object} chunk - Chunk object to split
   * @returns {Array<Object>} Array of smaller chunks
   */
  splitLargeChunk(chunk) {
    const tokens = this.estimateTokens(chunk.content);

    if (tokens <= this.config.maxChunkSize) {
      return [chunk];
    }

    // Use semantic chunker to split the content
    const splitContent = splitToTargetSize(
      chunk.content,
      this.config.targetChunkSize,
      this.config.maxChunkSize,
      this.getContentType()
    );

    // Create new chunk objects for each split
    return splitContent.map((content, index) => ({
      content,
      startLine: chunk.startLine, // Approximate - we don't have exact line tracking after split
      endLine: chunk.endLine,
      metadata: {
        ...chunk.metadata,
        splitIndex: index,
        splitTotal: splitContent.length,
        structureType: chunk.metadata?.structureType || 'paragraph'
      }
    }));
  }

  /**
   * Process chunks through the full pipeline:
   * 1. Split large chunks
   * 2. Merge small chunks
   * 3. Add overlap
   * 4. Add final metadata
   * @param {Array<Object>} chunks - Raw chunks from splitter
   * @param {string} filePath - Source file path
   * @returns {Array<Object>} Processed chunks ready for indexing
   */
  processChunks(chunks, filePath) {
    if (!chunks || chunks.length === 0) return [];

    // Step 1: Split any chunks that are too large
    let processed = [];
    for (const chunk of chunks) {
      const split = this.splitLargeChunk(chunk);
      processed.push(...split);
    }

    // Step 2: Merge chunks that are too small
    processed = this.mergeSmallChunks(processed);

    // Step 3: Add overlap between chunks
    if (this.config.overlapPercent > 0) {
      processed = this.addOverlap(processed);
    }

    // Step 4: Add final metadata and IDs
    return processed.map((chunk, index) => ({
      id: this.generateChunkId(filePath, index),
      content: chunk.content,
      startLine: chunk.startLine || 1,
      endLine: chunk.endLine || 1,
      estimatedTokens: this.estimateTokens(chunk.content),
      metadata: {
        ...chunk.metadata,
        chunkIndex: index,
        totalChunks: processed.length
      }
    }));
  }
}

module.exports = {
  BaseSplitter,
  DEFAULT_CONFIG
};
