/**
 * Wiki Search Agent
 *
 * Orchestrates wiki search workflow:
 * - Extract search terms from natural language
 * - Search pages by name/path matching
 * - Fetch and analyze page content
 * - Synthesize results into a final answer
 * - Handle cancellation (abort or stop-and-use)
 */

const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const providerFactory = require('./providers');
const configManager = require('./llmConfigManager');
const {
  SEARCH_TERM_EXTRACTION_PROMPT,
  CONTENT_RELEVANCE_PROMPT,
  SEARCH_SYNTHESIS_PROMPT
} = require('./prompts/wikiSearchPrompts');
const mermaidValidator = require('./mermaidValidator');

// Cached model instance
let cachedModel = null;
let cachedProvider = null;

// Cancellation state
let abortController = null;
let cancelMode = null; // 'abort' | 'stop' | null

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

  console.log(`[Wiki Search] Created ${config.provider} model: ${config.model}`);

  return cachedModel;
}

/**
 * Parse JSON from LLM response, handling markdown code blocks
 */
function parseJsonResponse(text) {
  // Try to extract JSON from code blocks first
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch (e) {
      console.warn('[Wiki Search] Failed to parse JSON from code block:', e.message);
    }
  }

  // Try raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn('[Wiki Search] Failed to parse raw JSON:', e.message);
    }
  }

  // Try entire response
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    console.warn('[Wiki Search] Failed to parse response as JSON');
    return null;
  }
}

/**
 * Extract quoted terms from a query (fast, no LLM call)
 * Used for quick extraction when user explicitly quotes search terms
 * @param {string} query - User's natural language query
 * @returns {string[]|null} - Array of quoted terms, or null if no quotes found
 */
