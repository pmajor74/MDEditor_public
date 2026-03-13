/**
 * Canvas Nodes and Edges Rendering
 *
 * Handles creation of node and edge SVG elements.
 */

import { SHAPES, EDGE_TYPES, CLASS_RELATIONSHIP_TYPES, STATE_SHAPES, ER_CARDINALITY_TYPES, SEQUENCE_MESSAGE_TYPES, getDefaultDimensions, getActualNodeDimensions, getShapePath, getShapeBounds, getBestConnectionPoints, getDistributedConnectionPoint, MESSAGE_Y_START, MESSAGE_Y_SPACING } from '../shapes.js';

/**
 * Create a smooth bezier curve path between two points
 * Used for flowcharts and state diagrams to create professional-looking connections
 * @param {number} fromX - Starting X coordinate
 * @param {number} fromY - Starting Y coordinate
 * @param {number} toX - Ending X coordinate
 * @param {number} toY - Ending Y coordinate
 * @param {string} fromSide - Side of source node ('top', 'bottom', 'left', 'right')
 * @param {string} toSide - Side of target node ('top', 'bottom', 'left', 'right')
 * @returns {string} SVG path d attribute
 */
function createBezierPath(fromX, fromY, toX, toY, fromSide, toSide) {
  const dx = toX - fromX;
  const dy = toY - fromY;

  // Calculate control point offset based on distance
  // Longer distances need more curve tension
  const distance = Math.sqrt(dx * dx + dy * dy);
  const tension = Math.min(distance * 0.4, 80); // Cap at 80px for very long edges

  // Determine control points based on connection sides
  let c1x, c1y, c2x, c2y;

  // Set control point 1 based on exit direction from source
  switch (fromSide) {
    case 'top':
      c1x = fromX;
      c1y = fromY - tension;
      break;
    case 'bottom':
      c1x = fromX;
      c1y = fromY + tension;
      break;
    case 'left':
      c1x = fromX - tension;
      c1y = fromY;
      break;
    case 'right':
      c1x = fromX + tension;
      c1y = fromY;
      break;
    default:
      // Fallback: use midpoint-based curve
      c1x = fromX + dx * 0.25;
      c1y = fromY + dy * 0.25;
  }

  // Set control point 2 based on entry direction to target
  switch (toSide) {
    case 'top':
      c2x = toX;
      c2y = toY - tension;
      break;
    case 'bottom':
      c2x = toX;
      c2y = toY + tension;
      break;
    case 'left':
      c2x = toX - tension;
      c2y = toY;
      break;
    case 'right':
      c2x = toX + tension;
      c2y = toY;
      break;
    default:
      // Fallback: use midpoint-based curve
      c2x = fromX + dx * 0.75;
      c2y = fromY + dy * 0.75;
  }

  // Use cubic bezier curve: M start C control1, control2, end
  return `M ${fromX} ${fromY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${toX} ${toY}`;
}

/**
 * Create an orthogonal (right-angle) path between two points
 * Used for ER diagrams to create clean, professional-looking connections
 * @param {number} fromX - Starting X coordinate
 * @param {number} fromY - Starting Y coordinate
 * @param {number} toX - Ending X coordinate
 * @param {number} toY - Ending Y coordinate
 * @param {string} fromSide - Side of source node ('top', 'bottom', 'left', 'right')
 * @param {string} toSide - Side of target node ('top', 'bottom', 'left', 'right')
 * @returns {string} SVG path d attribute
 */
function createOrthogonalPath(fromX, fromY, toX, toY, fromSide, toSide) {
  // For aligned connections (same axis), use a simple line
  const isVerticalConnection = (fromSide === 'bottom' && toSide === 'top') ||
                                (fromSide === 'top' && toSide === 'bottom');
  const isHorizontalConnection = (fromSide === 'right' && toSide === 'left') ||
                                  (fromSide === 'left' && toSide === 'right');

  if (isVerticalConnection && Math.abs(fromX - toX) < 5) {
    // Perfectly aligned vertically - straight line
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }

  if (isHorizontalConnection && Math.abs(fromY - toY) < 5) {
    // Perfectly aligned horizontally - straight line
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }

  // For non-aligned connections, create orthogonal routing
  // Strategy: Use midpoint routing with one or two bends

  if (isVerticalConnection) {
    // Both nodes connect vertically but are offset horizontally
    // Route: go to midpoint Y, then horizontal, then to target
    const midY = (fromY + toY) / 2;
    return `M ${fromX} ${fromY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${toY}`;
  }

  if (isHorizontalConnection) {
    // Both nodes connect horizontally but are offset vertically
    // Route: go to midpoint X, then vertical, then to target
    const midX = (fromX + toX) / 2;
    return `M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`;
  }

  // Mixed connection (e.g., from bottom to left, from right to top)
  // Use L-shaped or Z-shaped routing based on relative positions

  if ((fromSide === 'bottom' || fromSide === 'top') &&
      (toSide === 'left' || toSide === 'right')) {
    // Vertical exit, horizontal entry
    // First go vertically to target's Y level, then horizontally
    return `M ${fromX} ${fromY} L ${fromX} ${toY} L ${toX} ${toY}`;
  }

  if ((fromSide === 'left' || fromSide === 'right') &&
      (toSide === 'top' || toSide === 'bottom')) {
    // Horizontal exit, vertical entry
    // First go horizontally to target's X level, then vertically
    return `M ${fromX} ${fromY} L ${toX} ${fromY} L ${toX} ${toY}`;
  }

  // Fallback: same side connections or edge cases
  // Use Z-shaped routing through midpoint
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;

  if (fromSide === 'bottom' || fromSide === 'top') {
    // Exit vertically first
    return `M ${fromX} ${fromY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${toY}`;
  } else {
    // Exit horizontally first
    return `M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`;
  }
}

/**
 * Create a node SVG element
 * @param {Object} node - Node data
 * @param {Object} ctx - Canvas context
 * @param {boolean} isBottomCopy - When true, creates non-interactive copy (for sequence diagram bottom participants)
 */
