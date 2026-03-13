/**
 * Documentation Generation Agent
 *
 * Multi-step LLM agent that generates comprehensive developer documentation
 * using a map-reduce pattern. Leverages the code graph for structured context.
 *
 * Workflow:
 *   1. PLAN — LLM creates doc outline from code graph summary
 *   2. MAP — For each section, assemble context + generate content
 *   3. REDUCE — Combine sections into coherent document
 */

const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const providerFactory = require('../providers');
const configManager = require('../llmConfigManager');
const { loadCodeGraph } = require('../analysis/codeGraphStore');
const { assembleContext } = require('../rag/contextAssembler');
const {
  generateArchitectureDiagram,
  generateLayerDiagram
} = require('../analysis/architectureVisualizer');
const mermaidValidator = require('../mermaidValidator');
const {
  DOC_PLAN_PROMPT,
  DOC_SECTION_PROMPT,
  DOC_REDUCE_PROMPT,
  ARCHITECTURE_PROMPT,
  API_REFERENCE_PROMPT
} = require('../prompts/docPrompts');

// Cached model instance
let cachedModel = null;
let cachedProvider = null;

// Cancellation
let cancelRequested = false;

// Concurrency
const MAX_CONCURRENT_SECTIONS = 2;

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
  console.log(`[Doc Agent] Created ${config.provider} model: ${config.model}`);
  return cachedModel;
}

/**
 * Generate comprehensive developer documentation
 * @param {Object} options - Generation options
 * @param {string[]} options.catalogNames - Catalogs to document
 * @param {Object} options.vectorStore - Vector store reference
 * @param {Object} options.indexManager - Index manager reference
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<Object>} Generated documentation
 */
