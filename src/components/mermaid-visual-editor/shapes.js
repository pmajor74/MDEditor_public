/**
 * Node Shape Definitions for Visual Mermaid Editor
 *
 * Defines the visual appearance and SVG paths for different node shapes.
 */

/**
 * Shape definitions with display name and icon
 */
export const SHAPES = {
  rect: {
    name: 'Rectangle',
    icon: '▢',
    description: 'Standard rectangle node'
  },
  rounded: {
    name: 'Rounded',
    icon: '⬭',
    description: 'Rounded rectangle'
  },
  diamond: {
    name: 'Diamond',
    icon: '◇',
    description: 'Decision/condition node'
  },
  circle: {
    name: 'Circle',
    icon: '○',
    description: 'Circular node'
  },
  stadium: {
    name: 'Stadium',
    icon: '⬬',
    description: 'Stadium/pill shape'
  },
  hexagon: {
    name: 'Hexagon',
    icon: '⬡',
    description: 'Hexagonal node'
  },
  parallelogram: {
    name: 'Parallelogram',
    icon: '▱',
    description: 'Input/output node'
  },
  'parallelogram-alt': {
    name: 'Parallelogram Alt',
    icon: '▰',
    description: 'Alternative parallelogram (reverse slant)'
  },
  cylinder: {
    name: 'Cylinder',
    icon: '⬭',
    description: 'Database/storage'
  },
  subroutine: {
    name: 'Subroutine',
    icon: '⟦⟧',
    description: 'Subroutine/process (double-bordered)'
  },
  trapezoid: {
    name: 'Trapezoid',
    icon: '⏢',
    description: 'Trapezoid (wider top)'
  },
  'trapezoid-alt': {
    name: 'Trapezoid Alt',
    icon: '⏥',
    description: 'Trapezoid (wider bottom)'
  }
};

/**
 * Edge type definitions with arrow direction support
 */
export const EDGE_TYPES = {
  // Right arrows (standard)
  arrow: {
    name: 'Arrow →',
    syntax: '-->',
    description: 'Arrow pointing right',
    startArrow: false,
    endArrow: true,
    lineStyle: 'solid'
  },
  'arrow-left': {
    name: 'Arrow ←',
    syntax: '<--',
    description: 'Arrow pointing left',
    startArrow: true,
    endArrow: false,
    lineStyle: 'solid'
  },
  'arrow-both': {
    name: 'Arrow ↔',
    syntax: '<-->',
    description: 'Arrows on both ends',
    startArrow: true,
    endArrow: true,
    lineStyle: 'solid'
  },
  // Dotted arrows
  dotted: {
    name: 'Dotted →',
    syntax: '-.->',
    description: 'Dotted arrow right',
    startArrow: false,
    endArrow: true,
    lineStyle: 'dotted'
  },
  'dotted-left': {
    name: 'Dotted ←',
    syntax: '<-.-',
    description: 'Dotted arrow left',
    startArrow: true,
    endArrow: false,
    lineStyle: 'dotted'
  },
  'dotted-both': {
    name: 'Dotted ↔',
    syntax: '<-.->',
    description: 'Dotted arrows both ends',
    startArrow: true,
    endArrow: true,
    lineStyle: 'dotted'
  },
  // Thick arrows
  thick: {
    name: 'Thick →',
    syntax: '==>',
    description: 'Thick arrow right',
    startArrow: false,
    endArrow: true,
    lineStyle: 'thick'
  },
  'thick-left': {
    name: 'Thick ←',
    syntax: '<==',
    description: 'Thick arrow left',
    startArrow: true,
    endArrow: false,
    lineStyle: 'thick'
  },
  'thick-both': {
    name: 'Thick ↔',
    syntax: '<==>',
    description: 'Thick arrows both ends',
    startArrow: true,
    endArrow: true,
    lineStyle: 'thick'
  },
  // Open (no arrow)
  open: {
    name: 'Line —',
    syntax: '---',
    description: 'Line without arrow',
    startArrow: false,
    endArrow: false,
    lineStyle: 'solid'
  }
};

/**
 * Sequence diagram message types
 * These are specific to sequence diagrams and have different semantics
 */
