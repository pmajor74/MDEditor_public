/**
 * Canvas Interactions
 *
 * Handles mouse/keyboard event handlers, context menu, and connection mode.
 */

/**
 * Create interactions manager for the canvas
 */
export function createInteractionsManager(ctx) {
  // Track when context menu was shown (to prevent immediate close from click event)
  let contextMenuShownAt = 0;
  // Pending connection state for context menu
  let pendingConnection = null;

  /**
   * Get mouse position relative to SVG accounting for scroll and zoom/pan
   */
  function getMousePosition(e) {
    const svgRect = ctx.svg.getBoundingClientRect();
    const scrollLeft = ctx.container.scrollLeft || 0;
    const scrollTop = ctx.container.scrollTop || 0;

    // Get screen coordinates relative to SVG
    const screenX = e.clientX - svgRect.left + scrollLeft;
    const screenY = e.clientY - svgRect.top + scrollTop;

    // Convert to canvas coordinates if zoom/pan is active
    if (ctx.zoomPan) {
      return ctx.zoomPan.screenToCanvas(screenX, screenY);
    }

    return { x: screenX, y: screenY };
  }

  /**
   * Handle node mouse down (start dragging)
   */
  function handleNodeMouseDown(e, node) {
    if (e.target.classList.contains('connection-point')) return;
    // Don't start drag if in pan mode
    if (ctx.zoomPan && ctx.zoomPan.isPanning()) return;

    e.preventDefault();

    // Handle shift-click for multi-select
    if (e.shiftKey) {
      ctx.selection.toggleNodeSelection(node.id);
      return;
    }

    // Regular click - single select
    ctx.state.selectedNodeId = node.id;
    ctx.state.selectedEdgeId = null;
    ctx.state.selectedNodeIds = [];
    ctx.state.selectedEdgeIds = [];
    ctx.state.isDragging = true;

    const pos = getMousePosition(e);
    ctx.state.dragOffset = {
      x: pos.x - node.x,
      y: pos.y - node.y
    };
    // Store original position for detecting if node actually moved
    ctx.state.dragStartPos = { x: node.x, y: node.y };

    // Update selection visually without full re-render (to preserve dblclick detection)
    ctx.selection.updateSelectionVisuals();
    ctx.selection.notifyChange();
  }

  /**
   * Handle edge click (select edge)
   */
  function handleEdgeClick(e, edge) {
    e.preventDefault();

    // Handle shift-click for multi-select
    if (e.shiftKey) {
      ctx.selection.toggleEdgeSelection(edge.id);
      return;
    }

    // Regular click - single select
    ctx.state.selectedEdgeId = edge.id;
    ctx.state.selectedNodeId = null;
    ctx.state.selectedNodeIds = [];
    ctx.state.selectedEdgeIds = [];
    // Update selection visually without full re-render (to preserve dblclick detection)
    ctx.selection.updateSelectionVisuals();
    ctx.selection.notifyChange();
  }

  /**
   * Handle edge double click (edit label)
   */
  function handleEdgeDoubleClick(e, edge) {
    console.log('[DEBUG] handleEdgeDoubleClick called for edge:', edge.id);
    e.preventDefault();
    e.stopPropagation();

    // Close any open editors first
    ctx.editors.destroyInlineEditor();
    ctx.editors.hideFlowchartPanel();
    ctx.editors.hidePropertyPanel();

    // Create inline editor for edge label
    ctx.editors.createEdgeLabelEditor(e, edge);
  }

  /**
   * Handle edge mouse down (start dragging for sequence diagrams)
   */
  function handleEdgeMouseDown(e, edge, edgeIndex) {
    // Only handle left mouse button
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    const pos = getMousePosition(e);

    ctx.state.isDraggingEdge = true;
    ctx.state.draggingEdgeId = edge.id;
    ctx.state.draggingEdgeOriginalIndex = edgeIndex;
    ctx.state.draggingEdgeStartX = pos.x;
    ctx.state.draggingEdgeStartY = pos.y;

    // Select the edge
    ctx.state.selectedEdgeId = edge.id;
    ctx.state.selectedNodeId = null;
    ctx.selection.updateSelectionVisuals();
    ctx.selection.notifyChange();

    // Add visual feedback - highlight the edge being dragged
    const edgeGroup = ctx.svg.querySelector(`[data-edge-id="${edge.id}"]`);
    if (edgeGroup) {
      edgeGroup.classList.add('dragging');
    }

    // Create drop zone indicators
    ctx.sequence.createEdgeDropZones();
  }

  /**
   * Start connecting from a node
   */
  function startConnecting(node, position) {
    ctx.state.isConnecting = true;
    ctx.state.connectingFromId = node.id;

    // Create temporary line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('id', 'connecting-line');
    line.setAttribute('class', 'connecting-line');
    line.setAttribute('x1', node.x + position.x);
    line.setAttribute('y1', node.y + position.y);
    line.setAttribute('x2', node.x + position.x);
    line.setAttribute('y2', node.y + position.y);
    ctx.layers.connecting.appendChild(line);
  }

  /**
   * Document-level mouse move handler
   */
  function handleDocumentMouseMove(e) {
    const pos = getMousePosition(e);

    // Handle node dragging
    if (ctx.state.isDragging && ctx.state.selectedNodeId) {
      let newX = Math.max(0, pos.x - ctx.state.dragOffset.x);
      let newY = Math.max(0, pos.y - ctx.state.dragOffset.y);

      // Apply snap to grid if enabled
      if (ctx.zoomPan) {
        newX = ctx.zoomPan.snapToGrid(newX);
        newY = ctx.zoomPan.snapToGrid(newY);
      }

      // Update node position without adding to history on each move
      const nodeIndex = ctx.model.getState().nodes.findIndex(n => n.id === ctx.state.selectedNodeId);
      if (nodeIndex !== -1) {
        // Direct update for smooth dragging
        ctx.model.updateNode(ctx.state.selectedNodeId, { x: newX, y: newY }, true);
        ctx.render();
      }
    }

    // Handle connecting line update
    if (ctx.state.isConnecting) {
      const line = document.getElementById('connecting-line');
      if (line) {
        line.setAttribute('x2', pos.x);
        line.setAttribute('y2', pos.y);
      }
    }

    // Handle edge dragging for sequence diagrams
    if (ctx.state.isDraggingEdge && ctx.state.draggingEdgeId) {
      ctx.sequence.handleEdgeDragMove(pos);
    }

    // Handle endpoint dragging for sequence diagram message routing
    if (ctx.state.isDraggingEndpoint && ctx.state.draggingEndpointEdgeId) {
      ctx.sequence.handleEndpointDragMove(pos);
    }

    // Handle message drawing from lifelines
    if (ctx.state.isDrawingMessage) {
      ctx.sequence.handleMessageDrawMove(pos);
    }

    // Handle note dragging
    if (ctx.state.isDraggingNote && ctx.state.draggingNoteId) {
      ctx.sequence.handleNoteDragMove(pos);
    }
  }

  /**
   * Document-level mouse up handler
   */
  function handleDocumentMouseUp(e) {
    const pos = getMousePosition(e);

    // Handle connecting mode end
    if (ctx.state.isConnecting) {
      // Check if we're over a node
      const target = e.target.closest('.node-group');
      if (target && target.dataset.nodeId !== ctx.state.connectingFromId) {
        // Connect to existing node
        ctx.model.addEdge({
          from: ctx.state.connectingFromId,
          to: target.dataset.nodeId
        });
        ctx.render();
      } else if (!target) {
        // Dropped on empty canvas - show context menu
        pendingConnection = {
          fromId: ctx.state.connectingFromId,
          x: pos.x,
          y: pos.y
        };
        showContextMenu(pos.x, pos.y);
      }

      // Clean up
      const line = document.getElementById('connecting-line');
      if (line) line.remove();
      ctx.state.isConnecting = false;
      ctx.state.connectingFromId = null;
    }

    // Handle edge drag end for sequence diagrams
    if (ctx.state.isDraggingEdge && ctx.state.draggingEdgeId) {
      ctx.sequence.handleEdgeDragEnd(pos);
    }

    // Handle endpoint drag end for sequence diagram message routing
    if (ctx.state.isDraggingEndpoint && ctx.state.draggingEndpointEdgeId) {
      ctx.sequence.handleEndpointDragEnd(pos);
    }

    // Handle message drawing end from lifelines
    if (ctx.state.isDrawingMessage) {
      ctx.sequence.handleMessageDrawEnd(pos);
    }

    // Handle note drag end
    if (ctx.state.isDraggingNote && ctx.state.draggingNoteId) {
      ctx.sequence.handleNoteDragEnd(pos);
    }

    // If we were dragging a node, save the final position to history
    if (ctx.state.isDragging && ctx.state.selectedNodeId) {
      // Check if the node actually moved (to preserve double-click detection)
      const node = ctx.model.getState().nodes.find(n => n.id === ctx.state.selectedNodeId);
      const startPos = ctx.state.dragStartPos;
      const didMove = node && startPos &&
                      (Math.abs(node.x - startPos.x) > 5 || Math.abs(node.y - startPos.y) > 5);

      if (didMove) {
        // For sequence diagrams, reorder participants by X position after drag
        const modelState = ctx.model.getState();
        if (modelState.type === 'sequence') {
          reorderParticipantsByPosition();
        }
        // Force a history save for undo support
        ctx.model.saveCurrentState();
      }
    }

    ctx.state.isDragging = false;
    ctx.state.dragStartPos = null;
  }

  /**
   * Reorder sequence diagram participants by X position with dynamic spacing
   */
  function reorderParticipantsByPosition() {
    const modelState = ctx.model.getState();
    if (modelState.type !== 'sequence') return;

    const sortedNodes = [...modelState.nodes].sort((a, b) => a.x - b.x);
    const MIN_SPACING = 180;
    const CHAR_WIDTH = 7;
    const LABEL_PADDING = 40;
    const startX = 50;

    // Calculate optimal spacing for each gap based on message labels
    const spacings = [];
    for (let i = 0; i < sortedNodes.length - 1; i++) {
      const left = sortedNodes[i].id;
      const right = sortedNodes[i + 1].id;
      let maxLabelWidth = 0;

      for (const edge of modelState.edges) {
        const isAdjacent = (edge.from === left && edge.to === right) ||
                           (edge.from === right && edge.to === left);
        if (isAdjacent && edge.label) {
          const labelWidth = edge.label.length * CHAR_WIDTH + LABEL_PADDING;
          maxLabelWidth = Math.max(maxLabelWidth, labelWidth);
        }
      }
      spacings.push(Math.max(MIN_SPACING, maxLabelWidth));
    }

    // Position participants with calculated spacings
    let currentX = startX;
    sortedNodes.forEach((node, index) => {
      if (node.x !== currentX) {
        ctx.model.updateNode(node.id, { x: currentX }, true);
      }
      if (index < spacings.length) {
        currentX += spacings[index];
      }
    });

    ctx.render();
  }

  /**
   * Keyboard handler
   */
  function handleKeyDown(e) {
    // Don't handle keyboard shortcuts if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Ctrl+A for select all
    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      ctx.selection.selectAll();
      return;
    }

    // Ctrl+C for copy
    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      ctx.selection.copySelection();
      return;
    }

    // Ctrl+X for cut
    if (e.ctrlKey && e.key === 'x') {
      e.preventDefault();
      ctx.selection.cutSelection();
      return;
    }

    // Ctrl+V for paste
    if (e.ctrlKey && e.key === 'v') {
      e.preventDefault();
      ctx.selection.pasteClipboard();
      return;
    }

    // Ctrl+D for duplicate
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      ctx.selection.duplicateSelection();
      return;
    }

    // Delete or Backspace to delete selected
    if (e.key === 'Delete' || e.key === 'Backspace') {
      ctx.selection.deleteSelected();
    }
  }

  /**
   * Show context menu at position (in canvas coordinates)
   */
  function showContextMenu(x, y) {
    // Convert canvas coordinates to screen for positioning the DOM element
    let screenX = x, screenY = y;
    if (ctx.zoomPan) {
      const screenPos = ctx.zoomPan.canvasToScreen(x, y);
      screenX = screenPos.x;
      screenY = screenPos.y;
    }
    ctx.contextMenu.style.left = `${screenX}px`;
    ctx.contextMenu.style.top = `${screenY}px`;
    ctx.contextMenu.classList.remove('hidden');
    contextMenuShownAt = Date.now();
  }

  /**
   * Hide context menu
   */
  function hideContextMenu() {
    ctx.contextMenu.classList.add('hidden');
    pendingConnection = null;
  }

  /**
   * Setup context menu event handlers
   */
  function setupContextMenu() {
    ctx.contextMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = e.target.dataset.action;
      if (action === 'add-node' && pendingConnection) {
        // Create new node at drop position
        const newNode = ctx.model.addNode({
          shape: 'rect',
          label: 'New',
          x: pendingConnection.x - 50,
          y: pendingConnection.y - 20
        });
        // Connect to new node
        ctx.model.addEdge({
          from: pendingConnection.fromId,
          to: newNode.id
        });
        ctx.render();
        ctx.selection.notifyChange();
      }
      hideContextMenu();
    });

    // Hide context menu on outside click (with debounce to prevent immediate close)
    document.addEventListener('click', (e) => {
      // Ignore clicks within 100ms of showing the menu (prevents mouseup->click race)
      if (Date.now() - contextMenuShownAt < 100) return;
      if (!ctx.contextMenu.contains(e.target)) {
        hideContextMenu();
      }
    });
  }

  /**
   * Setup all document-level event handlers
   */
  function setupEventHandlers() {
    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);
    document.addEventListener('keydown', handleKeyDown);

    // Handle canvas click to deselect
    ctx.svg.addEventListener('click', (e) => {
      if (e.target === ctx.svg) {
        ctx.selection.clearSelection();
      }
    });

    // Setup context menu
    setupContextMenu();
  }

  /**
   * Remove all document-level event handlers
   */
  function removeEventHandlers() {
    document.removeEventListener('mousemove', handleDocumentMouseMove);
    document.removeEventListener('mouseup', handleDocumentMouseUp);
    document.removeEventListener('keydown', handleKeyDown);
  }

  return {
    getMousePosition,
    handleNodeMouseDown,
    handleEdgeClick,
    handleEdgeDoubleClick,
    handleEdgeMouseDown,
    startConnecting,
    handleDocumentMouseMove,
    handleDocumentMouseUp,
    handleKeyDown,
    showContextMenu,
    hideContextMenu,
    setupEventHandlers,
    removeEventHandlers
  };
}