async function generateDocumentation(options) {
  const { catalogNames, vectorStore, indexManager, onProgress = () => {} } = options;

  cancelRequested = false;
  const startTime = Date.now();

  try {
    // Load code graphs for all catalogs
    onProgress({ phase: 'loading', message: 'Loading code analysis data...' });
    const codeGraphs = {};
    for (const name of catalogNames) {
      const graph = await loadCodeGraph(name);
      if (graph) codeGraphs[name] = graph;
    }

    if (Object.keys(codeGraphs).length === 0) {
      return {
        success: false,
        error: 'No code graph available. Please index your catalog first with code analysis enabled.'
      };
    }

    // Step 1: PLAN — Create documentation outline
    if (cancelRequested) return cancelResult();
    onProgress({ phase: 'planning', message: 'Planning documentation structure...' });

    const outline = await planOutline(codeGraphs);
    if (!outline || outline.length === 0) {
      return { success: false, error: 'Failed to generate documentation outline.' };
    }

    console.log(`[Doc Agent] Plan: ${outline.length} sections`);

    // Step 2: MAP — Generate each section
    const sections = [];
    for (let i = 0; i < outline.length; i++) {
      if (cancelRequested) return cancelResult();

      const section = outline[i];
      onProgress({
        phase: 'writing',
        message: `Writing section ${i + 1}/${outline.length}: ${section.title}`,
        progress: Math.round(((i + 1) / outline.length) * 80)
      });

      const content = await generateSection(section, codeGraphs, {
        vectorStore,
        indexManager,
        catalogNames
      });

      sections.push({
        title: section.title,
        content: content || `## ${section.title}\n\n*Content generation failed for this section.*`
      });
    }

    // Step 3: REDUCE — Combine into final document
    if (cancelRequested) return cancelResult();
    onProgress({ phase: 'finalizing', message: 'Combining sections into final document...', progress: 90 });

    const finalDoc = await reduceDocument(sections);

    onProgress({ phase: 'complete', message: 'Documentation generated!', progress: 100 });

    return {
      success: true,
      document: finalDoc,
      outline,
      sectionCount: sections.length,
      durationMs: Date.now() - startTime
    };

  } catch (error) {
    console.error('[Doc Agent] Generation failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Cancel ongoing generation
 */
function cancelGeneration() {
  cancelRequested = true;
  console.log('[Doc Agent] Cancel requested');
}

function cancelResult() {
  return { success: false, cancelled: true };
}

// ============================================
// Step 1: PLAN
// ============================================

async function planOutline(codeGraphs) {
  const summary = buildCodeGraphSummary(codeGraphs);
  const prompt = DOC_PLAN_PROMPT.replace('{codeGraphSummary}', summary);

  const model = getModel();
  const messages = [
    new SystemMessage('You are a technical documentation planner. Return only valid JSON.'),
    new HumanMessage(prompt)
  ];

  try {
    const response = await model.invoke(messages);
    const text = response.content || '';

    // Parse JSON from response (handle markdown code blocks)
    const jsonText = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const outline = JSON.parse(jsonText);

    if (!Array.isArray(outline)) {
      throw new Error('Expected JSON array');
    }

    return outline.filter(s => s.title && s.scope && s.type);
  } catch (err) {
    console.error('[Doc Agent] Plan failed:', err.message);

    // Fallback: generate a default outline
    return getDefaultOutline(codeGraphs);
  }
}

function getDefaultOutline(codeGraphs) {
  const outline = [
    { title: 'Project Overview', scope: 'High-level purpose and functionality', type: 'overview' },
    { title: 'Architecture', scope: 'Project structure, layers, and module organization', type: 'architecture' },
    { title: 'Getting Started', scope: 'Setup, installation, and running the project', type: 'setup' }
  ];

  // Add module-specific sections
  for (const graph of Object.values(codeGraphs)) {
    if (graph.directory?.modules) {
      for (const mod of graph.directory.modules.slice(0, 5)) {
        outline.push({
          title: `Module: ${mod.name}`,
          scope: `Files, exports, and functionality in the ${mod.name} module`,
          type: 'module_guide'
        });
      }
    }
  }

  outline.push({ title: 'API Reference', scope: 'Exported functions and their signatures', type: 'api_reference' });

  return outline;
}

// ============================================
// Step 2: MAP — Generate Sections
// ============================================

async function generateSection(section, codeGraphs, searchOptions) {
  const context = await assembleSectionContext(section, codeGraphs, searchOptions);

  let prompt;
  if (section.type === 'architecture') {
    prompt = buildArchitecturePrompt(codeGraphs);
  } else if (section.type === 'api_reference') {
    prompt = buildApiReferencePrompt(codeGraphs);
  } else {
    prompt = DOC_SECTION_PROMPT
      .replace('{title}', section.title)
      .replace('{scope}', section.scope)
      .replace('{type}', section.type)
      .replace('{context}', context);
  }

  const model = getModel();
  const messages = [
    new SystemMessage('You are a senior technical writer creating developer documentation. Write in clear, professional Markdown.'),
    new HumanMessage(prompt)
  ];

  try {
    const response = await model.invoke(messages);
    let sectionContent = (response.content || '').trim();

    // Auto-fix mermaid diagrams in section content
    const mermaidFix = mermaidValidator.autoFixMermaidInContent(sectionContent);
    sectionContent = mermaidFix.content;
    if (mermaidFix.fixCount > 0) {
      console.log(`[Doc Agent] Auto-fixed ${mermaidFix.fixCount} mermaid label(s) in section "${section.title}"`);
    }

    return sectionContent;
  } catch (err) {
    console.error(`[Doc Agent] Section "${section.title}" failed:`, err.message);
    return null;
  }
}

async function assembleSectionContext(section, codeGraphs, searchOptions) {
  const parts = [];

  // Add relevant code graph data based on section type
  for (const graph of Object.values(codeGraphs)) {
    switch (section.type) {
      case 'overview':
        parts.push(buildCodeGraphSummary({ default: graph }));
        break;

      case 'architecture':
        // Handled by buildArchitecturePrompt
        break;

      case 'api_reference':
        // Handled by buildApiReferencePrompt
        break;

      case 'module_guide': {
        const moduleName = section.title.replace(/^Module:\s*/i, '');
        const mod = graph.directory?.modules?.find(m =>
          m.name.toLowerCase() === moduleName.toLowerCase()
        );
        if (mod) {
          parts.push(`Module: ${mod.name} (${mod.fileCount} files)`);
          if (mod.submodules.length > 0) parts.push(`Submodules: ${mod.submodules.join(', ')}`);
        }
        // Add signatures from this module
        const moduleSigs = graph.signatures.filter(s =>
          s.filePath.includes(`/${moduleName}/`) && s.isExported
        );
        if (moduleSigs.length > 0) {
          parts.push('\nExported functions:');
          for (const sig of moduleSigs.slice(0, 20)) {
            const params = sig.parameters.map(p => p.name).join(', ');
            parts.push(`  ${sig.name}(${params}) — ${sig.filePath}:${sig.startLine}`);
            if (sig.jsdocSummary) parts.push(`    ${sig.jsdocSummary}`);
          }
        }
        break;
      }

      case 'data_flow':
        if (graph.dependencyGraph) {
          parts.push('Entry points: ' + (graph.dependencyGraph.entryPoints || []).join(', '));
          parts.push(`Dependency edges: ${graph.dependencyGraph.edges.length}`);
        }
        break;

      case 'patterns':
        if (graph.directory?.patterns) {
          parts.push(`Build tool: ${graph.directory.patterns.buildTool || 'unknown'}`);
          parts.push(`Has tests: ${graph.directory.patterns.hasTests}`);
          parts.push(`Config files: ${(graph.directory.patterns.configFiles || []).join(', ')}`);
        }
        break;

      default:
        parts.push(buildCodeGraphSummary({ default: graph }));
    }
  }

  // Try to get relevant RAG context via search
  try {
    if (searchOptions.vectorStore && searchOptions.indexManager) {
      const searchQuery = `${section.title} ${section.scope}`;
      const ragResult = await assembleContext({
        query: searchQuery,
        catalogNames: searchOptions.catalogNames,
        vectorStore: searchOptions.vectorStore,
        indexManager: searchOptions.indexManager,
        searchOptions: { limit: 5, minScore: 0.3 }
      });

      if (ragResult.formatted) {
        parts.push('\n--- Related Code ---');
        parts.push(ragResult.formatted.substring(0, 4000));
      }
    }
  } catch {
    // RAG search is optional
  }

  return parts.join('\n');
}

function buildArchitecturePrompt(codeGraphs) {
  const parts = [];

  for (const graph of Object.values(codeGraphs)) {
    // Modules
    const modules = (graph.directory?.modules || [])
      .map(m => `  ${m.path}: ${m.fileCount} files${m.submodules.length > 0 ? ` (${m.submodules.join(', ')})` : ''}`)
      .join('\n');

    // Dependencies
    const deps = [];
    if (graph.dependencyGraph?.layers) {
      for (const [layer, files] of Object.entries(graph.dependencyGraph.layers)) {
        deps.push(`  ${layer}: ${files.length} files`);
      }
    }

    // Entry points
    const entries = (graph.dependencyGraph?.entryPoints || []).slice(0, 5).join(', ');

    // Tech
    const tech = [];
    if (graph.directory?.patterns?.buildTool) tech.push(`Build: ${graph.directory.patterns.buildTool}`);
    if (graph.directory?.stats?.languageBreakdown) {
      const langs = Object.entries(graph.directory.stats.languageBreakdown)
        .slice(0, 5).map(([l, c]) => `${l}(${c})`).join(', ');
      tech.push(`Languages: ${langs}`);
    }

    // Mermaid diagram
    let mermaidSection = '';
    const diagram = generateLayerDiagram(graph.dependencyGraph);
    if (diagram) {
      mermaidSection = `\n### Architecture Diagram\n\`\`\`mermaid\n${diagram}\n\`\`\``;
    }

    parts.push(ARCHITECTURE_PROMPT
      .replace('{modules}', modules || 'No modules detected')
      .replace('{dependencies}', deps.join('\n') || 'No dependency data')
      .replace('{entryPoints}', entries || 'Not detected')
      .replace('{techStack}', tech.join('\n') || 'Not detected')
      .replace('{mermaidDiagram}', mermaidSection));
  }

  return parts.join('\n\n');
}

function buildApiReferencePrompt(codeGraphs) {
  const sigTexts = [];

  for (const graph of Object.values(codeGraphs)) {
    // Group signatures by file
    const byFile = {};
    for (const sig of graph.signatures) {
      if (!sig.isExported) continue;
      if (!byFile[sig.filePath]) byFile[sig.filePath] = [];
      byFile[sig.filePath].push(sig);
    }

    for (const [file, sigs] of Object.entries(byFile)) {
      sigTexts.push(`\n### ${file}`);
      for (const sig of sigs) {
        const params = sig.parameters.map(p => {
          if (p.type) return `${p.name}: ${p.type}`;
          return p.name;
        }).join(', ');
        const ret = sig.returnType ? ` → ${sig.returnType}` : '';
        const async_ = sig.isAsync ? 'async ' : '';
        sigTexts.push(`  ${async_}${sig.kind} ${sig.name}(${params})${ret}`);
        if (sig.jsdocSummary) sigTexts.push(`    ${sig.jsdocSummary}`);
      }
    }
  }

  return API_REFERENCE_PROMPT.replace('{signatures}', sigTexts.join('\n') || 'No exported functions found');
}

// ============================================
// Step 3: REDUCE
// ============================================

async function reduceDocument(sections) {
  // If only a few sections, skip the reduce step
  if (sections.length <= 3) {
    return sections.map(s => s.content).join('\n\n---\n\n');
  }

  const sectionText = sections.map((s, i) =>
    `### Section ${i + 1}: ${s.title}\n\n${s.content}`
  ).join('\n\n---\n\n');

  const prompt = DOC_REDUCE_PROMPT.replace('{sections}', sectionText);

  const model = getModel();
  const messages = [
    new SystemMessage('You are a senior technical writer producing final documentation. Output clean Markdown only.'),
    new HumanMessage(prompt)
  ];

  try {
    const response = await model.invoke(messages);
    let result = (response.content || '').trim();

    // Clean up any markdown code fences wrapping the entire output
    result = result.replace(/^```markdown\s*\n?/i, '').replace(/\n?```$/i, '').trim();

    // Auto-fix mermaid diagrams in final document
    const mermaidFix = mermaidValidator.autoFixMermaidInContent(result);
    result = mermaidFix.content;
    if (mermaidFix.fixCount > 0) {
      console.log(`[Doc Agent] Auto-fixed ${mermaidFix.fixCount} mermaid label(s) in reduced document`);
    }

    return result;
  } catch (err) {
    console.error('[Doc Agent] Reduce failed, returning raw sections:', err.message);
    return sections.map(s => s.content).join('\n\n---\n\n');
  }
}

// ============================================
// Helpers
// ============================================

function buildCodeGraphSummary(codeGraphs) {
  const lines = [];

  for (const [name, graph] of Object.entries(codeGraphs)) {
    lines.push(`Catalog: ${name}`);
    lines.push(`Files: ${graph.stats?.totalFiles || 0} (${graph.stats?.analyzedFiles || 0} analyzed)`);
    lines.push(`Functions: ${graph.stats?.totalSignatures || 0}`);
    lines.push(`Dependencies: ${graph.stats?.totalEdges || 0} edges`);

    if (graph.directory?.modules) {
      lines.push(`\nModules:`);
      for (const mod of graph.directory.modules) {
        lines.push(`  ${mod.path} — ${mod.fileCount} files`);
        if (mod.submodules.length > 0) {
          lines.push(`    Submodules: ${mod.submodules.join(', ')}`);
        }
      }
    }

    if (graph.dependencyGraph?.layers) {
      lines.push(`\nLayers:`);
      for (const [layer, files] of Object.entries(graph.dependencyGraph.layers)) {
        lines.push(`  ${layer}: ${files.length} files`);
      }
    }

    if (graph.dependencyGraph?.entryPoints?.length > 0) {
      lines.push(`\nEntry Points: ${graph.dependencyGraph.entryPoints.slice(0, 5).join(', ')}`);
    }

    if (graph.directory?.patterns) {
      const p = graph.directory.patterns;
      if (p.buildTool) lines.push(`Build Tool: ${p.buildTool}`);
      if (p.hasTests) lines.push(`Test Dir: ${p.testDirs?.join(', ') || 'yes'}`);
    }

    if (graph.directory?.stats?.languageBreakdown) {
      lines.push(`\nLanguages:`);
      for (const [lang, count] of Object.entries(graph.directory.stats.languageBreakdown).slice(0, 8)) {
        lines.push(`  ${lang}: ${count}`);
      }
    }
  }

  return lines.join('\n');
}

module.exports = {
  generateDocumentation,
  cancelGeneration
};
