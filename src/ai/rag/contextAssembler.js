/**
 * Context Assembler
 *
 * Relationship-aware context assembly that replaces naive top-K chunk
 * concatenation. Uses the code graph to expand search results with
 * dependency relationships, function signatures, and module context.
 */

const { classifyQuery } = require('./queryClassifier');
const { loadCodeGraph } = require('../analysis/codeGraphStore');
const { getDependants, getDependencies } = require('../analysis/dependencyGraph');

// Max tokens for assembled context
const MAX_CONTEXT_TOKENS = 8000;
const CHARS_PER_TOKEN = 4;
const MAX_CONTEXT_CHARS = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;

/**
 * Assemble rich context for a query by combining vector search results
 * with code graph data
 * @param {Object} options - Assembly options
 * @param {string} options.query - User's query
 * @param {string[]} options.catalogNames - Catalog names to search
 * @param {Object} options.vectorStore - Vector store reference for search
 * @param {Object} options.indexManager - Index manager reference for search
 * @param {Object} [options.searchOptions] - Search options
 * @returns {Promise<Object>} Assembled context
 */
async function assembleContext(options) {
  const {
    query,
    catalogNames,
    vectorStore,
    indexManager,
    searchOptions = {}
  } = options;

  // Step 1: Classify query intent
  const classification = classifyQuery(query);
  console.log(`[ContextAssembler] Intent: ${classification.intent} (${classification.confidence})`);

  // Step 2: Perform hybrid search on all catalogs
  const searchResults = [];
  for (const catalogName of catalogNames) {
    try {
      const results = await indexManager.search(catalogName, query, {
        limit: searchOptions.limit || 10,
        minScore: searchOptions.minScore || 0.3
      });
      searchResults.push(...results.map(r => ({ ...r, catalog: catalogName })));
    } catch (err) {
      console.warn(`[ContextAssembler] Search failed for ${catalogName}:`, err.message);
    }
  }

  // Sort by score
  searchResults.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Step 3: Load code graphs for expansion
  const codeGraphs = {};
  for (const catalogName of catalogNames) {
    const graph = await loadCodeGraph(catalogName);
    if (graph) codeGraphs[catalogName] = graph;
  }

  // Step 4: Expand based on intent
  const expanded = expandByIntent(classification.intent, searchResults, codeGraphs);

  // Step 5: Budget tokens across sources
  const budgeted = budgetTokens(expanded, MAX_CONTEXT_CHARS);

  // Step 6: Format into structured context
  const context = formatContext(budgeted, classification);

  return {
    intent: classification.intent,
    confidence: classification.confidence,
    chunks: budgeted.chunks,
    graphContext: budgeted.graphContext,
    formatted: context,
    sourceCount: budgeted.chunks.length + (budgeted.graphContext ? 1 : 0)
  };
}

/**
 * Expand search results based on query intent
 */
function expandByIntent(intent, searchResults, codeGraphs) {
  const chunks = searchResults.slice(0, 10); // Base top-10
  let graphContext = null;

  switch (intent) {
    case 'api_lookup':
      graphContext = expandForApiLookup(chunks, codeGraphs);
      break;

    case 'architecture':
      graphContext = expandForArchitecture(codeGraphs);
      break;

    case 'data_flow':
      graphContext = expandForDataFlow(chunks, codeGraphs);
      break;

    case 'listing':
      graphContext = expandForListing(codeGraphs);
      break;

    case 'documentation':
      graphContext = expandForArchitecture(codeGraphs);
      break;

    case 'general':
    default:
      graphContext = expandForGeneral(chunks, codeGraphs);
      break;
  }

  return { chunks, graphContext };
}

/**
 * API lookup: Add function signature, callers/callees
 */