export function createNodeElement(node, ctx, isBottomCopy = false) {
  console.log('[canvas-nodes-edges] Creating node element:', node.id, 'isBottomCopy:', isBottomCopy);
  const dims = getDefaultDimensions(node.shape);
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', isBottomCopy ? 'node-group-bottom' : 'node-group');
  if (!isBottomCopy) {
    group.setAttribute('data-node-id', node.id);
  }
  group.setAttribute('transform', `translate(${node.x}, ${node.y})`);

  // Shape path
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', getShapePath(node.shape, 0, 0, dims.width, dims.height));
  path.setAttribute('class', `node-shape ${!isBottomCopy && ctx.state.selectedNodeId === node.id ? 'selected' : ''}`);

  // Label text
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', dims.width / 2);
  text.setAttribute('y', dims.height / 2);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'middle');
  text.setAttribute('class', 'node-label');
  text.textContent = node.label || node.id;

  group.appendChild(path);
  group.appendChild(text);

  // Only add connection points and event handlers for interactive nodes
  if (!isBottomCopy) {
    const connectPoints = createConnectionPoints(node, dims, ctx);
    connectPoints.forEach(cp => group.appendChild(cp));

    // Event handlers
    group.addEventListener('mousedown', (e) => ctx.handlers.handleNodeMouseDown(e, node));
    group.addEventListener('dblclick', (e) => {
      console.log('[DEBUG] dblclick event fired on node group:', node.id);
      ctx.handlers.handleNodeDoubleClick(e, node);
    });
  }

  return group;
}

/**
 * Create a class diagram box with name, attributes, and methods sections
 */
export function createClassBoxElement(node, ctx) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'node-group class-box');
  group.setAttribute('data-node-id', node.id);
  group.setAttribute('transform', `translate(${node.x}, ${node.y})`);

  const width = 150;
  const lineHeight = 18;
  const padding = 8;
  const headerHeight = 30;

  // Calculate heights
  const attrCount = (node.attributes || []).length;
  const methodCount = (node.methods || []).length;
  const attrHeight = attrCount > 0 ? attrCount * lineHeight + padding * 2 : lineHeight + padding;
  const methodHeight = methodCount > 0 ? methodCount * lineHeight + padding * 2 : lineHeight + padding;
  const totalHeight = headerHeight + attrHeight + methodHeight;

  // Main box outline
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  outline.setAttribute('x', 0);
  outline.setAttribute('y', 0);
  outline.setAttribute('width', width);
  outline.setAttribute('height', totalHeight);
  outline.setAttribute('class', `node-shape class-outline ${ctx.state.selectedNodeId === node.id ? 'selected' : ''}`);
  group.appendChild(outline);

  // Header section (class name)
  const headerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  headerRect.setAttribute('x', 0);
  headerRect.setAttribute('y', 0);
  headerRect.setAttribute('width', width);
  headerRect.setAttribute('height', headerHeight);
  headerRect.setAttribute('class', 'class-header');
  group.appendChild(headerRect);

  // Stereotype (if any)
  let nameY = headerHeight / 2;
  if (node.stereotype) {
    const stereoText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    stereoText.setAttribute('x', width / 2);
    stereoText.setAttribute('y', 10);
    stereoText.setAttribute('text-anchor', 'middle');
    stereoText.setAttribute('class', 'class-stereotype');
    stereoText.textContent = `<<${node.stereotype}>>`;
    group.appendChild(stereoText);
    nameY = 22;
  }

  // Class name
  const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  nameText.setAttribute('x', width / 2);
  nameText.setAttribute('y', nameY);
  nameText.setAttribute('text-anchor', 'middle');
  nameText.setAttribute('dominant-baseline', 'middle');
  nameText.setAttribute('class', 'class-name');
  nameText.textContent = node.label || node.id;
  group.appendChild(nameText);

  // Divider line after header
  const divider1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  divider1.setAttribute('x1', 0);
  divider1.setAttribute('y1', headerHeight);
  divider1.setAttribute('x2', width);
  divider1.setAttribute('y2', headerHeight);
  divider1.setAttribute('class', 'class-divider');
  group.appendChild(divider1);

  // Attributes section
  let yPos = headerHeight + padding + lineHeight / 2;
  if (node.attributes && node.attributes.length > 0) {
    node.attributes.forEach(attr => {
      const attrText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      attrText.setAttribute('x', padding);
      attrText.setAttribute('y', yPos);
      attrText.setAttribute('dominant-baseline', 'middle');
      attrText.setAttribute('class', 'class-member');
      attrText.textContent = attr;
      group.appendChild(attrText);
      yPos += lineHeight;
    });
  } else {
    yPos += lineHeight;
  }
  yPos += padding;

  // Divider line after attributes
  const divider2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  divider2.setAttribute('x1', 0);
  divider2.setAttribute('y1', headerHeight + attrHeight);
  divider2.setAttribute('x2', width);
  divider2.setAttribute('y2', headerHeight + attrHeight);
  divider2.setAttribute('class', 'class-divider');
  group.appendChild(divider2);

  // Methods section
  yPos = headerHeight + attrHeight + padding + lineHeight / 2;
  if (node.methods && node.methods.length > 0) {
    node.methods.forEach(method => {
      const methodText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      methodText.setAttribute('x', padding);
      methodText.setAttribute('y', yPos);
      methodText.setAttribute('dominant-baseline', 'middle');
      methodText.setAttribute('class', 'class-member');
      methodText.textContent = method;
      group.appendChild(methodText);
      yPos += lineHeight;
    });
  }

  // Connection points
  const dims = { width, height: totalHeight };
  const connectPoints = createConnectionPoints({ ...node, shape: 'rect' }, dims, ctx);
  connectPoints.forEach(cp => group.appendChild(cp));

  // Event handlers
  group.addEventListener('mousedown', (e) => ctx.handlers.handleNodeMouseDown(e, node));
  group.addEventListener('dblclick', (e) => ctx.handlers.handleNodeDoubleClick(e, node));

  return group;
}

/**
 * Create a state diagram node element
 */
export function createStateNodeElement(node, ctx) {
  // Check for special state types - only use stateType, not id
  // States named "Start" or "End" are just regular states with those labels
  if (node.stateType === 'initial') {
    return createInitialStateElement(node, ctx);
  }
  if (node.stateType === 'final') {
    return createFinalStateElement(node, ctx);
  }
  if (node.stateType === 'fork' || node.stateType === 'join') {
    return createForkJoinElement(node, ctx);
  }
  // Regular state - use rounded rectangle
  return createNodeElement({ ...node, shape: 'rounded' }, ctx);
}

/**
 * Create initial state element (filled black circle)
 */
function createInitialStateElement(node, ctx) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'node-group state-initial');
  group.setAttribute('data-node-id', node.id);
  group.setAttribute('transform', `translate(${node.x}, ${node.y})`);

  const radius = 15;
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', radius);
  circle.setAttribute('cy', radius);
  circle.setAttribute('r', radius);
  circle.setAttribute('class', `state-initial-circle ${ctx.state.selectedNodeId === node.id ? 'selected' : ''}`);
  group.appendChild(circle);

  // Connection points
  const dims = { width: radius * 2, height: radius * 2 };
  const connectPoints = createConnectionPoints({ ...node, shape: 'circle' }, dims, ctx);
  connectPoints.forEach(cp => group.appendChild(cp));

  group.addEventListener('mousedown', (e) => ctx.handlers.handleNodeMouseDown(e, node));
  group.addEventListener('dblclick', (e) => ctx.handlers.handleNodeDoubleClick(e, node));

  return group;
}

