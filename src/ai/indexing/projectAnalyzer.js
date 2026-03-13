/**
 * Project Analyzer
 * Generates comprehensive project overviews using LLM
 */

// Project overview prompt template (enhanced with code graph data)
const OVERVIEW_PROMPT = `Based on the following project information, write a comprehensive project overview (4-6 paragraphs).

Cover these aspects:
1. **Project Purpose**: What does this project do? What problem does it solve?
2. **Architecture**: How is the codebase organized? What are the main modules/layers? How do they connect?
3. **Tech Stack**: What languages, frameworks, and libraries are used?
4. **Key Features**: What are the notable functionalities or patterns?
5. **API Surface**: How many exported functions/classes? What are the key entry points?

Project Manifests:
{manifests}

File Summaries:
{summaries}

{codeGraphSection}

Write the overview in clear, professional prose. Do not use JSON formatting.
If a Mermaid architecture diagram is provided, include it in a fenced code block.`;

/**
 * Generate a project overview from summaries, manifests, and code graph
 * @param {Object} options - Options
 * @param {Array} options.summaries - Array of file summaries
 * @param {Array} options.manifests - Array of parsed manifest data
 * @param {Object} options.llmClient - LLM client instance
 * @param {Function} options.onStream - Stream callback
 * @param {Object} [options.codeGraph] - Code graph data from codeGraphStore
 * @returns {Promise<Object>} Overview result
 */
async function generateOverview(options) {
  const { summaries, manifests, llmClient, onStream, codeGraph } = options;

  // Format manifests for prompt
  const manifestText = manifests
    .map(m => m.raw || formatManifestForPrompt(m))
    .join('\n\n');

  // Format summaries for prompt (limit to prevent context overflow)
  const summaryText = summaries
    .slice(0, 30)
    .map(s => `- ${s.filePath}: ${s.summary}`)
    .join('\n');

  // Format code graph data for prompt
  const codeGraphSection = formatCodeGraphForPrompt(codeGraph);

  const prompt = OVERVIEW_PROMPT
    .replace('{manifests}', manifestText || 'No manifest files found.')
    .replace('{summaries}', summaryText || 'No file summaries available.')
    .replace('{codeGraphSection}', codeGraphSection);

  const startTime = Date.now();
  let overview = '';
  const inputTokens = estimateTokens(prompt);

  try {
    if (llmClient.streamMessage) {
      for await (const chunk of llmClient.streamMessage([{ role: 'user', content: prompt }])) {
        overview += chunk;
        if (onStream) {
          onStream(chunk);
        }
      }
    } else if (llmClient.sendSimpleMessage) {
      overview = await llmClient.sendSimpleMessage(prompt);
      if (onStream) {
        onStream(overview);
      }
    } else {
      const response = await llmClient.sendMessage(prompt, '');
      overview = response.changeSummary || response.updatedArticle || '';
      if (onStream) {
        onStream(overview);
      }
    }

    const outputTokens = estimateTokens(overview);

    return {
      success: true,
      overview: overview.trim(),
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens
      },
      durationMs: Date.now() - startTime
    };

  } catch (error) {
    console.error('[Project Analyzer] Error generating overview:', error.message);
    return {
      success: false,
      error: error.message,
      overview: null,
      tokenUsage: { input: inputTokens, output: 0, total: inputTokens }
    };
  }
}

/**
 * Analyze tech stack from manifests
 * @param {Array} manifests - Parsed manifest data
 * @returns {Object} Tech stack analysis
 */
function analyzeTechStack(manifests) {
  const techStack = new Set();
  const dependencies = new Set();
  const languages = new Set();

  for (const manifest of manifests) {
    if (manifest.techStack) {
      manifest.techStack.forEach(t => techStack.add(t));
    }
    if (manifest.dependencies) {
      manifest.dependencies.slice(0, 20).forEach(d => dependencies.add(d));
    }

    // Detect language from manifest type
    switch (manifest.manifestType) {
      case 'package.json':
        languages.add('JavaScript/Node.js');
        break;
      case 'requirements.txt':
      case 'pyproject.toml':
        languages.add('Python');
        break;
      case '.csproj':
      case 'packages.config':
        languages.add('C#/.NET');
        break;
      case 'go.mod':
        languages.add('Go');
        break;
      case 'Cargo.toml':
        languages.add('Rust');
        break;
      case 'pom.xml':
        languages.add('Java');
        break;
      case 'Gemfile':
        languages.add('Ruby');
        break;
      case 'composer.json':
        languages.add('PHP');
        break;
    }
  }

  return {
    techStack: Array.from(techStack),
    topDependencies: Array.from(dependencies).slice(0, 20),
    languages: Array.from(languages)
  };
}

