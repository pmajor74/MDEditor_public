/**
 * Markdown Splitter
 *
 * Splits markdown documents by headers for targeted editing of large documents.
 * Preserves metadata (line numbers, section hierarchy) for reassembly.
 *
 * Enhanced version includes:
 * - Code block preservation (never splits inside code blocks)
 * - Mermaid diagram preservation
 * - Semantic fallback for large sections
 * - Configurable overlap between chunks
 */

const { BaseSplitter, DEFAULT_CONFIG } = require('./baseSplitter');
const { estimateTokens } = require('./strategies/tokenEstimator');
const { splitToTargetSize } = require('./strategies/semanticChunker');

/**
 * @typedef {Object} Section
 * @property {string} title - Section title (heading text)
 * @property {number} level - Heading level (1-6)
 * @property {string} content - Section content (including heading)
 * @property {number} startLine - Starting line number (1-indexed)
 * @property {number} endLine - Ending line number (1-indexed)
 * @property {string} fullPath - Full path from root (e.g., "Installation/Prerequisites")
 */

// Placeholder patterns for protected blocks
const CODE_BLOCK_PLACEHOLDER = '__CODE_BLOCK_';
const MERMAID_PLACEHOLDER = '__MERMAID_BLOCK_';

/**
 * Extract all fenced code blocks from content
 * @param {string} content - Markdown content
 * @returns {{content: string, blocks: Map<string, string>}} Modified content and extracted blocks
 */
