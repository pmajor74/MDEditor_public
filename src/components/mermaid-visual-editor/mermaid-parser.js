/**
 * Mermaid Code Parser
 *
 * Parses mermaid code into a diagram model for visual editing.
 * Supports flowcharts and sequence diagrams.
 */

import { applyAutoLayout } from './auto-layout.js';

/**
 * Parse shape syntax to shape type
 */
function parseShapeType(openChar, closeChar) {
  const key = openChar + closeChar;

  const shapeMap = {
    '[]': 'rect',
    '()': 'rounded',
    '{}': 'diamond',
    '(())': 'circle',
    '([])': 'stadium',
    '[[]]': 'subroutine',
    '[()]': 'cylinder',
    '{{}}': 'hexagon',
    '[//]': 'parallelogram',
    '[\\\\]': 'parallelogram-alt',
    '[/\\]': 'trapezoid',
    '[\\/]': 'trapezoid-alt'
  };

  return shapeMap[key] || 'rect';
}

/**
 * Unescape mermaid character codes
 */
function unescapeLabel(label) {
  if (!label) return '';

  return label
    .replace(/#quot;/g, '"')
    .replace(/#91;/g, '[')
    .replace(/#93;/g, ']')
    .replace(/#123;/g, '{')
    .replace(/#125;/g, '}')
    .replace(/#40;/g, '(')
    .replace(/#41;/g, ')')
    .trim();
}

/**
 * Parse a node definition
 */
function parseNodeDefinition(nodeStr) {
  // Match patterns like: A[Label], B{Label}, C(Label), etc.
  const patterns = [
    // Standard shapes
    { regex: /^([A-Za-z0-9_]+)\[\[([^\]]*)\]\]/, shape: 'subroutine' },
    { regex: /^([A-Za-z0-9_]+)\(\(([^)]*)\)\)/, shape: 'circle' },
    { regex: /^([A-Za-z0-9_]+)\(\[([^\]]*)\]\)/, shape: 'stadium' },
    { regex: /^([A-Za-z0-9_]+)\[\(([^)]*)\)\]/, shape: 'cylinder' },
    { regex: /^([A-Za-z0-9_]+)\{\{([^}]*)\}\}/, shape: 'hexagon' },
    { regex: /^([A-Za-z0-9_]+)\[\/([^/]*)\/\]/, shape: 'parallelogram' },
    { regex: /^([A-Za-z0-9_]+)\[\\([^\\]*)\\]/, shape: 'parallelogram-alt' },
    { regex: /^([A-Za-z0-9_]+)\[\/([^\\]*)\\]/, shape: 'trapezoid' },
    { regex: /^([A-Za-z0-9_]+)\[\\([^/]*)\/\]/, shape: 'trapezoid-alt' },
    { regex: /^([A-Za-z0-9_]+)\[([^\]]*)\]/, shape: 'rect' },
    { regex: /^([A-Za-z0-9_]+)\(([^)]*)\)/, shape: 'rounded' },
    { regex: /^([A-Za-z0-9_]+)\{([^}]*)\}/, shape: 'diamond' },
    // Just ID (no shape)
    { regex: /^([A-Za-z0-9_]+)$/, shape: 'rect', noLabel: true }
  ];

  for (const pattern of patterns) {
    const match = nodeStr.match(pattern.regex);
    if (match) {
      return {
        id: match[1],
        label: pattern.noLabel ? match[1] : unescapeLabel(match[2]),
        shape: pattern.shape
      };
    }
  }

  return null;
}

/**
 * Parse an edge line
 */