function expandForApiLookup(chunks, codeGraphs) {
  const lines = [];

  for (const graph of Object.values(codeGraphs)) {
    // Find matching signatures from search results
    const matchedFiles = new Set();
    for (const chunk of chunks) {
      const filePath = chunk.metadata?.relativePath || chunk.metadata?.filePath;
      if (filePath) matchedFiles.add(filePath.replace(/\\/g, '/'));
    }

    // Add signatures for matched files
    const relevantSigs = graph.signatures.filter(s =>
      matchedFiles.has(s.filePath) && s.isExported
    );

    if (relevantSigs.length > 0) {
      lines.push('--- Function Signatures ---');
      for (const sig of relevantSigs.slice(0, 8)) {
        const params = sig.parameters.map(p => p.type ? `${p.name}: ${p.type}` : p.name).join(', ');
        const ret = sig.returnType ? ` → ${sig.returnType}` : '';
        const async_ = sig.isAsync ? 'async ' : '';
        lines.push(`${async_}${sig.kind} ${sig.name}(${params})${ret}`);
        if (sig.jsdocSummary) lines.push(`  ${sig.jsdocSummary}`);
        lines.push(`  File: ${sig.filePath}:${sig.startLine}`);
      }
    }

    // Add callers/callees for matched files
    for (const filePath of matchedFiles) {
      const dependants = getDependants(filePath, graph.dependencyGraph);
      const dependencies = getDependencies(filePath, graph.dependencyGraph);

      if (dependants.length > 0) {
        lines.push(`\nImported by: ${dependants.slice(0, 5).join(', ')}`);
      }
      if (dependencies.length > 0) {
        lines.push(`Imports from: ${dependencies.slice(0, 5).join(', ')}`);
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Architecture: Add module structure, dependency graph, layer summaries
 */
function expandForArchitecture(codeGraphs) {
  const lines = [];

  for (const [catalogName, graph] of Object.entries(codeGraphs)) {
    lines.push(`--- Architecture: ${catalogName} ---`);

    // Module structure
    if (graph.directory?.modules?.length > 0) {
      lines.push('\nModules:');
      for (const mod of graph.directory.modules) {
        const sub = mod.submodules.length > 0 ? ` → ${mod.submodules.join(', ')}` : '';
        lines.push(`  ${mod.path} (${mod.fileCount} files)${sub}`);
      }
    }

    // Layers
    if (graph.dependencyGraph?.layers) {
      lines.push('\nLayers:');
      for (const [layer, files] of Object.entries(graph.dependencyGraph.layers)) {
        lines.push(`  ${layer}: ${files.length} files`);
      }
    }

    // Entry points
    if (graph.dependencyGraph?.entryPoints?.length > 0) {
      lines.push(`\nEntry Points: ${graph.dependencyGraph.entryPoints.slice(0, 5).join(', ')}`);
    }

    // Key stats
    if (graph.stats) {
      lines.push(`\nStats: ${graph.stats.totalFiles} files, ${graph.stats.totalSignatures} functions, ${graph.stats.totalEdges} dependencies`);
    }

    // Circular deps warning
    if (graph.dependencyGraph?.circularDeps?.length > 0) {
      lines.push(`\nCircular Dependencies (${graph.dependencyGraph.circularDeps.length}):`);
      for (const cycle of graph.dependencyGraph.circularDeps.slice(0, 3)) {
        lines.push(`  ${cycle.join(' → ')}`);
      }
    }

    // Build tool and languages
    if (graph.directory?.patterns?.buildTool) {
      lines.push(`\nBuild Tool: ${graph.directory.patterns.buildTool}`);
    }
    if (graph.directory?.stats?.languageBreakdown) {
      const langs = Object.entries(graph.directory.stats.languageBreakdown)
        .slice(0, 5)
        .map(([l, c]) => `${l}(${c})`)
        .join(', ');
      lines.push(`Languages: ${langs}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Data flow: Trace import chains from matched chunks
 */
function expandForDataFlow(chunks, codeGraphs) {
  const lines = [];

  for (const graph of Object.values(codeGraphs)) {
    const matchedFiles = new Set();
    for (const chunk of chunks) {
      const filePath = chunk.metadata?.relativePath || chunk.metadata?.filePath;
      if (filePath) matchedFiles.add(filePath.replace(/\\/g, '/'));
    }

    if (matchedFiles.size === 0) continue;

    lines.push('--- Import Chains ---');

    // For each matched file, trace its imports and importers
    for (const filePath of matchedFiles) {
      const dependants = getDependants(filePath, graph.dependencyGraph);
      const dependencies = getDependencies(filePath, graph.dependencyGraph);

      if (dependants.length > 0 || dependencies.length > 0) {
        lines.push(`\n${filePath}:`);
        if (dependants.length > 0) {
          lines.push(`  ← Imported by: ${dependants.join(', ')}`);
        }
        if (dependencies.length > 0) {
          lines.push(`  → Imports: ${dependencies.join(', ')}`);
        }

        // Show what symbols are imported
        const edges = graph.dependencyGraph.edges.filter(e => e.from === filePath || e.to === filePath);
        for (const edge of edges.slice(0, 5)) {
          if (edge.symbols.length > 0) {
            lines.push(`    ${edge.from} → ${edge.to}: {${edge.symbols.join(', ')}}`);
          }
        }
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Listing: Return structured data from code graph
 */
function expandForListing(codeGraphs) {
  const lines = [];

  for (const [catalogName, graph] of Object.entries(codeGraphs)) {
    // List exported functions grouped by file
    const byFile = {};
    for (const sig of graph.signatures) {
      if (!sig.isExported) continue;
      if (!byFile[sig.filePath]) byFile[sig.filePath] = [];
      byFile[sig.filePath].push(sig);
    }

    lines.push(`--- Exported API: ${catalogName} ---`);
    for (const [file, sigs] of Object.entries(byFile)) {
      lines.push(`\n${file}:`);
      for (const sig of sigs) {
        const params = sig.parameters.map(p => p.name).join(', ');
        lines.push(`  ${sig.kind} ${sig.name}(${params})`);
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * General: Standard top-K with light graph expansion
 */
function expandForGeneral(chunks, codeGraphs) {
  const lines = [];

  // Add import context for matched files
  for (const graph of Object.values(codeGraphs)) {
    const matchedFiles = new Set();
    for (const chunk of chunks.slice(0, 5)) {
      const filePath = chunk.metadata?.relativePath || chunk.metadata?.filePath;
      if (filePath) matchedFiles.add(filePath.replace(/\\/g, '/'));
    }

    for (const filePath of matchedFiles) {
      const node = graph.dependencyGraph?.nodes?.[filePath];
      if (node && node.exports.length > 0) {
        lines.push(`${filePath} exports: ${node.exports.slice(0, 5).join(', ')}`);
      }
    }
  }

  return lines.length > 0 ? '--- Related Context ---\n' + lines.join('\n') : null;
}

/**
 * Budget tokens across direct matches vs. graph context
 */
function budgetTokens(expanded, maxChars) {
  const { chunks, graphContext } = expanded;

  // Reserve 30% for graph context if available
  const graphBudget = graphContext ? Math.floor(maxChars * 0.3) : 0;
  const chunkBudget = maxChars - graphBudget;

  // Trim chunks to budget
  const trimmedChunks = [];
  let usedChars = 0;

  for (const chunk of chunks) {
    const text = chunk.text || chunk.content || '';
    if (usedChars + text.length > chunkBudget) {
      // Add partial if we have room for at least 200 chars
      const remaining = chunkBudget - usedChars;
      if (remaining > 200) {
        trimmedChunks.push({ ...chunk, text: text.substring(0, remaining) + '...' });
      }
      break;
    }
    trimmedChunks.push(chunk);
    usedChars += text.length;
  }

  // Trim graph context to budget
  let trimmedGraph = graphContext;
  if (graphContext && graphContext.length > graphBudget) {
    trimmedGraph = graphContext.substring(0, graphBudget) + '\n...[truncated]';
  }

  return {
    chunks: trimmedChunks,
    graphContext: trimmedGraph
  };
}

/**
 * Format assembled context into a structured string
 */
function formatContext(budgeted, classification) {
  const parts = [];

  // Graph context first (architectural awareness)
  if (budgeted.graphContext) {
    parts.push(budgeted.graphContext);
  }

  // Search results
  if (budgeted.chunks.length > 0) {
    parts.push('--- Search Results ---');
    for (const chunk of budgeted.chunks) {
      const source = chunk.metadata?.relativePath || chunk.metadata?.fileName || 'unknown';
      const score = chunk.score ? ` (relevance: ${(chunk.score * 100).toFixed(0)}%)` : '';
      parts.push(`\n[${source}${score}]`);
      parts.push(chunk.text || chunk.content || '');
    }
  }

  return parts.join('\n');
}

module.exports = {
  assembleContext
};