/**
 * Create final state element (bullseye - circle in ring)
 */
function createFinalStateElement(node, ctx) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'node-group state-final');
  group.setAttribute('data-node-id', node.id);
  group.setAttribute('transform', `translate(${node.x}, ${node.y})`);

  const outerRadius = 18;
  const innerRadius = 10;
  const cx = outerRadius;
  const cy = outerRadius;

  // Outer ring
  const outerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  outerCircle.setAttribute('cx', cx);
  outerCircle.setAttribute('cy', cy);
  outerCircle.setAttribute('r', outerRadius);
  outerCircle.setAttribute('class', `state-final-outer ${ctx.state.selectedNodeId === node.id ? 'selected' : ''}`);
  group.appendChild(outerCircle);

  // Inner filled circle
  const innerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  innerCircle.setAttribute('cx', cx);
  innerCircle.setAttribute('cy', cy);
  innerCircle.setAttribute('r', innerRadius);
  innerCircle.setAttribute('class', 'state-final-inner');
  group.appendChild(innerCircle);

  // Connection points
  const dims = { width: outerRadius * 2, height: outerRadius * 2 };
  const connectPoints = createConnectionPoints({ ...node, shape: 'circle' }, dims, ctx);
  connectPoints.forEach(cp => group.appendChild(cp));

  group.addEventListener('mousedown', (e) => ctx.handlers.handleNodeMouseDown(e, node));
  group.addEventListener('dblclick', (e) => ctx.handlers.handleNodeDoubleClick(e, node));

  return group;
}

/**
 * Create fork/join bar element
 */
function createForkJoinElement(node, ctx) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'node-group state-fork-join');
  group.setAttribute('data-node-id', node.id);
  group.setAttribute('transform', `translate(${node.x}, ${node.y})`);

  const width = 80;
  const height = 8;

  const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bar.setAttribute('x', 0);
  bar.setAttribute('y', 0);
  bar.setAttribute('width', width);
  bar.setAttribute('height', height);
  bar.setAttribute('class', `state-fork-bar ${ctx.state.selectedNodeId === node.id ? 'selected' : ''}`);
  group.appendChild(bar);

  // Connection points
  const dims = { width, height };
  const connectPoints = createConnectionPoints(node, dims, ctx);
  connectPoints.forEach(cp => group.appendChild(cp));

  group.addEventListener('mousedown', (e) => ctx.handlers.handleNodeMouseDown(e, node));

  return group;
}

/**
 * Create an ER entity box with attribute list
 */
export function createEntityBoxElement(node, ctx) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'node-group entity-box');
  group.setAttribute('data-node-id', node.id);
  group.setAttribute('transform', `translate(${node.x}, ${node.y})`);

  const width = 160;
  const lineHeight = 20;
  const headerHeight = 30;
  const padding = 8;

  const attrCount = (node.attributes || []).length;
  const bodyHeight = attrCount > 0 ? attrCount * lineHeight + padding * 2 : lineHeight + padding * 2;
  const totalHeight = headerHeight + bodyHeight;

  // Main box outline
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  outline.setAttribute('x', 0);
  outline.setAttribute('y', 0);
  outline.setAttribute('width', width);
  outline.setAttribute('height', totalHeight);
  outline.setAttribute('class', `node-shape entity-outline ${ctx.state.selectedNodeId === node.id ? 'selected' : ''}`);
  group.appendChild(outline);

  // Header background
  const headerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  headerRect.setAttribute('x', 0);
  headerRect.setAttribute('y', 0);
  headerRect.setAttribute('width', width);
  headerRect.setAttribute('height', headerHeight);
  headerRect.setAttribute('class', 'entity-header');
  group.appendChild(headerRect);

  // Entity name
  const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  nameText.setAttribute('x', width / 2);
  nameText.setAttribute('y', headerHeight / 2);
  nameText.setAttribute('text-anchor', 'middle');
  nameText.setAttribute('dominant-baseline', 'middle');
  nameText.setAttribute('class', 'entity-name');
  nameText.textContent = node.label || node.id;
  group.appendChild(nameText);

  // Divider
  const divider = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  divider.setAttribute('x1', 0);
  divider.setAttribute('y1', headerHeight);
  divider.setAttribute('x2', width);
  divider.setAttribute('y2', headerHeight);
  divider.setAttribute('class', 'entity-divider');
  group.appendChild(divider);

  // Attributes
  let yPos = headerHeight + padding + lineHeight / 2;
  if (node.attributes && node.attributes.length > 0) {
    node.attributes.forEach(attr => {
      const attrText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      attrText.setAttribute('x', padding);
      attrText.setAttribute('y', yPos);
      attrText.setAttribute('dominant-baseline', 'middle');
      attrText.setAttribute('class', 'entity-attribute');

      // Check for PK/FK markers
      let displayText = attr;
      if (attr.startsWith('PK ') || attr.startsWith('FK ')) {
        const marker = attr.substring(0, 2);
        const markerSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        markerSpan.setAttribute('class', marker === 'PK' ? 'entity-pk' : 'entity-fk');
        markerSpan.textContent = marker + ' ';
        attrText.appendChild(markerSpan);

        const valueSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        valueSpan.textContent = attr.substring(3);
        attrText.appendChild(valueSpan);
      } else {
        attrText.textContent = attr;
      }

      group.appendChild(attrText);
      yPos += lineHeight;
    });
  }

  // Connection points
  const dims = { width, height: totalHeight };
  const connectPoints = createConnectionPoints(node, dims, ctx);
  connectPoints.forEach(cp => group.appendChild(cp));

  group.addEventListener('mousedown', (e) => ctx.handlers.handleNodeMouseDown(e, node));
  group.addEventListener('dblclick', (e) => ctx.handlers.handleNodeDoubleClick(e, node));

  return group;
}

/**
 * Create connection point indicators
 */
export function createConnectionPoints(node, dims, ctx) {
  const points = [];
  const positions = [
    { x: dims.width / 2, y: 0, side: 'top' },
    { x: dims.width / 2, y: dims.height, side: 'bottom' },
    { x: 0, y: dims.height / 2, side: 'left' },
    { x: dims.width, y: dims.height / 2, side: 'right' }
  ];

  positions.forEach(pos => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', pos.x);
    circle.setAttribute('cy', pos.y);
    circle.setAttribute('r', 6);
    circle.setAttribute('class', 'connection-point');
    circle.setAttribute('data-side', pos.side);

    circle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      ctx.handlers.startConnecting(node, pos);
    });

    points.push(circle);
  });

  return points;
}

