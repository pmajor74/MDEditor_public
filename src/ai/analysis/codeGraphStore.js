/**
 * Code Graph Store & Orchestration
 *
 * Orchestrates running all static analysis phases (import/export extraction,
 * signature extraction, directory analysis, dependency graph construction)
 * and persists results as JSON. Also injects searchable summary chunks
 * into LanceDB for RAG queries.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const { extractImportsExports, isExtractionSupported } = require('./importExportExtractor');
const { extractSignatures, isSignatureSupported } = require('./signatureExtractor');
const { analyzeDirectoryStructure } = require('./directoryAnalyzer');
const { buildDependencyGraph, getFileMetrics } = require('./dependencyGraph');

// Storage directory (lazy-initialized)
let storagePath = null;

/**
 * Initialize the storage path
 * @param {string} [basePath] - Override base path (uses userData by default)
 */
function initStorage(basePath) {
  if (basePath) {
    storagePath = path.join(basePath, 'code-graphs');
  } else {
    try {
      const { app } = require('electron');
      storagePath = path.join(app.getPath('userData'), 'code-graphs');
    } catch {
      storagePath = path.join(process.cwd(), '.code-graphs');
    }
  }
}

function getStoragePath() {
  if (!storagePath) initStorage();
  return storagePath;
}

/**
 * Build a complete code graph for a catalog
 * @param {Object} options - Build options
 * @param {string} options.catalogName - Catalog name
 * @param {string[]} options.rootPaths - Root paths to analyze
 * @param {string[]} options.extensions - File extensions to include
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<Object>} Code graph
 */
async function buildCodeGraph(options) {
  const { catalogName, rootPaths, extensions, onProgress = () => {} } = options;

  console.log(`[CodeGraph] Building code graph for "${catalogName}"`);
  const startTime = Date.now();

  // Phase 1: Discover files
  onProgress({ phase: 'scanning', message: 'Scanning files for analysis...' });
  const files = await discoverFiles(rootPaths, extensions);
  console.log(`[CodeGraph] Found ${files.length} files to analyze`);

  // Phase 2: Directory structure analysis (fast, no AST parsing)
  onProgress({ phase: 'directory', message: 'Analyzing directory structure...' });
  const directoryAnalysis = await analyzeDirectoryStructure(rootPaths, { extensions });

  // Phase 3: Import/Export and Signature extraction (AST-based)
  onProgress({ phase: 'ast', message: 'Extracting imports, exports, and signatures...' });
  const fileAnalyses = [];
  const allSignatures = [];
  let analyzedCount = 0;

  for (const file of files) {
    try {
      const content = await fs.readFile(file.path, 'utf-8');

      // Extract imports/exports
      if (isExtractionSupported(file.path)) {
        const analysis = await extractImportsExports(content, file.path);
        if (analysis) fileAnalyses.push(analysis);
      }

      // Extract signatures
      if (isSignatureSupported(file.path)) {
        const sigs = await extractSignatures(content, file.path);
        if (sigs) allSignatures.push(...sigs);
      }

      analyzedCount++;
      if (analyzedCount % 20 === 0) {
        onProgress({
          phase: 'ast',
          message: `Analyzing files... (${analyzedCount}/${files.length})`,
          progress: Math.round((analyzedCount / files.length) * 100)
        });
      }
    } catch (err) {
      console.warn(`[CodeGraph] Error analyzing ${file.path}:`, err.message);
    }
  }

  console.log(`[CodeGraph] Analyzed ${fileAnalyses.length} files for imports/exports, found ${allSignatures.length} signatures`);

  // Phase 4: Build dependency graph
  onProgress({ phase: 'graph', message: 'Building dependency graph...' });
  const dependencyGraph = buildDependencyGraph(fileAnalyses, rootPaths);

  // Assemble complete code graph
  const codeGraph = {
    catalogName,
    buildTimestamp: new Date().toISOString(),
    buildDurationMs: Date.now() - startTime,
    rootPaths: rootPaths.map(r => r.replace(/\\/g, '/')),
    directory: directoryAnalysis,
    dependencyGraph,
    signatures: allSignatures,
    stats: {
      totalFiles: files.length,
      analyzedFiles: fileAnalyses.length,
      totalSignatures: allSignatures.length,
      totalExports: Object.values(dependencyGraph.nodes).reduce((sum, n) => sum + n.exports.length, 0),
      totalEdges: dependencyGraph.edges.length,
      circularDeps: dependencyGraph.circularDeps.length,
      layers: Object.keys(dependencyGraph.layers).length
    }
  };

  // Save to disk
  onProgress({ phase: 'saving', message: 'Saving code graph...' });
  await saveCodeGraph(catalogName, codeGraph);

  console.log(`[CodeGraph] Built code graph in ${Date.now() - startTime}ms — ` +
    `${codeGraph.stats.analyzedFiles} files, ${codeGraph.stats.totalSignatures} signatures, ` +
    `${codeGraph.stats.totalEdges} edges`);

  return codeGraph;
}