function parseEdgeLine(line) {
  // Patterns for edges with labels
  const edgePatterns = [
    // With label: A -->|label| B
    {
      regex: /^(.+?)\s*(-->|-.->|==>|---|-.-)(\|([^|]*)\|)?\s*(.+)$/,
      getType: (arrow) => {
        switch (arrow) {
          case '-->': return 'arrow';
          case '-.->': return 'dotted';
          case '==>': return 'thick';
          case '---': return 'open';
          case '-.-': return 'dotted-open';
          default: return 'arrow';
        }
      }
    }
  ];

  for (const pattern of edgePatterns) {
    const match = line.match(pattern.regex);
    if (match) {
      const fromStr = match[1].trim();
      const arrow = match[2];
      const label = match[4] ? unescapeLabel(match[4]) : '';
      const toStr = match[5].trim();

      // Parse from and to nodes
      const fromNode = parseNodeDefinition(fromStr);
      const toNode = parseNodeDefinition(toStr);

      if (fromNode && toNode) {
        return {
          from: fromNode,
          to: toNode,
          label: label,
          type: pattern.getType(arrow)
        };
      }
    }
  }

  return null;
}

/**
 * Parse a flowchart
 */
function parseFlowchart(lines) {
  const model = {
    type: 'flowchart',
    direction: 'TD',
    nodes: [],
    edges: []
  };

  const nodeMap = new Map();
  let nodeX = 100;
  let nodeY = 100;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;

    // Check for direction
    if (trimmed.match(/^(flowchart|graph)\s+(TD|TB|BT|LR|RL)/i)) {
      const dirMatch = trimmed.match(/\s+(TD|TB|BT|LR|RL)/i);
      if (dirMatch) {
        model.direction = dirMatch[1].toUpperCase();
        if (model.direction === 'TB') model.direction = 'TD';
      }
      continue;
    }

    // Skip subgraph lines for now
    if (trimmed.match(/^(subgraph|end)\b/i)) continue;

    // Try to parse as edge
    const edgeResult = parseEdgeLine(trimmed);
    if (edgeResult) {
      // Add or update nodes
      [edgeResult.from, edgeResult.to].forEach(nodeDef => {
        if (!nodeMap.has(nodeDef.id)) {
          nodeMap.set(nodeDef.id, {
            id: nodeDef.id,
            label: nodeDef.label,
            shape: nodeDef.shape,
            x: nodeX,
            y: nodeY
          });
          nodeY += 100;
          if (nodeY > 400) {
            nodeY = 100;
            nodeX += 200;
          }
        } else {
          // Update label/shape if more specific
          const existing = nodeMap.get(nodeDef.id);
          if (nodeDef.label !== nodeDef.id || nodeDef.shape !== 'rect') {
            existing.label = nodeDef.label;
            existing.shape = nodeDef.shape;
          }
        }
      });

      // Add edge
      model.edges.push({
        id: `edge_${model.edges.length}`,
        from: edgeResult.from.id,
        to: edgeResult.to.id,
        label: edgeResult.label,
        type: edgeResult.type
      });
      continue;
    }

    // Try to parse as standalone node definition
    const nodeDef = parseNodeDefinition(trimmed);
    if (nodeDef && !nodeMap.has(nodeDef.id)) {
      nodeMap.set(nodeDef.id, {
        id: nodeDef.id,
        label: nodeDef.label,
        shape: nodeDef.shape,
        x: nodeX,
        y: nodeY
      });
      nodeY += 100;
      if (nodeY > 400) {
        nodeY = 100;
        nodeX += 200;
      }
    }
  }

  model.nodes = Array.from(nodeMap.values());
  return model;
}

/**
 * Map sequence diagram arrow syntax to message type
 */
function mapSequenceArrowToType(arrow) {
  switch (arrow) {
    case '->>':
      return 'sync';
    case '-->>':
      return 'sync-return';
    case '-)':
      return 'async';
    case '--)':
      return 'async-return';
    case '->':
      return 'solid';
    case '-->':
      return 'dotted';
    case '-x':
      return 'cross';
    case '--x':
      return 'cross-dotted';
    case '->>+':
      return 'sync';  // With activation
    case '->>-':
      return 'sync';  // With deactivation
    default:
      return 'sync';
  }
}

/**
 * Parse a sequence diagram
 */