/**
 * Map UML marker names to SVG marker IDs
 * @param {string} markerName - The semantic marker name
 * @param {boolean} isEnd - True if this is for marker-end (affects direction for triangles)
 */
function getUmlMarkerId(markerName, isEnd = false) {
  // For end markers, use reversed versions for directional markers
  if (isEnd) {
    const endMarkerMap = {
      'hollow-triangle': 'uml-inheritance-end',  // Points toward target
      'filled-diamond': 'uml-composition',
      'hollow-diamond': 'uml-aggregation',
      'arrow': 'arrowhead-end'
    };
    return endMarkerMap[markerName] || null;
  }

  const markerMap = {
    'hollow-triangle': 'uml-inheritance',
    'filled-diamond': 'uml-composition',
    'hollow-diamond': 'uml-aggregation',
    'arrow': 'arrowhead-end'
  };
  return markerMap[markerName] || null;
}

/**
 * Create an edge SVG element
 * @param {Object} edge - Edge data
 * @param {Array} nodes - All nodes
 * @param {Object} ctx - Canvas context
 * @param {number} edgeIndex - Index of this edge
 * @param {string} diagramType - Type of diagram
 * @param {Object} distributionInfo - Optional info for distributing connection points
 */
export function createEdgeElement(edge, nodes, ctx, edgeIndex = 0, diagramType = 'flowchart', distributionInfo = null) {
  const fromNode = nodes.find(n => n.id === edge.from);
  const toNode = nodes.find(n => n.id === edge.to);

  if (!fromNode || !toNode) return null;

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'edge-group');
  group.setAttribute('data-edge-id', edge.id);

  // Get edge type info based on diagram type
  let edgeType;
  if (diagramType === 'classDiagram') {
    edgeType = CLASS_RELATIONSHIP_TYPES[edge.type] || CLASS_RELATIONSHIP_TYPES.association;
  } else if (diagramType === 'sequence') {
    edgeType = SEQUENCE_MESSAGE_TYPES[edge.type] || SEQUENCE_MESSAGE_TYPES.sync;
  } else if (diagramType === 'erDiagram') {
    // ER diagram relationships use solid lines with cardinality markers
    edgeType = { lineStyle: 'solid', name: 'ER Relationship' };
  } else {
    edgeType = EDGE_TYPES[edge.type] || EDGE_TYPES.arrow;
  }

  // Determine line style class
  let lineStyleClass = '';
  if (edgeType.lineStyle === 'dotted' || edgeType.lineStyle === 'dashed') lineStyleClass = 'dashed';
  else if (edgeType.lineStyle === 'thick') lineStyleClass = 'thick';

  let fromX, fromY, toX, toY;
  let isSelfMessage = false;
  let connectionSides = { fromSide: null, toSide: null };

  // For sequence diagrams, render messages as horizontal lines at different Y positions
  if (diagramType === 'sequence') {
    const dims = getDefaultDimensions(fromNode.shape);
    const messageY = MESSAGE_Y_START + (edgeIndex * MESSAGE_Y_SPACING);

    // Check for self-message (from and to are the same participant)
    isSelfMessage = edge.from === edge.to;

    // Message goes from center of fromNode to center of toNode at this Y level
    fromX = fromNode.x + dims.width / 2;
    fromY = messageY;
    toX = toNode.x + dims.width / 2;
    toY = messageY;
  } else {
    // For other diagrams, use the connection points between nodes
    const points = getBestConnectionPoints(fromNode, toNode);
    connectionSides = { fromSide: points.fromSide, toSide: points.toSide };

    // Use distributed connection points for class diagrams, ER diagrams, flowcharts, and state diagrams when multiple edges share a connection
    if ((diagramType === 'classDiagram' || diagramType === 'erDiagram' ||
        diagramType === 'flowchart' || diagramType === 'stateDiagram') && distributionInfo) {
      // Get distributed "from" point if this edge shares a source connection
      if (distributionInfo.fromIndex !== undefined && distributionInfo.fromTotal > 1) {
        const fromPoint = getDistributedConnectionPoint(fromNode, points.fromSide, distributionInfo.fromIndex, distributionInfo.fromTotal);
        fromX = fromPoint.x;
        fromY = fromPoint.y;
      } else {
        fromX = points.from.x;
        fromY = points.from.y;
      }

      // Get distributed "to" point if this edge shares a target connection
      if (distributionInfo.toIndex !== undefined && distributionInfo.toTotal > 1) {
        const toPoint = getDistributedConnectionPoint(toNode, points.toSide, distributionInfo.toIndex, distributionInfo.toTotal);
        toX = toPoint.x;
        toY = toPoint.y;
      } else {
        toX = points.to.x;
        toY = points.to.y;
      }
    } else {
      fromX = points.from.x;
      fromY = points.from.y;
      toX = points.to.x;
      toY = points.to.y;
    }

    // For class diagrams with markers, offset the line endpoints
    // perpendicular to the box edge so markers are visible (not hidden under boxes)
    const hasMarker = edgeType.markerStart || edgeType.markerEnd || edgeType.endArrow || edge.type === 'association-arrow';
    const isERDiagram = diagramType === 'erDiagram';

    if (isERDiagram) {
      // ER diagram markers have refX at attachment point, extending backward
      // Only need minimal offset (2px) to prevent line from overlapping box border
      const erOffset = 2;

      if (points.fromSide === 'bottom') {
        fromY += erOffset;
      } else if (points.fromSide === 'top') {
        fromY -= erOffset;
      } else if (points.fromSide === 'right') {
        fromX += erOffset;
      } else if (points.fromSide === 'left') {
        fromX -= erOffset;
      }

      if (points.toSide === 'bottom') {
        toY += erOffset;
      } else if (points.toSide === 'top') {
        toY -= erOffset;
      } else if (points.toSide === 'right') {
        toX += erOffset;
      } else if (points.toSide === 'left') {
        toX -= erOffset;
      }
    } else if (diagramType === 'classDiagram' && hasMarker) {
      // Class diagram markers need offsets only for markerStart
      // markerStart markers (inheritance, composition, aggregation) extend backward
      // from the line start, so we need 18px offset for the 14px marker + 4px clearance
      const markerStartOffset = 18;

      // Offset based on which side the connection is on (perpendicular to edge)
      if (edgeType.markerStart) {
        // Move start point away from fromNode perpendicular to the connected edge
        if (points.fromSide === 'bottom') {
          fromY += markerStartOffset;
        } else if (points.fromSide === 'top') {
          fromY -= markerStartOffset;
        } else if (points.fromSide === 'right') {
          fromX += markerStartOffset;
        } else if (points.fromSide === 'left') {
          fromX -= markerStartOffset;
        }
      }
      // Note: markerEnd/endArrow markers have their tip at the line end (refX = tip),
      // so NO offset is needed - the arrow tip should touch the target node boundary
    } else if (diagramType === 'flowchart' || diagramType === 'stateDiagram') {
      // Flowchart/state diagram arrows: move endpoint INTO the node boundary
      // This ensures arrow tips touch the node visually
      // Use proportional offsets based on node type and size

      // Get actual dimensions of the target node
      const toNodeDims = getActualNodeDimensions(toNode);

      // Calculate intoNodeOffset based on node type and size
      // The offset needs to account for:
      // 1. The arrowhead marker size (17px wide)
      // 2. Bezier curves approaching at angles (not perpendicular)
      // 3. The arrowhead width when rotated at angles
      let intoNodeOffset;
      if (toNode.stateType === 'initial') {
        // Initial state: small filled circle (30x30) - smaller offset
        intoNodeOffset = 8;
      } else if (toNode.stateType === 'final') {
        // Final state: bullseye circle (36x36) - slightly larger offset
        intoNodeOffset = 9;
      } else if (toNode.stateType === 'fork' || toNode.stateType === 'join') {
        // Fork/join bars (80x8) - small offset for thin bars
        intoNodeOffset = 6;
      } else {
        // Standard nodes (120x60) and all other shapes
        // Larger offset to ensure arrow tips touch node edges cleanly
        intoNodeOffset = 0;
      }

      // Move target endpoint INTO the target node
      if (points.toSide === 'left') {
        toX += intoNodeOffset;  // Move right (into node)
      } else if (points.toSide === 'right') {
        toX -= intoNodeOffset;  // Move left (into node)
      } else if (points.toSide === 'top') {
        toY += intoNodeOffset;  // Move down (into node)
      } else if (points.toSide === 'bottom') {
        toY -= intoNodeOffset;  // Move up (into node)
      }
    }
  }

  // Edge line - different path for self-messages
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  let d;

  if (isSelfMessage) {
    // Self-message: curved loop going right and back
    const loopWidth = 40;
    const loopHeight = 30;
    d = `M ${fromX} ${fromY}
         L ${fromX + loopWidth} ${fromY}
         L ${fromX + loopWidth} ${fromY + loopHeight}
         L ${fromX} ${fromY + loopHeight}`;
    // Update toY for label positioning
    toY = fromY + loopHeight;
  } else if (diagramType === 'erDiagram') {
    // ER diagrams use orthogonal (right-angle) routing for cleaner appearance
    d = createOrthogonalPath(fromX, fromY, toX, toY, connectionSides.fromSide, connectionSides.toSide);
  } else if (diagramType === 'flowchart' || diagramType === 'stateDiagram') {
    // Flowcharts and state diagrams use smooth bezier curves
    d = createBezierPath(fromX, fromY, toX, toY, connectionSides.fromSide, connectionSides.toSide);
  } else if (diagramType === 'classDiagram') {
    // Class diagrams use smooth bezier curves for a professional UML look
    d = createBezierPath(fromX, fromY, toX, toY, connectionSides.fromSide, connectionSides.toSide);
  } else {
    // Fallback for sequence and other diagrams - straight lines
    d = `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }

  path.setAttribute('d', d);
  path.setAttribute('class', `edge-path ${lineStyleClass} ${ctx.state.selectedEdgeId === edge.id ? 'selected' : ''}`);

  // Apply arrow markers based on edge type and diagram type
  if (diagramType === 'classDiagram') {
    // Apply UML markers for class diagrams
    if (edgeType.markerStart) {
      const markerId = getUmlMarkerId(edgeType.markerStart, false);
      if (markerId) {
        path.setAttribute('marker-start', `url(#${markerId})`);
      }
    }
    if (edgeType.markerEnd) {
      const markerId = getUmlMarkerId(edgeType.markerEnd, true);
      if (markerId) {
        path.setAttribute('marker-end', `url(#${markerId})`);
      }
    }
    // Association with arrow needs end marker
    if (edge.type === 'association-arrow' || edgeType.endArrow) {
      path.setAttribute('marker-end', 'url(#arrowhead-end)');
    }
  } else if (diagramType === 'sequence') {
    // Sequence diagram messages always have arrows at the end
    // arrowStyle can be 'filled', 'open', or 'simple' - all get arrowheads
    if (edgeType.arrowStyle) {
      path.setAttribute('marker-end', 'url(#arrowhead-end)');
    }
  } else if (diagramType === 'erDiagram') {
    // Apply ER cardinality markers based on edge.fromCardinality and edge.toCardinality
    const fromCardinality = edge.fromCardinality || 'one';
    const toCardinality = edge.toCardinality || 'many';

    // Map cardinality to marker ID
    const cardinalityToMarker = (cardinality, position) => {
      const cardMap = {
        'one': `er-one-${position}`,
        'zero-one': `er-zero-one-${position}`,
        'many': `er-many-${position}`,
        'one-many': `er-one-many-${position}`,
        'zero-many': `er-zero-many-${position}`
      };
      return cardMap[cardinality] || `er-one-${position}`;
    };

    const startMarkerId = cardinalityToMarker(fromCardinality, 'start');
    const endMarkerId = cardinalityToMarker(toCardinality, 'end');

    path.setAttribute('marker-start', `url(#${startMarkerId})`);
    path.setAttribute('marker-end', `url(#${endMarkerId})`);
  } else {
    // Standard arrow markers for other diagram types
    if (edgeType.endArrow) {
      path.setAttribute('marker-end', 'url(#arrowhead-end)');
    }
    if (edgeType.startArrow) {
      path.setAttribute('marker-start', 'url(#arrowhead-start)');
    }
  }

  // Click target (wider area)
  const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hitArea.setAttribute('d', d);
  hitArea.setAttribute('class', 'edge-hit-area');

  // Append hitArea and path first
  group.appendChild(hitArea);
  group.appendChild(path);

  // Edge label - appended after path so it renders on top of the line
  if (edge.label) {
    let labelX, labelY;

    if (isSelfMessage) {
      // Position label to the right of the self-message loop
      labelX = fromX + 50;
      labelY = fromY + 15;  // Middle of the loop
    } else {
      labelX = (fromX + toX) / 2;
      labelY = (fromY + toY) / 2;  // Position label centered on the line
    }

    const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');

    labelText.setAttribute('x', labelX);
    labelText.setAttribute('y', labelY);
    labelText.setAttribute('text-anchor', isSelfMessage ? 'start' : 'middle');
    labelText.setAttribute('dominant-baseline', 'middle');
    labelText.setAttribute('class', 'edge-label');
    labelText.textContent = edge.label;

    // Background will be sized after text is rendered
    labelBg.setAttribute('class', 'edge-label-bg');
    labelBg.setAttribute('x', labelX - (isSelfMessage ? 5 : 30));
    labelBg.setAttribute('y', labelY - 8);
    labelBg.setAttribute('width', 60);
    labelBg.setAttribute('height', 16);

    group.appendChild(labelBg);
    group.appendChild(labelText);
  }

  // Event handlers
  hitArea.addEventListener('click', (e) => ctx.handlers.handleEdgeClick(e, edge));
  hitArea.addEventListener('dblclick', (e) => ctx.handlers.handleEdgeDoubleClick(e, edge));

  // For sequence diagrams, allow dragging edges to reorder them
  if (diagramType === 'sequence') {
    hitArea.addEventListener('mousedown', (e) => ctx.handlers.handleEdgeMouseDown(e, edge, edgeIndex));
    hitArea.style.cursor = 'grab';

    // Add draggable endpoint handles for sequence diagram messages
    const startHandle = ctx.sequence.createEndpointHandle(fromX, fromY, 'start', edge);
    const endHandle = ctx.sequence.createEndpointHandle(toX, toY, 'end', edge);
    group.appendChild(startHandle);
    group.appendChild(endHandle);
  }

  return group;
}

