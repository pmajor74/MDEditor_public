/**
 * Wiki Synthesis Agent
 *
 * Implements Map-Reduce pattern for synthesizing content from multiple wiki pages.
 * Supports multimodal context (images/diagrams from wiki pages).
 *
 * Workflow:
 * 1. Fetch pages with content and images
 * 2. MAP: Summarize each page focused on user's request
 * 3. REDUCE: Combine summaries into coherent final document
 */

const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const providerFactory = require('./providers');
const configManager = require('./llmConfigManager');
const {
  MAP_SUMMARIZE_PROMPT,
  REDUCE_SYNTHESIZE_PROMPT
} = require('./prompts/wikiSearchPrompts');
const mermaidValidator = require('./mermaidValidator');

// Cached model instance
let cachedModel = null;
let cachedProvider = null;

// Cancellation state
let cancelRequested = false;

// Concurrency settings
const MAX_CONCURRENT_MAP = 3; // Process up to 3 pages in parallel

/**
 * Get or create the LLM model instance
 */
function getModel() {
  const config = configManager.getActiveConfig();

  if (cachedModel && cachedProvider === config.provider) {
    return cachedModel;
  }

  cachedModel = providerFactory.createModel(config.provider, config);
  cachedProvider = config.provider;

  console.log(`[Wiki Synthesis] Created ${config.provider} model: ${config.model}`);

  return cachedModel;
}

/**
 * Extract image references from markdown content
 * @param {string} content - Markdown content
 * @returns {string[]} Array of image paths (e.g., ['/.attachments/image.png'])
 */
function extractImageReferences(content) {
  if (!content) return [];

  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = [];
  let match;

  while ((match = imageRegex.exec(content)) !== null) {
    const imagePath = match[2];
    // Only include wiki attachments (not external URLs)
    if (imagePath.includes('.attachments/') || imagePath.startsWith('/')) {
      images.push(imagePath);
    }
  }

  return images;
}

/**
 * Extract just the filename from an attachment path
 * @param {string} path - Full path like '/.attachments/image.png'
 * @returns {string} Just the filename like 'image.png'
 */
function extractFilename(path) {
  const match = path.match(/\.attachments\/(.+)$/);
  return match ? match[1] : path.split('/').pop();
}

/**
 * Fetch a page with its content and images
 * @param {Object} page - Page object with path, title
 * @param {Function} getPageContent - Function to fetch page content
 * @param {Function} getAttachment - Function to fetch attachments
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} Page with content and images
 */
async function fetchPageWithImages(page, getPageContent, getAttachment, onProgress) {
  try {
    // Fetch page content
    const result = await getPageContent(page.path);
    const content = result.content || '';

    // Extract image references
    const imageRefs = extractImageReferences(content);
    const images = [];

    if (imageRefs.length > 0 && getAttachment) {
      onProgress?.({ message: `Fetching ${imageRefs.length} images from "${page.title}"...` });

      // Fetch images (limit to first 5 to avoid overwhelming context)
      const imagesToFetch = imageRefs.slice(0, 5);

      for (const imagePath of imagesToFetch) {
        try {
          const filename = extractFilename(imagePath);
          const imageResult = await getAttachment(filename);

          if (imageResult.success && imageResult.data) {
            // Determine mime type from filename
            const ext = filename.split('.').pop().toLowerCase();
            const mimeTypes = {
              'png': 'image/png',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'gif': 'image/gif',
              'webp': 'image/webp',
              'svg': 'image/svg+xml'
            };
            const mimeType = mimeTypes[ext] || 'image/png';

            images.push({
              path: imagePath,
              filename,
              data: imageResult.data, // base64
              mimeType
            });

            console.log(`[Wiki Synthesis] Fetched image: ${filename}`);
          }
        } catch (imgError) {
          console.warn(`[Wiki Synthesis] Failed to fetch image ${imagePath}:`, imgError.message);
        }
      }
    }

    return {
      ...page,
      content,
      images,
      imageCount: images.length,
      fetchError: null
    };
  } catch (error) {
    console.warn('[Wiki Synthesis] Failed to fetch page:', page.path, error.message);
    return {
      ...page,
      content: null,
      images: [],
      fetchError: error.message
    };
  }
}

/**
 * MAP phase: Summarize a single page focused on user's request
 * @param {Object} page - Page with content and images
 * @param {string} userRequest - What the user wants to know
 * @returns {Promise<Object>} Page with summary
 */
