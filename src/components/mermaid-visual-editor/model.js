/**
 * Diagram Model for Visual Mermaid Editor
 *
 * Manages the data model for visual diagram editing.
 * Includes undo/redo support and change notifications.
 */

/**
 * Create a new diagram model
 */
export function createDiagramModel() {
  let state = {
    type: 'flowchart',
    direction: 'TD',
    nodes: [],
    edges: [],
    notes: [],
    activations: [],
    // Pie chart specific
    pieTitle: '',
    pieShowData: false,
    pieSegments: [],
    // Gantt chart specific
    ganttTitle: '',
    ganttDateFormat: 'YYYY-MM-DD',
    ganttAxisFormat: '',
    ganttSections: [],   // { id, name }
    ganttTasks: []       // { id, label, sectionId, taskId, startDate, duration, status, dependencies }
  };

  let history = [];
  let historyIndex = -1;
  let onChange = null;

  // Generate unique IDs
  let nodeIdCounter = 0;
  let edgeIdCounter = 0;

  function generateNodeId() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const index = nodeIdCounter++;
    if (index < 26) {
      return letters[index];
    }
    return letters[index % 26] + Math.floor(index / 26);
  }

  function generateEdgeId() {
    return `edge_${edgeIdCounter++}`;
  }

  // Save state to history for undo/redo
  function saveToHistory() {
    // Remove any future history if we're not at the end
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }

    // Add current state to history
    history.push(JSON.stringify(state));
    historyIndex = history.length - 1;

    // Limit history size
    if (history.length > 50) {
      history.shift();
      historyIndex--;
    }
  }

  // Notify listeners of changes
  function notifyChange() {
    if (onChange) {
      onChange(getState());
    }
  }

  // Get a copy of the current state
  function getState() {
    return JSON.parse(JSON.stringify(state));
  }

  // Set state from external source (e.g., parsed mermaid)
  function setState(newState) {
    saveToHistory();

    // Deep copy nodes to prevent reference sharing of attributes/methods arrays
    // Only copy attributes/methods if they exist on the original node
    // (class diagram nodes will have them, flowchart nodes won't)
    const copiedNodes = (newState.nodes || []).map(node => {
      const copied = { ...node };
      if (node.attributes !== undefined) {
        copied.attributes = [...node.attributes];
      }
      if (node.methods !== undefined) {
        copied.methods = [...node.methods];
      }
      return copied;
    });

    // Copy edges (preserve cardinality for ER diagrams)
    const copiedEdges = (newState.edges || []).map(edge => ({
      ...edge,
      // Explicitly preserve ER diagram cardinality
      fromCardinality: edge.fromCardinality,
      toCardinality: edge.toCardinality
    }));

    state = {
      type: newState.type || 'flowchart',
      direction: newState.direction || 'TD',
      nodes: copiedNodes,
      edges: copiedEdges,
      // Sequence diagram specific
      notes: newState.notes ? [...newState.notes] : [],
      activations: newState.activations ? [...newState.activations] : [],
      // Pie chart specific
      pieTitle: newState.pieTitle || '',
      pieShowData: newState.pieShowData || false,
      pieSegments: newState.pieSegments ? newState.pieSegments.map(seg => ({ ...seg })) : [],
      // Gantt chart specific
      ganttTitle: newState.ganttTitle || '',
      ganttDateFormat: newState.ganttDateFormat || 'YYYY-MM-DD',
      ganttAxisFormat: newState.ganttAxisFormat || '',
      ganttSections: newState.ganttSections ? newState.ganttSections.map(sec => ({ ...sec })) : [],
      ganttTasks: newState.ganttTasks ? newState.ganttTasks.map(task => ({ ...task, dependencies: task.dependencies ? [...task.dependencies] : [] })) : []
    };

    // Update ID counters based on existing nodes
    // Only consider IDs in expected format: single letter (A-Z) or letter+number (A1, B2)
    // Ignore multi-letter entity names like "CUSTOMER" which aren't auto-generated
    nodeIdCounter = 0;
    state.nodes.forEach(node => {
      // Match single letter followed by optional digits (A, B, C, A1, B2, etc.)
      const match = node.id.match(/^([A-Z])(\d*)$/);
      if (match) {
        const letterIndex = match[1].charCodeAt(0) - 65; // A=0, B=1, etc.
        const numSuffix = match[2] ? parseInt(match[2], 10) : 0;
        // Calculate position: A=0, B=1, ..., Z=25, A1=26, B1=27, etc.
        const position = numSuffix > 0 ? 26 + (numSuffix - 1) * 26 + letterIndex : letterIndex;
        nodeIdCounter = Math.max(nodeIdCounter, position + 1);
      }
    });

    // Update edge ID counter based on existing edges
    edgeIdCounter = 0;
    state.edges.forEach(edge => {
      const match = edge.id && edge.id.match(/^edge_(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        edgeIdCounter = Math.max(edgeIdCounter, num + 1);
      }
    });
    console.log('[Model] setState: edgeIdCounter set to', edgeIdCounter, 'based on', state.edges.length, 'existing edges');

    notifyChange();
  }

  // Reset to empty diagram
  function reset(type = 'flowchart', direction = 'TD') {
    saveToHistory();
    state = {
      type,
      direction,
      nodes: [],
      edges: [],
      notes: [],
      activations: [],
      // Pie chart specific
      pieTitle: '',
      pieShowData: false,
      pieSegments: [],
      // Gantt chart specific
      ganttTitle: '',
      ganttDateFormat: 'YYYY-MM-DD',
      ganttAxisFormat: '',
      ganttSections: [],
      ganttTasks: []
    };
    nodeIdCounter = 0;
    edgeIdCounter = 0;
    pieSegmentIdCounter = 0;
    ganttSectionIdCounter = 0;
    ganttTaskIdCounter = 0;
    notifyChange();
  }

  // Set diagram type
  function setType(type) {
    if (state.type !== type) {
      saveToHistory();
      state.type = type;
      notifyChange();
    }
  }

  // Set diagram direction
  function setDirection(direction) {
    if (state.direction !== direction) {
      saveToHistory();
      state.direction = direction;
      notifyChange();
    }
  }

  // Add a node
  function addNode(node) {
    saveToHistory();

    const id = node.id || generateNodeId();
    const newNode = {
      id,
      label: node.label || id,
      shape: node.shape || 'rect',
      x: node.x || 100,
      y: node.y || 100
    };

    // Only add attributes/methods for class diagram nodes (when provided in input)
    if (node.attributes !== undefined) {
      newNode.attributes = [...node.attributes];
    }
    if (node.methods !== undefined) {
      newNode.methods = [...node.methods];
    }

    // Preserve stateType for state diagrams (initial/final/fork/join)
    if (node.stateType) {
      newNode.stateType = node.stateType;
    }

    // Preserve stereotype for class diagrams
    if (node.stereotype) {
      newNode.stereotype = node.stereotype;
    }

    state.nodes.push(newNode);
    notifyChange();
    return newNode;
  }

  // Update a node
  // skipHistory: when true, doesn't save to undo history (for smooth dragging)
  function updateNode(id, updates, skipHistory = false) {
    const nodeIndex = state.nodes.findIndex(n => n.id === id);
    if (nodeIndex === -1) return null;

    if (!skipHistory) {
      saveToHistory();
    }

    // Create safe copies of arrays to prevent reference sharing
    const safeUpdates = { ...updates };
    if (updates.attributes) {
      safeUpdates.attributes = [...updates.attributes];
    }
    if (updates.methods) {
      safeUpdates.methods = [...updates.methods];
    }

    state.nodes[nodeIndex] = {
      ...state.nodes[nodeIndex],
      ...safeUpdates
    };
    notifyChange();
    return state.nodes[nodeIndex];
  }

  // Rename a node's ID (and update all edge references)
  // Used for ER diagrams where the entity name is the identifier
  function renameNode(oldId, newId) {
    const nodeIndex = state.nodes.findIndex(n => n.id === oldId);
    if (nodeIndex === -1) return false;

    // Check if new ID already exists
    if (state.nodes.some(n => n.id === newId && n.id !== oldId)) {
      console.warn(`[Model] Cannot rename node: ID "${newId}" already exists`);
      return false;
    }

    saveToHistory();

    // Update the node's ID
    state.nodes[nodeIndex].id = newId;

    // Update all edge references
    state.edges.forEach(edge => {
      if (edge.from === oldId) edge.from = newId;
      if (edge.to === oldId) edge.to = newId;
    });

    notifyChange();
    return true;
  }

  // Delete a node and its connected edges
  function deleteNode(id) {
    const nodeIndex = state.nodes.findIndex(n => n.id === id);
    if (nodeIndex === -1) return false;

    saveToHistory();

    // Remove the node
    state.nodes.splice(nodeIndex, 1);

    // Remove connected edges
    state.edges = state.edges.filter(e => e.from !== id && e.to !== id);

    notifyChange();
    return true;
  }

  // Get a node by ID
  function getNode(id) {
    return state.nodes.find(n => n.id === id) || null;
  }

  // Add an edge
  // Optional insertIndex parameter allows inserting at a specific position (for sequence diagrams)
  function addEdge(edge, insertIndex = null) {
    // Don't allow duplicate edges (same from, to, AND label)
    // This allows multiple edges between same nodes with different labels (needed for sequence diagrams)
    const exists = state.edges.some(e =>
      e.from === edge.from &&
      e.to === edge.to &&
      e.label === (edge.label || '')
    );
    if (exists) {
      console.warn('[Model] addEdge: duplicate edge rejected', edge);
      return null;
    }

    // Don't allow self-loops for flowcharts (but allow for sequence diagrams - self-messages)
    if (edge.from === edge.to && state.type !== 'sequence') return null;

    saveToHistory();

    const id = edge.id || generateEdgeId();
    const newEdge = {
      id,
      from: edge.from,
      to: edge.to,
      label: edge.label || '',
      type: edge.type || 'arrow'
    };

    // ER diagram cardinality support
    if (edge.fromCardinality !== undefined) {
      newEdge.fromCardinality = edge.fromCardinality;
    }
    if (edge.toCardinality !== undefined) {
      newEdge.toCardinality = edge.toCardinality;
    }

    // Insert at specific index or append to end
    if (insertIndex !== null && insertIndex >= 0 && insertIndex <= state.edges.length) {
      state.edges.splice(insertIndex, 0, newEdge);
      console.log('[Model] addEdge: created edge with id', id, 'at index', insertIndex);
    } else {
      state.edges.push(newEdge);
      console.log('[Model] addEdge: created edge with id', id, 'at index', state.edges.length - 1);
    }
    notifyChange();
    return newEdge;
  }

  // Update an edge
  function updateEdge(id, updates) {
    const edgeIndex = state.edges.findIndex(e => e.id === id);
    if (edgeIndex === -1) return null;

    saveToHistory();
    state.edges[edgeIndex] = {
      ...state.edges[edgeIndex],
      ...updates
    };
    notifyChange();
    return state.edges[edgeIndex];
  }

  // Delete an edge
  function deleteEdge(id) {
    const edgeIndex = state.edges.findIndex(e => e.id === id);
    if (edgeIndex === -1) return false;

    saveToHistory();
    state.edges.splice(edgeIndex, 1);
    notifyChange();
    return true;
  }

  // Reorder an edge (move to new index)
  // Useful for sequence diagrams where edge order = message order
  function reorderEdge(id, newIndex) {
    const currentIndex = state.edges.findIndex(e => e.id === id);
    if (currentIndex === -1) return false;
    if (newIndex < 0 || newIndex >= state.edges.length) return false;
    if (currentIndex === newIndex) return false;

    saveToHistory();

    // Remove from current position and insert at new position
    const [edge] = state.edges.splice(currentIndex, 1);
    state.edges.splice(newIndex, 0, edge);

    notifyChange();
    return true;
  }

  // Get edges connected to a node
  function getEdgesForNode(nodeId) {
    return state.edges.filter(e => e.from === nodeId || e.to === nodeId);
  }

  // Undo
  function undo() {
    if (historyIndex <= 0) return false;

    historyIndex--;
    state = JSON.parse(history[historyIndex]);
    notifyChange();
    return true;
  }

  // Redo
  function redo() {
    if (historyIndex >= history.length - 1) return false;

    historyIndex++;
    state = JSON.parse(history[historyIndex]);
    notifyChange();
    return true;
  }

  // Check if undo is available
  function canUndo() {
    return historyIndex > 0;
  }

  // Check if redo is available
  function canRedo() {
    return historyIndex < history.length - 1;
  }

  // Set change callback
  function setOnChange(callback) {
    onChange = callback;
  }

  // Save current state to history (for after drag operations)
  function saveCurrentState() {
    saveToHistory();
  }

  // Generate unique note ID
  let noteIdCounter = 0;
  function generateNoteId() {
    return `note_${noteIdCounter++}`;
  }

  // Generate unique pie segment ID
  let pieSegmentIdCounter = 0;
  function generatePieSegmentId() {
    return `seg_${pieSegmentIdCounter++}`;
  }

  // Generate unique Gantt section ID
  let ganttSectionIdCounter = 0;
  function generateGanttSectionId() {
    return `section_${ganttSectionIdCounter++}`;
  }

  // Generate unique Gantt task ID
  let ganttTaskIdCounter = 0;
  function generateGanttTaskId() {
    return `task_${ganttTaskIdCounter++}`;
  }

  // Add a note (sequence diagrams)
  function addNote(note) {
    saveToHistory();
    const id = note.id || generateNoteId();
    const newNote = {
      id,
      position: note.position || 'right of',
      participant: note.participant,
      text: note.text || '',
      y: note.y  // Optional Y position for rendering
    };
    if (!state.notes) state.notes = [];
    state.notes.push(newNote);
    notifyChange();
    return newNote;
  }

  // Delete a note
  function deleteNote(id) {
    if (!state.notes) return false;
    const noteIndex = state.notes.findIndex(n => n.id === id);
    if (noteIndex === -1) return false;
    saveToHistory();
    state.notes.splice(noteIndex, 1);
    notifyChange();
    return true;
  }

  // Update a note
  function updateNote(id, updates) {
    if (!state.notes) return null;
    const noteIndex = state.notes.findIndex(n => n.id === id);
    if (noteIndex === -1) return null;
    saveToHistory();
    state.notes[noteIndex] = { ...state.notes[noteIndex], ...updates };
    notifyChange();
    return state.notes[noteIndex];
  }

  // ==========================================
  // PIE CHART METHODS
  // ==========================================

  // Add a pie segment
  function addPieSegment(segment = {}) {
    saveToHistory();
    const id = segment.id || generatePieSegmentId();
    const newSegment = {
      id,
      label: segment.label || 'Segment',
      value: segment.value !== undefined ? segment.value : 25
    };
    if (!state.pieSegments) state.pieSegments = [];
    state.pieSegments.push(newSegment);
    notifyChange();
    return newSegment;
  }

  // Update a pie segment
  function updatePieSegment(id, updates) {
    if (!state.pieSegments) return null;
    const segIndex = state.pieSegments.findIndex(s => s.id === id);
    if (segIndex === -1) return null;
    saveToHistory();
    state.pieSegments[segIndex] = { ...state.pieSegments[segIndex], ...updates };
    notifyChange();
    return state.pieSegments[segIndex];
  }

  // Delete a pie segment
  function deletePieSegment(id) {
    if (!state.pieSegments) return false;
    const segIndex = state.pieSegments.findIndex(s => s.id === id);
    if (segIndex === -1) return false;
    saveToHistory();
    state.pieSegments.splice(segIndex, 1);
    notifyChange();
    return true;
  }

  // Set pie chart title
  function setPieTitle(title) {
    if (state.pieTitle !== title) {
      saveToHistory();
      state.pieTitle = title;
      notifyChange();
    }
  }

  // Set pie chart showData option
  function setPieShowData(show) {
    if (state.pieShowData !== show) {
      saveToHistory();
      state.pieShowData = show;
      notifyChange();
    }
  }

  // ==========================================
  // GANTT CHART METHODS
  // ==========================================

  // Set Gantt chart title
  function setGanttTitle(title) {
    if (state.ganttTitle !== title) {
      saveToHistory();
      state.ganttTitle = title;
      notifyChange();
    }
  }

  // Set Gantt chart date format
  function setGanttDateFormat(format) {
    if (state.ganttDateFormat !== format) {
      saveToHistory();
      state.ganttDateFormat = format;
      notifyChange();
    }
  }

  // Set Gantt chart axis format
  function setGanttAxisFormat(format) {
    if (state.ganttAxisFormat !== format) {
      saveToHistory();
      state.ganttAxisFormat = format;
      notifyChange();
    }
  }

  // Add a Gantt section
  function addGanttSection(section = {}) {
    saveToHistory();
    const id = section.id || generateGanttSectionId();
    const newSection = {
      id,
      name: section.name || 'New Section'
    };
    if (!state.ganttSections) state.ganttSections = [];
    state.ganttSections.push(newSection);
    notifyChange();
    return newSection;
  }

  // Update a Gantt section
  function updateGanttSection(id, updates) {
    if (!state.ganttSections) return null;
    const sectionIndex = state.ganttSections.findIndex(s => s.id === id);
    if (sectionIndex === -1) return null;
    saveToHistory();
    state.ganttSections[sectionIndex] = { ...state.ganttSections[sectionIndex], ...updates };
    notifyChange();
    return state.ganttSections[sectionIndex];
  }

  // Delete a Gantt section and its tasks
  function deleteGanttSection(id) {
    if (!state.ganttSections) return false;
    const sectionIndex = state.ganttSections.findIndex(s => s.id === id);
    if (sectionIndex === -1) return false;
    saveToHistory();
    state.ganttSections.splice(sectionIndex, 1);
    // Also delete all tasks in this section
    if (state.ganttTasks) {
      state.ganttTasks = state.ganttTasks.filter(t => t.sectionId !== id);
    }
    notifyChange();
    return true;
  }

  // Reorder a Gantt section (move to new index)
  function reorderGanttSection(id, newIndex) {
    if (!state.ganttSections) return false;
    const currentIndex = state.ganttSections.findIndex(s => s.id === id);
    if (currentIndex === -1) return false;
    if (newIndex < 0 || newIndex >= state.ganttSections.length) return false;
    if (currentIndex === newIndex) return false;

    saveToHistory();
    const [section] = state.ganttSections.splice(currentIndex, 1);
    state.ganttSections.splice(newIndex, 0, section);
    notifyChange();
    return true;
  }

  // Add a Gantt task
  function addGanttTask(task = {}) {
    saveToHistory();
    const id = task.id || generateGanttTaskId();
    const newTask = {
      id,
      label: task.label || 'New Task',
      sectionId: task.sectionId || (state.ganttSections?.length > 0 ? state.ganttSections[0].id : null),
      taskId: task.taskId || id,  // Mermaid task identifier
      startDate: task.startDate || '',  // Can be date string or "after taskId"
      duration: task.duration || '1d',
      status: task.status || 'normal',  // normal, done, active, crit, milestone
      dependencies: task.dependencies ? [...task.dependencies] : []
    };
    if (!state.ganttTasks) state.ganttTasks = [];
    state.ganttTasks.push(newTask);
    notifyChange();
    return newTask;
  }

  // Update a Gantt task
  function updateGanttTask(id, updates) {
    if (!state.ganttTasks) return null;
    const taskIndex = state.ganttTasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return null;
    saveToHistory();
    const safeUpdates = { ...updates };
    if (updates.dependencies) {
      safeUpdates.dependencies = [...updates.dependencies];
    }
    state.ganttTasks[taskIndex] = { ...state.ganttTasks[taskIndex], ...safeUpdates };
    notifyChange();
    return state.ganttTasks[taskIndex];
  }

  // Delete a Gantt task
  function deleteGanttTask(id) {
    if (!state.ganttTasks) return false;
    const taskIndex = state.ganttTasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return false;

    const deletedTask = state.ganttTasks[taskIndex];
    saveToHistory();
    state.ganttTasks.splice(taskIndex, 1);

    // Remove this task from other tasks' dependencies
    state.ganttTasks.forEach(task => {
      if (task.dependencies && task.dependencies.includes(deletedTask.taskId)) {
        task.dependencies = task.dependencies.filter(dep => dep !== deletedTask.taskId);
      }
    });

    notifyChange();
    return true;
  }

  // Reorder a Gantt task (move to new index within same or different section)
  function reorderGanttTask(id, newIndex, newSectionId = null) {
    if (!state.ganttTasks) return false;
    const currentIndex = state.ganttTasks.findIndex(t => t.id === id);
    if (currentIndex === -1) return false;
    if (newIndex < 0 || newIndex >= state.ganttTasks.length) return false;
    if (currentIndex === newIndex && !newSectionId) return false;

    saveToHistory();
    const [task] = state.ganttTasks.splice(currentIndex, 1);
    if (newSectionId) {
      task.sectionId = newSectionId;
    }
    state.ganttTasks.splice(newIndex, 0, task);
    notifyChange();
    return true;
  }

  // Get tasks for a specific section
  function getGanttTasksForSection(sectionId) {
    if (!state.ganttTasks) return [];
    return state.ganttTasks.filter(t => t.sectionId === sectionId);
  }

  // Initialize history with empty state
  saveToHistory();

  return {
    getState,
    setState,
    reset,
    setType,
    setDirection,
    addNode,
    updateNode,
    renameNode,
    deleteNode,
    getNode,
    addEdge,
    updateEdge,
    deleteEdge,
    reorderEdge,
    getEdgesForNode,
    // Notes (sequence diagrams)
    addNote,
    updateNote,
    deleteNote,
    // Pie chart
    addPieSegment,
    updatePieSegment,
    deletePieSegment,
    setPieTitle,
    setPieShowData,
    // Gantt chart
    setGanttTitle,
    setGanttDateFormat,
    setGanttAxisFormat,
    addGanttSection,
    updateGanttSection,
    deleteGanttSection,
    reorderGanttSection,
    addGanttTask,
    updateGanttTask,
    deleteGanttTask,
    reorderGanttTask,
    getGanttTasksForSection,
    undo,
    redo,
    canUndo,
    canRedo,
    setOnChange,
    saveCurrentState
  };
}
