/**
 * Mermaid Code Generator
 *
 * Generates valid mermaid code from the diagram model.
 */

/**
 * Convert shape type to mermaid syntax
 */
function shapeToSyntax(shape, label) {
  const escapedLabel = escapeLabel(label);

  switch (shape) {
    case 'rect':
      return `[${escapedLabel}]`;
    case 'rounded':
      return `(${escapedLabel})`;
    case 'diamond':
      return `{${escapedLabel}}`;
    case 'circle':
      return `((${escapedLabel}))`;
    case 'stadium':
      return `([${escapedLabel}])`;
    case 'subroutine':
      return `[[${escapedLabel}]]`;
    case 'cylinder':
      return `[(${escapedLabel})]`;
    case 'hexagon':
      return `{{${escapedLabel}}}`;
    case 'parallelogram':
      return `[/${escapedLabel}/]`;
    case 'parallelogram-alt':
      return `[\\${escapedLabel}\\]`;
    case 'trapezoid':
      return `[/${escapedLabel}\\]`;
    case 'trapezoid-alt':
      return `[\\${escapedLabel}/]`;
    default:
      return `[${escapedLabel}]`;
  }
}

/**
 * Escape special characters in labels
 */
function escapeLabel(label) {
  if (!label) return '';

  // Escape quotes and special mermaid characters
  return label
    .replace(/"/g, '#quot;')
    .replace(/\[/g, '#91;')
    .replace(/\]/g, '#93;')
    .replace(/\{/g, '#123;')
    .replace(/\}/g, '#125;')
    .replace(/\(/g, '#40;')
    .replace(/\)/g, '#41;');
}

/**
 * Convert edge type to mermaid arrow syntax
 */
function edgeTypeToArrow(type) {
  switch (type) {
    // Solid arrows
    case 'arrow':
      return '-->';
    case 'arrow-left':
      return '<--';
    case 'arrow-both':
      return '<-->';
    // Dotted arrows
    case 'dotted':
      return '-.->';
    case 'dotted-left':
      return '<-.-';
    case 'dotted-both':
      return '<-.->';
    // Thick arrows
    case 'thick':
      return '==>';
    case 'thick-left':
      return '<==';
    case 'thick-both':
      return '<==>';
    // Open (no arrows)
    case 'open':
      return '---';
    case 'dotted-open':
      return '-.-';
    case 'thick-open':
      return '===';
    default:
      return '-->';
  }
}

/**
 * Generate mermaid code from a flowchart model
 */
function generateFlowchart(model) {
  const lines = [];

  // Diagram type and direction
  lines.push(`flowchart ${model.direction}`);

  // Group nodes by whether they have connections
  const connectedNodes = new Set();
  model.edges.forEach(edge => {
    connectedNodes.add(edge.from);
    connectedNodes.add(edge.to);
  });

  // Generate node definitions for nodes that need explicit shape definition
  // Only define nodes that aren't already defined by edges or have custom shapes
  model.nodes.forEach(node => {
    // Always define nodes with non-default shapes or if they have no connections
    if (node.shape !== 'rect' || !connectedNodes.has(node.id)) {
      lines.push(`    ${node.id}${shapeToSyntax(node.shape, node.label)}`);
    }
  });

  // Generate edges
  // Left arrow types need to be converted to right arrows with swapped nodes
  // because Mermaid doesn't support <-- syntax in flowcharts
  const LEFT_ARROW_TYPES = {
    'arrow-left': 'arrow',
    'dotted-left': 'dotted',
    'thick-left': 'thick'
  };

  model.edges.forEach(edge => {
    const isLeftArrow = edge.type in LEFT_ARROW_TYPES;

    // For left arrows, swap from/to and use the right arrow equivalent
    const actualFrom = isLeftArrow ? edge.to : edge.from;
    const actualTo = isLeftArrow ? edge.from : edge.to;
    const actualType = isLeftArrow ? LEFT_ARROW_TYPES[edge.type] : edge.type;

    const fromNode = model.nodes.find(n => n.id === actualFrom);
    const toNode = model.nodes.find(n => n.id === actualTo);

    if (!fromNode || !toNode) return;

    const arrow = edgeTypeToArrow(actualType);

    // Include node shapes in edge definitions for default-shaped nodes
    let fromPart = fromNode.id;
    let toPart = toNode.id;

    if (fromNode.shape === 'rect') {
      fromPart = `${fromNode.id}[${escapeLabel(fromNode.label)}]`;
    }
    if (toNode.shape === 'rect') {
      toPart = `${toNode.id}[${escapeLabel(toNode.label)}]`;
    }

    if (edge.label) {
      lines.push(`    ${fromPart} ${arrow}|${escapeLabel(edge.label)}| ${toPart}`);
    } else {
      lines.push(`    ${fromPart} ${arrow} ${toPart}`);
    }
  });

  return lines.join('\n');
}

/**
 * Convert sequence message type to mermaid arrow syntax
 */
function sequenceMessageToArrow(type) {
  switch (type) {
    case 'sync':
      return '->>';  // Solid line, filled arrowhead
    case 'sync-return':
      return '-->>';  // Dotted line, filled arrowhead
    case 'async':
      return '-)';  // Solid line, open arrowhead
    case 'async-return':
      return '--)';  // Dotted line, open arrowhead
    case 'solid':
      return '->';  // Solid line, simple arrow
    case 'dotted':
      return '-->';  // Dotted line, simple arrow
    case 'cross':
      return '-x';  // Solid line, X end
    case 'cross-dotted':
      return '--x';  // Dotted line, X end
    // Legacy support for old edge types
    case 'arrow':
      return '->>';
    default:
      return '->>';
  }
}

/**
 * Generate mermaid code from a sequence diagram model
 */
function generateSequence(model) {
  const lines = [];
  lines.push('sequenceDiagram');

  // For sequence diagrams, nodes are participants
  model.nodes.forEach(node => {
    lines.push(`    participant ${node.id} as ${escapeLabel(node.label)}`);
  });

  // Edges are messages
  model.edges.forEach(edge => {
    const arrow = sequenceMessageToArrow(edge.type);
    const label = edge.label || '';

    // Handle self-messages (from same participant)
    if (edge.from === edge.to) {
      // Self-message syntax is the same, mermaid handles the visual rendering
      lines.push(`    ${edge.from}${arrow}${edge.to}: ${escapeLabel(label)}`);
    } else {
      lines.push(`    ${edge.from}${arrow}${edge.to}: ${escapeLabel(label)}`);
    }
  });

  // Add notes if present
  if (model.notes && model.notes.length > 0) {
    model.notes.forEach(note => {
      const position = note.position || 'right of';
      const participant = note.participant || model.nodes[0]?.id || '';
      const text = escapeLabel(note.text || '');
      lines.push(`    Note ${position} ${participant}: ${text}`);
    });
  }

  // Add activation markers if present
  if (model.activations && model.activations.length > 0) {
    // Activations are typically integrated with messages
    // For now, we'll add activate/deactivate statements
    model.activations.forEach(activation => {
      if (activation.type === 'activate') {
        lines.push(`    activate ${activation.participant}`);
      } else if (activation.type === 'deactivate') {
        lines.push(`    deactivate ${activation.participant}`);
      }
    });
  }

  return lines.join('\n');
}

/**
 * Convert class diagram relationship type to mermaid arrow syntax
 */
function classRelTypeToArrow(type) {
  switch (type) {
    case 'inheritance':
      return '<|--';
    case 'realization':
      return '<|..';
    case 'composition':
      return '*--';
    case 'aggregation':
      return 'o--';
    case 'dependency':
      return '..>';
    case 'association':
    default:
      return '-->';
  }
}

/**
 * Generate mermaid code from a class diagram model
 */
function generateClassDiagram(model) {
  const lines = [];
  lines.push('classDiagram');

  // Generate stereotype annotations first
  model.nodes.forEach(node => {
    if (node.stereotype) {
      lines.push(`    <<${node.stereotype}>> ${node.id}`);
    }
  });

  // Generate class definitions with attributes and methods
  model.nodes.forEach(node => {
    const label = node.label || node.id;
    const hasMembers = (node.attributes && node.attributes.length > 0) ||
                       (node.methods && node.methods.length > 0);

    // Use display name syntax if label differs from id
    if (hasMembers) {
      // Class with members uses block syntax
      if (label !== node.id) {
        lines.push(`    class ${node.id}["${escapeLabel(label)}"] {`);
      } else {
        lines.push(`    class ${node.id} {`);
      }

      // Add attributes
      if (node.attributes && node.attributes.length > 0) {
        node.attributes.forEach(attr => {
          lines.push(`        ${attr}`);
        });
      }

      // Add methods
      if (node.methods && node.methods.length > 0) {
        node.methods.forEach(method => {
          lines.push(`        ${method}`);
        });
      }

      lines.push('    }');
    } else if (!node.stereotype) {
      // Simple class definition (skip if stereotype already defines it)
      if (label !== node.id) {
        lines.push(`    class ${node.id}["${escapeLabel(label)}"]`);
      } else {
        lines.push(`    class ${node.id}`);
      }
    }
  });

  // Generate relationships with proper UML arrows
  model.edges.forEach(edge => {
    const arrow = classRelTypeToArrow(edge.type);
    if (edge.label) {
      lines.push(`    ${edge.from} ${arrow} ${edge.to} : ${escapeLabel(edge.label)}`);
    } else {
      lines.push(`    ${edge.from} ${arrow} ${edge.to}`);
    }
  });

  return lines.join('\n');
}

/**
 * Generate mermaid code from a state diagram model
 */
function generateStateDiagram(model) {
  const lines = [];
  lines.push('stateDiagram-v2');

  // Helper to convert special state IDs to [*] syntax
  const toMermaidId = (id, node) => {
    if (node && (node.stateType === 'initial' || node.stateType === 'final')) {
      return '[*]';
    }
    if (id === '__initial__' || id === '__final__') {
      return '[*]';
    }
    return id;
  };

  // Create a map for quick node lookup
  const nodeMap = new Map(model.nodes.map(n => [n.id, n]));

  // Generate state definitions (skip initial/final pseudo-states)
  model.nodes.forEach(node => {
    // Skip initial/final pseudo-states - they don't need definitions
    if (node.stateType === 'initial' || node.stateType === 'final') {
      return;
    }
    const label = node.label || node.id;
    if (label !== node.id) {
      lines.push(`    ${node.id} : ${escapeLabel(label)}`);
    }
  });

  // Generate transitions
  // Note: Mermaid state diagrams ONLY support --> syntax for transitions
  // They don't support dotted (-.->), thick (==>), or reverse (<--) arrows
  // The visual editor can show different styles, but generated code must use -->

  // Left/reverse arrows: swap from/to nodes
  const LEFT_ARROW_TYPES = ['arrow-left', 'dotted-left', 'thick-left'];

  // Bidirectional arrows: generate two transitions
  const BIDIRECTIONAL_TYPES = ['arrow-both', 'dotted-both', 'thick-both'];

  model.edges.forEach(edge => {
    const isLeftArrow = LEFT_ARROW_TYPES.includes(edge.type);
    const isBidirectional = BIDIRECTIONAL_TYPES.includes(edge.type);

    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    const fromId = toMermaidId(edge.from, fromNode);
    const toId = toMermaidId(edge.to, toNode);

    // State diagrams only support --> syntax
    const arrow = '-->';

    if (isBidirectional) {
      // Generate two transitions for bidirectional arrows
      if (edge.label) {
        lines.push(`    ${fromId} ${arrow} ${toId} : ${escapeLabel(edge.label)}`);
        lines.push(`    ${toId} ${arrow} ${fromId} : ${escapeLabel(edge.label)}`);
      } else {
        lines.push(`    ${fromId} ${arrow} ${toId}`);
        lines.push(`    ${toId} ${arrow} ${fromId}`);
      }
    } else if (isLeftArrow) {
      // For left arrows, swap from/to
      if (edge.label) {
        lines.push(`    ${toId} ${arrow} ${fromId} : ${escapeLabel(edge.label)}`);
      } else {
        lines.push(`    ${toId} ${arrow} ${fromId}`);
      }
    } else {
      // Standard forward arrow
      if (edge.label) {
        lines.push(`    ${fromId} ${arrow} ${toId} : ${escapeLabel(edge.label)}`);
      } else {
        lines.push(`    ${fromId} ${arrow} ${toId}`);
      }
    }
  });

  return lines.join('\n');
}

/**
 * Map cardinality type to left-side mermaid symbol
 */
function cardinalityToLeftSymbol(cardinality) {
  switch (cardinality) {
    case 'one': return '||';
    case 'zero-one': return '|o';
    case 'many': return '}|';
    case 'one-many': return '}|';
    case 'zero-many': return '}o';
    default: return '||';
  }
}

/**
 * Map cardinality type to right-side mermaid symbol
 */
function cardinalityToRightSymbol(cardinality) {
  switch (cardinality) {
    case 'one': return '||';
    case 'zero-one': return 'o|';
    case 'many': return '|{';
    case 'one-many': return '|{';
    case 'zero-many': return 'o{';
    default: return '||';
  }
}

/**
 * Format an ER diagram attribute to ensure valid Mermaid syntax
 * Mermaid ER attributes require: type name [PK|FK|UK]
 * @param {string} attr - The attribute string
 * @returns {string} Properly formatted attribute
 */
function formatERAttribute(attr) {
  if (!attr || !attr.trim()) return null;

  const trimmed = attr.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length >= 2) {
    // Already has type and name, return as-is
    return trimmed;
  } else if (parts.length === 1) {
    // Only one word - treat as name and add default type
    return `string ${parts[0]}`;
  }

  return null;
}