function parseSequenceDiagram(lines) {
  const model = {
    type: 'sequence',
    direction: 'TD',
    nodes: [],
    edges: []
  };

  const participantOrder = []; // Track participant IDs in order
  const MIN_SPACING = 180; // Minimum spacing (for 120px wide boxes = 60px gap)
  const CHAR_WIDTH = 7; // Approximate character width in pixels
  const LABEL_PADDING = 40; // Extra padding around label

  // First pass: parse all content
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (trimmed.toLowerCase() === 'sequencediagram') continue;

    // Parse participant
    const participantMatch = trimmed.match(/^participant\s+([A-Za-z0-9_]+)(?:\s+as\s+(.+))?$/i);
    if (participantMatch) {
      participantOrder.push(participantMatch[1]);
      model.nodes.push({
        id: participantMatch[1],
        label: participantMatch[2] ? unescapeLabel(participantMatch[2]) : participantMatch[1],
        shape: 'rect',
        x: 0, // Will be calculated later
        y: 50
      });
      continue;
    }

    // Parse actor
    const actorMatch = trimmed.match(/^actor\s+([A-Za-z0-9_]+)(?:\s+as\s+(.+))?$/i);
    if (actorMatch) {
      participantOrder.push(actorMatch[1]);
      model.nodes.push({
        id: actorMatch[1],
        label: actorMatch[2] ? unescapeLabel(actorMatch[2]) : actorMatch[1],
        shape: 'rounded',
        x: 0,
        y: 50
      });
      continue;
    }

    // Parse message arrow
    const messageMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*(-->>|-->|--\)|--x|->>\+|->>\-|->>|-\)|->|-x)\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (messageMatch) {
      model.edges.push({
        id: `edge_${model.edges.length}`,
        from: messageMatch[1],
        to: messageMatch[3],
        label: unescapeLabel(messageMatch[4]),
        type: mapSequenceArrowToType(messageMatch[2])
      });
      continue;
    }

    // Parse Note statements
    const noteMatch = trimmed.match(/^Note\s+(right of|left of|over)\s+([A-Za-z0-9_,\s]+)\s*:\s*(.*)$/i);
    if (noteMatch) {
      if (!model.notes) model.notes = [];
      model.notes.push({
        id: `note_${model.notes.length}`,
        position: noteMatch[1].toLowerCase(),  // Normalize position to lowercase for consistent comparison
        participant: noteMatch[2].trim(),
        text: unescapeLabel(noteMatch[3])
      });
      continue;
    }

    // Parse activate/deactivate statements
    const activateMatch = trimmed.match(/^(activate|deactivate)\s+([A-Za-z0-9_]+)$/i);
    if (activateMatch) {
      if (!model.activations) model.activations = [];
      model.activations.push({
        type: activateMatch[1].toLowerCase(),
        participant: activateMatch[2]
      });
      continue;
    }
  }

  // Second pass: calculate optimal spacing between adjacent participants
  const spacings = []; // Spacing for each gap between participants
  for (let i = 0; i < participantOrder.length - 1; i++) {
    const left = participantOrder[i];
    const right = participantOrder[i + 1];
    let maxLabelWidth = 0;

    // Find longest message label between these two participants
    for (const edge of model.edges) {
      const isAdjacent = (edge.from === left && edge.to === right) ||
                         (edge.from === right && edge.to === left);
      if (isAdjacent && edge.label) {
        const labelWidth = edge.label.length * CHAR_WIDTH + LABEL_PADDING;
        maxLabelWidth = Math.max(maxLabelWidth, labelWidth);
      }
    }

    spacings.push(Math.max(MIN_SPACING, maxLabelWidth));
  }

  // Third pass: position participants based on calculated spacings
  let currentX = 100;
  for (let i = 0; i < model.nodes.length; i++) {
    model.nodes[i].x = currentX;
    if (i < spacings.length) {
      currentX += spacings[i];
    }
  }

  return model;
}

/**
 * Parse a class diagram
 */