async function mapSummarizePage(page, userRequest) {
  if (!page.content) {
    return {
      ...page,
      summary: null,
      summaryError: 'No content available'
    };
  }

  try {
    const model = getModel();

    // Build message content with text and images
    const messageContent = [];

    // Add text prompt
    const textPrompt = `Page Title: ${page.title}
Page Path: ${page.path}

User's Request: "${userRequest}"

Page Content:
${page.content.substring(0, 8000)}${page.content.length > 8000 ? '\n\n[Content truncated...]' : ''}`;

    messageContent.push({ type: 'text', text: textPrompt });

    // Add images if available (multimodal support)
    if (page.images && page.images.length > 0) {
      for (const img of page.images) {
        try {
          messageContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${img.mimeType};base64,${img.data}`
            }
          });
        } catch (imgErr) {
          console.warn('[Wiki Synthesis] Failed to add image to context:', imgErr.message);
        }
      }
    }

    const messages = [
      new SystemMessage(MAP_SUMMARIZE_PROMPT),
      new HumanMessage({ content: messageContent })
    ];

    const response = await model.invoke(messages);
    const summary = response.content || '';

    console.log(`[Wiki Synthesis] MAP complete for: ${page.title} (${summary.length} chars)`);

    return {
      ...page,
      summary,
      summaryError: null
    };
  } catch (error) {
    console.error('[Wiki Synthesis] MAP error for', page.title, ':', error.message);
    return {
      ...page,
      summary: null,
      summaryError: error.message
    };
  }
}

/**
 * Strip markdown code fence wrappers from LLM response
 * Handles ```markdown, ```md, or just ``` at start/end
 * @param {string} content - Raw LLM response
 * @returns {string} Clean content without code fence wrappers
 */
function stripMarkdownCodeFence(content) {
  if (!content) return content;

  let result = content.trim();

  // Remove opening code fence (```markdown, ```md, or just ```)
  const openingFenceRegex = /^```(?:markdown|md)?\s*\n?/i;
  if (openingFenceRegex.test(result)) {
    result = result.replace(openingFenceRegex, '');
  }

  // Remove closing code fence (``` at the end, possibly with trailing whitespace)
  const closingFenceRegex = /\n?```\s*$/;
  if (closingFenceRegex.test(result)) {
    result = result.replace(closingFenceRegex, '');
  }

  return result.trim();
}

/**
 * Clean over-escaped markdown links from AI output
 * Fixes: \[text\]\(url\) -> [text](url)
 * Also handles double-escaped: \\[text\\]\\(url\\) -> [text](url)
 * Also fixes incorrect TOC syntax: [[*TOC*]] -> [[_TOC_]]
 * @param {string} content - Content with potentially escaped links
 * @returns {string} Clean content with proper markdown links
 */
function cleanMarkdownLinks(content) {
  if (!content) return content;

  let cleaned = content;

  // Debug: Log sample of content BEFORE cleaning
  console.log('[Wiki Synthesis] Content BEFORE cleaning (sample):');
  console.log(cleaned.substring(0, 500));

  // First, preserve code blocks by replacing with placeholders
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = [];
  cleaned = cleaned.replace(codeBlockRegex, (match) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(match);
    return placeholder;
  });

  // Also preserve inline code (single backticks)
  const inlineCodeRegex = /`[^`]+`/g;
  const inlineCodes = [];
  cleaned = cleaned.replace(inlineCodeRegex, (match) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(match);
    return placeholder;
  });

  // Remove backslash escapes - use \\+ to match ONE OR MORE backslashes
  // Run in a loop to handle nested/multiple escaping
  let prev;
  do {
    prev = cleaned;
    // Link-critical characters
    cleaned = cleaned.replace(/\\+\[/g, '[');
    cleaned = cleaned.replace(/\\+\]/g, ']');
    cleaned = cleaned.replace(/\\+\(/g, '(');
    cleaned = cleaned.replace(/\\+\)/g, ')');
    // Path characters
    cleaned = cleaned.replace(/\\+-/g, '-');
    cleaned = cleaned.replace(/\\+\//g, '/');
    // Other markdown characters
    cleaned = cleaned.replace(/\\+</g, '<');
    cleaned = cleaned.replace(/\\+>/g, '>');
    cleaned = cleaned.replace(/\\+\*/g, '*');
    cleaned = cleaned.replace(/\\+_/g, '_');
    cleaned = cleaned.replace(/\\+#/g, '#');
    cleaned = cleaned.replace(/\\+`/g, '`');
    cleaned = cleaned.replace(/\\+~/g, '~');
    cleaned = cleaned.replace(/\\+\|/g, '|');
    cleaned = cleaned.replace(/\\+!/g, '!');
    cleaned = cleaned.replace(/\\+,/g, ',');
    cleaned = cleaned.replace(/\\+\./g, '.');
  } while (cleaned !== prev);

  // Fix incorrect TOC syntax: [[*TOC*]] -> [[_TOC_]]
  cleaned = cleaned.replace(/\[\[\*TOC\*\]\]/gi, '[[_TOC_]]');

  // Restore inline code
  inlineCodes.forEach((code, index) => {
    cleaned = cleaned.replace(`__INLINE_CODE_${index}__`, code);
  });

  // Restore code blocks (unchanged)
  codeBlocks.forEach((block, index) => {
    cleaned = cleaned.replace(`__CODE_BLOCK_${index}__`, block);
  });

  // Debug: Log sample of content AFTER cleaning
  console.log('[Wiki Synthesis] Content AFTER cleaning (sample):');
  console.log(cleaned.substring(0, 500));

  return cleaned;
}

/**
 * Remove inline wiki links from content, preserving the link text
 * Catches any links the LLM created despite instructions not to
 * @param {string} content - Content that may contain wiki links
 * @returns {string} Content with wiki links converted to plain text
 */
function removeInlineWikiLinks(content) {
  if (!content) return content;

  // Preserve code blocks
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = [];
  let cleaned = content.replace(codeBlockRegex, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // Remove wiki-style links [text](/path) but keep the text
  // Only target links with paths starting with / (internal wiki links)
  cleaned = cleaned.replace(/\[([^\]]+)\]\(\/[^)]+\)/g, (match, linkText) => {
    console.log(`[Wiki Synthesis] Removed fabricated link: ${match} -> "${linkText}"`);
    return `"${linkText}"`;
  });

  // Restore code blocks
  codeBlocks.forEach((block, index) => {
    cleaned = cleaned.replace(`__CODE_BLOCK_${index}__`, block);
  });

  return cleaned;
}

/**
 * Strip any References section from content
 * Searches backward for References heading and truncates
 * Uses two strategies: heading-based detection and link-list detection
 * @param {string} content - Content that may contain an LLM-generated References section
 * @returns {string} Content with References section removed
 */
function stripReferencesSection(content) {
  if (!content) return content;

  const lines = content.split('\n');
  let refsStartIndex = -1;

  // Debug: Log last 15 lines to see what we're searching
  console.log('[Wiki Synthesis] stripReferencesSection - Last 15 lines:');
  for (let i = Math.max(0, lines.length - 15); i < lines.length; i++) {
    console.log(`  Line ${i}: "${lines[i]}"`);
  }

  // Strategy 1: Heading-based detection (existing, with expanded terms)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();

    // Strip all markdown formatting and escapes to get plain text
    const plainLine = line
      .replace(/\\/g, '')           // Remove all backslashes
      .replace(/^#+\s*/, '')        // Remove heading markers (# ## ### etc)
      .replace(/^\*+\s*/, '')       // Remove bold/list markers at start
      .replace(/\*+$/g, '')         // Remove bold markers at end
      .replace(/^_+\s*/, '')        // Remove italic/underscore at start
      .replace(/_+$/g, '')          // Remove italic/underscore at end
      .replace(/:\s*$/, '')         // Remove trailing colon
      .trim()
      .toLowerCase();

    // Check if this is a references/sources/citations heading (expanded terms)
    if (['references', 'sources', 'citations', 'source pages', 'source documents', 'related pages'].includes(plainLine)) {
      refsStartIndex = i;
      console.log(`[Wiki Synthesis] Found References heading at line ${i}: "${line}"`);
      break;
    }
  }

  // Strategy 2: Look for link list at end if no heading found
  if (refsStartIndex === -1) {
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 25); i--) {
      const line = lines[i].trim();
      // Check for list item with wiki link pattern
      if (/^[\*\-\d]\s*\.?\s*\\?\[/.test(line) && /\]\s*\\?\(\//.test(line)) {
        // Found a link list item, find where list starts
        let listStart = i;
        for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
          const prevLine = lines[j].trim();
          if (/^[\*\-\d]\s*\.?\s*\\?\[/.test(prevLine) && /\]\s*\\?\(\//.test(prevLine)) {
            listStart = j;
          } else if (prevLine === '') {
            continue; // Skip blank lines
          } else if (/^#+/.test(prevLine) || /^\*\*.*\*\*$/.test(prevLine)) {
            // Found a heading above the list
            refsStartIndex = j;
            console.log(`[Wiki Synthesis] Found References list starting at line ${j}`);
            break;
          } else {
            // Non-list content, the list starts at listStart
            refsStartIndex = listStart;
            console.log(`[Wiki Synthesis] Found orphan References list at line ${listStart}`);
            break;
          }
        }
        break;
      }
    }
  }

  if (refsStartIndex !== -1) {
    console.log(`[Wiki Synthesis] Stripping from line ${refsStartIndex} to end`);
    return lines.slice(0, refsStartIndex).join('\n').trim();
  }

  console.log('[Wiki Synthesis] No References section found to strip');
  return content;
}

/**
 * Sanitize a wiki path by removing Azure DevOps metadata markers
 * Removes markers like <<obsolete, dead page>>, <<deprecated>>, etc.
 * @param {string} path - Wiki path that may contain metadata markers
 * @returns {string} Clean path without metadata markers
 */
function sanitizeWikiPath(path) {
  if (!path) return path;

  // Remove Azure metadata markers like <<obsolete, dead page>>, <<deprecated>>, etc.
  // Also clean up any resulting double slashes
  return path
    .replace(/\s*<<[^>]*>>\s*/g, '')  // Remove <<...>> markers with surrounding whitespace
    .replace(/\/+/g, '/');             // Collapse multiple slashes into one
}

/**
 * Generate a full Azure DevOps wiki URL for a page
 * Uses the path-based format with hyphens instead of spaces
 * @param {string} path - Wiki page path like "/IT - App Delivery Home Page/Folder/Page"
 * @param {Object} connectionInfo - Azure connection info {org, project, wikiId}
 * @returns {string} Full Azure DevOps URL
 */
function generateWikiUrl(path, connectionInfo) {
  if (!path || !connectionInfo) return path;

  const { org, project, wikiId } = connectionInfo;
  if (!org || !project || !wikiId) return path;

  // Convert path to Azure DevOps wiki URL format:
  // - Replace spaces with hyphens
  // - Keep forward slashes as path separators
  // - Encode special characters that aren't valid in URL paths
  const urlPath = path
    .split('/')
    .map(segment => {
      if (!segment) return segment;
      // Replace spaces with hyphens, then encode remaining special chars
      return segment
        .replace(/\s+/g, '-')           // Spaces -> hyphens
        .replace(/[<>:"\\|?*]/g, '')    // Remove invalid path chars
        .replace(/-+/g, '-');           // Collapse multiple hyphens
    })
    .join('/');

  // Generate full Azure DevOps wiki URL with path-based format
  return `https://dev.azure.com/${org}/${project}/_wiki/wikis/${wikiId}${urlPath}`;
}

/**
 * Generate a properly formatted References section from source pages
 * Uses full Azure DevOps wiki URLs for clickable links
 * @param {Object[]} sources - Array of {title, path, hasImages, remoteUrl}
 * @param {Object} connectionInfo - Azure connection info {org, project, wikiId}
 * @returns {string} Formatted markdown References section
 */
function generateReferencesSection(sources, connectionInfo) {
  if (!sources || sources.length === 0) return '';

  let refsSection = '\n\n## References\n\n';

  sources.forEach(source => {
    // Sanitize path to remove Azure metadata markers like <<obsolete, dead page>>
    const cleanPath = sanitizeWikiPath(source.path);
    const title = source.title || cleanPath.split('/').pop();
    const imgNote = source.hasImages ? ' *(includes diagrams)*' : '';

    // Prefer Azure's remoteUrl (canonical link), fall back to generated URL
    const wikiUrl = source.remoteUrl || generateWikiUrl(cleanPath, connectionInfo);
    console.log(`[Wiki Synthesis] Reference link for "${title}": remoteUrl=${source.remoteUrl ? 'yes' : 'no'}, url=${wikiUrl}`);

    refsSection += `- [${title}](${wikiUrl})${imgNote}\n`;
  });

  return refsSection;
}

/**
 * REDUCE phase: Combine all page summaries into final document
 * @param {Object[]} summarizedPages - Pages with summaries
 * @param {string} userRequest - Original user request
 * @param {string} currentPageContent - Current content of the target page
 * @param {Object} connectionInfo - Azure connection info for URL generation
 * @returns {Promise<Object>} Final synthesized result
 */
async function reduceSynthesizeDocument(summarizedPages, userRequest, currentPageContent = '', connectionInfo = null) {
  // Filter to pages with valid summaries
  const validPages = summarizedPages.filter(p => p.summary && !p.summaryError);

  if (validPages.length === 0) {
    return {
      success: false,
      error: 'No pages could be summarized successfully'
    };
  }

  try {
    const model = getModel();

    // Build combined summaries text - emphasize source numbers, omit paths to avoid LLM fabricating links
    const summariesText = validPages.map((p, i) => {
      const sourceNum = i + 1;
      return `=== SOURCE ${sourceNum}: "${p.title}" ===
${p.images?.length > 0 ? `(Contains ${p.images.length} diagram(s)/image(s))` : ''}

${p.summary}`;
    }).join('\n\n---\n\n');

    const prompt = `User's Request: "${userRequest}"

Number of sources analyzed: ${validPages.length}

${currentPageContent ? `Current page content (to update/enhance):
---
${currentPageContent.substring(0, 2000)}${currentPageContent.length > 2000 ? '\n[truncated...]' : ''}
---

` : ''}Summaries from each source:

${summariesText}`;

    const messages = [
      new SystemMessage(REDUCE_SYNTHESIZE_PROMPT),
      new HumanMessage(prompt)
    ];

    const response = await model.invoke(messages);
    const rawContent = response.content || '';

    // Debug: Log last 5 lines of raw content
    const rawLines = rawContent.split('\n');
    console.log('[Wiki Synthesis] RAW content - Last 5 lines:');
    for (let i = Math.max(0, rawLines.length - 5); i < rawLines.length; i++) {
      console.log(`  Raw line ${i}: "${rawLines[i]}"`);
    }

    // Strip markdown code fences
    const strippedContent = stripMarkdownCodeFence(rawContent);

    // Clean over-escaped markdown links FIRST
    let synthesizedContent = cleanMarkdownLinks(strippedContent);

    // Remove any fabricated wiki links (convert to plain text)
    synthesizedContent = removeInlineWikiLinks(synthesizedContent);

    // Debug: Log after cleaning
    const cleanedLines = synthesizedContent.split('\n');
    console.log('[Wiki Synthesis] AFTER cleanMarkdownLinks - Last 5 lines:');
    for (let i = Math.max(0, cleanedLines.length - 5); i < cleanedLines.length; i++) {
      console.log(`  Cleaned line ${i}: "${cleanedLines[i]}"`);
    }

    // Auto-fix mermaid diagrams (quote unquoted labels with special chars)
    const mermaidFix = mermaidValidator.autoFixMermaidInContent(synthesizedContent);
    synthesizedContent = mermaidFix.content;
    if (mermaidFix.fixCount > 0) {
      console.log(`[Wiki Synthesis] Auto-fixed ${mermaidFix.fixCount} mermaid label(s)`);
    }

    // Strip any LLM-generated References section (robust line-based approach)
    synthesizedContent = stripReferencesSection(synthesizedContent);

    console.log('[Wiki Synthesis] Stripped LLM References, adding programmatic ones');

    // Add programmatically generated References section with correct links
    const validSources = validPages.map(p => ({
      title: p.title,
      path: p.path,
      hasImages: (p.images?.length || 0) > 0,
      remoteUrl: p.remoteUrl || null  // Preserve Azure's canonical URL if available
    }));
    const refsSection = generateReferencesSection(validSources, connectionInfo);
    console.log('[Wiki Synthesis] Generated References section:');
    console.log(refsSection);
    synthesizedContent += refsSection;

    // Final pass: clean any remaining escaped markdown in the entire content
    synthesizedContent = cleanMarkdownLinks(synthesizedContent);

    // Debug: Log the actual References section in final content
    const finalLines = synthesizedContent.split('\n');
    const refsIndex = finalLines.findIndex(l => l.trim() === '## References');
    if (refsIndex !== -1) {
      console.log('[Wiki Synthesis] FINAL References section (lines', refsIndex, 'to end):');
      finalLines.slice(refsIndex).forEach((line, i) => {
        console.log(`  Final refs line ${refsIndex + i}: "${line}"`);
      });
    }

    console.log(`[Wiki Synthesis] REDUCE complete: ${synthesizedContent.length} chars`);

    return {
      success: true,
      content: synthesizedContent,
      sourcesUsed: validPages.map(p => ({
        title: p.title,
        path: p.path,
        hasImages: (p.images?.length || 0) > 0
      })),
      pagesAnalyzed: validPages.length,
      totalPages: summarizedPages.length
    };
  } catch (error) {
    console.error('[Wiki Synthesis] REDUCE error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Process pages in batches with concurrency control
 */
async function processInBatches(items, processFn, batchSize, onProgress) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    if (cancelRequested) break;

    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processFn));
    results.push(...batchResults);

    onProgress?.({
      current: Math.min(i + batchSize, items.length),
      total: items.length
    });
  }

  return results;
}

/**
 * Main synthesis entry point
 * @param {Object} options - Synthesis options
 * @param {string} options.query - User's request/query
 * @param {Object[]} options.pages - Pages to synthesize (already matched)
 * @param {number} options.maxPages - Maximum pages to analyze
 * @param {Function} options.getPageContent - Function to fetch page content
 * @param {Function} options.getAttachment - Function to fetch attachments
 * @param {string} options.currentPageContent - Current content of target page
 * @param {Function} options.onProgress - Progress callback
 * @param {Object} options.connectionInfo - Azure connection info {org, project, wikiId}
 * @returns {Promise<Object>} Synthesis result
 */
async function synthesizeFromPages(options) {
  const {
    query,
    pages,
    maxPages,
    getPageContent,
    getAttachment,
    currentPageContent = '',
    onProgress,
    connectionInfo = null
  } = options;

  cancelRequested = false;

  const emitProgress = (data) => {
    if (onProgress && typeof onProgress === 'function') {
      onProgress(data);
    }
  };

  try {
    // Limit pages
    const pagesToProcess = maxPages && maxPages < pages.length
      ? pages.slice(0, maxPages)
      : pages;

    console.log(`[Wiki Synthesis] Starting synthesis of ${pagesToProcess.length} pages`);

    // Phase 1: Fetch all pages with images
    emitProgress({
      phase: 'fetching',
      current: 0,
      total: pagesToProcess.length,
      message: 'Fetching page content and images...'
    });

    const fetchedPages = [];
    for (let i = 0; i < pagesToProcess.length; i++) {
      if (cancelRequested) {
        return { cancelled: true };
      }

      const page = pagesToProcess[i];
      emitProgress({
        phase: 'fetching',
        current: i + 1,
        total: pagesToProcess.length,
        currentPage: page.title,
        message: `Fetching: "${page.title}" (${i + 1}/${pagesToProcess.length})`
      });

      const fetchedPage = await fetchPageWithImages(page, getPageContent, getAttachment, emitProgress);
      fetchedPages.push(fetchedPage);
    }

    // Phase 2: MAP - Summarize each page
    emitProgress({
      phase: 'mapping',
      current: 0,
      total: fetchedPages.length,
      message: 'Analyzing pages...'
    });

    const summarizedPages = [];
    for (let i = 0; i < fetchedPages.length; i++) {
      if (cancelRequested) {
        return { cancelled: true };
      }

      const page = fetchedPages[i];
      emitProgress({
        phase: 'mapping',
        current: i + 1,
        total: fetchedPages.length,
        currentPage: page.title,
        message: `Analyzing: "${page.title}" (${i + 1}/${fetchedPages.length})`,
        imagesFound: page.imageCount || 0
      });

      const summarizedPage = await mapSummarizePage(page, query);
      summarizedPages.push(summarizedPage);
    }

    // Phase 3: REDUCE - Synthesize final document
    emitProgress({
      phase: 'reducing',
      current: 0,
      total: 1,
      message: 'Synthesizing final document...'
    });

    const result = await reduceSynthesizeDocument(summarizedPages, query, currentPageContent, connectionInfo);

    emitProgress({
      phase: 'complete',
      message: 'Synthesis complete'
    });

    return result;

  } catch (error) {
    console.error('[Wiki Synthesis] Error:', error.message);
    emitProgress({
      phase: 'complete',
      message: 'Synthesis failed: ' + error.message
    });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Cancel ongoing synthesis
 */
function cancelSynthesis() {
  console.log('[Wiki Synthesis] Cancel requested');
  cancelRequested = true;
}

/**
 * Check if synthesis is in progress
 */
function isSynthesisRunning() {
  return !cancelRequested;
}

module.exports = {
  synthesizeFromPages,
  cancelSynthesis,
  isSynthesisRunning,
  extractImageReferences,
  extractFilename
};
