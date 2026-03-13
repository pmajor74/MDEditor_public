/**
 * Canvas Selection Management
 *
 * Handles selection state and visual updates including multi-select.
 */

/**
 * Create selection manager for the canvas
 */
export function createSelectionManager(ctx) {
  /**
   * Update selection visuals without re-rendering (preserves event listeners for dblclick)
   */
  function updateSelectionVisuals() {
    // Update node selection - handle both single and multi-select
    ctx.svg.querySelectorAll('.node-shape').forEach(shape => {
      shape.classList.remove('selected');
    });

    // Apply selection to all selected nodes
    const selectedNodes = getSelectedNodeIds();
    selectedNodes.forEach(nodeId => {
      const selectedGroup = ctx.svg.querySelector(`[data-node-id="${nodeId}"] .node-shape`);
      if (selectedGroup) {
        selectedGroup.classList.add('selected');
      }
    });

    // Update edge selection - handle both single and multi-select
    ctx.svg.querySelectorAll('.edge-path').forEach(path => {
      path.classList.remove('selected');
    });

    // Apply selection to all selected edges
    const selectedEdges = getSelectedEdgeIds();
    selectedEdges.forEach(edgeId => {
      const selectedEdge = ctx.svg.querySelector(`[data-edge-id="${edgeId}"] .edge-path`);
      if (selectedEdge) {
        selectedEdge.classList.add('selected');
      }
    });
  }

  /**
   * Get all selected node IDs (combines single and multi-select)
   */
  function getSelectedNodeIds() {
    const ids = new Set(ctx.state.selectedNodeIds || []);
    if (ctx.state.selectedNodeId) {
      ids.add(ctx.state.selectedNodeId);
    }
    return Array.from(ids);
  }

  /**
   * Get all selected edge IDs (combines single and multi-select)
   */
  function getSelectedEdgeIds() {
    const ids = new Set(ctx.state.selectedEdgeIds || []);
    if (ctx.state.selectedEdgeId) {
      ids.add(ctx.state.selectedEdgeId);
    }
    return Array.from(ids);
  }

  /**
   * Check if a node is selected
   */
  function isNodeSelected(nodeId) {
    return ctx.state.selectedNodeId === nodeId ||
           (ctx.state.selectedNodeIds && ctx.state.selectedNodeIds.includes(nodeId));
  }

  /**
   * Check if an edge is selected
   */
  function isEdgeSelected(edgeId) {
    return ctx.state.selectedEdgeId === edgeId ||
           (ctx.state.selectedEdgeIds && ctx.state.selectedEdgeIds.includes(edgeId));
  }

  /**
   * Clear current selection
   */
  function clearSelection() {
    ctx.state.selectedNodeId = null;
    ctx.state.selectedEdgeId = null;
    ctx.state.selectedNodeIds = [];
    ctx.state.selectedEdgeIds = [];
    ctx.render();
    notifyChange();
  }

  /**
   * Get current selection
   */
  function getSelection() {
    return {
      nodeId: ctx.state.selectedNodeId,
      edgeId: ctx.state.selectedEdgeId,
      nodeIds: getSelectedNodeIds(),
      edgeIds: getSelectedEdgeIds()
    };
  }

  /**
   * Select a node (single select mode - clears other selections)
   */
  function selectNode(nodeId) {
    ctx.state.selectedNodeId = nodeId;
    ctx.state.selectedEdgeId = null;
    ctx.state.selectedNodeIds = [];
    ctx.state.selectedEdgeIds = [];
    updateSelectionVisuals();
    notifyChange();
  }

  /**
   * Toggle node selection (for shift-click multi-select)
   */
  function toggleNodeSelection(nodeId) {
    // If using single selection, migrate to multi-select
    if (ctx.state.selectedNodeId && !ctx.state.selectedNodeIds.includes(ctx.state.selectedNodeId)) {
      ctx.state.selectedNodeIds = [ctx.state.selectedNodeId];
      ctx.state.selectedNodeId = null;
    }

    // Clear edge selection when selecting nodes
    ctx.state.selectedEdgeId = null;
    ctx.state.selectedEdgeIds = [];

    // Toggle the node
    const index = ctx.state.selectedNodeIds.indexOf(nodeId);
    if (index === -1) {
      ctx.state.selectedNodeIds.push(nodeId);
    } else {
      ctx.state.selectedNodeIds.splice(index, 1);
    }

    updateSelectionVisuals();
    notifyChange();
  }

  /**
   * Select an edge (single select mode - clears other selections)
   */
  function selectEdge(edgeId) {
    ctx.state.selectedEdgeId = edgeId;
    ctx.state.selectedNodeId = null;
    ctx.state.selectedNodeIds = [];
    ctx.state.selectedEdgeIds = [];
    updateSelectionVisuals();
    notifyChange();
  }

  /**
   * Toggle edge selection (for shift-click multi-select)
   */
  function toggleEdgeSelection(edgeId) {
    // If using single selection, migrate to multi-select
    if (ctx.state.selectedEdgeId && !ctx.state.selectedEdgeIds.includes(ctx.state.selectedEdgeId)) {
      ctx.state.selectedEdgeIds = [ctx.state.selectedEdgeId];
      ctx.state.selectedEdgeId = null;
    }

    // Clear node selection when selecting edges
    ctx.state.selectedNodeId = null;
    ctx.state.selectedNodeIds = [];

    // Toggle the edge
    const index = ctx.state.selectedEdgeIds.indexOf(edgeId);
    if (index === -1) {
      ctx.state.selectedEdgeIds.push(edgeId);
    } else {
      ctx.state.selectedEdgeIds.splice(index, 1);
    }

    updateSelectionVisuals();
    notifyChange();
  }

  /**
   * Select all nodes and edges
   */
  function selectAll() {
    const modelState = ctx.model.getState();
    ctx.state.selectedNodeIds = modelState.nodes.map(n => n.id);
    ctx.state.selectedEdgeIds = modelState.edges.map(e => e.id);
    ctx.state.selectedNodeId = null;
    ctx.state.selectedEdgeId = null;
    updateSelectionVisuals();
    notifyChange();
  }

  /**
   * Delete currently selected elements
   */
  function deleteSelected() {
    const nodeIds = getSelectedNodeIds();
    const edgeIds = getSelectedEdgeIds();

    // Delete all selected nodes (this also removes connected edges)
    nodeIds.forEach(nodeId => {
      ctx.model.deleteNode(nodeId);
    });

    // Delete all selected edges that weren't already deleted with nodes
    const remainingEdges = ctx.model.getState().edges;
    edgeIds.forEach(edgeId => {
      if (remainingEdges.find(e => e.id === edgeId)) {
        ctx.model.deleteEdge(edgeId);
      }
    });

    // Clear selection
    ctx.state.selectedNodeId = null;
    ctx.state.selectedEdgeId = null;
    ctx.state.selectedNodeIds = [];
    ctx.state.selectedEdgeIds = [];

    ctx.render();
    notifyChange();
  }

  /**
   * Get selected edge data (for single selection - used by toolbar)
   */
  function getSelectedEdge() {
    const edgeId = ctx.state.selectedEdgeId || ctx.state.selectedEdgeIds[0];
    if (!edgeId) return null;
    const modelState = ctx.model.getState();
    return modelState.edges.find(e => e.id === edgeId);
  }

  /**
   * Set the edge type for the selected edge(s)
   * For sequence diagrams, swaps from/to when transitioning between return and non-return types
   */
  function setSelectedEdgeType(edgeType) {
    // Types that represent "return" messages (arrows pointing back/left)
    // Based on SEQUENCE_MESSAGE_TYPES in shapes.js - only types with "←" in their name
    const RETURN_TYPES = ['sync-return', 'async-return'];

    function isReturnType(type) {
      return RETURN_TYPES.includes(type);
    }

    const edgeIds = getSelectedEdgeIds();

    edgeIds.forEach(edgeId => {
      // Get current edge to check if direction swap is needed
      const currentEdge = ctx.model.getState().edges.find(e => e.id === edgeId);
      if (!currentEdge) return;

      const wasReturn = isReturnType(currentEdge.type);
      const willBeReturn = isReturnType(edgeType);

      // Swap from/to when transitioning between return and non-return types
      if (wasReturn !== willBeReturn) {
        ctx.model.updateEdge(edgeId, {
          type: edgeType,
          from: currentEdge.to,
          to: currentEdge.from
        });
      } else {
        ctx.model.updateEdge(edgeId, { type: edgeType });
      }
    });

    if (edgeIds.length > 0) {
      ctx.render();
    }
  }

  /**
   * Get selected nodes data (for clipboard operations)
   */
  function getSelectedNodes() {
    const nodeIds = getSelectedNodeIds();
    const modelState = ctx.model.getState();
    return modelState.nodes.filter(n => nodeIds.includes(n.id));
  }

  /**
   * Get selected edges data (for clipboard operations)
   */
  function getSelectedEdges() {
    const edgeIds = getSelectedEdgeIds();
    const modelState = ctx.model.getState();
    return modelState.edges.filter(e => edgeIds.includes(e.id));
  }

  /**
   * Copy selected elements to clipboard
   */
  function copySelection() {
    const nodes = getSelectedNodes();
    const edges = getSelectedEdges();

    if (nodes.length === 0 && edges.length === 0) return;

    // Deep clone the data
    ctx.state.clipboard = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges))
    };
  }

  /**
   * Cut selected elements (copy + delete)
   */
  function cutSelection() {
    copySelection();
    deleteSelected();
  }

  /**
   * Paste from clipboard
   */
  function pasteClipboard() {
    if (!ctx.state.clipboard) return;

    const { nodes, edges } = ctx.state.clipboard;
    if (nodes.length === 0) return;

    // Create a mapping from old IDs to new IDs
    const idMapping = {};
    const offset = 30; // Offset paste position

    // Paste nodes with new IDs and offset positions
    const newNodeIds = [];
    nodes.forEach(node => {
      const newNode = ctx.model.addNode({
        shape: node.shape,
        label: node.label,
        x: node.x + offset,
        y: node.y + offset,
        attributes: node.attributes,
        methods: node.methods
      });
      idMapping[node.id] = newNode.id;
      newNodeIds.push(newNode.id);
    });

    // Paste edges that connect pasted nodes
    const newEdgeIds = [];
    edges.forEach(edge => {
      // Only paste edge if both ends are in the pasted nodes
      if (idMapping[edge.from] && idMapping[edge.to]) {
        const newEdge = ctx.model.addEdge({
          from: idMapping[edge.from],
          to: idMapping[edge.to],
          label: edge.label,
          type: edge.type
        });
        if (newEdge) {
          newEdgeIds.push(newEdge.id);
        }
      }
    });

    // Select the newly pasted elements
    ctx.state.selectedNodeIds = newNodeIds;
    ctx.state.selectedEdgeIds = newEdgeIds;
    ctx.state.selectedNodeId = null;
    ctx.state.selectedEdgeId = null;

    ctx.render();
    notifyChange();
  }

  /**
   * Duplicate selected elements (copy + paste immediately)
   */
  function duplicateSelection() {
    copySelection();
    pasteClipboard();
  }

  /**
   * Notify change callback
   */
  function notifyChange() {
    if (ctx.state.onChange) {
      ctx.state.onChange({
        selectedNodeId: ctx.state.selectedNodeId,
        selectedEdgeId: ctx.state.selectedEdgeId,
        selectedNodeIds: getSelectedNodeIds(),
        selectedEdgeIds: getSelectedEdgeIds()
      });
    }
  }

  return {
    updateSelectionVisuals,
    clearSelection,
    getSelection,
    selectNode,
    selectEdge,
    toggleNodeSelection,
    toggleEdgeSelection,
    selectAll,
    deleteSelected,
    getSelectedEdge,
    setSelectedEdgeType,
    getSelectedNodes,
    getSelectedEdges,
    getSelectedNodeIds,
    getSelectedEdgeIds,
    isNodeSelected,
    isEdgeSelected,
    copySelection,
    cutSelection,
    pasteClipboard,
    duplicateSelection,
    notifyChange
  };
}