function parseClassDiagram(lines) {
  const model = {
    type: 'classDiagram',
    direction: 'TD',
    nodes: [],
    edges: []
  };

  const nodeMap = new Map();
  let nodeX = 100;
  let nodeY = 100;
  let currentClass = null; // Track if we're inside a class block

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (trimmed.toLowerCase() === 'classdiagram') continue;

    // Check for closing brace (end of class block)
    if (currentClass && trimmed === '}') {
      currentClass = null;
      continue;
    }

    // If inside a class block, parse members
    if (currentClass) {
      // Method: has parentheses like +getName() or -setName(String name)
      if (trimmed.includes('(') && trimmed.includes(')')) {
        currentClass.methods.push(trimmed);
      } else {
        // Attribute: anything else like +String name or -int age
        currentClass.attributes.push(trimmed);
      }
      continue;
    }

    // Parse stereotype annotation: <<interface>> ClassName or <<abstract>> ClassName
    const stereoMatch = trimmed.match(/^<<(interface|abstract|enum|service)>>\s*([A-Za-z0-9_]+)\s*$/i);
    if (stereoMatch) {
      const stereotype = stereoMatch[1].toLowerCase();
      const id = stereoMatch[2];
      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id,
          label: id,
          shape: 'rect',
          x: nodeX,
          y: nodeY,
          attributes: [],
          methods: [],
          stereotype
        });
        nodeY += 120;
        if (nodeY > 400) { nodeY = 100; nodeX += 200; }
      } else {
        nodeMap.get(id).stereotype = stereotype;
      }
      continue;
    }

    // Parse class definition: class ClassName { or class ClassName["Label"] {
    const classMatch = trimmed.match(/^class\s+([A-Za-z0-9_]+)(?:\["([^"]+)"\])?\s*\{?\s*$/i);
    if (classMatch) {
      const id = classMatch[1];
      const label = classMatch[2] || id;
      const hasOpenBrace = trimmed.includes('{');

      if (!nodeMap.has(id)) {
        const newClass = {
          id,
          label,
          shape: 'rect',
          x: nodeX,
          y: nodeY,
          attributes: [],
          methods: [],
          stereotype: null
        };
        nodeMap.set(id, newClass);
        nodeY += 120;
        if (nodeY > 400) { nodeY = 100; nodeX += 200; }

        // If line has opening brace, we're entering a class block
        if (hasOpenBrace) {
          currentClass = newClass;
        }
      } else if (hasOpenBrace) {
        currentClass = nodeMap.get(id);
      }
      continue;
    }

    // Parse member notation: ClassName : +attribute or ClassName : +method()
    const memberMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/);
    if (memberMatch) {
      const className = memberMatch[1];
      const member = memberMatch[2].trim();

      // Ensure class exists
      if (!nodeMap.has(className)) {
        nodeMap.set(className, {
          id: className,
          label: className,
          shape: 'rect',
          x: nodeX,
          y: nodeY,
          attributes: [],
          methods: []
        });
        nodeY += 120;
        if (nodeY > 400) { nodeY = 100; nodeX += 200; }
      }

      const classNode = nodeMap.get(className);
      if (member.includes('(') && member.includes(')')) {
        classNode.methods.push(member);
      } else {
        classNode.attributes.push(member);
      }
      continue;
    }

    // Parse relationship with UML notation
    // Patterns: <|-- inheritance, *-- composition, o-- aggregation, ..> dependency, ..|> realization
    const relMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*(<\|--|<\|\.\.|\*--|o--|--|\.\.>|\.\.|\<--|--\>|<--)\s*([A-Za-z0-9_]+)(?:\s*:\s*(.*))?$/);
    if (relMatch) {
      const fromId = relMatch[1];
      const arrow = relMatch[2];
      const toId = relMatch[3];
      const label = relMatch[4] ? unescapeLabel(relMatch[4]) : '';

      // Map arrow syntax to relationship type
      let relType = 'association';
      switch (arrow) {
        case '<|--':
        case '<|..':
          relType = arrow === '<|..' ? 'realization' : 'inheritance';
          break;
        case '*--':
          relType = 'composition';
          break;
        case 'o--':
          relType = 'aggregation';
          break;
        case '..>':
        case '..':
          relType = 'dependency';
          break;
        case '-->':
        case '<--':
        case '--':
        default:
          relType = 'association';
      }

      [fromId, toId].forEach(id => {
        if (!nodeMap.has(id)) {
          nodeMap.set(id, {
            id,
            label: id,
            shape: 'rect',
            x: nodeX,
            y: nodeY,
            attributes: [],
            methods: [],
            stereotype: null
          });
          nodeY += 120;
          if (nodeY > 400) { nodeY = 100; nodeX += 200; }
        }
      });

      model.edges.push({
        id: `edge_${model.edges.length}`,
        from: fromId,
        to: toId,
        label,
        type: relType
      });
    }
  }

  model.nodes = Array.from(nodeMap.values());
  return model;
}