/**
 * Format manifest data for prompt
 */
function formatManifestForPrompt(manifest) {
  const lines = [];

  if (manifest.projectName) {
    lines.push(`Project: ${manifest.projectName}`);
  }
  if (manifest.description) {
    lines.push(`Description: ${manifest.description}`);
  }
  if (manifest.techStack && manifest.techStack.length > 0) {
    lines.push(`Tech Stack: ${manifest.techStack.join(', ')}`);
  }
  if (manifest.dependencies && manifest.dependencies.length > 0) {
    lines.push(`Key Dependencies: ${manifest.dependencies.slice(0, 15).join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format code graph data for inclusion in the overview prompt
 * @param {Object|null} codeGraph - Code graph from codeGraphStore
 * @returns {string} Formatted text section
 */
function formatCodeGraphForPrompt(codeGraph) {
  if (!codeGraph) return '';

  const lines = ['Code Analysis:'];

  // Stats
  if (codeGraph.stats) {
    lines.push(`- Files: ${codeGraph.stats.totalFiles} total, ${codeGraph.stats.analyzedFiles} analyzed`);
    lines.push(`- Functions/Methods: ${codeGraph.stats.totalSignatures}`);
    lines.push(`- Exports: ${codeGraph.stats.totalExports}`);
    lines.push(`- Dependencies: ${codeGraph.stats.totalEdges} edges`);
    if (codeGraph.stats.circularDeps > 0) {
      lines.push(`- Circular Dependencies: ${codeGraph.stats.circularDeps}`);
    }
  }

  // Module structure
  if (codeGraph.directory?.modules?.length > 0) {
    lines.push('\nModule Structure:');
    for (const mod of codeGraph.directory.modules) {
      const sub = mod.submodules.length > 0 ? ` (${mod.submodules.join(', ')})` : '';
      lines.push(`- ${mod.path}: ${mod.fileCount} files${sub}`);
    }
  }

  // Layers
  if (codeGraph.dependencyGraph?.layers) {
    lines.push('\nArchitectural Layers:');
    for (const [layer, files] of Object.entries(codeGraph.dependencyGraph.layers)) {
      lines.push(`- ${layer}: ${files.length} files`);
    }
  }

  // Entry points
  if (codeGraph.dependencyGraph?.entryPoints?.length > 0) {
    lines.push(`\nEntry Points: ${codeGraph.dependencyGraph.entryPoints.slice(0, 5).join(', ')}`);
  }

  // Build tool
  if (codeGraph.directory?.patterns?.buildTool) {
    lines.push(`\nBuild Tool: ${codeGraph.directory.patterns.buildTool}`);
  }

  // Language breakdown
  if (codeGraph.directory?.stats?.languageBreakdown) {
    lines.push('\nLanguage Distribution:');
    for (const [lang, count] of Object.entries(codeGraph.directory.stats.languageBreakdown).slice(0, 6)) {
      lines.push(`- ${lang}: ${count} files`);
    }
  }

  // Architecture diagram (Mermaid)
  try {
    const { generateLayerDiagram } = require('../analysis/architectureVisualizer');
    if (codeGraph.dependencyGraph) {
      const diagram = generateLayerDiagram(codeGraph.dependencyGraph);
      if (diagram) {
        lines.push(`\nArchitecture Diagram (Mermaid):\n\`\`\`mermaid\n${diagram}\n\`\`\``);
      }
    }
  } catch {
    // architectureVisualizer not available — skip diagram
  }

  return lines.join('\n');
}

/**
 * Estimate tokens
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

module.exports = {
  generateOverview,
  analyzeTechStack
};