/**
 * Render all nodes to the nodes layer
 */
export function renderNodes(ctx) {
  ctx.layers.nodes.innerHTML = '';

  const modelState = ctx.model.getState();
  const diagramType = modelState.type;
  const isSequence = diagramType === 'sequence';
  const edgeCount = modelState.edges.length;

  modelState.nodes.forEach(node => {
    let nodeGroup;

    // Use specialized rendering based on diagram type
    if (diagramType === 'classDiagram') {
      nodeGroup = createClassBoxElement(node, ctx);
    } else if (diagramType === 'stateDiagram') {
      nodeGroup = createStateNodeElement(node, ctx);
    } else if (diagramType === 'erDiagram') {
      nodeGroup = createEntityBoxElement(node, ctx);
    } else {
      nodeGroup = createNodeElement(node, ctx);
    }

    ctx.layers.nodes.appendChild(nodeGroup);

    // For sequence diagrams, add bottom participant boxes
    if (isSequence && edgeCount > 0) {
      const lastMessageY = MESSAGE_Y_START + (edgeCount * MESSAGE_Y_SPACING);
      const bottomY = lastMessageY + 20;
      const bottomNode = { ...node, y: bottomY };
      const bottomGroup = createNodeElement(bottomNode, ctx, true); // true = bottom copy (non-interactive)
      ctx.layers.nodes.appendChild(bottomGroup);
    }
  });
}