/**
 * Parse a state diagram
 */
function parseStateDiagram(lines) {
  const model = {
    type: 'stateDiagram',
    direction: 'TD',
    nodes: [],
    edges: []
  };

  const nodeMap = new Map();
  let nodeX = 100;
  let nodeY = 100;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (trimmed.toLowerCase().startsWith('statediagram')) continue;

    // Parse state definition: StateName : Label
    const stateDefMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*:\s*(.+)$/);
    if (stateDefMatch && !trimmed.includes('-->')) {
      const id = stateDefMatch[1];
      const label = unescapeLabel(stateDefMatch[2]);
      if (!nodeMap.has(id)) {
        nodeMap.set(id, { id, label, shape: 'rounded', x: nodeX, y: nodeY });
        nodeY += 100;
        if (nodeY > 400) { nodeY = 100; nodeX += 200; }
      } else {
        nodeMap.get(id).label = label;
      }
      continue;
    }

    // Parse transition: StateA --> StateB : label
    const transMatch = trimmed.match(/^([A-Za-z0-9_\[\]\*]+)\s*-->\s*([A-Za-z0-9_\[\]\*]+)(?:\s*:\s*(.*))?$/);
    if (transMatch) {
      let fromId = transMatch[1];
      let toId = transMatch[2];
      const label = transMatch[3] ? unescapeLabel(transMatch[3]) : '';

      // Handle special states [*] - these are initial/final pseudo-states
      const fromIsInitial = fromId === '[*]';
      const toIsFinal = toId === '[*]';
      if (fromIsInitial) fromId = '__initial__';
      if (toIsFinal) toId = '__final__';

      // Create nodes if they don't exist
      if (fromIsInitial && !nodeMap.has(fromId)) {
        nodeMap.set(fromId, {
          id: fromId,
          label: '',
          shape: 'circle',
          stateType: 'initial',
          x: nodeX,
          y: nodeY
        });
        nodeY += 100;
        if (nodeY > 400) { nodeY = 100; nodeX += 200; }
      }
      if (toIsFinal && !nodeMap.has(toId)) {
        nodeMap.set(toId, {
          id: toId,
          label: '',
          shape: 'circle',
          stateType: 'final',
          x: nodeX,
          y: nodeY
        });
        nodeY += 100;
        if (nodeY > 400) { nodeY = 100; nodeX += 200; }
      }

      // Create regular state nodes
      [fromId, toId].forEach(id => {
        if (!nodeMap.has(id)) {
          nodeMap.set(id, {
            id,
            label: id,
            shape: 'rounded',
            x: nodeX,
            y: nodeY
          });
          nodeY += 100;
          if (nodeY > 400) { nodeY = 100; nodeX += 200; }
        }
      });

      model.edges.push({
        id: `edge_${model.edges.length}`,
        from: fromId,
        to: toId,
        label,
        type: 'arrow'
      });
    }
  }

  model.nodes = Array.from(nodeMap.values());
  return model;
}

/**
 * Parse ER cardinality symbol (left side of relationship)
 * Left side symbols: || (one), |o (zero-one), }| (one-many), }o (zero-many)
 */
function parseLeftCardinality(symbol) {
  switch (symbol) {
    case '||': return 'one';
    case '|o': return 'zero-one';
    case '}|': return 'one-many';
    case '}o': return 'zero-many';
    case 'o|': return 'zero-one';  // Alternative form
    default: return 'one';
  }
}

/**
 * Parse ER cardinality symbol (right side of relationship)
 * Right side symbols: || (one), o| (zero-one), |{ (one-many), o{ (zero-many)
 */
