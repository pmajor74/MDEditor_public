/**
 * Auto-Layout Module for Visual Mermaid Editor
 *
 * Uses Dagre library to automatically arrange nodes in a hierarchical layout
 * that matches how Mermaid renders diagrams.
 */

import dagre from 'dagre';
import { getDefaultDimensions } from './shapes.js';

/**
 * Calculate dimensions for a node based on diagram type and content
 */
function getNodeDimensions(node, type) {
  // For class diagrams, calculate actual box size based on content
  if (type === 'classDiagram') {
    const width = 150;
    const lineHeight = 18;
    const padding = 8;
    const headerHeight = 30;

    const attrCount = (node.attributes || []).length;
    const methodCount = (node.methods || []).length;
    const attrHeight = attrCount > 0 ? attrCount * lineHeight + padding * 2 : lineHeight + padding;
    const methodHeight = methodCount > 0 ? methodCount * lineHeight + padding * 2 : lineHeight + padding;
    const totalHeight = headerHeight + attrHeight + methodHeight;

    return { width, height: totalHeight };
  }

  // For ER diagrams, calculate based on attribute count
  if (type === 'erDiagram') {
    const width = 160;
    const lineHeight = 20;
    const headerHeight = 30;
    const padding = 8;

    const attrCount = (node.attributes || []).length;
    const bodyHeight = attrCount > 0 ? attrCount * lineHeight + padding * 2 : lineHeight + padding * 2;
    const totalHeight = headerHeight + bodyHeight;

    return { width, height: totalHeight };
  }

  // Default dimensions for other diagram types
  return getDefaultDimensions(node.shape);
}

/**
 * Apply Dagre auto-layout to the diagram model
 * @param {Object} modelState - The diagram model state { type, direction, nodes, edges }
 * @returns {Object} - Updated model with new node positions
 */
export function applyAutoLayout(modelState) {
  const { nodes, edges, direction, type } = modelState;

  // Skip layout for sequence diagrams (they use different layout logic)
  if (type === 'sequence') {
    return applySequenceLayout(modelState);
  }

  // Skip if no nodes
  if (!nodes || nodes.length === 0) {
    return modelState;
  }

  // Determine layout spacing based on diagram type
  const isClassOrER = type === 'classDiagram' || type === 'erDiagram';
  const nodesep = isClassOrER ? 80 : 50;   // More horizontal spacing for class/ER
  const ranksep = isClassOrER ? 100 : 80;  // More vertical spacing for class/ER

  // Create dagre graph
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: directionToRankdir(direction),
    nodesep,        // horizontal spacing between nodes
    ranksep,        // vertical spacing between ranks
    marginx: 50,    // left/right margin
    marginy: 50,    // top/bottom margin
    edgesep: 20     // spacing between edges
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes with their dimensions (calculate properly for class/ER diagrams)
  nodes.forEach(node => {
    const dims = getNodeDimensions(node, type);
    g.setNode(node.id, {
      width: dims.width,
      height: dims.height,
      label: node.label
    });
  });

  // Add edges
  edges.forEach(edge => {
    g.setEdge(edge.from, edge.to);
  });

  // Run the layout algorithm
  dagre.layout(g);

  // Extract computed positions and update nodes
  const updatedNodes = nodes.map(node => {
    const layoutNode = g.node(node.id);
    if (!layoutNode) {
      // Node wasn't in graph (shouldn't happen, but be safe)
      return node;
    }
    return {
      ...node,
      // Dagre returns center coordinates, convert to top-left
      x: layoutNode.x - layoutNode.width / 2,
      y: layoutNode.y - layoutNode.height / 2
    };
  });

  return {
    ...modelState,
    nodes: updatedNodes
  };
}

/**
 * Apply layout for sequence diagrams
 * Participants are arranged horizontally with better spacing
 */
function applySequenceLayout(modelState) {
  const { nodes } = modelState;

  if (!nodes || nodes.length === 0) {
    return modelState;
  }

  // Arrange participants horizontally with improved spacing
  const startX = 80;
  const startY = 60;
  const spacing = 180;  // More space for participant names

  const updatedNodes = nodes.map((node, index) => ({
    ...node,
    x: startX + (index * spacing),
    y: startY
  }));

  return {
    ...modelState,
    nodes: updatedNodes
  };
}

/**
 * Convert Mermaid direction to Dagre rankdir
 * Mermaid uses: TD (top-down), TB, BT (bottom-top), LR (left-right), RL
 * Dagre uses: TB, BT, LR, RL
 */
function directionToRankdir(direction) {
  const mapping = {
    'TD': 'TB',  // Top-Down -> Top-Bottom
    'TB': 'TB',
    'BT': 'BT',
    'LR': 'LR',
    'RL': 'RL'
  };
  return mapping[direction] || 'TB';
}

/**
 * Check if layout should be applied (has multiple nodes with edges)
 */
export function shouldApplyLayout(modelState) {
  const { nodes, edges } = modelState;
  // Apply layout if we have at least 2 nodes or any edges
  return nodes && (nodes.length >= 2 || (edges && edges.length > 0));
}