export const SEQUENCE_MESSAGE_TYPES = {
  'sync': {
    name: 'Sync →',
    syntax: '->>',
    description: 'Synchronous message (solid line, filled arrow)',
    lineStyle: 'solid',
    arrowStyle: 'filled'
  },
  'sync-return': {
    name: 'Return ← ',
    syntax: '-->>',
    description: 'Return message (dotted line, filled arrow)',
    lineStyle: 'dotted',
    arrowStyle: 'filled'
  },
  'async': {
    name: 'Async →',
    syntax: '-)',
    description: 'Asynchronous message (solid line, open arrow)',
    lineStyle: 'solid',
    arrowStyle: 'open'
  },
  'async-return': {
    name: 'Async Return ←',
    syntax: '--)',
    description: 'Async return (dotted line, open arrow)',
    lineStyle: 'dotted',
    arrowStyle: 'open'
  },
  'solid': {
    name: 'Solid →',
    syntax: '->',
    description: 'Simple solid line message',
    lineStyle: 'solid',
    arrowStyle: 'simple'
  },
  'dotted': {
    name: 'Dotted →',
    syntax: '-->',
    description: 'Simple dotted line message',
    lineStyle: 'dotted',
    arrowStyle: 'simple'
  },
  'cross': {
    name: 'Lost ✕',
    syntax: '-x',
    description: 'Lost message (solid line, X)',
    lineStyle: 'solid',
    arrowStyle: 'cross'
  },
  'cross-dotted': {
    name: 'Lost Dotted ✕',
    syntax: '--x',
    description: 'Lost message (dotted line, X)',
    lineStyle: 'dotted',
    arrowStyle: 'cross'
  }
};

/**
 * Direction options
 */
export const DIRECTIONS = {
  TD: { name: 'Top to Bottom', abbrev: 'TD' },
  LR: { name: 'Left to Right', abbrev: 'LR' },
  BT: { name: 'Bottom to Top', abbrev: 'BT' },
  RL: { name: 'Right to Left', abbrev: 'RL' }
};

/**
 * Get SVG path for a shape at given position and size
 */