function parseRightCardinality(symbol) {
  switch (symbol) {
    case '||': return 'one';
    case 'o|': return 'zero-one';
    case '|{': return 'one-many';
    case 'o{': return 'zero-many';
    case '|o': return 'zero-one';  // Alternative form
    default: return 'one';
  }
}

/**
 * Parse an ER diagram
 */
function parseERDiagram(lines) {
  const model = {
    type: 'erDiagram',
    direction: 'TD',  // Mermaid ER diagrams don't support direction, always render top-down
    nodes: [],
    edges: []
  };

  const nodeMap = new Map();
  let nodeX = 100;
  let nodeY = 100;
  let currentEntity = null;  // Track entity block for attribute parsing

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (trimmed.toLowerCase() === 'erdiagram') continue;

    // Check for closing brace (end of entity block)
    if (currentEntity && trimmed === '}') {
      currentEntity = null;
      continue;
    }

    // If inside an entity block, parse attributes
    if (currentEntity) {
      // Parse attribute line: type name "comment" or PK type name "comment"
      // Examples: string name, PK int id, FK string customer_id "foreign key"
      const attrMatch = trimmed.match(/^(PK\s+|FK\s+)?(\w+)\s+(\w+)(?:\s+"([^"]*)")?$/);
      if (attrMatch) {
        const prefix = attrMatch[1] ? attrMatch[1].trim() : '';
        const attrType = attrMatch[2];
        const attrName = attrMatch[3];
        const comment = attrMatch[4] || '';

        // Format: "PK type name" or "FK type name" or "type name"
        let attrString = prefix ? `${prefix} ${attrType} ${attrName}` : `${attrType} ${attrName}`;
        if (comment) {
          attrString += ` "${comment}"`;
        }

        currentEntity.attributes.push(attrString);
      }
      continue;
    }

    // Parse entity definition: ENTITY { (start of block)
    const entityMatch = trimmed.match(/^([A-Z][A-Za-z0-9_]*)\s*\{$/);
    if (entityMatch) {
      const id = entityMatch[1];
      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id,
          label: id,
          shape: 'rect',
          x: nodeX,
          y: nodeY,
          attributes: []
        });
        nodeY += 120;
        if (nodeY > 400) { nodeY = 100; nodeX += 200; }
      }
      currentEntity = nodeMap.get(id);
      continue;
    }

    // Parse relationship: ENTITY1 ||--o{ ENTITY2 : "label"
    // Regex breakdown:
    // - ([A-Z][A-Za-z0-9_]*) : first entity name
    // - \s* : optional whitespace
    // - ([|o}]{1,2}) : left cardinality (||, |o, }|, }o, o|)
    // - -- : the connector
    // - ([|o{]{1,2}) : right cardinality (||, o|, |{, o{, |o)
    // - \s* : optional whitespace
    // - ([A-Z][A-Za-z0-9_]*) : second entity name
    // - \s*:\s* : colon with optional whitespace
    // - "?([^"]*)"? : quoted or unquoted label
    const relMatch = trimmed.match(/^([A-Z][A-Za-z0-9_]*)\s*([|o}]{1,2})--([|o{]{1,2})\s*([A-Z][A-Za-z0-9_]*)\s*:\s*"?([^"]*)"?$/);
    if (relMatch) {
      const fromId = relMatch[1];
      const leftCardinality = relMatch[2];
      const rightCardinality = relMatch[3];
      const toId = relMatch[4];
      const label = relMatch[5] || '';

      // Ensure entities exist
      [fromId, toId].forEach(id => {
        if (!nodeMap.has(id)) {
          nodeMap.set(id, {
            id,
            label: id,
            shape: 'rect',
            x: nodeX,
            y: nodeY,
            attributes: []
          });
          nodeY += 120;
          if (nodeY > 400) { nodeY = 100; nodeX += 200; }
        }
      });

      model.edges.push({
        id: `edge_${model.edges.length}`,
        from: fromId,
        to: toId,
        label: unescapeLabel(label),
        type: 'er-relationship',
        fromCardinality: parseLeftCardinality(leftCardinality),
        toCardinality: parseRightCardinality(rightCardinality)
      });
    }
  }

  model.nodes = Array.from(nodeMap.values());
  return model;
}