/**
 * Calculate distribution info for edges that share connection points
 * Used for class diagrams to spread out arrows connecting to the same node
 */
function calculateEdgeDistribution(edges, nodes) {
  const distributionMap = new Map(); // edgeId -> distributionInfo

  // For each node, track which edges connect to it and from which direction
  const nodeConnections = new Map(); // nodeId -> { top: [], bottom: [], left: [], right: [] }

  edges.forEach((edge, index) => {
    const fromNode = nodes.find(n => n.id === edge.from);
    const toNode = nodes.find(n => n.id === edge.to);
    if (!fromNode || !toNode) return;

    // Determine which sides are used for this connection
    // Use getShapeBounds for accurate center calculation (must match getBestConnectionPoints)
    const fromBounds = getShapeBounds(fromNode);
    const toBounds = getShapeBounds(toNode);
    const dx = toBounds.centerX - fromBounds.centerX;
    const dy = toBounds.centerY - fromBounds.centerY;

    let fromSide, toSide;
    if (Math.abs(dx) > Math.abs(dy)) {
      fromSide = dx > 0 ? 'right' : 'left';
      toSide = dx > 0 ? 'left' : 'right';
    } else {
      fromSide = dy > 0 ? 'bottom' : 'top';
      toSide = dy > 0 ? 'top' : 'bottom';
    }

    // Track connections for fromNode
    if (!nodeConnections.has(edge.from)) {
      nodeConnections.set(edge.from, { top: [], bottom: [], left: [], right: [] });
    }
    nodeConnections.get(edge.from)[fromSide].push({ edgeId: edge.id, type: 'from' });

    // Track connections for toNode
    if (!nodeConnections.has(edge.to)) {
      nodeConnections.set(edge.to, { top: [], bottom: [], left: [], right: [] });
    }
    nodeConnections.get(edge.to)[toSide].push({ edgeId: edge.id, type: 'to' });
  });

  // Now calculate distribution indices for each edge
  edges.forEach(edge => {
    const info = { fromIndex: 0, fromTotal: 1, toIndex: 0, toTotal: 1 };

    // Find distribution for the "from" end
    const fromConns = nodeConnections.get(edge.from);
    if (fromConns) {
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const conns = fromConns[side].filter(c => c.type === 'from');
        const idx = conns.findIndex(c => c.edgeId === edge.id);
        if (idx !== -1) {
          info.fromIndex = idx;
          info.fromTotal = conns.length;
          break;
        }
      }
    }

    // Find distribution for the "to" end
    const toConns = nodeConnections.get(edge.to);
    if (toConns) {
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const conns = toConns[side].filter(c => c.type === 'to');
        const idx = conns.findIndex(c => c.edgeId === edge.id);
        if (idx !== -1) {
          info.toIndex = idx;
          info.toTotal = conns.length;
          break;
        }
      }
    }

    distributionMap.set(edge.id, info);
  });

  return distributionMap;
}

/**
 * Render all edges to the edges layer
 */
export function renderEdges(ctx) {
  ctx.layers.edges.innerHTML = '';

  const modelState = ctx.model.getState();
  const diagramType = modelState.type || 'flowchart';

  // Calculate edge distribution for class diagrams, ER diagrams, flowcharts, and state diagrams
  let distributionMap = null;
  if (diagramType === 'classDiagram' || diagramType === 'erDiagram' ||
      diagramType === 'flowchart' || diagramType === 'stateDiagram') {
    distributionMap = calculateEdgeDistribution(modelState.edges, modelState.nodes);
  }

  modelState.edges.forEach((edge, index) => {
    const distributionInfo = distributionMap ? distributionMap.get(edge.id) : null;
    const edgeElement = createEdgeElement(edge, modelState.nodes, ctx, index, diagramType, distributionInfo);
    if (edgeElement) {
      ctx.layers.edges.appendChild(edgeElement);
    }
  });
}

/**
 * Add arrow marker definitions for both directions
 */