/**
 * Generate searchable summary chunks from the code graph for LanceDB injection
 * @param {Object} codeGraph - The code graph
 * @returns {Array<Object>} Documents for LanceDB
 */
function generateSearchableChunks(codeGraph) {
  const documents = [];
  const { dependencyGraph, signatures, directory, catalogName } = codeGraph;

  // 1. One chunk per exported function with full signature
  for (const sig of signatures) {
    if (!sig.isExported) continue;

    const paramStr = sig.parameters
      .map(p => p.type ? `${p.name}: ${p.type}` : p.name)
      .join(', ');
    const returnStr = sig.returnType ? ` → ${sig.returnType}` : '';
    const asyncStr = sig.isAsync ? 'async ' : '';
    const summaryStr = sig.jsdocSummary ? `\n${sig.jsdocSummary}` : '';

    const text = `[API: ${sig.filePath}:${sig.startLine}]\n` +
      `${asyncStr}${sig.kind} ${sig.name}(${paramStr})${returnStr}${summaryStr}`;

    const id = `api_${crypto.createHash('md5').update(`${sig.filePath}:${sig.name}`).digest('hex').substring(0, 10)}`;

    documents.push({
      id,
      text,
      metadata: {
        structureType: 'api_signature',
        fileType: 'generated',
        fileName: path.basename(sig.filePath),
        filePath: sig.filePath,
        functionName: sig.name,
        startLine: sig.startLine,
        isAsync: sig.isAsync,
        searchBoost: 1.3
      }
    });
  }

  // 2. Dependency summary per module/layer
  for (const [layer, files] of Object.entries(dependencyGraph.layers)) {
    const fileDetails = files.map(f => {
      const node = dependencyGraph.nodes[f];
      if (!node) return null;
      const exports = node.exports.length > 0 ? ` (exports: ${node.exports.join(', ')})` : '';
      return `  - ${f}${exports}`;
    }).filter(Boolean);

    if (fileDetails.length === 0) continue;

    const incomingEdges = dependencyGraph.edges.filter(e => files.includes(e.to));
    const outgoingEdges = dependencyGraph.edges.filter(e => files.includes(e.from));

    const text = `[Module: ${layer}]\n` +
      `Files (${fileDetails.length}):\n${fileDetails.join('\n')}\n\n` +
      `Dependencies: ${outgoingEdges.length} outgoing, ${incomingEdges.length} incoming`;

    const id = `module_${crypto.createHash('md5').update(layer).digest('hex').substring(0, 10)}`;

    documents.push({
      id,
      text,
      metadata: {
        structureType: 'module_summary',
        fileType: 'generated',
        fileName: `Module: ${layer}`,
        layer,
        searchBoost: 1.2
      }
    });
  }

  // 3. Architecture overview chunk
  const archText = generateArchitectureOverviewText(codeGraph);
  if (archText) {
    documents.push({
      id: 'architecture_overview',
      text: archText,
      metadata: {
        structureType: 'architecture_overview',
        fileType: 'generated',
        fileName: 'Architecture Overview',
        searchBoost: 1.5
      }
    });
  }

  return documents;
}

/**
 * Generate the architecture overview text
 */
function generateArchitectureOverviewText(codeGraph) {
  const { dependencyGraph, directory, stats } = codeGraph;
  const lines = ['[Architecture Overview]'];

  // Project stats
  lines.push(`\nProject Structure: ${stats.totalFiles} files, ${stats.analyzedFiles} analyzed`);
  lines.push(`API Surface: ${stats.totalSignatures} functions/methods, ${stats.totalExports} exports`);
  lines.push(`Dependency Graph: ${stats.totalEdges} edges, ${stats.layers} layers`);

  if (stats.circularDeps > 0) {
    lines.push(`Circular Dependencies: ${stats.circularDeps} detected`);
  }

  // Layers
  lines.push('\nLayers:');
  for (const [layer, files] of Object.entries(dependencyGraph.layers)) {
    lines.push(`  ${layer}: ${files.length} files`);
  }

  // Entry points
  if (dependencyGraph.entryPoints.length > 0) {
    lines.push('\nEntry Points:');
    for (const ep of dependencyGraph.entryPoints.slice(0, 10)) {
      lines.push(`  - ${ep}`);
    }
  }

  // Modules
  if (directory.modules.length > 0) {
    lines.push('\nModules:');
    for (const mod of directory.modules) {
      const sub = mod.submodules.length > 0 ? ` (submodules: ${mod.submodules.join(', ')})` : '';
      lines.push(`  ${mod.path}: ${mod.fileCount} files${sub}`);
    }
  }

  // Build tool and tech
  if (directory.patterns.buildTool) {
    lines.push(`\nBuild Tool: ${directory.patterns.buildTool}`);
  }

  // Language breakdown
  if (directory.stats.languageBreakdown) {
    lines.push('\nLanguages:');
    for (const [lang, count] of Object.entries(directory.stats.languageBreakdown).slice(0, 8)) {
      lines.push(`  ${lang}: ${count} files`);
    }
  }

  return lines.join('\n');
}