/**
 * Parse a Gantt chart
 */
function parseGanttChart(lines) {
  const model = {
    type: 'gantt',
    direction: 'TD',
    nodes: [],
    edges: [],
    ganttTitle: '',
    ganttDateFormat: 'YYYY-MM-DD',
    ganttAxisFormat: '',
    ganttSections: [],
    ganttTasks: []
  };

  let sectionIdCounter = 0;
  let taskIdCounter = 0;
  let currentSectionId = null;

  // Generate unique section ID
  function generateSectionId() {
    return `section_${sectionIdCounter++}`;
  }

  // Generate unique task ID
  function generateTaskId() {
    return `task_${taskIdCounter++}`;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (trimmed.toLowerCase() === 'gantt') continue;

    // Parse title
    const titleMatch = trimmed.match(/^title\s+(.+)$/i);
    if (titleMatch) {
      model.ganttTitle = titleMatch[1].trim();
      continue;
    }

    // Parse dateFormat
    const dateFormatMatch = trimmed.match(/^dateFormat\s+(.+)$/i);
    if (dateFormatMatch) {
      model.ganttDateFormat = dateFormatMatch[1].trim();
      continue;
    }

    // Parse axisFormat
    const axisFormatMatch = trimmed.match(/^axisFormat\s+(.+)$/i);
    if (axisFormatMatch) {
      model.ganttAxisFormat = axisFormatMatch[1].trim();
      continue;
    }

    // Parse tickInterval (ignore for now, but don't error on it)
    if (trimmed.match(/^tickInterval\s+/i)) {
      continue;
    }

    // Parse excludes (ignore for now)
    if (trimmed.match(/^excludes\s+/i)) {
      continue;
    }

    // Parse section
    const sectionMatch = trimmed.match(/^section\s+(.+)$/i);
    if (sectionMatch) {
      const sectionId = generateSectionId();
      currentSectionId = sectionId;
      model.ganttSections.push({
        id: sectionId,
        name: sectionMatch[1].trim()
      });
      continue;
    }

    // Parse task line
    // Format: TaskName :status, taskId, startDate|after task, duration
    // Examples:
    //   Design    :a1, 2024-01-01, 7d
    //   Develop   :a2, after a1, 14d
    //   Test      :crit, a3, after a2, 7d
    //   Deploy    :milestone, a4, after a3, 1d
    //   Done Task :done, a5, 2024-01-01, 3d
    //   Active    :active, a6, after a5, 2d

    // First, split by colon to get task name and definition
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const taskLabel = trimmed.substring(0, colonIndex).trim();
      const definition = trimmed.substring(colonIndex + 1).trim();

      // Parse the definition parts
      const parts = definition.split(',').map(p => p.trim());

      // Determine which parts are status modifiers, taskId, start, and duration
      let status = 'normal';
      let taskId = null;
      let startDate = '';
      let duration = '1d';
      let dependencies = [];

      // Status modifiers: done, active, crit, milestone
      const statusModifiers = ['done', 'active', 'crit', 'milestone'];
      let partIndex = 0;

      // Check for status modifiers at the beginning
      while (partIndex < parts.length && statusModifiers.includes(parts[partIndex].toLowerCase())) {
        const modifier = parts[partIndex].toLowerCase();
        if (modifier === 'crit') {
          status = 'critical';
        } else {
          status = modifier;
        }
        partIndex++;
      }

      // Next should be taskId (if it looks like an identifier)
      if (partIndex < parts.length) {
        const possibleTaskId = parts[partIndex];
        // TaskId is typically alphanumeric, check if it's not a date or "after X"
        if (!possibleTaskId.match(/^\d{4}-\d{2}-\d{2}/) && !possibleTaskId.toLowerCase().startsWith('after ')) {
          taskId = possibleTaskId;
          partIndex++;
        }
      }

      // Next should be start date or "after taskId"
      if (partIndex < parts.length) {
        const startPart = parts[partIndex];
        if (startPart.toLowerCase().startsWith('after ')) {
          const depTaskId = startPart.substring(6).trim();
          dependencies.push(depTaskId);
          startDate = `after ${depTaskId}`;
        } else {
          startDate = startPart;
        }
        partIndex++;
      }

      // Last should be duration
      if (partIndex < parts.length) {
        duration = parts[partIndex];
      }

      // If no taskId was found, generate one
      if (!taskId) {
        taskId = `t${taskIdCounter}`;
      }

      const task = {
        id: generateTaskId(),
        label: taskLabel,
        sectionId: currentSectionId,
        taskId: taskId,
        startDate: startDate,
        duration: duration,
        status: status,
        dependencies: dependencies
      };

      model.ganttTasks.push(task);
    }
  }

  return model;
}