export function addArrowMarkers(svg) {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

  // End arrow (pointing right/forward) - refX=18 places the arrow TIP at the line endpoint
  // Arrow path: tip at x=17, back at x=0. Simple triangle design.
  const endMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  endMarker.setAttribute('id', 'arrowhead-end');
  endMarker.setAttribute('markerWidth', '17');
  endMarker.setAttribute('markerHeight', '21');
  endMarker.setAttribute('refX', '18');    // Arrow tip at line endpoint
  endMarker.setAttribute('refY', '10.5');  // Center vertically (21/2)
  endMarker.setAttribute('orient', 'auto');
  endMarker.setAttribute('markerUnits', 'userSpaceOnUse');

  // Simple triangle arrowhead: M 0 0 (top-left) -> L 17 10.5 (tip) -> L 0 21 (bottom-left)
  const endPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  endPath.setAttribute('d', 'M 0 0 L 17 10.5 L 0 21 Z');
  endPath.setAttribute('class', 'arrow-marker');

  endMarker.appendChild(endPath);
  defs.appendChild(endMarker);

  // Start arrow (pointing left/backward) - refX=-1 places the arrow TIP at the line start
  // Arrow path (reversed): tip at x=0, back at x=17. Simple triangle design.
  const startMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  startMarker.setAttribute('id', 'arrowhead-start');
  startMarker.setAttribute('markerWidth', '17');
  startMarker.setAttribute('markerHeight', '21');
  startMarker.setAttribute('refX', '-1');   // Arrow tip at line start (touches source node)
  startMarker.setAttribute('refY', '10.5'); // Center vertically (21/2)
  startMarker.setAttribute('orient', 'auto');
  startMarker.setAttribute('markerUnits', 'userSpaceOnUse');

  // Simple triangle arrowhead (reversed): M 17 0 (top-right) -> L 0 10.5 (tip) -> L 17 21 (bottom-right)
  const startPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  startPath.setAttribute('d', 'M 17 0 L 0 10.5 L 17 21 Z');
  startPath.setAttribute('class', 'arrow-marker');

  startMarker.appendChild(startPath);
  defs.appendChild(startMarker);

  // =============================================
  // UML CLASS DIAGRAM MARKERS
  // =============================================

  // Hollow Triangle (Inheritance/Realization) - pointing at start
  // refX=14 positions the marker so it extends outward from the line start
  const inheritanceMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  inheritanceMarker.setAttribute('id', 'uml-inheritance');
  inheritanceMarker.setAttribute('markerWidth', '14');
  inheritanceMarker.setAttribute('markerHeight', '10');
  inheritanceMarker.setAttribute('refX', '14');
  inheritanceMarker.setAttribute('refY', '5');
  inheritanceMarker.setAttribute('orient', 'auto');
  inheritanceMarker.setAttribute('markerUnits', 'userSpaceOnUse');

  const inheritanceTriangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  inheritanceTriangle.setAttribute('points', '14 0, 0 5, 14 10');
  inheritanceTriangle.setAttribute('class', 'uml-marker-hollow');

  inheritanceMarker.appendChild(inheritanceTriangle);
  defs.appendChild(inheritanceMarker);

  // Hollow Triangle (Realization) - pointing at end (toward target)
  // Used for marker-end to point into the target class
  // refX=14 positions the tip at the line end
  const inheritanceEndMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  inheritanceEndMarker.setAttribute('id', 'uml-inheritance-end');
  inheritanceEndMarker.setAttribute('markerWidth', '14');
  inheritanceEndMarker.setAttribute('markerHeight', '10');
  inheritanceEndMarker.setAttribute('refX', '14');
  inheritanceEndMarker.setAttribute('refY', '5');
  inheritanceEndMarker.setAttribute('orient', 'auto');
  inheritanceEndMarker.setAttribute('markerUnits', 'userSpaceOnUse');

  const inheritanceEndTriangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  // Triangle pointing right (toward target): tip at (14,5), base at x=0
  inheritanceEndTriangle.setAttribute('points', '0 0, 14 5, 0 10');
  inheritanceEndTriangle.setAttribute('class', 'uml-marker-hollow');

  inheritanceEndMarker.appendChild(inheritanceEndTriangle);
  defs.appendChild(inheritanceEndMarker);

  // Filled Diamond (Composition) - pointing at start
  // refX=14 positions the marker so it extends outward from the line start
  const compositionMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  compositionMarker.setAttribute('id', 'uml-composition');
  compositionMarker.setAttribute('markerWidth', '14');
  compositionMarker.setAttribute('markerHeight', '10');
  compositionMarker.setAttribute('refX', '14');
  compositionMarker.setAttribute('refY', '5');
  compositionMarker.setAttribute('orient', 'auto');
  compositionMarker.setAttribute('markerUnits', 'userSpaceOnUse');

  const compositionDiamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  compositionDiamond.setAttribute('points', '7 0, 0 5, 7 10, 14 5');
  compositionDiamond.setAttribute('class', 'uml-marker-filled');

  compositionMarker.appendChild(compositionDiamond);
  defs.appendChild(compositionMarker);

  // Hollow Diamond (Aggregation) - pointing at start
  // refX=14 positions the marker so it extends outward from the line start
  const aggregationMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  aggregationMarker.setAttribute('id', 'uml-aggregation');
  aggregationMarker.setAttribute('markerWidth', '14');
  aggregationMarker.setAttribute('markerHeight', '10');
  aggregationMarker.setAttribute('refX', '14');
  aggregationMarker.setAttribute('refY', '5');
  aggregationMarker.setAttribute('orient', 'auto');
  aggregationMarker.setAttribute('markerUnits', 'userSpaceOnUse');

  const aggregationDiamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  aggregationDiamond.setAttribute('points', '7 0, 0 5, 7 10, 14 5');
  aggregationDiamond.setAttribute('class', 'uml-marker-hollow');

  aggregationMarker.appendChild(aggregationDiamond);
  defs.appendChild(aggregationMarker);

  // =============================================
  // ER DIAGRAM CARDINALITY MARKERS
  // =============================================
  // Geometry designed for orient="auto" - refX at right edge, content extends backward
  // Perpendicular marks span Y dimension, crow's feet converge toward refX

  // One (two perpendicular lines) - creates the || symbol
  // Size: 12x12, refX=12 (attachment at right edge), refY=6 (vertically centered)
  const erOneStart = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  erOneStart.setAttribute('id', 'er-one-start');
  erOneStart.setAttribute('markerWidth', '12');
  erOneStart.setAttribute('markerHeight', '12');
  erOneStart.setAttribute('refX', '12');
  erOneStart.setAttribute('refY', '6');
  erOneStart.setAttribute('orient', 'auto');
  erOneStart.setAttribute('markerUnits', 'userSpaceOnUse');

  const erOneLine1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  erOneLine1.setAttribute('x1', '6');
  erOneLine1.setAttribute('y1', '1');
  erOneLine1.setAttribute('x2', '6');
  erOneLine1.setAttribute('y2', '11');
  erOneLine1.setAttribute('class', 'er-marker');

  const erOneLine2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  erOneLine2.setAttribute('x1', '9');
  erOneLine2.setAttribute('y1', '1');
  erOneLine2.setAttribute('x2', '9');
  erOneLine2.setAttribute('y2', '11');
  erOneLine2.setAttribute('class', 'er-marker');

  erOneStart.appendChild(erOneLine1);
  erOneStart.appendChild(erOneLine2);
  defs.appendChild(erOneStart);

  // Many (crow's foot) - three lines converging to attachment point
  // Size: 12x14, refX=12 (attachment at right edge), refY=7 (vertically centered)
  const erManyStart = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  erManyStart.setAttribute('id', 'er-many-start');
  erManyStart.setAttribute('markerWidth', '12');
  erManyStart.setAttribute('markerHeight', '14');
  erManyStart.setAttribute('refX', '12');
  erManyStart.setAttribute('refY', '7');
  erManyStart.setAttribute('orient', 'auto');
  erManyStart.setAttribute('markerUnits', 'userSpaceOnUse');

  const erManyPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  // From attachment point (12,7) backward to three endpoints
  erManyPath.setAttribute('d', 'M 12 7 L 0 0 M 12 7 L 0 7 M 12 7 L 0 14');
  erManyPath.setAttribute('class', 'er-marker');

  erManyStart.appendChild(erManyPath);
  defs.appendChild(erManyStart);

  // Zero or one (circle + perpendicular line) - creates o| symbol
  // Size: 20x12, refX=20 (attachment at right edge), refY=6 (vertically centered)
  const erZeroOneStart = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  erZeroOneStart.setAttribute('id', 'er-zero-one-start');
  erZeroOneStart.setAttribute('markerWidth', '20');
  erZeroOneStart.setAttribute('markerHeight', '12');
  erZeroOneStart.setAttribute('refX', '20');
  erZeroOneStart.setAttribute('refY', '6');
  erZeroOneStart.setAttribute('orient', 'auto');
  erZeroOneStart.setAttribute('markerUnits', 'userSpaceOnUse');

  // Circle on the left (away from attachment)
  const erZeroOneCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  erZeroOneCircle.setAttribute('cx', '5');
  erZeroOneCircle.setAttribute('cy', '6');
  erZeroOneCircle.setAttribute('r', '4');
  erZeroOneCircle.setAttribute('class', 'er-marker-hollow');

  // Perpendicular line on the right (near attachment)
  const erZeroOneLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  erZeroOneLine.setAttribute('x1', '14');
  erZeroOneLine.setAttribute('y1', '1');
  erZeroOneLine.setAttribute('x2', '14');
  erZeroOneLine.setAttribute('y2', '11');
  erZeroOneLine.setAttribute('class', 'er-marker');

  erZeroOneStart.appendChild(erZeroOneCircle);
  erZeroOneStart.appendChild(erZeroOneLine);
  defs.appendChild(erZeroOneStart);

  // Zero or many (circle + crow's foot) - creates o{ symbol
  // Size: 20x14, refX=20 (attachment at right edge), refY=7 (vertically centered)
  const erZeroManyStart = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  erZeroManyStart.setAttribute('id', 'er-zero-many-start');
  erZeroManyStart.setAttribute('markerWidth', '20');
  erZeroManyStart.setAttribute('markerHeight', '14');
  erZeroManyStart.setAttribute('refX', '20');
  erZeroManyStart.setAttribute('refY', '7');
  erZeroManyStart.setAttribute('orient', 'auto');
  erZeroManyStart.setAttribute('markerUnits', 'userSpaceOnUse');

  // Circle on the left (away from attachment)
  const erZeroManyCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  erZeroManyCircle.setAttribute('cx', '5');
  erZeroManyCircle.setAttribute('cy', '7');
  erZeroManyCircle.setAttribute('r', '4');
  erZeroManyCircle.setAttribute('class', 'er-marker-hollow');

  // Crow's foot converging to attachment point
  const erZeroManyPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  erZeroManyPath.setAttribute('d', 'M 20 7 L 10 0 M 20 7 L 10 7 M 20 7 L 10 14');
  erZeroManyPath.setAttribute('class', 'er-marker');

  erZeroManyStart.appendChild(erZeroManyCircle);
  erZeroManyStart.appendChild(erZeroManyPath);
  defs.appendChild(erZeroManyStart);

  // One or many (perpendicular line + crow's foot) - creates |{ symbol
  // Size: 20x14, refX=20 (attachment at right edge), refY=7 (vertically centered)
  const erOneManyStart = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  erOneManyStart.setAttribute('id', 'er-one-many-start');
  erOneManyStart.setAttribute('markerWidth', '20');
  erOneManyStart.setAttribute('markerHeight', '14');
  erOneManyStart.setAttribute('refX', '20');
  erOneManyStart.setAttribute('refY', '7');
  erOneManyStart.setAttribute('orient', 'auto');
  erOneManyStart.setAttribute('markerUnits', 'userSpaceOnUse');

  // Perpendicular line on the left
  const erOneManyLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  erOneManyLine.setAttribute('x1', '4');
  erOneManyLine.setAttribute('y1', '1');
  erOneManyLine.setAttribute('x2', '4');
  erOneManyLine.setAttribute('y2', '13');
  erOneManyLine.setAttribute('class', 'er-marker');

  // Crow's foot converging to attachment point
  const erOneManyPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  erOneManyPath.setAttribute('d', 'M 20 7 L 10 0 M 20 7 L 10 7 M 20 7 L 10 14');
  erOneManyPath.setAttribute('class', 'er-marker');

  erOneManyStart.appendChild(erOneManyLine);
  erOneManyStart.appendChild(erOneManyPath);
  defs.appendChild(erOneManyStart);

  // Create end markers - same geometry, refX at right edge works for both
  // orient="auto" handles flipping for opposite line directions
  ['one', 'many', 'zero-one', 'zero-many', 'one-many'].forEach(type => {
    const startMarker = defs.querySelector(`#er-${type}-start`);
    if (startMarker) {
      const endMarker = startMarker.cloneNode(true);
      endMarker.setAttribute('id', `er-${type}-end`);
      // End markers use same refX - orient="auto" handles direction
      defs.appendChild(endMarker);
    }
  });

  svg.insertBefore(defs, svg.firstChild);
}