/**
 * Save a code graph to disk
 */
async function saveCodeGraph(catalogName, codeGraph) {
  const dir = getStoragePath();

  try {
    await fs.mkdir(dir, { recursive: true });
  } catch { /* exists */ }

  const filePath = path.join(dir, `${sanitizeFilename(catalogName)}.json`);
  await fs.writeFile(filePath, JSON.stringify(codeGraph, null, 2), 'utf-8');
  console.log(`[CodeGraph] Saved to ${filePath}`);
}

/**
 * Load a code graph from disk
 * @param {string} catalogName - Catalog name
 * @returns {Promise<Object|null>} Code graph or null
 */
async function loadCodeGraph(catalogName) {
  const dir = getStoragePath();
  const filePath = path.join(dir, `${sanitizeFilename(catalogName)}.json`);

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Delete a code graph
 * @param {string} catalogName - Catalog name
 */
async function deleteCodeGraph(catalogName) {
  const dir = getStoragePath();
  const filePath = path.join(dir, `${sanitizeFilename(catalogName)}.json`);

  try {
    await fs.unlink(filePath);
    console.log(`[CodeGraph] Deleted graph for "${catalogName}"`);
  } catch { /* not found */ }
}

/**
 * Incrementally update a code graph for changed files
 * @param {string} catalogName - Catalog name
 * @param {string[]} changedFiles - Paths of changed/new files
 * @param {string[]} rootPaths - Project root paths
 * @param {string[]} extensions - File extensions
 * @returns {Promise<Object>} Updated code graph
 */
async function incrementalUpdate(catalogName, changedFiles, rootPaths, extensions) {
  console.log(`[CodeGraph] Incremental update for "${catalogName}" — ${changedFiles.length} changed files`);

  const existing = await loadCodeGraph(catalogName);
  if (!existing) {
    // No existing graph, do full build
    return buildCodeGraph({ catalogName, rootPaths, extensions });
  }

  // Re-analyze changed files
  const updatedAnalyses = [];
  const updatedSignatures = [];

  for (const filePath of changedFiles) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (isExtractionSupported(filePath)) {
        const analysis = await extractImportsExports(content, filePath);
        if (analysis) updatedAnalyses.push(analysis);
      }

      if (isSignatureSupported(filePath)) {
        const sigs = await extractSignatures(content, filePath);
        if (sigs) updatedSignatures.push(...sigs);
      }
    } catch (err) {
      console.warn(`[CodeGraph] Error re-analyzing ${filePath}:`, err.message);
    }
  }

  // Merge: remove old data for changed files, add new data
  const changedSet = new Set(changedFiles.map(f => f.replace(/\\/g, '/')));

  // Filter out old signatures for changed files
  const keptSignatures = existing.signatures.filter(s => !changedSet.has(s.filePath));
  const mergedSignatures = [...keptSignatures, ...updatedSignatures];

  // Rebuild dependency graph with merged analyses
  // We need all file analyses, not just changed ones — load from existing graph
  // For simplicity, do a full rebuild of the dependency graph
  const fullGraph = await buildCodeGraph({ catalogName, rootPaths, extensions });
  return fullGraph;
}

// ============================================
// File Discovery
// ============================================

const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'target', 'bin', 'obj',
  '.next', '.nuxt', '.cache', 'coverage', 'vendor'
]);

async function discoverFiles(rootPaths, extensions) {
  const extensionSet = new Set(extensions.map(e => e.startsWith('.') ? e : `.${e}`));
  const files = [];

  async function scan(dirPath) {
    const dirName = path.basename(dirPath);
    if (SKIP_DIRS.has(dirName) || dirName.startsWith('.')) return;

    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await scan(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensionSet.size === 0 || extensionSet.has(ext)) {
          files.push({ path: fullPath, name: entry.name, ext });
        }
      }
    }
  }

  for (const rootPath of rootPaths) {
    await scan(rootPath);
  }

  return files;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

module.exports = {
  buildCodeGraph,
  generateSearchableChunks,
  loadCodeGraph,
  saveCodeGraph,
  deleteCodeGraph,
  incrementalUpdate,
  initStorage
};