/**
 * Parse a pie chart
 */
function parsePieChart(lines) {
  const model = {
    type: 'pie',
    direction: 'TD',
    nodes: [],
    edges: [],
    pieTitle: '',
    pieShowData: false,
    pieSegments: []
  };

  let segmentIdCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;

    // Check for pie header with optional showData
    if (trimmed.toLowerCase().startsWith('pie')) {
      if (trimmed.toLowerCase().includes('showdata')) {
        model.pieShowData = true;
      }
      continue;
    }

    // Check for title
    const titleMatch = trimmed.match(/^title\s+(.+)$/i);
    if (titleMatch) {
      model.pieTitle = titleMatch[1].trim();
      continue;
    }

    // Parse segment: "Label" : value
    const segmentMatch = trimmed.match(/^"([^"]+)"\s*:\s*(\d+(?:\.\d+)?)$/);
    if (segmentMatch) {
      model.pieSegments.push({
        id: `seg_${segmentIdCounter++}`,
        label: segmentMatch[1],
        value: parseFloat(segmentMatch[2])
      });
    }
  }

  return model;
}

/**
 * Parse mermaid code into a model
 */
export function parseMermaidCode(code) {
  if (!code || typeof code !== 'string') {
    return null;
  }

  // Remove code block markers if present
  code = code.replace(/^```mermaid\s*/i, '').replace(/\s*```$/, '');

  const lines = code.split('\n');
  const firstLine = lines[0]?.trim().toLowerCase() || '';

  let model;

  // Detect diagram type
  if (firstLine.startsWith('sequencediagram')) {
    model = parseSequenceDiagram(lines);
  } else if (firstLine.startsWith('flowchart') || firstLine.startsWith('graph')) {
    model = parseFlowchart(lines);
  } else if (firstLine.startsWith('classdiagram')) {
    model = parseClassDiagram(lines);
  } else if (firstLine.startsWith('statediagram')) {
    model = parseStateDiagram(lines);
  } else if (firstLine.startsWith('erdiagram')) {
    model = parseERDiagram(lines);
  } else if (firstLine.startsWith('pie')) {
    model = parsePieChart(lines);
  } else if (firstLine.startsWith('gantt')) {
    model = parseGanttChart(lines);
  } else {
    // Default to flowchart
    model = parseFlowchart(lines);
  }

  // Apply auto-layout to position nodes hierarchically
  // This ensures the visual editor canvas matches the mermaid preview
  if (model && model.nodes && model.nodes.length > 0) {
    model = applyAutoLayout(model);
  }

  return model;
}

/**
 * Validate if code can be parsed
 */
export function canParseMermaid(code) {
  if (!code) return false;

  const cleanCode = code.replace(/^```mermaid\s*/i, '').replace(/\s*```$/, '').trim().toLowerCase();

  // Check for supported diagram types
  return cleanCode.startsWith('flowchart') ||
         cleanCode.startsWith('graph') ||
         cleanCode.startsWith('sequencediagram') ||
         cleanCode.startsWith('classdiagram') ||
         cleanCode.startsWith('statediagram') ||
         cleanCode.startsWith('erdiagram') ||
         cleanCode.startsWith('pie') ||
         cleanCode.startsWith('gantt');
}