function extractQuotedTerms(query) {
  if (!query) return null;

  // Match terms in double or single quotes: "term" or 'term'
  const quotedMatches = query.match(/["']([^"']+)["']/g);
  if (quotedMatches && quotedMatches.length > 0) {
    const terms = quotedMatches
      .map(m => m.replace(/["']/g, '').trim())
      .filter(t => t.length > 0);
    if (terms.length > 0) {
      console.log('[Wiki Search] Extracted quoted terms:', terms);
      return terms;
    }
  }
  return null;
}

/**
 * Quick extraction of search terms (prefers quoted terms, falls back to LLM)
 * Use this before showing confirmation dialog
 * @param {string} query - User's natural language query
 * @param {boolean} allowLlm - If true, use LLM as fallback; if false, only check quotes
 * @returns {Promise<Object>} - { keywords: string[], intent: string, source: 'quoted'|'llm'|'fallback' }
 */
async function quickExtractSearchTerms(query, allowLlm = true) {
  // First try quoted terms (instant)
  const quotedTerms = extractQuotedTerms(query);
  if (quotedTerms && quotedTerms.length > 0) {
    return {
      keywords: quotedTerms,
      intent: 'Search for: ' + quotedTerms.join(', '),
      source: 'quoted'
    };
  }

  // Fall back to LLM extraction if allowed
  if (allowLlm) {
    const result = await extractSearchTerms(query);
    return { ...result, source: 'llm' };
  }

  // No LLM, no quotes - return null to indicate extraction needed later
  return null;
}

/**
 * Extract search keywords from natural language query
 * @param {string} query - User's natural language query
 * @returns {Promise<Object>} - { keywords: string[], intent: string }
 */
async function extractSearchTerms(query) {
  console.log('[Wiki Search] Extracting search terms from:', query);

  const model = getModel();
  const messages = [
    new SystemMessage(SEARCH_TERM_EXTRACTION_PROMPT),
    new HumanMessage(query)
  ];

  try {
    const response = await model.invoke(messages);
    const result = parseJsonResponse(response.content || '');

    if (result && result.keywords) {
      console.log('[Wiki Search] Extracted keywords:', result.keywords);
      return result;
    }

    // Fallback: split query into words
    const fallbackKeywords = query
      .split(/\s+/)
      .filter(word => word.length > 2)
      .slice(0, 5);

    return {
      keywords: fallbackKeywords,
      intent: 'Search for: ' + query
    };
  } catch (error) {
    console.error('[Wiki Search] Error extracting terms:', error.message);
    // Fallback
    return {
      keywords: query.split(/\s+/).filter(word => word.length > 2).slice(0, 5),
      intent: query
    };
  }
}

/**
 * Flatten wiki tree into array of pages
 * @param {Object} wikiTree - Wiki tree from Azure API
 * @returns {Array} - Flat array of {path, title, remoteUrl}
 */
function flattenWikiTree(wikiTree) {
  const pages = [];

  function traverse(node, depth = 0) {
    if (!node) return;

    // Add current node
    if (node.path) {
      pages.push({
        path: node.path,
        title: node.path.split('/').pop() || node.path,
        remoteUrl: node.remoteUrl || null // Preserve Azure DevOps URL for links
      });
    }

    // Traverse children
    if (node.subPages && Array.isArray(node.subPages)) {
      for (const child of node.subPages) {
        traverse(child, depth + 1);
      }
    }
  }

  traverse(wikiTree);
  return pages;
}

/**
 * Search pages by name/path matching keywords
 * @param {string[]} keywords - Search keywords
 * @param {Object} wikiTree - Full wiki tree
 * @returns {Array} - Matching pages sorted by relevance
 */
function searchByPageName(keywords, wikiTree) {
  const pages = flattenWikiTree(wikiTree);
  const lowerKeywords = keywords.map(k => k.toLowerCase());

  const scored = pages.map(page => {
    const lowerPath = page.path.toLowerCase();
    const lowerTitle = page.title.toLowerCase();

    let score = 0;
    for (const keyword of lowerKeywords) {
      // Exact match in title gets highest score
      if (lowerTitle === keyword) {
        score += 100;
      } else if (lowerTitle.includes(keyword)) {
        score += 50;
      }
      // Match in path
      if (lowerPath.includes(keyword)) {
        score += 25;
      }
    }

    return { ...page, score };
  });

  // Filter and sort by score
  return scored
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Fetch page content with progress tracking
 * @param {Object} page - Page to fetch
 * @param {Function} getPageContent - Function to fetch content
 * @returns {Promise<Object>} - Page with content
 */
async function fetchPageContent(page, getPageContent) {
  try {
    const result = await getPageContent(page.path);
    return {
      ...page,
      content: result.content || '',
      fetchError: null
    };
  } catch (error) {
    console.warn('[Wiki Search] Failed to fetch:', page.path, error.message);
    return {
      ...page,
      content: null,
      fetchError: error.message
    };
  }
}

/**
 * Analyze page content for relevance
 * @param {Object} page - Page with content
 * @param {string[]} keywords - Search keywords
 * @returns {Promise<Object>} - Page with relevance score and summary
 */
async function analyzePageRelevance(page, keywords) {
  if (!page.content) {
    return { ...page, relevanceScore: 0, summary: 'Failed to fetch content' };
  }

  // Quick keyword check first (avoid LLM call for obviously irrelevant pages)
  const lowerContent = page.content.toLowerCase();
  const matchCount = keywords.filter(k => lowerContent.includes(k.toLowerCase())).length;

  if (matchCount === 0) {
    return {
      ...page,
      relevanceScore: 10,
      summary: 'No keyword matches in content'
    };
  }

  try {
    const model = getModel();
    // Truncate content for analysis (first 3000 chars)
    const contentSample = page.content.substring(0, 3000);
    const prompt = `Search keywords: ${keywords.join(', ')}\n\nPage title: ${page.title}\nPage path: ${page.path}\n\nContent:\n${contentSample}`;

    const messages = [
      new SystemMessage(CONTENT_RELEVANCE_PROMPT),
      new HumanMessage(prompt)
    ];

    const response = await model.invoke(messages);
    const result = parseJsonResponse(response.content || '');

    if (result && typeof result.score === 'number') {
      return {
        ...page,
        relevanceScore: result.score,
        summary: result.summary || '',
        keyPoints: result.keyPoints || []
      };
    }

    // Fallback based on keyword match count
    return {
      ...page,
      relevanceScore: 20 + (matchCount * 15),
      summary: `Contains ${matchCount} of ${keywords.length} search terms`
    };
  } catch (error) {
    console.warn('[Wiki Search] Error analyzing:', page.path, error.message);
    return {
      ...page,
      relevanceScore: 20 + (matchCount * 15),
      summary: 'Analysis failed: ' + error.message
    };
  }
}

/**
 * Synthesize search results into final answer
 * @param {string} originalQuery - User's original query
 * @param {Array} analyzedPages - Pages with content and relevance scores
 * @returns {Promise<Object>} - Synthesized result
 */
async function synthesizeResults(originalQuery, analyzedPages) {
  console.log('[Wiki Search] Synthesizing results from', analyzedPages.length, 'pages');

  // Sort by relevance and take top results
  const topPages = analyzedPages
    .filter(p => p.relevanceScore >= 30)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 10);

  if (topPages.length === 0) {
    return {
      summary: 'No relevant pages found for your search.',
      generatedContent: null,
      sources: [],
      suggestedFollowUp: ['Try different search terms', 'Check if the topic exists in the wiki']
    };
  }

  const model = getModel();

  // Build context from top pages
  const pagesContext = topPages.map(p => {
    const contentSnippet = p.content ? p.content.substring(0, 2000) : '';
    return `## ${p.title}\nPath: ${p.path}\nRelevance: ${p.relevanceScore}%\nSummary: ${p.summary || 'N/A'}\n\nContent excerpt:\n${contentSnippet}\n`;
  }).join('\n---\n');

  const prompt = `User's request: ${originalQuery}\n\nSearch results (${topPages.length} relevant pages found):\n\n${pagesContext}`;

  try {
    const messages = [
      new SystemMessage(SEARCH_SYNTHESIS_PROMPT),
      new HumanMessage(prompt)
    ];

    const response = await model.invoke(messages);
    const result = parseJsonResponse(response.content || '');

    if (result) {
      // Auto-fix mermaid diagrams in generated content
      if (result.generatedContent) {
        const mermaidFix = mermaidValidator.autoFixMermaidInContent(result.generatedContent);
        result.generatedContent = mermaidFix.content;
        if (mermaidFix.fixCount > 0) {
          console.log(`[Wiki Search] Auto-fixed ${mermaidFix.fixCount} mermaid label(s) in synthesized content`);
        }
      }
      // Ensure sources are properly formatted
      result.sources = topPages.map(p => ({
        title: p.title,
        path: p.path,
        relevance: p.relevanceScore
      }));
      return result;
    }

    // Fallback
    return {
      summary: `Found ${topPages.length} relevant pages.`,
      generatedContent: null,
      sources: topPages.map(p => ({ title: p.title, path: p.path, relevance: p.relevanceScore })),
      suggestedFollowUp: []
    };
  } catch (error) {
    console.error('[Wiki Search] Synthesis error:', error.message);
    return {
      summary: `Found ${topPages.length} relevant pages but failed to synthesize: ${error.message}`,
      generatedContent: null,
      sources: topPages.map(p => ({ title: p.title, path: p.path, relevance: p.relevanceScore })),
      suggestedFollowUp: []
    };
  }
}

/**
 * Main search entry point
 * @param {Object} options - Search options
 * @param {string} options.query - User's natural language query
 * @param {Object} options.wikiTree - Full wiki tree
 * @param {Function} options.getPageContent - Function to fetch page content
 * @param {Function} options.onProgress - Progress callback
 * @param {boolean} options.stopBeforeFetch - Stop after matching pages (for user selection)
 * @returns {Promise<Object>} - Search result
 */
async function searchWikiPages(options) {
  const { query, wikiTree, getPageContent, onProgress, stopBeforeFetch = false } = options;

  // Reset cancellation state
  abortController = new AbortController();
  cancelMode = null;

  const emitProgress = (data) => {
    if (onProgress && typeof onProgress === 'function') {
      onProgress(data);
    }
  };

  try {
    // Phase 1: Extract search terms
    emitProgress({
      phase: 'extracting',
      current: 0,
      total: 0,
      message: 'Analyzing your request...'
    });

    const { keywords, intent } = await extractSearchTerms(query);

    if (cancelMode === 'abort') {
      return { cancelled: true, cancelMode: 'abort' };
    }

    // Phase 2: Search by page name
    emitProgress({
      phase: 'searching',
      current: 0,
      total: 0,
      message: 'Searching wiki pages...',
      keywords
    });

    const matchingPages = searchByPageName(keywords, wikiTree);
    console.log('[Wiki Search] Found', matchingPages.length, 'matching pages');

    if (matchingPages.length === 0) {
      emitProgress({ phase: 'complete', message: 'No matching pages found' });
      return {
        success: true,
        summary: 'No pages found matching your search terms.',
        sources: [],
        keywords,
        intent,
        pagesFound: 0
      };
    }

    emitProgress({
      phase: 'searching',
      current: 0,
      total: matchingPages.length,
      message: `Found ${matchingPages.length} pages matching your search`,
      pagesFound: matchingPages.length
    });

    // If stopBeforeFetch is true, return matching pages for user selection
    if (stopBeforeFetch) {
      return {
        needsSelection: true,
        pagesFound: matchingPages.length,
        keywords,
        intent,
        pages: matchingPages
      };
    }

    // Return pages for confirmation if > 50 (legacy behavior)
    if (matchingPages.length > 50) {
      return {
        needsConfirmation: true,
        pagesFound: matchingPages.length,
        keywords,
        intent,
        pages: matchingPages
      };
    }

    // Phase 3: Fetch and analyze content
    const analyzedPages = [];
    const total = matchingPages.length;

    for (let i = 0; i < total; i++) {
      // Check for cancellation
      if (cancelMode === 'abort') {
        return { cancelled: true, cancelMode: 'abort' };
      }
      if (cancelMode === 'stop') {
        console.log('[Wiki Search] Stopping and using results so far');
        break;
      }

      const page = matchingPages[i];

      emitProgress({
        phase: 'fetching',
        current: i + 1,
        total,
        currentPage: page.title,
        message: `Scanning: "${page.title}" (${i + 1}/${total})`,
        pagesFetched: i + 1,
        pagesFound: total
      });

      // Fetch content
      const pageWithContent = await fetchPageContent(page, getPageContent);

      // Analyze relevance
      emitProgress({
        phase: 'analyzing',
        current: i + 1,
        total,
        currentPage: page.title,
        message: `Analyzing: "${page.title}" (${i + 1}/${total})`
      });

      const analyzedPage = await analyzePageRelevance(pageWithContent, keywords);
      analyzedPages.push(analyzedPage);
    }

    // Phase 4: Synthesize results
    emitProgress({
      phase: 'analyzing',
      current: total,
      total,
      message: 'Synthesizing findings...'
    });

    const result = await synthesizeResults(query, analyzedPages);

    emitProgress({
      phase: 'complete',
      message: 'Search complete'
    });

    return {
      success: true,
      ...result,
      keywords,
      intent,
      pagesSearched: analyzedPages.length,
      cancelled: cancelMode === 'stop'
    };

  } catch (error) {
    console.error('[Wiki Search] Error:', error.message);
    emitProgress({
      phase: 'complete',
      message: 'Search failed: ' + error.message
    });
    return {
      success: false,
      error: error.message
    };
  } finally {
    abortController = null;
    cancelMode = null;
  }
}

/**
 * Continue search after confirmation
 * @param {Object} options - Same as searchWikiPages but with confirmed pages
 * @param {number} options.maxPages - Maximum number of pages to analyze
 */
async function continueSearch(options) {
  const { pages, query, keywords, getPageContent, onProgress, maxPages } = options;

  // Reset cancellation state
  abortController = new AbortController();
  cancelMode = null;

  const emitProgress = (data) => {
    if (onProgress && typeof onProgress === 'function') {
      onProgress(data);
    }
  };

  try {
    // Limit pages if maxPages is specified
    const pagesToAnalyze = maxPages && maxPages < pages.length
      ? pages.slice(0, maxPages)
      : pages;

    console.log(`[Wiki Search] Analyzing ${pagesToAnalyze.length} of ${pages.length} pages`);

    const analyzedPages = [];
    const total = pagesToAnalyze.length;

    for (let i = 0; i < total; i++) {
      if (cancelMode === 'abort') {
        return { cancelled: true, cancelMode: 'abort' };
      }
      if (cancelMode === 'stop') {
        break;
      }

      const page = pagesToAnalyze[i];

      emitProgress({
        phase: 'fetching',
        current: i + 1,
        total,
        currentPage: page.title,
        message: `Scanning: "${page.title}" (${i + 1}/${total})`,
        pagesFetched: i + 1,
        pagesFound: total
      });

      const pageWithContent = await fetchPageContent(page, getPageContent);

      emitProgress({
        phase: 'analyzing',
        current: i + 1,
        total,
        currentPage: page.title,
        message: `Analyzing: "${page.title}" (${i + 1}/${total})`
      });

      const analyzedPage = await analyzePageRelevance(pageWithContent, keywords);
      analyzedPages.push(analyzedPage);
    }

    emitProgress({
      phase: 'analyzing',
      current: total,
      total,
      message: 'Synthesizing findings...'
    });

    const result = await synthesizeResults(query, analyzedPages);

    emitProgress({ phase: 'complete', message: 'Search complete' });

    return {
      success: true,
      ...result,
      keywords,
      pagesSearched: analyzedPages.length,
      totalPagesAvailable: pages.length,
      cancelled: cancelMode === 'stop'
    };

  } catch (error) {
    console.error('[Wiki Search] Error:', error.message);
    return { success: false, error: error.message };
  } finally {
    abortController = null;
    cancelMode = null;
  }
}

/**
 * Cancel the current search
 * @param {string} mode - 'abort' (stop completely) or 'stop' (use results so far)
 */
function cancelSearch(mode = 'abort') {
  console.log('[Wiki Search] Cancel requested, mode:', mode);
  cancelMode = mode;
  if (abortController) {
    abortController.abort();
  }
}

/**
 * Check if search is currently running
 */
function isSearchRunning() {
  return abortController !== null;
}

module.exports = {
  searchWikiPages,
  continueSearch,
  cancelSearch,
  isSearchRunning,
  extractSearchTerms,
  extractQuotedTerms,
  quickExtractSearchTerms,
  searchByPageName
};
