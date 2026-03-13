/**
 * Canvas Core
 *
 * Main canvas setup, SVG creation, layers, and coordination of modules.
 */

import { SHAPES } from '../shapes.js';
import { createSelectionManager } from './canvas-selection.js';
import { createEditorsManager } from './canvas-editors.js';
import { createSequenceManager } from './canvas-sequence.js';
import { createInteractionsManager } from './canvas-interactions.js';
import { createZoomPanManager } from './canvas-zoom-pan.js';
import { renderNodes, renderEdges, addArrowMarkers } from './canvas-nodes-edges.js';

/**
 * Create the visual canvas
 */
export function createCanvas(container, model, options = {}) {
  // =============================================
  // STATE
  // =============================================
  const state = {
    selectedNodeId: null,
    selectedEdgeId: null,
    // Multi-select support
    selectedNodeIds: [],
    selectedEdgeIds: [],
    isDragging: false,
    isConnecting: false,
    connectingFromId: null,
    dragOffset: { x: 0, y: 0 },
    // Edge dragging for sequence diagrams
    isDraggingEdge: false,
    draggingEdgeId: null,
    draggingEdgeOriginalIndex: -1,
    draggingEdgeStartX: 0,
    draggingEdgeStartY: 0,
    // Endpoint dragging for sequence diagram message routing
    isDraggingEndpoint: false,
    draggingEndpointEdgeId: null,
    draggingEndpointType: null, // 'start' or 'end'
    draggingEndpointOriginalNodeId: null,
    draggingEndpointY: 0,
    // Drawing messages from lifelines (click-drag)
    isDrawingMessage: false,
    drawingMessageFromId: null,
    drawingMessageStartY: null,
    drawingMessageStartX: null,
    onChange: options.onChange || null,
    onZoomChange: options.onZoomChange || null,
    // Grid state
    showGrid: false,
    gridSize: 20,
    snapToGrid: false,
    // Clipboard state
    clipboard: null
  };

  // =============================================
  // SVG AND LAYERS SETUP
  // =============================================
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'visual-editor-svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  // Create layers
  const lifelinesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  lifelinesLayer.setAttribute('class', 'lifelines-layer');

  const edgesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  edgesLayer.setAttribute('class', 'edges-layer');

  const nodesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  nodesLayer.setAttribute('class', 'nodes-layer');

  const connectingLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  connectingLayer.setAttribute('class', 'connecting-layer');

  svg.appendChild(lifelinesLayer);
  svg.appendChild(edgesLayer);
  svg.appendChild(nodesLayer);
  svg.appendChild(connectingLayer);

  container.appendChild(svg);

  // =============================================
  // CONTEXT MENU SETUP
  // =============================================
  const contextMenu = document.createElement('div');
  contextMenu.className = 've-context-menu hidden';
  contextMenu.innerHTML = `
    <button class="ve-context-item" data-action="add-node">Add Node Here</button>
    <button class="ve-context-item" data-action="cancel">Cancel</button>
  `;
  container.appendChild(contextMenu);

  // =============================================
  // PROPERTY PANELS SETUP
  // =============================================

  // Create flowchart mini property panel
  const flowchartPanel = document.createElement('div');
  flowchartPanel.className = 've-flowchart-panel hidden';
  const shapeOptions = Object.entries(SHAPES).map(([key, shape]) =>
    `<option value="${key}">${shape.icon || ''} ${shape.name}</option>`
  ).join('');
  flowchartPanel.innerHTML = `
    <div class="ve-flowchart-panel-content">
      <div class="ve-property-group">
        <label class="ve-property-label">Label</label>
        <input type="text" id="ve-fc-label" class="ve-property-input" />
      </div>
      <div class="ve-property-group">
        <label class="ve-property-label">Shape</label>
        <select id="ve-fc-shape" class="ve-select" style="width: 100%;">${shapeOptions}</select>
      </div>
      <div class="ve-flowchart-panel-actions">
        <button class="ve-btn ve-btn-small ve-btn-secondary ve-fc-cancel">Cancel</button>
        <button class="ve-btn ve-btn-small ve-btn-primary ve-fc-apply">Apply</button>
      </div>
    </div>
  `;
  container.appendChild(flowchartPanel);

  // Create property panel for class/ER diagrams
  const propertyPanel = document.createElement('div');
  propertyPanel.className = 've-property-panel hidden';
  propertyPanel.innerHTML = `
    <div class="ve-property-panel-header">
      <h4 class="ve-property-panel-title">Node Properties</h4>
      <button class="ve-property-panel-close">&times;</button>
    </div>
    <div class="ve-property-panel-content">
      <div class="ve-property-group">
        <label class="ve-property-label">Name</label>
        <input type="text" id="ve-prop-name" class="ve-property-input" />
      </div>
      <div class="ve-property-group ve-attributes-group">
        <label class="ve-property-label">Attributes</label>
        <div id="ve-prop-attributes" class="ve-property-list"></div>
        <button class="ve-btn ve-btn-small ve-add-attribute">+ Add Attribute</button>
      </div>
      <div class="ve-property-group ve-methods-group hidden">
        <label class="ve-property-label">Methods</label>
        <div id="ve-prop-methods" class="ve-property-list"></div>
        <button class="ve-btn ve-btn-small ve-add-method">+ Add Method</button>
      </div>
    </div>
    <div class="ve-property-panel-footer">
      <button class="ve-btn ve-btn-secondary ve-prop-cancel">Cancel</button>
      <button class="ve-btn ve-btn-primary ve-prop-apply">Apply</button>
    </div>
  `;
  container.appendChild(propertyPanel);

  // =============================================
  // CONTEXT OBJECT (shared between modules)
  // =============================================
  const ctx = {
    container,
    model,
    svg,
    state,
    contextMenu,
    layers: {
      lifelines: lifelinesLayer,
      edges: edgesLayer,
      nodes: nodesLayer,
      connecting: connectingLayer
    },
    panels: {
      flowchart: flowchartPanel,
      property: propertyPanel
    },
    // These will be set after module initialization
    render: null,
    selection: null,
    editors: null,
    sequence: null,
    zoomPan: null,
    handlers: null,
    getMousePosition: null
  };

  // =============================================
  // INITIALIZE MODULES
  // =============================================

  // Create managers
  const selection = createSelectionManager(ctx);
  ctx.selection = selection;

  const sequence = createSequenceManager(ctx);
  ctx.sequence = sequence;

  // Editors needs to be created after sequence since it references ctx.sequence
  const editors = createEditorsManager(ctx);
  ctx.editors = editors;

  const interactions = createInteractionsManager(ctx);
  ctx.handlers = {
    handleNodeMouseDown: interactions.handleNodeMouseDown,
    handleNodeDoubleClick: editors.handleNodeDoubleClick,
    handleEdgeClick: interactions.handleEdgeClick,
    handleEdgeDoubleClick: interactions.handleEdgeDoubleClick,
    handleEdgeMouseDown: interactions.handleEdgeMouseDown,
    handleNoteDoubleClick: editors.handleNoteDoubleClick,
    startConnecting: interactions.startConnecting
  };
  ctx.getMousePosition = interactions.getMousePosition;

  // Create zoom/pan manager
  const zoomPan = createZoomPanManager(ctx);
  ctx.zoomPan = zoomPan;

  // =============================================
  // RENDER FUNCTION
  // =============================================
  function render() {
    sequence.renderLifelines();
    sequence.renderNotes();
    renderEdges(ctx);
    renderNodes(ctx);
  }
  ctx.render = render;

  // =============================================
  // PUBLIC API
  // =============================================

  function addNode(shape = 'rect', options = {}) {
    // Prevent duplicate initial/final states
    if (options.stateType === 'initial' || options.stateType === 'final') {
      const existingNodes = model.getState().nodes;
      const targetId = options.stateType === 'initial' ? '__initial__' : '__final__';
      const exists = existingNodes.some(n => n.id === targetId || n.stateType === options.stateType);
      if (exists) {
        console.log(`[canvas] ${options.stateType} state already exists, skipping`);
        return null; // Don't add duplicate
      }
    }

    const nodeData = {
      shape,
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 200,
      ...options
    };
    // For initial/final states, use special IDs
    if (options.stateType === 'initial') {
      nodeData.id = '__initial__';
      nodeData.label = '';
    } else if (options.stateType === 'final') {
      nodeData.id = '__final__';
      nodeData.label = '';
    } else if (typeof options === 'string') {
      // Backward compatibility: if options is a string, treat as label
      nodeData.label = options;
    }
    const node = model.addNode(nodeData);
    render();
    return node;
  }

  function destroy() {
    interactions.removeEventHandlers();
    zoomPan.removeEventHandlers();
    svg.remove();
    contextMenu.remove();
    flowchartPanel.remove();
    propertyPanel.remove();
  }

  // =============================================
  // INITIALIZATION
  // =============================================
  addArrowMarkers(svg);
  zoomPan.initialize(); // Setup zoom/pan wrapper and events
  interactions.setupEventHandlers();
  render();

  // =============================================
  // RETURN PUBLIC API
  // =============================================
  return {
    render,
    addNode,
    deleteSelected: selection.deleteSelected,
    clearSelection: selection.clearSelection,
    getSelection: selection.getSelection,
    setSelectedEdgeType: selection.setSelectedEdgeType,
    getSelectedEdge: selection.getSelectedEdge,
    editEdgeLabel: editors.editEdgeLabel,
    // Zoom/pan methods
    zoomIn: zoomPan.zoomIn,
    zoomOut: zoomPan.zoomOut,
    resetZoom: zoomPan.resetZoom,
    fitToContent: zoomPan.fitToContent,
    getZoom: zoomPan.getZoom,
    // Grid methods
    setShowGrid: zoomPan.setShowGrid,
    setSnapToGrid: zoomPan.setSnapToGrid,
    destroy
  };
}
