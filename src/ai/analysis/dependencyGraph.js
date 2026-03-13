/**
 * Dependency Graph Builder
 *
 * Consumes per-file import/export data from importExportExtractor.js
 * and builds a project-wide directed dependency graph.
 */

const path = require('path');

/**
 * Build a project-wide dependency graph from per-file import/export data
 * @param {Array<Object>} fileAnalyses - Array of extractImportsExports results
 * @param {string[]} rootPaths - Project root paths
 * @returns {Object} Dependency graph
 */
function buildDependencyGraph(fileAnalyses, rootPaths) {
  const nodes = {};
  const edges = [];
  const fileMap = new Map(); // normalized path -> analysis

  // Normalize root paths
  const normalizedRoots = rootPaths.map(r => r.replace(/\\/g, '/'));

  // Index all files
  for (const analysis of fileAnalyses) {
    if (!analysis) continue;
    const normPath = normalizePath(analysis.filePath, normalizedRoots);
    fileMap.set(normPath, analysis);

    nodes[normPath] = {
      exports: analysis.exports.map(e => e.name),
      importCount: analysis.imports.length,
      importedByCount: 0,
      layer: inferLayer(normPath)
    };
  }

  // Build edges from import relationships
  for (const analysis of fileAnalyses) {
    if (!analysis) continue;
    const fromPath = normalizePath(analysis.filePath, normalizedRoots);

    for (const imp of analysis.imports) {
      const resolvedPath = resolveImportPath(imp.source, analysis.filePath, fileMap, normalizedRoots);
      if (!resolvedPath) continue;

      // Only add edges for project-internal imports
      if (!nodes[resolvedPath]) continue;

      edges.push({
        from: fromPath,
        to: resolvedPath,
        symbols: imp.symbols.filter(s => s !== '*')
      });

      // Increment importedBy count
      nodes[resolvedPath].importedByCount++;
    }
  }

  // Compute layers
  const layers = computeLayers(nodes);

  // Detect entry points (files with zero importers)
  const entryPoints = Object.keys(nodes)
    .filter(p => nodes[p].importedByCount === 0)
    .sort();

  // Detect circular dependencies
  const circularDeps = detectCircularDeps(edges);

  return {
    nodes,
    edges,
    layers,
    entryPoints,
    circularDeps
  };
}

/**
 * Normalize a file path to be project-relative
 */
function normalizePath(filePath, rootPaths) {
  const normalized = filePath.replace(/\\/g, '/');

  for (const root of rootPaths) {
    if (normalized.startsWith(root + '/')) {
      return normalized.substring(root.length + 1);
    }
    // Handle case-insensitive on Windows
    if (normalized.toLowerCase().startsWith(root.toLowerCase() + '/')) {
      return normalized.substring(root.length + 1);
    }
  }

  return normalized;
}

/**
 * Resolve an import source to a project-relative file path
 */
function resolveImportPath(source, importerPath, fileMap, rootPaths) {
  if (!source) return null;

  // Skip external packages (no relative path prefix)
  if (!source.startsWith('.') && !source.startsWith('/')) {
    return null;
  }

  // Resolve relative to the importer's directory
  const importerDir = path.dirname(importerPath).replace(/\\/g, '/');
  let resolved = path.resolve(importerDir, source).replace(/\\/g, '/');

  // Normalize against root paths
  const normResolved = normalizePath(resolved, rootPaths);

  // Try exact match first
  if (fileMap.has(normResolved)) return normResolved;

  // Try with common extensions
  const extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs'];
  for (const ext of extensions) {
    const withExt = normResolved + ext;
    if (fileMap.has(withExt)) return withExt;
  }

  // Try index files
  const indexFiles = ['index.js', 'index.ts', 'index.jsx', 'index.tsx', 'mod.rs', '__init__.py'];
  for (const indexFile of indexFiles) {
    const withIndex = normResolved + '/' + indexFile;
    if (fileMap.has(withIndex)) return withIndex;
  }

  return null;
}

/**
 * Infer the architectural layer from the file path
 */
function inferLayer(filePath) {
  const parts = filePath.split('/');

  // Use the first meaningful directory segment
  if (parts.length >= 2 && parts[0] === 'src') {
    return parts[1];
  }
  if (parts.length >= 1) {
    // Top-level files belong to "root" layer
    if (parts.length === 1) return 'root';
    return parts[0];
  }

  return 'root';
}

/**
 * Group nodes into layers
 */
function computeLayers(nodes) {
  const layers = {};

  for (const [filePath, nodeData] of Object.entries(nodes)) {
    const layer = nodeData.layer;
    if (!layers[layer]) {
      layers[layer] = [];
    }
    layers[layer].push(filePath);
  }

  // Sort files within each layer
  for (const layer of Object.keys(layers)) {
    layers[layer].sort();
  }

  return layers;
}

/**
 * Detect circular dependencies using DFS
 */
function detectCircularDeps(edges) {
  // Build adjacency list
  const adj = new Map();
  for (const edge of edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from).push(edge.to);
  }

  const visited = new Set();
  const inStack = new Set();
  const cycles = [];

  function dfs(node, path) {
    if (inStack.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node);
      if (cycleStart >= 0) {
        cycles.push(path.slice(cycleStart).concat(node));
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const neighbors = adj.get(node) || [];
    for (const neighbor of neighbors) {
      dfs(neighbor, path);
    }

    path.pop();
    inStack.delete(node);
  }

  for (const node of adj.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  // Deduplicate cycles (normalize by sorting)
  const seen = new Set();
  const unique = [];
  for (const cycle of cycles) {
    const key = [...cycle].sort().join(' -> ');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(cycle);
    }
  }

  return unique;
}

/**
 * Get fan-in/fan-out metrics for a file
 * @param {string} filePath - Project-relative file path
 * @param {Object} graph - Dependency graph
 * @returns {Object} Metrics
 */
function getFileMetrics(filePath, graph) {
  const node = graph.nodes[filePath];
  if (!node) return null;

  const fanOut = graph.edges.filter(e => e.from === filePath).length;
  const fanIn = graph.edges.filter(e => e.to === filePath).length;

  return {
    fanIn,
    fanOut,
    exports: node.exports.length,
    layer: node.layer,
    isEntryPoint: graph.entryPoints.includes(filePath)
  };
}

/**
 * Get all files that depend on (import from) a given file
 * @param {string} filePath - Project-relative file path
 * @param {Object} graph - Dependency graph
 * @returns {Array<string>} Importing file paths
 */
function getDependants(filePath, graph) {
  return graph.edges
    .filter(e => e.to === filePath)
    .map(e => e.from);
}

/**
 * Get all files that a given file depends on (imports)
 * @param {string} filePath - Project-relative file path
 * @param {Object} graph - Dependency graph
 * @returns {Array<string>} Imported file paths
 */
function getDependencies(filePath, graph) {
  return graph.edges
    .filter(e => e.from === filePath)
    .map(e => e.to);
}

module.exports = {
  buildDependencyGraph,
  getFileMetrics,
  getDependants,
  getDependencies
};