export function getShapePath(shape, x, y, width, height) {
  const hw = width / 2;
  const hh = height / 2;
  const cx = x + hw;
  const cy = y + hh;

  switch (shape) {
    case 'rect':
      return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;

    case 'rounded':
      const r = Math.min(hw, hh, 10);
      return `M ${x + r} ${y}
              L ${x + width - r} ${y}
              Q ${x + width} ${y} ${x + width} ${y + r}
              L ${x + width} ${y + height - r}
              Q ${x + width} ${y + height} ${x + width - r} ${y + height}
              L ${x + r} ${y + height}
              Q ${x} ${y + height} ${x} ${y + height - r}
              L ${x} ${y + r}
              Q ${x} ${y} ${x + r} ${y}
              Z`;

    case 'diamond':
      return `M ${cx} ${y} L ${x + width} ${cy} L ${cx} ${y + height} L ${x} ${cy} Z`;

    case 'circle':
      // Approximate circle with bezier curves
      const k = 0.5522847498;
      const rx = hw;
      const ry = hh;
      return `M ${cx} ${y}
              C ${cx + rx * k} ${y} ${x + width} ${cy - ry * k} ${x + width} ${cy}
              C ${x + width} ${cy + ry * k} ${cx + rx * k} ${y + height} ${cx} ${y + height}
              C ${cx - rx * k} ${y + height} ${x} ${cy + ry * k} ${x} ${cy}
              C ${x} ${cy - ry * k} ${cx - rx * k} ${y} ${cx} ${y}
              Z`;

    case 'stadium':
      const sr = hh;
      return `M ${x + sr} ${y}
              L ${x + width - sr} ${y}
              A ${sr} ${sr} 0 0 1 ${x + width - sr} ${y + height}
              L ${x + sr} ${y + height}
              A ${sr} ${sr} 0 0 1 ${x + sr} ${y}
              Z`;

    case 'hexagon':
      const hx = width * 0.2;
      return `M ${x + hx} ${y}
              L ${x + width - hx} ${y}
              L ${x + width} ${cy}
              L ${x + width - hx} ${y + height}
              L ${x + hx} ${y + height}
              L ${x} ${cy}
              Z`;

    case 'parallelogram':
      const px = width * 0.2;
      return `M ${x + px} ${y}
              L ${x + width} ${y}
              L ${x + width - px} ${y + height}
              L ${x} ${y + height}
              Z`;

    case 'parallelogram-alt':
      // Reverse slant parallelogram [\label\]
      const pax = width * 0.2;
      return `M ${x} ${y}
              L ${x + width - pax} ${y}
              L ${x + width} ${y + height}
              L ${x + pax} ${y + height}
              Z`;

    case 'subroutine':
      // Double-bordered rectangle [[label]]
      const inset = 8;
      return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z
              M ${x + inset} ${y} L ${x + inset} ${y + height}
              M ${x + width - inset} ${y} L ${x + width - inset} ${y + height}`;

    case 'trapezoid':
      // Wider top [/label\]
      const tx = width * 0.15;
      return `M ${x} ${y}
              L ${x + width} ${y}
              L ${x + width - tx} ${y + height}
              L ${x + tx} ${y + height}
              Z`;

    case 'trapezoid-alt':
      // Wider bottom [\label/]
      const tax = width * 0.15;
      return `M ${x + tax} ${y}
              L ${x + width - tax} ${y}
              L ${x + width} ${y + height}
              L ${x} ${y + height}
              Z`;

    case 'cylinder':
      const cy1 = height * 0.15;
      return `M ${x} ${y + cy1}
              Q ${x} ${y} ${cx} ${y}
              Q ${x + width} ${y} ${x + width} ${y + cy1}
              L ${x + width} ${y + height - cy1}
              Q ${x + width} ${y + height} ${cx} ${y + height}
              Q ${x} ${y + height} ${x} ${y + height - cy1}
              Z
              M ${x} ${y + cy1}
              Q ${x} ${y + cy1 * 2} ${cx} ${y + cy1 * 2}
              Q ${x + width} ${y + cy1 * 2} ${x + width} ${y + cy1}`;

    default:
      return getShapePath('rect', x, y, width, height);
  }
}

/**
 * Get default dimensions for a shape
 */
export function getDefaultDimensions(shape) {
  switch (shape) {
    case 'circle':
      return { width: 80, height: 80 };
    case 'diamond':
      return { width: 100, height: 80 };
    case 'cylinder':
      return { width: 80, height: 100 };
    default:
      return { width: 120, height: 60 };
  }
}

/**
 * Get actual node dimensions, accounting for variable content height
 * Class diagram nodes have variable height based on attributes/methods
 * State diagram initial/final states have specific sizes
 */
export function getActualNodeDimensions(node) {
  // State diagram special states have specific sizes
  if (node.stateType === 'initial') {
    // Initial state is a filled circle with radius 15
    return { width: 30, height: 30 };
  }
  if (node.stateType === 'final') {
    // Final state is a bullseye with outer radius 18
    return { width: 36, height: 36 };
  }

  // Class diagram nodes have variable height based on content
  // Check that arrays actually have content, not just that they exist (empty arrays)
  // This prevents flowchart nodes from being incorrectly treated as class diagram nodes
  if ((Array.isArray(node.attributes) && node.attributes.length > 0) ||
      (Array.isArray(node.methods) && node.methods.length > 0) ||
      node.nodeType === 'class') {
    const width = 150;
    const lineHeight = 18;
    const padding = 8;
    const headerHeight = 30;

    const attrCount = (node.attributes || []).length;
    const methodCount = (node.methods || []).length;
    const attrHeight = attrCount > 0 ? attrCount * lineHeight + padding * 2 : lineHeight + padding;
    const methodHeight = methodCount > 0 ? methodCount * lineHeight + padding * 2 : lineHeight + padding;

    return { width, height: headerHeight + attrHeight + methodHeight };
  }

  return getDefaultDimensions(node.shape);
}

/**
 * Calculate bounding box for a shape
 */
export function getShapeBounds(node) {
  const dims = getActualNodeDimensions(node);
  return {
    x: node.x,
    y: node.y,
    width: dims.width,
    height: dims.height,
    centerX: node.x + dims.width / 2,
    centerY: node.y + dims.height / 2
  };
}

/**
 * Get connection points for a shape
 */
export function getConnectionPoints(node) {
  const bounds = getShapeBounds(node);

  return {
    top: { x: bounds.centerX, y: bounds.y },
    bottom: { x: bounds.centerX, y: bounds.y + bounds.height },
    left: { x: bounds.x, y: bounds.centerY },
    right: { x: bounds.x + bounds.width, y: bounds.centerY }
  };
}

/**
 * Get a distributed connection point along a side of a node
 * Used when multiple edges connect to the same side of a node
 * @param {Object} node - The node
 * @param {string} side - 'top', 'bottom', 'left', or 'right'
 * @param {number} index - Index of this connection (0-based)
 * @param {number} total - Total connections on this side
 */
export function getDistributedConnectionPoint(node, side, index, total) {
  const bounds = getShapeBounds(node);
  const margin = 30; // Margin from edges

  if (total <= 1) {
    // Single connection - use center
    return getConnectionPoints(node)[side];
  }

  // Calculate distributed position
  if (side === 'top' || side === 'bottom') {
    // Distribute horizontally along the edge
    const usableWidth = bounds.width - margin * 2;
    const spacing = usableWidth / (total - 1);
    const x = bounds.x + margin + spacing * index;
    const y = side === 'top' ? bounds.y : bounds.y + bounds.height;
    return { x, y };
  } else {
    // Distribute vertically along the edge
    const usableHeight = bounds.height - margin * 2;
    const spacing = usableHeight / (total - 1);
    const y = bounds.y + margin + spacing * index;
    const x = side === 'left' ? bounds.x : bounds.x + bounds.width;
    return { x, y };
  }
}

/**
 * Find the best connection point between two nodes
 */
export function getBestConnectionPoints(fromNode, toNode) {
  const fromBounds = getShapeBounds(fromNode);
  const toBounds = getShapeBounds(toNode);

  // Determine relative position
  const dx = toBounds.centerX - fromBounds.centerX;
  const dy = toBounds.centerY - fromBounds.centerY;

  // Use horizontal or vertical connection based on relative position
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal connection
    if (dx > 0) {
      return {
        from: getConnectionPoints(fromNode).right,
        to: getConnectionPoints(toNode).left,
        fromSide: 'right',
        toSide: 'left'
      };
    } else {
      return {
        from: getConnectionPoints(fromNode).left,
        to: getConnectionPoints(toNode).right,
        fromSide: 'left',
        toSide: 'right'
      };
    }
  } else {
    // Vertical connection
    if (dy > 0) {
      return {
        from: getConnectionPoints(fromNode).bottom,
        to: getConnectionPoints(toNode).top,
        fromSide: 'bottom',
        toSide: 'top'
      };
    } else {
      return {
        from: getConnectionPoints(fromNode).top,
        to: getConnectionPoints(toNode).bottom,
        fromSide: 'top',
        toSide: 'bottom'
      };
    }
  }
}

// =============================================
// SEQUENCE DIAGRAM LAYOUT CONSTANTS
// =============================================
export const MESSAGE_Y_START = 150;  // Y position of first message (below participant boxes)
export const MESSAGE_Y_SPACING = 50; // Vertical spacing between messages
export const PARTICIPANT_SPACING = 180; // Horizontal spacing between participants

// =============================================
// CLASS DIAGRAM RELATIONSHIP TYPES
// =============================================
export const CLASS_RELATIONSHIP_TYPES = {
  inheritance: {
    name: 'Inheritance',
    syntax: '<|--',
    description: 'Parent-child inheritance (hollow triangle)',
    markerStart: 'hollow-triangle',
    markerEnd: null,
    lineStyle: 'solid'
  },
  composition: {
    name: 'Composition',
    syntax: '*--',
    description: 'Strong ownership (filled diamond)',
    markerStart: 'filled-diamond',
    markerEnd: null,
    lineStyle: 'solid'
  },
  aggregation: {
    name: 'Aggregation',
    syntax: 'o--',
    description: 'Weak ownership (hollow diamond)',
    markerStart: 'hollow-diamond',
    markerEnd: null,
    lineStyle: 'solid'
  },
  association: {
    name: 'Association',
    syntax: '-->',
    description: 'Directed association (arrow at target)',
    markerStart: null,
    markerEnd: null,
    endArrow: true,
    lineStyle: 'solid'
  },
  dependency: {
    name: 'Dependency',
    syntax: '..>',
    description: 'Dependency (dashed arrow)',
    markerStart: null,
    markerEnd: 'arrow',
    lineStyle: 'dashed'
  },
  realization: {
    name: 'Realization',
    syntax: '..|>',
    description: 'Interface implementation (dashed + hollow triangle)',
    markerStart: null,
    markerEnd: 'hollow-triangle',
    lineStyle: 'dashed'
  }
};

// =============================================
// STATE DIAGRAM SHAPES
// =============================================
export const STATE_SHAPES = {
  initial: {
    name: 'Initial State',
    icon: '●',
    description: 'Starting state (filled circle)'
  },
  final: {
    name: 'Final State',
    icon: '◉',
    description: 'Ending state (bullseye)'
  },
  state: {
    name: 'State',
    icon: '▢',
    description: 'Regular state'
  },
  fork: {
    name: 'Fork',
    icon: '▬',
    description: 'Fork bar for parallel states'
  },
  join: {
    name: 'Join',
    icon: '▬',
    description: 'Join bar for synchronization'
  },
  choice: {
    name: 'Choice',
    icon: '◇',
    description: 'Choice/decision point'
  }
};

// =============================================
// ER DIAGRAM CARDINALITY TYPES
// =============================================
export const ER_CARDINALITY_TYPES = {
  'one': {
    name: 'One (||)',
    symbol: '||',
    marker: 'one',
    description: 'Exactly one'
  },
  'zero-one': {
    name: 'Zero or One (|o)',
    symbol: '|o',
    marker: 'zero-one',
    description: 'Zero or one (optional)'
  },
  'one-many': {
    name: 'One or Many (}|)',
    symbol: '}|',
    marker: 'one-many',
    description: 'One or more (at least one)'
  },
  'zero-many': {
    name: 'Zero or Many (}o)',
    symbol: '}o',
    marker: 'zero-many',
    description: 'Zero or more'
  }
};
