/**
 * Config Splitter
 *
 * Splits configuration files (JSON, YAML, TOML, INI, XML, ENV) at logical boundaries.
 * Respects structure-specific patterns for each format.
 */

const path = require('path');
const { BaseSplitter, DEFAULT_CONFIG } = require('./baseSplitter');
const { estimateTokens } = require('./strategies/tokenEstimator');

/**
 * Config-specific default config overrides
 */
const CONFIG_CONFIG = {
  ...DEFAULT_CONFIG,
  targetChunkSize: 256,   // Smaller chunks for config
  overlapPercent: 10,     // Less overlap needed for config
  preserveStructure: true // Keep related keys together
};

/**
 * File extension to format mapping
 */
const FORMAT_MAP = {
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.env': 'env',
  '.properties': 'properties',
  '.xml': 'xml'
};

/**
 * Configuration file splitter
 */
class ConfigSplitter extends BaseSplitter {
  constructor(config = {}) {
    super({ ...CONFIG_CONFIG, ...config });
    this.format = null;
  }

  getContentType() {
    return 'config';
  }

  /**
   * Split configuration content into chunks
   * @param {string} content - Config content
   * @param {string} filePath - Path to source file
   * @returns {Array<Object>} Array of chunk objects
   */
  split(content, filePath) {
    if (!content) return [];

    // Detect format from extension
    const ext = path.extname(filePath).toLowerCase();
    this.format = FORMAT_MAP[ext] || 'text';

    // Route to format-specific splitter
    switch (this.format) {
      case 'json':
        return this.splitJson(content, filePath);
      case 'yaml':
        return this.splitYaml(content, filePath);
      case 'toml':
      case 'ini':
        return this.splitIni(content, filePath);
      case 'env':
      case 'properties':
        return this.splitEnv(content, filePath);
      case 'xml':
        return this.splitXml(content, filePath);
      default:
        return this.splitGeneric(content, filePath);
    }
  }