/**
 * Generate mermaid code from an ER diagram model
 */
function generateERDiagram(model) {
  const lines = [];
  lines.push('erDiagram');

  // Track which entities are referenced in relationships
  const entitiesInRelationships = new Set();
  model.edges.forEach(edge => {
    entitiesInRelationships.add(edge.from);
    entitiesInRelationships.add(edge.to);
  });

  // Generate entity definitions
  // Use node.label as the entity name (what user sees), falling back to node.id
  model.nodes.forEach(node => {
    const entityName = node.label || node.id;
    const hasAttributes = node.attributes && node.attributes.length > 0;
    const isInRelationship = entitiesInRelationships.has(node.id);

    if (hasAttributes) {
      // Entity with attributes - always output
      const validAttrs = node.attributes
        .map(formatERAttribute)
        .filter(attr => attr !== null);

      if (validAttrs.length > 0) {
        lines.push(`    ${entityName} {`);
        validAttrs.forEach(attr => {
          lines.push(`        ${attr}`);
        });
        lines.push(`    }`);
      } else if (!isInRelationship) {
        // No valid attributes but not in any relationship - output empty definition
        lines.push(`    ${entityName} {`);
        lines.push(`    }`);
      }
    } else if (!isInRelationship) {
      // No attributes and not in any relationship - output empty definition
      // so the entity isn't lost
      lines.push(`    ${entityName} {`);
      lines.push(`    }`);
    }
    // Entities with no attributes but in relationships are implicitly created
  });

  // Generate relationships with proper cardinality
  // Use labels for entity names in relationships
  model.edges.forEach(edge => {
    const fromNode = model.nodes.find(n => n.id === edge.from);
    const toNode = model.nodes.find(n => n.id === edge.to);
    const fromName = fromNode ? (fromNode.label || fromNode.id) : edge.from;
    const toName = toNode ? (toNode.label || toNode.id) : edge.to;

    const label = edge.label || 'relates';
    const fromCardinality = edge.fromCardinality || 'one';
    const toCardinality = edge.toCardinality || 'many';

    const leftSymbol = cardinalityToLeftSymbol(fromCardinality);
    const rightSymbol = cardinalityToRightSymbol(toCardinality);

    lines.push(`    ${fromName} ${leftSymbol}--${rightSymbol} ${toName} : "${escapeLabel(label)}"`);
  });

  return lines.join('\n');
}

