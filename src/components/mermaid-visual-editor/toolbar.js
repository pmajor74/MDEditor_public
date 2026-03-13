/**
 * Toolbar Component for Visual Mermaid Editor
 *
 * Provides controls for diagram editing: add nodes, shapes, undo/redo, etc.
 */

import { SHAPES, EDGE_TYPES, DIRECTIONS, SEQUENCE_MESSAGE_TYPES, CLASS_RELATIONSHIP_TYPES, STATE_SHAPES, ER_CARDINALITY_TYPES } from './shapes.js';

/**
 * Create the toolbar
 */
export function createToolbar(container, options = {}) {
  const state = {
    diagramType: options.diagramType || 'flowchart',
    direction: options.direction || 'TD',
    onAddNode: options.onAddNode || null,
    onAddParticipant: options.onAddParticipant || null,
    onAddMessage: options.onAddMessage || null,
    onAddNote: options.onAddNote || null,
    onDelete: options.onDelete || null,
    onUndo: options.onUndo || null,
    onRedo: options.onRedo || null,
    onDirectionChange: options.onDirectionChange || null,
    onTypeChange: options.onTypeChange || null,
    onEdgeTypeChange: options.onEdgeTypeChange || null,
    onAutoLayout: options.onAutoLayout || null,
    getSelectedEdge: options.getSelectedEdge || null,
    getParticipants: options.getParticipants || null,
    getSelection: options.getSelection || null,
    // ER diagram callbacks
    onAddERRelationship: options.onAddERRelationship || null,
    onERCardinalityChange: options.onERCardinalityChange || null,
    getEntities: options.getEntities || null,
    // Zoom/pan callbacks
    onZoomIn: options.onZoomIn || null,
    onZoomOut: options.onZoomOut || null,
    onZoomReset: options.onZoomReset || null,
    onFitToContent: options.onFitToContent || null,
    // Grid callbacks
    onToggleGrid: options.onToggleGrid || null,
    onToggleSnap: options.onToggleSnap || null,
    // State
    showGrid: false,
    snapToGrid: false
  };

  // Build toolbar HTML
  const toolbar = document.createElement('div');
  toolbar.className = 've-toolbar';
  toolbar.innerHTML = `
    <div class="ve-toolbar-group">
      <select id="ve-diagram-type" class="ve-select" title="Diagram Type">
        <option value="flowchart">Flowchart</option>
        <option value="sequence">Sequence</option>
        <option value="classDiagram">Class Diagram</option>
        <option value="stateDiagram">State Diagram</option>
        <option value="erDiagram">ER Diagram</option>
        <option value="pie">Pie Chart</option>
        <option value="gantt">Gantt Chart</option>
      </select>
      <select id="ve-direction" class="ve-select" title="Direction">
        <option value="TD">Top-Down</option>
        <option value="LR">Left-Right</option>
        <option value="BT">Bottom-Top</option>
        <option value="RL">Right-Left</option>
      </select>
    </div>
    <div class="ve-toolbar-divider"></div>
    <div class="ve-toolbar-group ve-node-controls">
      <button id="ve-add-node" class="ve-btn" title="Add Node">
        <span class="ve-btn-icon">+</span>
        <span class="ve-btn-text">Add Node</span>
      </button>
      <div class="ve-dropdown" id="ve-shape-dropdown">
        <button class="ve-btn ve-dropdown-toggle" title="Select Shape">
          <span class="ve-btn-icon">▢</span>
          <span class="ve-btn-caret">▼</span>
        </button>
        <div class="ve-dropdown-menu">
          ${Object.entries(SHAPES).map(([key, shape]) => `
            <button class="ve-dropdown-item" data-shape="${key}">
              <span class="ve-shape-icon">${shape.icon}</span>
              <span class="ve-shape-name">${shape.name}</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="ve-toolbar-group ve-sequence-controls" style="display: none;">
      <button id="ve-add-participant" class="ve-btn" title="Add Participant">
        <span class="ve-btn-icon">+</span>
        <span class="ve-btn-text">Add Participant</span>
      </button>
      <div class="ve-dropdown" id="ve-note-dropdown">
        <button class="ve-btn ve-dropdown-toggle" title="Add Note">
          <span class="ve-btn-icon">📝</span>
          <span class="ve-btn-text">Note</span>
          <span class="ve-btn-caret">▼</span>
        </button>
        <div class="ve-dropdown-menu">
          <button class="ve-dropdown-item" data-note-position="right of">
            <span>Note Right</span>
          </button>
          <button class="ve-dropdown-item" data-note-position="left of">
            <span>Note Left</span>
          </button>
          <button class="ve-dropdown-item" data-note-position="over">
            <span>Note Over</span>
          </button>
        </div>
      </div>
    </div>
    <div class="ve-toolbar-group ve-message-controls" style="display: none;">
      <label class="ve-toolbar-label">From:</label>
      <select id="ve-msg-from" class="ve-select ve-participant-select" title="From Participant"></select>
      <label class="ve-toolbar-label">To:</label>
      <select id="ve-msg-to" class="ve-select ve-participant-select" title="To Participant"></select>
      <button id="ve-add-message" class="ve-btn" title="Add Message">
        <span class="ve-btn-icon">→</span>
        <span class="ve-btn-text">Add</span>
      </button>
    </div>
    <div class="ve-toolbar-group ve-class-controls" style="display: none;">
      <button id="ve-add-class" class="ve-btn" title="Add Class">
        <span class="ve-btn-icon">+</span>
        <span class="ve-btn-text">Add Class</span>
      </button>
      <button id="ve-add-interface" class="ve-btn" title="Add Interface">
        <span class="ve-btn-icon">◇</span>
        <span class="ve-btn-text">Interface</span>
      </button>
      <select id="ve-class-rel-type" class="ve-select" title="Relationship Type">
        ${Object.entries(CLASS_RELATIONSHIP_TYPES).map(([key, type]) =>
          `<option value="${key}">${type.name}</option>`
        ).join('')}
      </select>
    </div>
    <div class="ve-toolbar-group ve-state-controls" style="display: none;">
      <button id="ve-add-state" class="ve-btn" title="Add State">
        <span class="ve-btn-icon">▢</span>
        <span class="ve-btn-text">Add State</span>
      </button>
      <button id="ve-add-initial" class="ve-btn" title="Add Initial State">
        <span class="ve-btn-icon">●</span>
        <span class="ve-btn-text">Initial</span>
      </button>
      <button id="ve-add-final" class="ve-btn" title="Add Final State">
        <span class="ve-btn-icon">◉</span>
        <span class="ve-btn-text">Final</span>
      </button>
    </div>
    <div class="ve-toolbar-group ve-er-controls" style="display: none;">
      <button id="ve-add-entity" class="ve-btn" title="Add Entity">
        <span class="ve-btn-icon">+</span>
        <span class="ve-btn-text">Add Entity</span>
      </button>
      <div class="ve-toolbar-divider-inline"></div>
      <label class="ve-toolbar-label">From:</label>
      <select id="ve-er-from" class="ve-select ve-entity-select" title="From Entity"></select>
      <select id="ve-er-cardinality-from" class="ve-select ve-cardinality-select" title="From Cardinality">
        ${Object.entries(ER_CARDINALITY_TYPES).map(([key, type]) =>
          `<option value="${key}">${type.name}</option>`
        ).join('')}
      </select>
      <span class="ve-toolbar-label">to</span>
      <select id="ve-er-cardinality-to" class="ve-select ve-cardinality-select" title="To Cardinality">
        ${Object.entries(ER_CARDINALITY_TYPES).map(([key, type]) =>
          `<option value="${key}">${type.name}</option>`
        ).join('')}
      </select>
      <select id="ve-er-to" class="ve-select ve-entity-select" title="To Entity"></select>
      <button id="ve-add-er-rel" class="ve-btn" title="Add Relationship">
        <span class="ve-btn-icon">↔</span>
        <span class="ve-btn-text">Add Rel</span>
      </button>
    </div>
    <div class="ve-toolbar-divider"></div>
    <div class="ve-toolbar-group">
      <label class="ve-toolbar-label">Arrow:</label>
      <select id="ve-edge-type" class="ve-select" title="Arrow Type">
        ${Object.entries(EDGE_TYPES).map(([key, type]) => `
          <option value="${key}">${type.name}</option>
        `).join('')}
      </select>
    </div>
    <div class="ve-toolbar-divider"></div>
    <div class="ve-toolbar-group">
      <button id="ve-delete" class="ve-btn ve-btn-danger" title="Delete Selected">
        <span class="ve-btn-icon">🗑</span>
        <span class="ve-btn-text">Delete</span>
      </button>
    </div>
    <div class="ve-toolbar-divider"></div>
    <div class="ve-toolbar-group">
      <button id="ve-undo" class="ve-btn" title="Undo (Ctrl+Z)" disabled>
        <span class="ve-btn-icon">↶</span>
      </button>
      <button id="ve-redo" class="ve-btn" title="Redo (Ctrl+Y)" disabled>
        <span class="ve-btn-icon">↷</span>
      </button>
    </div>
    <div class="ve-toolbar-divider"></div>
    <div class="ve-toolbar-group">
      <button id="ve-auto-layout" class="ve-btn" title="Auto-arrange nodes to match preview">
        <span class="ve-btn-icon">⊞</span>
        <span class="ve-btn-text">Auto Layout</span>
      </button>
    </div>
    <div class="ve-toolbar-divider"></div>
    <div class="ve-toolbar-group ve-zoom-controls">
      <button id="ve-zoom-out" class="ve-btn ve-btn-small" title="Zoom Out (Scroll Down)">
        <span class="ve-btn-icon">−</span>
      </button>
      <span id="ve-zoom-level" class="ve-zoom-display" title="Current Zoom Level">100%</span>
      <button id="ve-zoom-in" class="ve-btn ve-btn-small" title="Zoom In (Scroll Up)">
        <span class="ve-btn-icon">+</span>
      </button>
      <button id="ve-zoom-fit" class="ve-btn ve-btn-small" title="Fit to Content">
        <span class="ve-btn-icon">⊡</span>
      </button>
      <button id="ve-zoom-reset" class="ve-btn ve-btn-small" title="Reset Zoom (100%)">
        <span class="ve-btn-icon">↺</span>
      </button>
    </div>
    <div class="ve-toolbar-divider"></div>
    <div class="ve-toolbar-group">
      <button id="ve-grid-toggle" class="ve-btn ve-btn-small" title="Toggle Grid">
        <span class="ve-btn-icon">#</span>
      </button>
      <button id="ve-snap-toggle" class="ve-btn ve-btn-small" title="Toggle Snap to Grid">
        <span class="ve-btn-icon">⊞</span>
      </button>
    </div>
    <div class="ve-toolbar-spacer"></div>
    <div class="ve-toolbar-group">
      <span class="ve-toolbar-hint">Drag nodes to move • Double-click to edit • Sequence: drag messages to reorder</span>
    </div>
  `;

  container.appendChild(toolbar);

  // Get element references
  const typeSelect = toolbar.querySelector('#ve-diagram-type');
  const directionSelect = toolbar.querySelector('#ve-direction');
  const addNodeBtn = toolbar.querySelector('#ve-add-node');
  const addParticipantBtn = toolbar.querySelector('#ve-add-participant');
  const addMessageBtn = toolbar.querySelector('#ve-add-message');
  const msgFromSelect = toolbar.querySelector('#ve-msg-from');
  const msgToSelect = toolbar.querySelector('#ve-msg-to');
  const nodeControls = toolbar.querySelector('.ve-node-controls');
  const sequenceControls = toolbar.querySelector('.ve-sequence-controls');
  const messageControls = toolbar.querySelector('.ve-message-controls');
  const classControls = toolbar.querySelector('.ve-class-controls');
  const stateControls = toolbar.querySelector('.ve-state-controls');
  const erControls = toolbar.querySelector('.ve-er-controls');
  const shapeDropdown = toolbar.querySelector('#ve-shape-dropdown');
  // Class diagram controls
  const addClassBtn = toolbar.querySelector('#ve-add-class');
  const addInterfaceBtn = toolbar.querySelector('#ve-add-interface');
  const classRelTypeSelect = toolbar.querySelector('#ve-class-rel-type');
  // State diagram controls
  const addStateBtn = toolbar.querySelector('#ve-add-state');
  const addInitialBtn = toolbar.querySelector('#ve-add-initial');
  const addFinalBtn = toolbar.querySelector('#ve-add-final');
  // ER diagram controls
  const addEntityBtn = toolbar.querySelector('#ve-add-entity');
  const erFromSelect = toolbar.querySelector('#ve-er-from');
  const erToSelect = toolbar.querySelector('#ve-er-to');
  const erCardinalityFromSelect = toolbar.querySelector('#ve-er-cardinality-from');
  const erCardinalityToSelect = toolbar.querySelector('#ve-er-cardinality-to');
  const addERRelBtn = toolbar.querySelector('#ve-add-er-rel');
  const edgeTypeSelect = toolbar.querySelector('#ve-edge-type');
  const deleteBtn = toolbar.querySelector('#ve-delete');
  const undoBtn = toolbar.querySelector('#ve-undo');
  const redoBtn = toolbar.querySelector('#ve-redo');
  const autoLayoutBtn = toolbar.querySelector('#ve-auto-layout');
  // Zoom controls
  const zoomInBtn = toolbar.querySelector('#ve-zoom-in');
  const zoomOutBtn = toolbar.querySelector('#ve-zoom-out');
  const zoomResetBtn = toolbar.querySelector('#ve-zoom-reset');
  const zoomFitBtn = toolbar.querySelector('#ve-zoom-fit');
  const zoomLevelDisplay = toolbar.querySelector('#ve-zoom-level');
  // Grid controls
  const gridToggleBtn = toolbar.querySelector('#ve-grid-toggle');
  const snapToggleBtn = toolbar.querySelector('#ve-snap-toggle');

  let selectedShape = 'rect';
  let selectedEdgeType = 'arrow';

  // Set initial values
  typeSelect.value = state.diagramType;
  directionSelect.value = state.direction;

  // Update toolbar controls based on diagram type
  function updateControlsForDiagramType(type) {
    const isSequence = type === 'sequence';
    const isClass = type === 'classDiagram';
    const isState = type === 'stateDiagram';
    const isER = type === 'erDiagram';
    const isPie = type === 'pie';
    const isGantt = type === 'gantt';
    const isFlowchart = type === 'flowchart' || type === 'graph';
    const isTableBased = isPie || isGantt; // Types that use table editor instead of canvas

    // Disable direction for diagrams that don't support it (ER, sequence, pie, and gantt)
    directionSelect.disabled = isSequence || isER || isPie || isGantt;

    // Show/hide appropriate controls - all hidden for table-based editors
    nodeControls.style.display = isFlowchart ? 'flex' : 'none';
    sequenceControls.style.display = isSequence ? 'flex' : 'none';
    messageControls.style.display = isSequence ? 'flex' : 'none';
    classControls.style.display = isClass ? 'flex' : 'none';
    stateControls.style.display = isState ? 'flex' : 'none';
    erControls.style.display = isER ? 'flex' : 'none';

    // Hide edge type dropdown for table-based editors (no edges) and state diagrams
    // (state diagrams only support --> syntax, so arrow options are misleading)
    edgeTypeSelect.parentElement.style.display = (isTableBased || isState) ? 'none' : 'flex';

    // Hide delete button for table-based editors (use table UI instead)
    deleteBtn.parentElement.style.display = isTableBased ? 'none' : 'flex';

    // Hide auto-layout for table-based editors
    autoLayoutBtn.parentElement.style.display = isTableBased ? 'none' : 'flex';

    // Update edge type dropdown based on diagram type
    if (!isTableBased) {
      updateEdgeTypeDropdown(type);
    }

    // Update participant dropdowns when switching to sequence
    if (isSequence) {
      updateParticipantDropdowns();
    }

    // Update entity dropdowns when switching to ER diagram
    if (isER) {
      updateEntityDropdowns();
    }
  }

  // Update edge type dropdown based on diagram type
  function updateEdgeTypeDropdown(diagramType) {
    let types;
    let defaultType;

    switch (diagramType) {
      case 'sequence':
        types = SEQUENCE_MESSAGE_TYPES;
        defaultType = 'sync';
        break;
      case 'classDiagram':
        types = CLASS_RELATIONSHIP_TYPES;
        defaultType = 'association';
        break;
      default:
        types = EDGE_TYPES;
        defaultType = 'arrow';
    }

    edgeTypeSelect.innerHTML = Object.entries(types).map(([key, type]) =>
      `<option value="${key}">${type.name}</option>`
    ).join('');
    // Reset selected edge type
    selectedEdgeType = defaultType;
    edgeTypeSelect.value = selectedEdgeType;
  }

  // Update participant dropdowns with current participants
  function updateParticipantDropdowns() {
    if (!state.getParticipants) return;

    const participants = state.getParticipants();
    const options = participants.map(p =>
      `<option value="${p.id}">${p.label || p.id}</option>`
    ).join('');

    msgFromSelect.innerHTML = options;
    msgToSelect.innerHTML = options;

    // Set second option for 'to' if available
    if (participants.length > 1) {
      msgToSelect.selectedIndex = 1;
    }
  }

  // Update entity dropdowns with current entities (for ER diagrams)
  function updateEntityDropdowns() {
    if (!state.getEntities) return;

    const entities = state.getEntities();
    const options = entities.map(e =>
      `<option value="${e.id}">${e.label || e.id}</option>`
    ).join('');

    erFromSelect.innerHTML = options;
    erToSelect.innerHTML = options;

    // Set second option for 'to' if available
    if (entities.length > 1) {
      erToSelect.selectedIndex = 1;
    }
  }

  // Update dropdowns based on current selection (smart defaults)
  function updateDropdownsFromSelection() {
    if (!state.getSelection || !state.getParticipants) return;

    const selection = state.getSelection();
    const participants = state.getParticipants();

    if (participants.length < 2) return;

    // Sort participants by X position (left to right)
    const sorted = [...participants].sort((a, b) => a.x - b.x);

    if (selection && selection.nodeId) {
      // Find the selected participant's index in sorted order
      const selectedIndex = sorted.findIndex(p => p.id === selection.nodeId);

      if (selectedIndex !== -1) {
        let fromId, toId;

        if (selectedIndex === sorted.length - 1) {
          // Selected is the rightmost → connect previous to selected
          fromId = sorted[selectedIndex - 1].id;
          toId = sorted[selectedIndex].id;
        } else {
          // Normal case → connect selected to next right
          fromId = sorted[selectedIndex].id;
          toId = sorted[selectedIndex + 1].id;
        }

        // Update dropdown selections
        msgFromSelect.value = fromId;
        msgToSelect.value = toId;
      }
    } else {
      // No selection → default to first two
      msgFromSelect.value = sorted[0].id;
      msgToSelect.value = sorted[1].id;
    }
  }

  // Initialize controls visibility
  updateControlsForDiagramType(state.diagramType);

  // Event handlers
  typeSelect.addEventListener('change', (e) => {
    state.diagramType = e.target.value;
    // Update direction visibility for sequence/ER/pie/gantt diagrams (they don't support direction in Mermaid)
    directionSelect.disabled = e.target.value === 'sequence' || e.target.value === 'erDiagram' || e.target.value === 'pie' || e.target.value === 'gantt';
    // Update toolbar controls
    updateControlsForDiagramType(e.target.value);
    if (state.onTypeChange) {
      state.onTypeChange(e.target.value);
    }
  });

  directionSelect.addEventListener('change', (e) => {
    state.direction = e.target.value;
    if (state.onDirectionChange) {
      state.onDirectionChange(e.target.value);
    }
  });

  // Edge type change - applies to selected edge
  edgeTypeSelect.addEventListener('change', (e) => {
    selectedEdgeType = e.target.value;
    if (state.onEdgeTypeChange) {
      state.onEdgeTypeChange(e.target.value);
    }
  });

  addNodeBtn.addEventListener('click', () => {
    if (state.onAddNode) {
      state.onAddNode(selectedShape);
    }
  });

  addParticipantBtn.addEventListener('click', () => {
    if (state.onAddParticipant) {
      state.onAddParticipant();
      // Update dropdowns after adding participant
      updateParticipantDropdowns();
    }
  });

  addMessageBtn.addEventListener('click', () => {
    if (state.onAddMessage) {
      const fromId = msgFromSelect.value;
      const toId = msgToSelect.value;
      state.onAddMessage(selectedEdgeType, fromId, toId);
    }
  });

  // Class diagram button handlers
  addClassBtn.addEventListener('click', () => {
    if (state.onAddNode) {
      state.onAddNode('rect', { stereotype: null });
    }
  });

  addInterfaceBtn.addEventListener('click', () => {
    if (state.onAddNode) {
      state.onAddNode('rect', { stereotype: 'interface' });
    }
  });

  classRelTypeSelect.addEventListener('change', (e) => {
    selectedEdgeType = e.target.value;
    if (state.onEdgeTypeChange) {
      state.onEdgeTypeChange(e.target.value);
    }
  });

  // State diagram button handlers
  addStateBtn.addEventListener('click', () => {
    if (state.onAddNode) {
      state.onAddNode('rounded', { stateType: 'state' });
    }
  });

  addInitialBtn.addEventListener('click', () => {
    if (state.onAddNode) {
      state.onAddNode('circle', { stateType: 'initial' });
    }
  });

  addFinalBtn.addEventListener('click', () => {
    if (state.onAddNode) {
      state.onAddNode('circle', { stateType: 'final' });
    }
  });

  // ER diagram button handlers
  addEntityBtn.addEventListener('click', () => {
    if (state.onAddNode) {
      // Generate a meaningful default name for the entity
      const entities = state.getEntities ? state.getEntities() : [];
      const entityNum = entities.length + 1;
      state.onAddNode('rect', {
        label: `ENTITY${entityNum}`,
        attributes: []
      });
      // Update dropdowns after adding entity
      updateEntityDropdowns();
    }
  });

  // Add ER relationship button handler
  addERRelBtn.addEventListener('click', () => {
    if (state.onAddERRelationship) {
      const fromId = erFromSelect.value;
      const toId = erToSelect.value;
      const fromCardinality = erCardinalityFromSelect.value;
      const toCardinality = erCardinalityToSelect.value;
      state.onAddERRelationship(fromId, toId, fromCardinality, toCardinality);
    }
  });

  // ER cardinality change handlers - update selected edge if applicable
  erCardinalityFromSelect.addEventListener('change', () => {
    if (state.onERCardinalityChange) {
      state.onERCardinalityChange('from', erCardinalityFromSelect.value);
    }
  });

  erCardinalityToSelect.addEventListener('change', () => {
    if (state.onERCardinalityChange) {
      state.onERCardinalityChange('to', erCardinalityToSelect.value);
    }
  });

  // Shape dropdown toggle
  const dropdownToggle = shapeDropdown.querySelector('.ve-dropdown-toggle');
  const dropdownMenu = shapeDropdown.querySelector('.ve-dropdown-menu');

  dropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('show');
  });

  // Shape selection - only updates the selected shape, doesn't add a node
  dropdownMenu.querySelectorAll('.ve-dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
      selectedShape = item.dataset.shape;
      const shape = SHAPES[selectedShape];
      dropdownToggle.querySelector('.ve-btn-icon').textContent = shape.icon;
      dropdownMenu.classList.remove('show');
      // Shape is now selected - user clicks "Add Node" to actually add it
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    dropdownMenu.classList.remove('show');
  });

  // Note dropdown event handlers
  const noteDropdown = toolbar.querySelector('#ve-note-dropdown');
  if (noteDropdown) {
    const noteToggle = noteDropdown.querySelector('.ve-dropdown-toggle');
    const noteMenu = noteDropdown.querySelector('.ve-dropdown-menu');

    noteToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      noteMenu.classList.toggle('show');
      // Close shape dropdown if open
      dropdownMenu.classList.remove('show');
    });

    noteMenu.querySelectorAll('.ve-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const position = item.dataset.notePosition;
        const participantId = msgFromSelect.value; // Use selected "From" participant
        if (state.onAddNote && participantId) {
          state.onAddNote(position, participantId);
        }
        noteMenu.classList.remove('show');
      });
    });

    // Close note dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!noteDropdown.contains(e.target)) {
        noteMenu.classList.remove('show');
      }
    });
  }

  deleteBtn.addEventListener('click', () => {
    if (state.onDelete) {
      state.onDelete();
    }
  });

  undoBtn.addEventListener('click', () => {
    if (state.onUndo) {
      state.onUndo();
    }
  });

  redoBtn.addEventListener('click', () => {
    if (state.onRedo) {
      state.onRedo();
    }
  });

  autoLayoutBtn.addEventListener('click', () => {
    if (state.onAutoLayout) {
      state.onAutoLayout();
    }
  });

  // Zoom event handlers
  zoomInBtn.addEventListener('click', () => {
    if (state.onZoomIn) {
      state.onZoomIn();
    }
  });

  zoomOutBtn.addEventListener('click', () => {
    if (state.onZoomOut) {
      state.onZoomOut();
    }
  });

  zoomResetBtn.addEventListener('click', () => {
    if (state.onZoomReset) {
      state.onZoomReset();
    }
  });

  zoomFitBtn.addEventListener('click', () => {
    if (state.onFitToContent) {
      state.onFitToContent();
    }
  });

  // Grid event handlers
  gridToggleBtn.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    gridToggleBtn.classList.toggle('active', state.showGrid);
    if (state.onToggleGrid) {
      state.onToggleGrid(state.showGrid);
    }
  });

  snapToggleBtn.addEventListener('click', () => {
    state.snapToGrid = !state.snapToGrid;
    snapToggleBtn.classList.toggle('active', state.snapToGrid);
    if (state.onToggleSnap) {
      state.onToggleSnap(state.snapToGrid);
    }
  });

  // Public methods
  function setUndoEnabled(en) { undoBtn.disabled = !en; }
  function setRedoEnabled(en) { redoBtn.disabled = !en; }
  function setDeleteEnabled(en) { deleteBtn.disabled = !en; }

  function setDiagramType(type) {
    state.diagramType = type;
    typeSelect.value = type;
    directionSelect.disabled = type === 'sequence' || type === 'erDiagram' || type === 'pie' || type === 'gantt';
    updateControlsForDiagramType(type);
  }

  function setDirection(dir) { state.direction = dir; directionSelect.value = dir; }
  function setEdgeType(type) { selectedEdgeType = type; edgeTypeSelect.value = type; }
  function setEdgeTypeEnabled(enabled) { edgeTypeSelect.disabled = !enabled; }

  function updateEdgeTypeFromSelection() {
    if (!state.getSelectedEdge) return;
    const edge = state.getSelectedEdge();
    if (edge) { setEdgeType(edge.type || 'arrow'); setEdgeTypeEnabled(true); }
    else { setEdgeTypeEnabled(false); }
  }

  // Update ER cardinality dropdowns based on selected edge
  function updateERCardinalityFromSelection() {
    if (!state.getSelectedEdge) return;
    const edge = state.getSelectedEdge();
    if (edge && edge.fromCardinality !== undefined) {
      erCardinalityFromSelect.value = edge.fromCardinality || 'one';
      erCardinalityToSelect.value = edge.toCardinality || 'many';
    }
  }

  function setZoomLevel(scale) { zoomLevelDisplay.textContent = `${Math.round(scale * 100)}%`; }
  function setGridEnabled(en) { state.showGrid = en; gridToggleBtn.classList.toggle('active', en); }
  function setSnapEnabled(en) { state.snapToGrid = en; snapToggleBtn.classList.toggle('active', en); }
  function destroy() { toolbar.remove(); }

  return {
    setUndoEnabled,
    setRedoEnabled,
    setDeleteEnabled,
    setDiagramType,
    setDirection,
    setEdgeType,
    setEdgeTypeEnabled,
    updateEdgeTypeFromSelection,
    updateParticipantDropdowns,
    updateDropdownsFromSelection,
    updateEntityDropdowns,
    updateERCardinalityFromSelection,
    setZoomLevel,
    setGridEnabled,
    setSnapEnabled,
    destroy
  };
}