  /**
   * Split JSON content at top-level keys
   * @param {string} content - JSON content
   * @param {string} filePath - Source file path
   * @returns {Array<Object>} Chunk objects
   */
  splitJson(content, filePath) {
    const chunks = [];

    try {
      const parsed = JSON.parse(content);

      // If it's an object, split by top-level keys
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed);

        // If small enough or few keys, return as single chunk
        const totalTokens = estimateTokens(content, 'config');
        if (totalTokens <= this.config.maxChunkSize || keys.length <= 3) {
          chunks.push({
            content: content,
            startLine: 1,
            endLine: content.split('\n').length,
            metadata: {
              fileType: 'config',
              language: 'json',
              structureType: 'root',
              structureName: 'root'
            }
          });
        } else {
          // Split by top-level keys
          let currentChunk = {};
          let currentKeys = [];

          for (const key of keys) {
            currentChunk[key] = parsed[key];
            currentKeys.push(key);

            const chunkContent = JSON.stringify(currentChunk, null, 2);
            const chunkTokens = estimateTokens(chunkContent, 'config');

            if (chunkTokens >= this.config.targetChunkSize) {
              chunks.push({
                content: chunkContent,
                startLine: 1, // Approximate
                endLine: chunkContent.split('\n').length,
                metadata: {
                  fileType: 'config',
                  language: 'json',
                  structureType: 'object',
                  structureName: currentKeys.join(', '),
                  keys: [...currentKeys]
                }
              });
              currentChunk = {};
              currentKeys = [];
            }
          }

          // Remaining keys
          if (currentKeys.length > 0) {
            const chunkContent = JSON.stringify(currentChunk, null, 2);
            chunks.push({
              content: chunkContent,
              startLine: 1,
              endLine: chunkContent.split('\n').length,
              metadata: {
                fileType: 'config',
                language: 'json',
                structureType: 'object',
                structureName: currentKeys.join(', '),
                keys: [...currentKeys]
              }
            });
          }
        }
      } else if (Array.isArray(parsed)) {
        // For arrays, split into groups
        const totalTokens = estimateTokens(content, 'config');
        if (totalTokens <= this.config.maxChunkSize) {
          chunks.push({
            content: content,
            startLine: 1,
            endLine: content.split('\n').length,
            metadata: {
              fileType: 'config',
              language: 'json',
              structureType: 'array',
              structureName: 'root array'
            }
          });
        } else {
          // Split array into chunks
          let currentItems = [];
          let startIndex = 0;

          for (let i = 0; i < parsed.length; i++) {
            currentItems.push(parsed[i]);

            const chunkContent = JSON.stringify(currentItems, null, 2);
            const chunkTokens = estimateTokens(chunkContent, 'config');

            if (chunkTokens >= this.config.targetChunkSize) {
              chunks.push({
                content: chunkContent,
                startLine: 1,
                endLine: chunkContent.split('\n').length,
                metadata: {
                  fileType: 'config',
                  language: 'json',
                  structureType: 'array',
                  structureName: `items ${startIndex}-${i}`,
                  arrayRange: [startIndex, i]
                }
              });
              currentItems = [];
              startIndex = i + 1;
            }
          }

          // Remaining items
          if (currentItems.length > 0) {
            const chunkContent = JSON.stringify(currentItems, null, 2);
            chunks.push({
              content: chunkContent,
              startLine: 1,
              endLine: chunkContent.split('\n').length,
              metadata: {
                fileType: 'config',
                language: 'json',
                structureType: 'array',
                structureName: `items ${startIndex}-${parsed.length - 1}`,
                arrayRange: [startIndex, parsed.length - 1]
              }
            });
          }
        }
      } else {
        // Scalar value - single chunk
        chunks.push({
          content: content,
          startLine: 1,
          endLine: 1,
          metadata: {
            fileType: 'config',
            language: 'json',
            structureType: 'scalar',
            structureName: 'value'
          }
        });
      }
    } catch (e) {
      // Invalid JSON - fall back to generic splitting
      return this.splitGeneric(content, filePath);
    }

    return this.processChunks(chunks, filePath);
  }

  /**
   * Split YAML content at top-level keys
   * @param {string} content - YAML content
   * @param {string} filePath - Source file path
   * @returns {Array<Object>} Chunk objects
   */
  splitYaml(content, filePath) {
    const chunks = [];
    const lines = content.split('\n');

    // Find top-level keys (lines that start with non-whitespace followed by colon)
    const topLevelKeyPattern = /^([a-zA-Z_][\w-]*)\s*:/;
    const boundaries = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments and empty lines
      if (line.trim().startsWith('#') || line.trim() === '') continue;

      const match = line.match(topLevelKeyPattern);
      if (match) {
        boundaries.push({
          line: i,
          key: match[1]
        });
      }
    }

    // If no boundaries or small file, return as single chunk
    const totalTokens = estimateTokens(content, 'config');
    if (boundaries.length <= 1 || totalTokens <= this.config.maxChunkSize) {
      chunks.push({
        content: content,
        startLine: 1,
        endLine: lines.length,
        metadata: {
          fileType: 'config',
          language: 'yaml',
          structureType: 'document',
          structureName: boundaries[0]?.key || 'root'
        }
      });
      return this.processChunks(chunks, filePath);
    }

    // Group keys into chunks
    let currentStart = 0;
    let currentKeys = [];

    for (let i = 0; i < boundaries.length; i++) {
      const boundary = boundaries[i];
      const nextBoundary = boundaries[i + 1];

      const sectionEnd = nextBoundary ? nextBoundary.line : lines.length;
      const sectionContent = lines.slice(boundary.line, sectionEnd).join('\n');

      currentKeys.push(boundary.key);

      // Check combined content size
      const combinedContent = lines.slice(currentStart, sectionEnd).join('\n');
      const combinedTokens = estimateTokens(combinedContent, 'config');

      if (combinedTokens >= this.config.targetChunkSize || i === boundaries.length - 1) {
        chunks.push({
          content: combinedContent,
          startLine: currentStart + 1,
          endLine: sectionEnd,
          metadata: {
            fileType: 'config',
            language: 'yaml',
            structureType: 'section',
            structureName: currentKeys.join(', '),
            keys: [...currentKeys]
          }
        });

        if (nextBoundary) {
          currentStart = nextBoundary.line;
          currentKeys = [];
        }
      }
    }

    return this.processChunks(chunks, filePath);
  }

  /**
   * Split INI/TOML content at section headers
   * @param {string} content - INI/TOML content
   * @param {string} filePath - Source file path
   * @returns {Array<Object>} Chunk objects
   */
  splitIni(content, filePath) {
    const chunks = [];
    const lines = content.split('\n');

    // Find section headers [section] or [[section]]
    const sectionPattern = /^\s*\[{1,2}([^\]]+)\]{1,2}\s*$/;
    const boundaries = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(sectionPattern);
      if (match) {
        boundaries.push({
          line: i,
          section: match[1].trim()
        });
      }
    }

    // Handle content before first section (if any)
    const preambleEnd = boundaries.length > 0 ? boundaries[0].line : lines.length;
    const preamble = lines.slice(0, preambleEnd).join('\n').trim();

    if (preamble) {
      chunks.push({
        content: preamble,
        startLine: 1,
        endLine: preambleEnd,
        metadata: {
          fileType: 'config',
          language: this.format,
          structureType: 'preamble',
          structureName: 'global'
        }
      });
    }

    // Process sections
    for (let i = 0; i < boundaries.length; i++) {
      const boundary = boundaries[i];
      const nextBoundary = boundaries[i + 1];

      const sectionEnd = nextBoundary ? nextBoundary.line : lines.length;
      const sectionContent = lines.slice(boundary.line, sectionEnd).join('\n');

      if (sectionContent.trim()) {
        chunks.push({
          content: sectionContent,
          startLine: boundary.line + 1,
          endLine: sectionEnd,
          metadata: {
            fileType: 'config',
            language: this.format,
            structureType: 'section',
            structureName: boundary.section
          }
        });
      }
    }

    // If no sections found, return as single chunk
    if (chunks.length === 0) {
      chunks.push({
        content: content,
        startLine: 1,
        endLine: lines.length,
        metadata: {
          fileType: 'config',
          language: this.format,
          structureType: 'document',
          structureName: 'root'
        }
      });
    }

    return this.processChunks(chunks, filePath);
  }

  /**
   * Split ENV/properties content by groups of related variables
   * @param {string} content - ENV content
   * @param {string} filePath - Source file path
   * @returns {Array<Object>} Chunk objects
   */
  splitEnv(content, filePath) {
    const chunks = [];
    const lines = content.split('\n');

    // Group by common prefixes or by comment sections
    const groups = [];
    let currentGroup = [];
    let currentPrefix = null;
    let currentComment = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Check for comment that might indicate a new section
      if (trimmed.startsWith('#') && !trimmed.startsWith('##')) {
        if (currentGroup.length > 0) {
          groups.push({
            lines: [...currentGroup],
            name: currentComment || currentPrefix || 'config'
          });
          currentGroup = [];
        }
        currentComment = trimmed.substring(1).trim();
        currentGroup.push(line);
        continue;
      }

      // Parse key=value
      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=/i);
      if (match) {
        const key = match[1];
        const prefix = key.split('_')[0];

        // Check if prefix changed significantly
        if (currentPrefix && prefix !== currentPrefix && currentGroup.length > 5) {
          groups.push({
            lines: [...currentGroup],
            name: currentComment || currentPrefix || 'config'
          });
          currentGroup = [];
          currentComment = null;
        }

        currentPrefix = prefix;
      }

      currentGroup.push(line);
    }

    // Don't forget last group
    if (currentGroup.length > 0) {
      groups.push({
        lines: currentGroup,
        name: currentComment || currentPrefix || 'config'
      });
    }

    // Create chunks from groups
    let lineNum = 1;
    for (const group of groups) {
      const groupContent = group.lines.join('\n');
      const groupLines = group.lines.length;

      if (groupContent.trim()) {
        chunks.push({
          content: groupContent,
          startLine: lineNum,
          endLine: lineNum + groupLines - 1,
          metadata: {
            fileType: 'config',
            language: this.format,
            structureType: 'group',
            structureName: group.name
          }
        });
      }

      lineNum += groupLines;
    }

    return this.processChunks(chunks, filePath);
  }

  /**
   * Split XML content at top-level elements
   * @param {string} content - XML content
   * @param {string} filePath - Source file path
   * @returns {Array<Object>} Chunk objects
   */
  splitXml(content, filePath) {
    const chunks = [];
    const lines = content.split('\n');

    // Find top-level elements (very basic - just looks for opening tags at root level)
    const elementPattern = /^<([a-zA-Z][\w:-]*)/;
    const closingPattern = /^<\/([a-zA-Z][\w:-]*)\s*>/;
    let depth = 0;
    let inProlog = true;
    const boundaries = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip XML prolog and comments
      if (line.startsWith('<?') || line.startsWith('<!--')) {
        continue;
      }

      // Track depth
      const openMatch = line.match(elementPattern);
      const closeMatch = line.match(closingPattern);

      if (openMatch && depth === 0) {
        inProlog = false;
        boundaries.push({
          line: i,
          element: openMatch[1]
        });
      }

      // Simple depth tracking (not perfect but works for well-formatted XML)
      if (openMatch && !line.includes('/>')) {
        depth++;
      }
      if (closeMatch) {
        depth--;
      }
      if (line.endsWith('/>')) {
        // Self-closing tag doesn't change depth
      }
    }

    // If small or no boundaries, return as single chunk
    const totalTokens = estimateTokens(content, 'config');
    if (boundaries.length <= 1 || totalTokens <= this.config.maxChunkSize) {
      chunks.push({
        content: content,
        startLine: 1,
        endLine: lines.length,
        metadata: {
          fileType: 'config',
          language: 'xml',
          structureType: 'document',
          structureName: boundaries[0]?.element || 'root'
        }
      });
      return this.processChunks(chunks, filePath);
    }

    // Create chunks from boundaries
    for (let i = 0; i < boundaries.length; i++) {
      const boundary = boundaries[i];
      const nextBoundary = boundaries[i + 1];

      const sectionEnd = nextBoundary ? nextBoundary.line : lines.length;
      const sectionContent = lines.slice(boundary.line, sectionEnd).join('\n');

      if (sectionContent.trim()) {
        chunks.push({
          content: sectionContent,
          startLine: boundary.line + 1,
          endLine: sectionEnd,
          metadata: {
            fileType: 'config',
            language: 'xml',
            structureType: 'element',
            structureName: boundary.element
          }
        });
      }
    }

    return this.processChunks(chunks, filePath);
  }

  /**
   * Generic splitting for unknown config formats
   * @param {string} content - Config content
   * @param {string} filePath - Source file path
   * @returns {Array<Object>} Chunk objects
   */
  splitGeneric(content, filePath) {
    const chunks = [];
    const lines = content.split('\n');

    // Split at blank lines or comment headers
    const boundaries = [0];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : '';

      // Break on blank line after content
      if (line.trim() === '' && prevLine.trim() !== '') {
        const chunkContent = lines.slice(boundaries[boundaries.length - 1], i).join('\n');
        const tokens = estimateTokens(chunkContent, 'config');

        if (tokens >= this.config.targetChunkSize * 0.5) {
          boundaries.push(i + 1);
        }
      }
    }

    boundaries.push(lines.length);

    // Create chunks
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      const chunkContent = lines.slice(start, end).join('\n');

      if (chunkContent.trim()) {
        chunks.push({
          content: chunkContent,
          startLine: start + 1,
          endLine: end,
          metadata: {
            fileType: 'config',
            language: this.format || 'unknown',
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
  ConfigSplitter,
  CONFIG_CONFIG,
  FORMAT_MAP
};