function extractCodeBlocks(content) {
  const blocks = new Map();
  let counter = 0;

  // Match fenced code blocks (``` or ~~~)
  const codeBlockRegex = /(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\1/g;

  const modifiedContent = content.replace(codeBlockRegex, (match, fence, lang, code) => {
    const placeholder = `${CODE_BLOCK_PLACEHOLDER}${counter}__`;
    blocks.set(placeholder, match);
    counter++;
    return placeholder;
  });

  return { content: modifiedContent, blocks };
}

/**
 * Extract mermaid diagram blocks from content
 * @param {string} content - Markdown content
 * @returns {{content: string, blocks: Map<string, string>}} Modified content and extracted blocks
 */
function extractMermaidBlocks(content) {
  const blocks = new Map();
  let counter = 0;

  // Match mermaid code blocks specifically
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;

  const modifiedContent = content.replace(mermaidRegex, (match) => {
    const placeholder = `${MERMAID_PLACEHOLDER}${counter}__`;
    blocks.set(placeholder, match);
    counter++;
    return placeholder;
  });

  return { content: modifiedContent, blocks };
}

/**
 * Restore placeholders with original content
 * @param {string} content - Content with placeholders
 * @param {Map<string, string>} blocks - Map of placeholder to original content
 * @returns {string} Content with placeholders restored
 */
function restorePlaceholders(content, blocks) {
  let restored = content;
  for (const [placeholder, original] of blocks) {
    restored = restored.replace(placeholder, original);
  }
  return restored;
}

/**
 * Split a markdown document into sections by headers (legacy function)
 * @param {string} markdown - The markdown content
 * @returns {Section[]} Array of sections with metadata
 */
function splitByHeaders(markdown) {
  if (!markdown) return [];

  const lines = markdown.split('\n');
  const sections = [];
  const headerRegex = /^(#{1,6})\s+(.+)$/;

  let currentSection = null;
  const sectionStack = []; // For tracking hierarchy

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const match = line.match(headerRegex);

    if (match) {
      // Save previous section
      if (currentSection) {
        currentSection.endLine = lineNum - 1;
        currentSection.content = lines.slice(
          currentSection.startLine - 1,
          currentSection.endLine
        ).join('\n');
        sections.push(currentSection);
      }

      const level = match[1].length;
      const title = match[2].trim();

      // Update stack for hierarchy tracking
      while (sectionStack.length >= level) {
        sectionStack.pop();
      }
      sectionStack.push(title);

      currentSection = {
        title,
        level,
        content: '',
        startLine: lineNum,
        endLine: lines.length,
        fullPath: sectionStack.join('/')
      };
    }
  }

  // Handle content before first header (preamble)
  if (sections.length === 0 || sections[0].startLine > 1) {
    const preambleEnd = sections.length > 0 ? sections[0].startLine - 1 : lines.length;
    const preambleContent = lines.slice(0, preambleEnd).join('\n').trim();

    if (preambleContent) {
      sections.unshift({
        title: '(Preamble)',
        level: 0,
        content: preambleContent,
        startLine: 1,
        endLine: preambleEnd,
        fullPath: '(Preamble)'
      });
    }
  }

  // Save last section
  if (currentSection) {
    currentSection.endLine = lines.length;
    currentSection.content = lines.slice(
      currentSection.startLine - 1,
      currentSection.endLine
    ).join('\n');
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Find a section by title (case-insensitive partial match)
 * @param {Section[]} sections - Array of sections
 * @param {string} query - Search query
 * @returns {Section|null} Matching section or null
 */
function findSection(sections, query) {
  const lowerQuery = query.toLowerCase();

  // Try exact match first
  let match = sections.find(s =>
    s.title.toLowerCase() === lowerQuery
  );

  if (match) return match;

  // Try partial match
  match = sections.find(s =>
    s.title.toLowerCase().includes(lowerQuery)
  );

  if (match) return match;

  // Try full path match
  match = sections.find(s =>
    s.fullPath.toLowerCase().includes(lowerQuery)
  );

  return match || null;
}

/**
 * Find sections that match a query (returns all matches)
 * @param {Section[]} sections - Array of sections
 * @param {string} query - Search query
 * @returns {Section[]} Matching sections
 */
function findSections(sections, query) {
  const lowerQuery = query.toLowerCase();

  return sections.filter(s =>
    s.title.toLowerCase().includes(lowerQuery) ||
    s.fullPath.toLowerCase().includes(lowerQuery) ||
    s.content.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get context around a section (neighboring sections)
 * @param {Section[]} sections - Array of sections
 * @param {number} index - Index of target section
 * @param {number} contextSize - Number of sections before/after to include
 * @returns {Section[]} Sections with context
 */
function getSectionWithContext(sections, index, contextSize = 1) {
  const start = Math.max(0, index - contextSize);
  const end = Math.min(sections.length, index + contextSize + 1);
  return sections.slice(start, end);
}

/**
 * Reassemble document after editing a section
 * @param {string} originalMarkdown - Original document
 * @param {Section} originalSection - Original section being replaced
 * @param {string} newContent - New content for the section
 * @returns {string} Reassembled document
 */
function reassembleDocument(originalMarkdown, originalSection, newContent) {
  const lines = originalMarkdown.split('\n');

  // Replace the section content
  const before = lines.slice(0, originalSection.startLine - 1);
  const after = lines.slice(originalSection.endLine);

  return [...before, newContent, ...after].join('\n');
}

/**
 * Insert content after a section
 * @param {string} originalMarkdown - Original document
 * @param {Section} targetSection - Section to insert after
 * @param {string} newContent - Content to insert
 * @returns {string} Modified document
 */
function insertAfterSection(originalMarkdown, targetSection, newContent) {
  const lines = originalMarkdown.split('\n');

  const before = lines.slice(0, targetSection.endLine);
  const after = lines.slice(targetSection.endLine);

  return [...before, '', newContent, ...after].join('\n');
}

/**
 * Delete a section from the document
 * @param {string} originalMarkdown - Original document
 * @param {Section} targetSection - Section to delete
 * @returns {string} Modified document
 */
function deleteSection(originalMarkdown, targetSection) {
  const lines = originalMarkdown.split('\n');

  const before = lines.slice(0, targetSection.startLine - 1);
  const after = lines.slice(targetSection.endLine);

  return [...before, ...after].join('\n');
}

/**
 * Get a summary of the document structure
 * @param {Section[]} sections - Array of sections
 * @returns {string} Human-readable structure summary
 */
function getStructureSummary(sections) {
  return sections.map(s => {
    const indent = '  '.repeat(Math.max(0, s.level - 1));
    const lineInfo = `(lines ${s.startLine}-${s.endLine})`;
    return `${indent}${s.level > 0 ? '#'.repeat(s.level) + ' ' : ''}${s.title} ${lineInfo}`;
  }).join('\n');
}

/**
 * Estimate token count for sections (legacy function)
 * @param {Section[]} sections - Array of sections
 * @returns {Object} Section token counts
 */
function estimateSectionTokens(sections) {
  return sections.map(s => ({
    title: s.title,
    tokens: Math.ceil(s.content.length / 4),
    lines: s.endLine - s.startLine + 1
  }));
}

// ============================================================================
// Enhanced Markdown Splitter Class
// ============================================================================

/**
 * Enhanced Markdown Splitter with code block preservation and semantic fallback
 */
class EnhancedMarkdownSplitter extends BaseSplitter {
  constructor(config = {}) {
    super({
      ...DEFAULT_CONFIG,
      ...config
    });
  }

  getContentType() {
    return 'markdown';
  }

  /**
   * Split markdown content into chunks
   * @param {string} content - Markdown content
   * @param {string} filePath - Source file path
   * @returns {Array<Object>} Array of chunk objects
   */
  split(content, filePath) {
    if (!content) return [];

    // Step 1: Extract protected blocks (mermaid first, then other code blocks)
    let workingContent = content;
    const mermaidBlocks = this.config.preserveMermaid
      ? extractMermaidBlocks(workingContent)
      : { content: workingContent, blocks: new Map() };

    workingContent = mermaidBlocks.content;

    const codeBlocks = this.config.preserveCodeBlocks
      ? extractCodeBlocks(workingContent)
      : { content: workingContent, blocks: new Map() };

    workingContent = codeBlocks.content;

    // Step 2: Split by headers
    const sections = splitByHeaders(workingContent);

    // Step 3: Process each section
    const chunks = [];
    for (const section of sections) {
      const sectionTokens = estimateTokens(section.content, 'markdown');

      if (sectionTokens > this.config.maxChunkSize) {
        // Section is too large - split semantically
        const subChunks = this.splitLargeSection(section, codeBlocks.blocks, mermaidBlocks.blocks);
        chunks.push(...subChunks);
      } else {
        // Section fits in one chunk
        const restoredContent = restorePlaceholders(
          restorePlaceholders(section.content, codeBlocks.blocks),
          mermaidBlocks.blocks
        );

        chunks.push({
          content: restoredContent,
          startLine: section.startLine,
          endLine: section.endLine,
          metadata: {
            title: section.title,
            fullPath: section.fullPath,
            level: section.level,
            fileType: 'markdown',
            language: null,
            structureType: 'section',
            structureName: section.title
          }
        });
      }
    }

    // Step 4: Process through base class pipeline (merge small, add overlap)
    return this.processChunks(chunks, filePath);
  }

  /**
   * Split a large section into smaller semantic chunks
   * @param {Section} section - Section to split
   * @param {Map} codeBlocks - Code block placeholders
   * @param {Map} mermaidBlocks - Mermaid block placeholders
   * @returns {Array<Object>} Array of chunk objects
   */
  splitLargeSection(section, codeBlocks, mermaidBlocks) {
    const chunks = [];

    // First, try to identify sub-content that should stay together
    const protectedRanges = this.findProtectedRanges(section.content, codeBlocks, mermaidBlocks);

    // Use semantic splitting
    const subChunks = splitToTargetSize(
      section.content,
      this.config.targetChunkSize,
      this.config.maxChunkSize,
      'markdown'
    );

    for (let i = 0; i < subChunks.length; i++) {
      let chunkContent = subChunks[i];

      // Restore any placeholders in this chunk
      chunkContent = restorePlaceholders(chunkContent, codeBlocks);
      chunkContent = restorePlaceholders(chunkContent, mermaidBlocks);

      chunks.push({
        content: chunkContent,
        startLine: section.startLine,
        endLine: section.endLine,
        metadata: {
          title: section.title,
          fullPath: section.fullPath,
          level: section.level,
          fileType: 'markdown',
          language: null,
          structureType: 'section',
          structureName: section.title,
          subChunkIndex: i,
          subChunkTotal: subChunks.length
        }
      });
    }

    return chunks;
  }

  /**
   * Find ranges that should not be split (code blocks, mermaid diagrams)
   * @param {string} content - Content with placeholders
   * @param {Map} codeBlocks - Code block placeholders
   * @param {Map} mermaidBlocks - Mermaid block placeholders
   * @returns {Array<{start: number, end: number}>} Protected ranges
   */
  findProtectedRanges(content, codeBlocks, mermaidBlocks) {
    const ranges = [];

    // Find all placeholder positions
    const allBlocks = new Map([...codeBlocks, ...mermaidBlocks]);
    for (const placeholder of allBlocks.keys()) {
      const start = content.indexOf(placeholder);
      if (start !== -1) {
        ranges.push({
          start,
          end: start + placeholder.length
        });
      }
    }

    return ranges.sort((a, b) => a.start - b.start);
  }
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Legacy exports (backward compatible)
  splitByHeaders,
  findSection,
  findSections,
  getSectionWithContext,
  reassembleDocument,
  insertAfterSection,
  deleteSection,
  getStructureSummary,
  estimateSectionTokens,

  // Enhanced exports
  EnhancedMarkdownSplitter,
  extractCodeBlocks,
  extractMermaidBlocks,
  restorePlaceholders
};