/**
 * Generate mermaid code from a pie chart model
 */
function generatePieChart(model) {
  const lines = [];

  // Header with optional showData
  if (model.pieShowData) {
    lines.push('pie showData');
  } else {
    lines.push('pie');
  }

  // Title
  if (model.pieTitle) {
    lines.push(`    title ${model.pieTitle}`);
  }

  // Segments
  if (model.pieSegments && model.pieSegments.length > 0) {
    model.pieSegments.forEach(segment => {
      const value = Number.isInteger(segment.value) ? segment.value : segment.value.toFixed(1);
      lines.push(`    "${segment.label}" : ${value}`);
    });
  }

  return lines.join('\n');
}

/**
 * Generate mermaid code from a Gantt chart model
 */
function generateGanttChart(model) {
  const lines = [];

  // Header
  lines.push('gantt');

  // Title
  if (model.ganttTitle) {
    lines.push(`    title ${model.ganttTitle}`);
  }

  // Date format
  if (model.ganttDateFormat) {
    lines.push(`    dateFormat ${model.ganttDateFormat}`);
  }

  // Axis format
  if (model.ganttAxisFormat) {
    lines.push(`    axisFormat ${model.ganttAxisFormat}`);
  }

  // Sections and tasks
  if (model.ganttSections && model.ganttSections.length > 0) {
    model.ganttSections.forEach(section => {
      lines.push(`    section ${section.name}`);

      // Get tasks for this section
      const sectionTasks = (model.ganttTasks || []).filter(t => t.sectionId === section.id);

      sectionTasks.forEach(task => {
        // Build task definition parts
        const parts = [];

        // Status modifier
        if (task.status && task.status !== 'normal') {
          // Convert 'critical' back to 'crit' for Mermaid
          const statusMod = task.status === 'critical' ? 'crit' : task.status;
          parts.push(statusMod);
        }

        // Task ID
        if (task.taskId) {
          parts.push(task.taskId);
        }

        // Start date (can be date or "after taskId")
        if (task.startDate) {
          parts.push(task.startDate);
        }

        // Duration
        if (task.duration) {
          parts.push(task.duration);
        }

        // Generate task line
        const taskDef = parts.join(', ');
        lines.push(`    ${task.label}    :${taskDef}`);
      });
    });
  } else {
    // Tasks without sections
    (model.ganttTasks || []).forEach(task => {
      const parts = [];

      if (task.status && task.status !== 'normal') {
        const statusMod = task.status === 'critical' ? 'crit' : task.status;
        parts.push(statusMod);
      }

      if (task.taskId) {
        parts.push(task.taskId);
      }

      if (task.startDate) {
        parts.push(task.startDate);
      }

      if (task.duration) {
        parts.push(task.duration);
      }

      const taskDef = parts.join(', ');
      lines.push(`    ${task.label}    :${taskDef}`);
    });
  }

  return lines.join('\n');
}

/**
 * Generate mermaid code from a model
 */
export function generateMermaidCode(model) {
  if (!model) return '';

  switch (model.type) {
    case 'flowchart':
    case 'graph':
      return generateFlowchart(model);
    case 'sequence':
      return generateSequence(model);
    case 'classDiagram':
      return generateClassDiagram(model);
    case 'stateDiagram':
      return generateStateDiagram(model);
    case 'erDiagram':
      return generateERDiagram(model);
    case 'pie':
      return generatePieChart(model);
    case 'gantt':
      return generateGanttChart(model);
    default:
      return generateFlowchart(model);
  }
}

/**
 * Wrap code in mermaid code block for markdown
 */
export function wrapInCodeBlock(code) {
  return '```mermaid\n' + code + '\n```';
}
