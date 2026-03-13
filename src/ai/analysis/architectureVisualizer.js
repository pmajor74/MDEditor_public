/**
 * Architecture Visualizer
 *
 * Generates Mermaid diagram source code from the dependency graph.
 * Pure static generation — no LLM calls needed.
 */

/**
 * Generate a full project architecture diagram in Mermaid
 * @param {Object} graph - Dependency graph from dependencyGraph.js
 * @returns {string} Mermaid diagram source
 */
function generateArchitectureDiagram(graph) {
  if (!graph || !graph.layers || Object.keys(graph.layers).length === 0) {
    return null;
  }

  const lines = ['graph TD'];

  // Group nodes into subgraphs by layer
  for (const [layer, files] of Object.entries(graph.layers)) {
    const layerId = sanitizeId(layer);

    // Only create subgraph for layers with > 1 file
    if (files.length > 1) {
      lines.push(`  subgraph ${layerId}["${escapeLabel(layer)}"]`);
      for (const file of files.slice(0, 15)) { // Limit files per layer
        const nodeId = sanitizeId(file);
        const label = getShortLabel(file);
        lines.push(`    ${nodeId}["${escapeLabel(label)}"]`);
      }
      if (files.length > 15) {
        lines.push(`    ${layerId}_more["... +${files.length - 15} more"]`);
      }
      lines.push('  end');
    } else if (files.length === 1) {
      const nodeId = sanitizeId(files[0]);
      const label = getShortLabel(files[0]);
      lines.push(`  ${nodeId}["${escapeLabel(label)}"]`);
    }
  }

  // Add edges (limit to avoid diagram clutter)
  const addedEdges = new Set();
  let edgeCount = 0;

  for (const edge of graph.edges) {
    if (edgeCount >= 40) break; // Max edges for readability

    const fromId = sanitizeId(edge.from);
    const toId = sanitizeId(edge.to);
    const edgeKey = `${fromId}-${toId}`;

    // Skip duplicate edges
    if (addedEdges.has(edgeKey)) continue;
    addedEdges.add(edgeKey);

    // Only show edges if both nodes are in the diagram
    const fromExists = hasNode(graph.layers, edge.from);
    const toExists = hasNode(graph.layers, edge.to);
    if (!fromExists || !toExists) continue;

    const label = edge.symbols.length > 0 && edge.symbols.length <= 3
      ? `|"${edge.symbols.join(', ')}"|`
      : '';

    lines.push(`  ${fromId} -->${label} ${toId}`);
    edgeCount++;
  }

  return lines.join('\n');
}

/**
 * Generate a zoomed-in diagram for a single module
 * @param {string} moduleName - Module/layer name
 * @param {Object} graph - Dependency graph
 * @returns {string|null} Mermaid diagram source or null
 */
function generateModuleDiagram(moduleName, graph) {
  if (!graph || !graph.layers || !graph.layers[moduleName]) {
    return null;
  }

  const moduleFiles = new Set(graph.layers[moduleName]);
  const lines = ['graph LR'];

  // Add all files in this module
  lines.push(`  subgraph ${sanitizeId(moduleName)}["${escapeLabel(moduleName)}"]`);
  for (const file of moduleFiles) {
    const nodeId = sanitizeId(file);
    const label = getShortLabel(file);
    const node = graph.nodes[file];
    const exports = node?.exports?.length > 0
      ? `<br/><small>${node.exports.slice(0, 3).join(', ')}${node.exports.length > 3 ? '...' : ''}</small>`
      : '';
    lines.push(`    ${nodeId}["${escapeLabel(label)}${exports}"]`);
  }
  lines.push('  end');

  // Add external nodes that connect to this module
  const externalNodes = new Set();
  const moduleEdges = graph.edges.filter(e =>
    moduleFiles.has(e.from) || moduleFiles.has(e.to)
  );

  for (const edge of moduleEdges) {
    if (!moduleFiles.has(edge.from)) externalNodes.add(edge.from);
    if (!moduleFiles.has(edge.to)) externalNodes.add(edge.to);
  }

  // Add external nodes
  if (externalNodes.size > 0) {
    lines.push(`  subgraph external["External"]`);
    for (const ext of [...externalNodes].slice(0, 10)) {
      lines.push(`    ${sanitizeId(ext)}["${escapeLabel(getShortLabel(ext))}"]:::external`);
    }
    lines.push('  end');
  }

  // Add edges
  for (const edge of moduleEdges.slice(0, 30)) {
    const fromId = sanitizeId(edge.from);
    const toId = sanitizeId(edge.to);
    lines.push(`  ${fromId} --> ${toId}`);
  }

  // Style external nodes
  lines.push('  classDef external fill:#f5f5f5,stroke:#ccc,color:#999');

  return lines.join('\n');
}

/**
 * Generate a simple layer-level overview diagram
 * @param {Object} graph - Dependency graph
 * @returns {string|null} Mermaid diagram source
 */
function generateLayerDiagram(graph) {
  if (!graph || !graph.layers || Object.keys(graph.layers).length === 0) {
    return null;
  }

  const lines = ['graph TD'];

  // Create a node for each layer
  for (const [layer, files] of Object.entries(graph.layers)) {
    const layerId = sanitizeId(`layer_${layer}`);
    lines.push(`  ${layerId}["${escapeLabel(layer)}<br/>${files.length} files"]`);
  }

  // Create edges between layers based on inter-layer dependencies
  const layerEdges = new Map();
  for (const edge of graph.edges) {
    const fromLayer = graph.nodes[edge.from]?.layer;
    const toLayer = graph.nodes[edge.to]?.layer;
    if (fromLayer && toLayer && fromLayer !== toLayer) {
      const key = `${fromLayer}->${toLayer}`;
      layerEdges.set(key, (layerEdges.get(key) || 0) + 1);
    }
  }

  for (const [key, count] of layerEdges) {
    const [from, to] = key.split('->');
    const fromId = sanitizeId(`layer_${from}`);
    const toId = sanitizeId(`layer_${to}`);
    const label = count > 1 ? `|"${count} deps"|` : '';
    lines.push(`  ${fromId} -->${label} ${toId}`);
  }

  return lines.join('\n');
}

// ============================================
// Utilities
// ============================================

function sanitizeId(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function escapeLabel(str) {
  return str.replace(/"/g, "'").replace(/[<>]/g, '');
}

function getShortLabel(filePath) {
  const parts = filePath.split('/');
  if (parts.length <= 2) return filePath;
  return parts.slice(-2).join('/');
}

function hasNode(layers, filePath) {
  for (const files of Object.values(layers)) {
    if (files.includes(filePath)) return true;
    // Check truncated (first 15 files per layer)
    if (files.slice(0, 15).includes(filePath)) return true;
  }
  return false;
}

module.exports = {
  generateArchitectureDiagram,
  generateModuleDiagram,
  generateLayerDiagram
};
