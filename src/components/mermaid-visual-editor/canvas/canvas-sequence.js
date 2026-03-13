/**
 * Canvas Sequence Diagram Support
 *
 * Handles lifeline rendering, message dragging/reordering,
 * endpoint dragging, activation boxes, and snap indicators for sequence diagrams.
 */

import { getDefaultDimensions, MESSAGE_Y_START, MESSAGE_Y_SPACING, PARTICIPANT_SPACING } from '../shapes.js';

/**
 * Create sequence diagram manager for the canvas
 */
export function createSequenceManager(ctx) {
  /**
   * Compute activation states from messages and explicit activate/deactivate statements
   * Returns a Map of participantId -> array of { startY, endY } activation ranges
   */
  function computeActivations() {
    const modelState = ctx.model.getState();
    if (modelState.type !== 'sequence') return new Map();

    const activations = new Map();
    // Track current activation depth per participant
    const activeStack = new Map();

    // Initialize for all participants
    modelState.nodes.forEach(node => {
      activations.set(node.id, []);
      activeStack.set(node.id, []);
    });

    // Process explicit activations if present
    if (modelState.activations && modelState.activations.length > 0) {
      let currentEdgeIndex = 0;

      modelState.activations.forEach(activation => {
        const participantId = activation.participant;
        const stack = activeStack.get(participantId) || [];
        const ranges = activations.get(participantId) || [];

        if (activation.type === 'activate') {
          // Start a new activation at current message position
          const startY = MESSAGE_Y_START + (currentEdgeIndex * MESSAGE_Y_SPACING);
          stack.push({ startY });
          activeStack.set(participantId, stack);
        } else if (activation.type === 'deactivate' && stack.length > 0) {
          // End the most recent activation
          const active = stack.pop();
          const endY = MESSAGE_Y_START + (currentEdgeIndex * MESSAGE_Y_SPACING);
          ranges.push({ startY: active.startY, endY });
          activations.set(participantId, ranges);
          activeStack.set(participantId, stack);
        }

        // Increment edge index for next activation (rough approximation)
        currentEdgeIndex++;
      });
    }

    // Also check for inline activation markers in edges (+/-)
    modelState.edges.forEach((edge, index) => {
      const messageY = MESSAGE_Y_START + (index * MESSAGE_Y_SPACING);

      // Check if this message has activation markers
      // The parser would have added these as edge.activation = 'activate' | 'deactivate'
      if (edge.activation === 'activate') {
        const stack = activeStack.get(edge.to) || [];
        stack.push({ startY: messageY });
        activeStack.set(edge.to, stack);
      } else if (edge.activation === 'deactivate') {
        const stack = activeStack.get(edge.from) || [];
        const ranges = activations.get(edge.from) || [];
        if (stack.length > 0) {
          const active = stack.pop();
          ranges.push({ startY: active.startY, endY: messageY });
          activations.set(edge.from, ranges);
          activeStack.set(edge.from, stack);
        }
      }
    });

    // Close any unclosed activations at the end
    const edgeCount = modelState.edges.length;
    const endY = MESSAGE_Y_START + (edgeCount * MESSAGE_Y_SPACING);

    activeStack.forEach((stack, participantId) => {
      const ranges = activations.get(participantId) || [];
      while (stack.length > 0) {
        const active = stack.pop();
        ranges.push({ startY: active.startY, endY });
      }
      activations.set(participantId, ranges);
    });

    return activations;
  }

  /** Render activation boxes on lifelines */
  function renderActivationBoxes() {
    // Remove existing activation boxes
    ctx.svg.querySelectorAll('.activation-box').forEach(el => el.remove());

    const modelState = ctx.model.getState();
    if (modelState.type !== 'sequence') return;

    // Only render if we have explicit activations
    if (!modelState.activations || modelState.activations.length === 0) return;

    const activations = computeActivations();
    const ACTIVATION_WIDTH = 12;

    modelState.nodes.forEach(node => {
      const dims = getDefaultDimensions(node.shape);
      const lifelineX = node.x + dims.width / 2;
      const ranges = activations.get(node.id) || [];

      ranges.forEach(range => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', lifelineX - ACTIVATION_WIDTH / 2);
        rect.setAttribute('y', range.startY);
        rect.setAttribute('width', ACTIVATION_WIDTH);
        rect.setAttribute('height', Math.max(range.endY - range.startY, 20));
        rect.setAttribute('class', 'activation-box');
        ctx.layers.lifelines.appendChild(rect);
      });
    });
  }

  /**
   * Render lifelines for sequence diagrams
   */
  function renderLifelines() {
    ctx.layers.lifelines.innerHTML = '';

    const modelState = ctx.model.getState();
    if (modelState.type !== 'sequence') return;

    const edgeCount = modelState.edges.length;
    // Always render lifelines, even with no edges (for message drawing)
    const minLifelineHeight = 100;

    // Calculate lifeline end Y position (below all messages)
    const lastMessageY = MESSAGE_Y_START + (edgeCount * MESSAGE_Y_SPACING);
    const lifelineEndY = edgeCount === 0
      ? MESSAGE_Y_START + minLifelineHeight
      : lastMessageY + 40;

    modelState.nodes.forEach(node => {
      const dims = getDefaultDimensions(node.shape);
      const centerX = node.x + dims.width / 2;
      const startY = node.y + dims.height;

      // Create vertical dashed lifeline
      const lifeline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      lifeline.setAttribute('x1', centerX);
      lifeline.setAttribute('y1', startY);
      lifeline.setAttribute('x2', centerX);
      lifeline.setAttribute('y2', lifelineEndY);
      lifeline.setAttribute('class', 'lifeline');
      lifeline.setAttribute('stroke', '#999');
      lifeline.setAttribute('stroke-width', '1');
      lifeline.setAttribute('stroke-dasharray', '5,5');

      ctx.layers.lifelines.appendChild(lifeline);

      // Create invisible hit area for click-drag message drawing
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const hitWidth = 30; // Width of the clickable area around lifeline
      hitArea.setAttribute('x', centerX - hitWidth / 2);
      hitArea.setAttribute('y', startY);
      hitArea.setAttribute('width', hitWidth);
      hitArea.setAttribute('height', lifelineEndY - startY);
      hitArea.setAttribute('class', 'lifeline-hit-area');
      hitArea.setAttribute('data-participant-id', node.id);
      hitArea.setAttribute('fill', 'transparent');
      hitArea.style.cursor = 'crosshair';

      // Mousedown starts message drawing
      hitArea.addEventListener('mousedown', (e) => {
        // Only handle left click
        if (e.button !== 0) return;
        // Don't start if already dragging something else
        if (ctx.state.isDragging || ctx.state.isDraggingEdge ||
            ctx.state.isDraggingEndpoint || ctx.state.isConnecting) return;

        e.preventDefault();
        e.stopPropagation();

        startMessageDrawing(e, node.id, centerX, startY, lifelineEndY);
      });

      ctx.layers.lifelines.appendChild(hitArea);
    });

    // Render activation boxes after lifelines
    renderActivationBoxes();
  }

  /**
   * Render notes for sequence diagrams
   */
  function renderNotes() {
    // Remove existing notes
    ctx.svg.querySelectorAll('.sequence-note').forEach(el => el.remove());

    const modelState = ctx.model.getState();
    if (modelState.type !== 'sequence') return;
    if (!modelState.notes || modelState.notes.length === 0) return;

    console.log('[renderNotes] Rendering', modelState.notes.length, 'notes');

    const NOTE_WIDTH = 100;
    const NOTE_HEIGHT = 40;
    const NOTE_OFFSET = 20; // Distance from lifeline

    modelState.notes.forEach((note, index) => {
      // Handle multi-participant "over" notes (e.g., "A,B" -> use first participant)
      let participantId = note.participant;
      if (participantId && participantId.includes(',')) {
        participantId = participantId.split(',')[0].trim();
        console.log('[renderNotes] Multi-participant note, using first:', participantId);
      }

      // Find the participant node
      const participant = modelState.nodes.find(n => n.id === participantId);
      if (!participant) {
        console.warn(`[renderNotes] Participant "${participantId}" not found for note:`, note);
        return;
      }

      const dims = getDefaultDimensions(participant.shape);
      const lifelineCenterX = participant.x + dims.width / 2;

      // Calculate note Y position - use stored y position or place in message area
      // Notes appear alongside messages, not at the bottom
      const edgeCount = modelState.edges.length;
      let noteY;
      if (note.y !== undefined) {
        // Use stored Y position
        noteY = note.y;
      } else {
        // Position note after the last message, but still in the message area
        // Each note gets its own row, interleaved with messages
        const baseY = MESSAGE_Y_START + (index * MESSAGE_Y_SPACING);
        // Ensure it's within the message area (not below bottom participants)
        const maxY = MESSAGE_Y_START + (Math.max(0, edgeCount - 1) * MESSAGE_Y_SPACING);
        noteY = Math.min(baseY, maxY);
        // If no messages, place at MESSAGE_Y_START
        if (edgeCount === 0) {
          noteY = MESSAGE_Y_START;
        }
      }

      // Calculate X based on position or use stored X position
      let noteX;
      if (note.x !== undefined) {
        // Use stored X position (from dragging)
        noteX = note.x;
      } else if (note.position === 'left of') {
        noteX = lifelineCenterX - NOTE_WIDTH - NOTE_OFFSET;
      } else if (note.position === 'over') {
        noteX = lifelineCenterX - NOTE_WIDTH / 2;
      } else { // 'right of' or default
        noteX = lifelineCenterX + NOTE_OFFSET;
      }

      // Create note group
      const noteGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      noteGroup.setAttribute('class', 'sequence-note');
      noteGroup.setAttribute('data-note-id', note.id);
      noteGroup.style.cursor = 'pointer';

      // Note background (with folded corner effect)
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const foldSize = 8;
      const d = `M ${noteX} ${noteY}
                 L ${noteX + NOTE_WIDTH - foldSize} ${noteY}
                 L ${noteX + NOTE_WIDTH} ${noteY + foldSize}
                 L ${noteX + NOTE_WIDTH} ${noteY + NOTE_HEIGHT}
                 L ${noteX} ${noteY + NOTE_HEIGHT} Z`;
      rect.setAttribute('d', d);
      rect.setAttribute('class', 'sequence-note-bg');

      // Fold line
      const fold = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      fold.setAttribute('d', `M ${noteX + NOTE_WIDTH - foldSize} ${noteY} L ${noteX + NOTE_WIDTH - foldSize} ${noteY + foldSize} L ${noteX + NOTE_WIDTH} ${noteY + foldSize}`);
      fold.setAttribute('class', 'sequence-note-fold');

      // Note text
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', noteX + NOTE_WIDTH / 2);
      text.setAttribute('y', noteY + NOTE_HEIGHT / 2);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('class', 'sequence-note-text');
      text.textContent = note.text || '';

      // Add double-click handler for editing
      noteGroup.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (ctx.handlers && ctx.handlers.handleNoteDoubleClick) {
          ctx.handlers.handleNoteDoubleClick(e, note, noteX, noteY, NOTE_WIDTH);
        }
      });

      // Add mousedown handler for dragging
      noteGroup.addEventListener('mousedown', (e) => {
        // Only handle left click
        if (e.button !== 0) return;
        // Don't start if already dragging something else
        if (ctx.state.isDragging || ctx.state.isDraggingEdge ||
            ctx.state.isDraggingEndpoint || ctx.state.isConnecting) return;

        e.preventDefault();
        e.stopPropagation();

        const pos = ctx.getMousePosition(e);
        startNoteDrag(e, note, noteX, noteY, pos);
      });

      noteGroup.appendChild(rect);
      noteGroup.appendChild(fold);
      noteGroup.appendChild(text);

      ctx.layers.lifelines.appendChild(noteGroup);
    });
  }

  /**
   * Start dragging a note
   */
  function startNoteDrag(e, note, noteX, noteY, pos) {
    ctx.state.isDraggingNote = true;
    ctx.state.draggingNoteId = note.id;
    ctx.state.draggingNoteStartX = noteX;
    ctx.state.draggingNoteStartY = noteY;
    ctx.state.draggingNoteOffsetX = pos.x - noteX;
    ctx.state.draggingNoteOffsetY = pos.y - noteY;

    // Add dragging class for visual feedback
    const noteGroup = ctx.svg.querySelector(`[data-note-id="${note.id}"]`);
    if (noteGroup) {
      noteGroup.classList.add('dragging');
    }

    // Change cursor
    document.body.style.cursor = 'grabbing';
  }

  /**
   * Handle note drag move
   */
  function handleNoteDragMove(pos) {
    if (!ctx.state.isDraggingNote || !ctx.state.draggingNoteId) return;

    const newX = pos.x - ctx.state.draggingNoteOffsetX;
    const newY = pos.y - ctx.state.draggingNoteOffsetY;

    // Move the note group visually (preview)
    const noteGroup = ctx.svg.querySelector(`[data-note-id="${ctx.state.draggingNoteId}"]`);
    if (noteGroup) {
      const deltaX = newX - ctx.state.draggingNoteStartX;
      const deltaY = newY - ctx.state.draggingNoteStartY;
      noteGroup.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    }

    // Find nearest lifeline and determine snap position
    const snapInfo = findNoteSnapPosition(newX, newY);
    if (snapInfo) {
      // Show snap indicator at the snap position
      const NOTE_HEIGHT = 40;
      showSnapIndicator(snapInfo.snapX + 50, newY + NOTE_HEIGHT / 2); // Center of note
    } else {
      hideSnapIndicator();
    }
  }

  /**
   * Handle note drag end
   */
  function handleNoteDragEnd(pos) {
    if (!ctx.state.isDraggingNote || !ctx.state.draggingNoteId) return;

    const newX = pos.x - ctx.state.draggingNoteOffsetX;
    const newY = pos.y - ctx.state.draggingNoteOffsetY;

    // Check if note actually moved (minimum 5px to avoid accidental drags)
    const deltaX = Math.abs(newX - ctx.state.draggingNoteStartX);
    const deltaY = Math.abs(newY - ctx.state.draggingNoteStartY);
    const didMove = deltaX > 5 || deltaY > 5;

    if (didMove) {
      // Find snap position based on where note was dragged
      const snapInfo = findNoteSnapPosition(newX, newY);

      if (snapInfo) {
        // Update note with new position and participant
        // Clear custom x so it renders from position, keep Y for vertical placement
        ctx.model.updateNote(ctx.state.draggingNoteId, {
          position: snapInfo.position,
          participant: snapInfo.participant,
          x: undefined,  // Clear custom x so it calculates from position
          y: newY        // Keep Y position for vertical placement
        });
      } else {
        // No valid snap target - keep original position (don't update)
        console.log('[handleNoteDragEnd] No valid snap position found');
      }
    }

    // Clean up
    hideSnapIndicator();
    const noteGroup = ctx.svg.querySelector(`[data-note-id="${ctx.state.draggingNoteId}"]`);
    if (noteGroup) {
      noteGroup.classList.remove('dragging');
      noteGroup.style.transform = '';
    }

    document.body.style.cursor = '';

    ctx.state.isDraggingNote = false;
    ctx.state.draggingNoteId = null;
    ctx.state.draggingNoteStartX = 0;
    ctx.state.draggingNoteStartY = 0;
    ctx.state.draggingNoteOffsetX = 0;
    ctx.state.draggingNoteOffsetY = 0;

    // Re-render to show the updated position
    if (didMove) {
      ctx.render();
      ctx.selection.notifyChange();
    }
  }

  /**
   * Create a draggable endpoint handle for sequence diagram messages
   */
  function createEndpointHandle(x, y, type, edge) {
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    handle.setAttribute('cx', x);
    handle.setAttribute('cy', y);
    handle.setAttribute('r', 8);
    handle.setAttribute('class', 'edge-endpoint-handle');
    handle.setAttribute('data-edge-id', edge.id);
    handle.setAttribute('data-endpoint', type);

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      startEndpointDrag(e, edge, type);
    });

    return handle;
  }

  /**
   * Start dragging an endpoint to reconnect message to different participant
   */
  function startEndpointDrag(e, edge, endpointType) {
    e.preventDefault();

    const pos = ctx.getMousePosition(e);
    const originalNodeId = endpointType === 'start' ? edge.from : edge.to;

    ctx.state.isDraggingEndpoint = true;
    ctx.state.draggingEndpointEdgeId = edge.id;
    ctx.state.draggingEndpointType = endpointType;
    ctx.state.draggingEndpointOriginalNodeId = originalNodeId;

    // Calculate the Y position of this edge for the message line
    const modelState = ctx.model.getState();
    const edgeIndex = modelState.edges.findIndex(e => e.id === edge.id);
    ctx.state.draggingEndpointY = MESSAGE_Y_START + (edgeIndex * MESSAGE_Y_SPACING);

    // Create temporary drag line
    createEndpointDragLine(pos.x, ctx.state.draggingEndpointY, endpointType, edge);
  }

  /**
   * Create a temporary line showing the endpoint being dragged
   */
  function createEndpointDragLine(x, y, endpointType, edge) {
    // Remove any existing drag line
    ctx.svg.querySelectorAll('.endpoint-drag-line').forEach(el => el.remove());

    const modelState = ctx.model.getState();
    const otherNodeId = endpointType === 'start' ? edge.to : edge.from;
    const otherNode = modelState.nodes.find(n => n.id === otherNodeId);
    if (!otherNode) return;

    const dims = getDefaultDimensions(otherNode.shape);
    const otherX = otherNode.x + dims.width / 2;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'endpoint-drag-line');
    line.setAttribute('x1', endpointType === 'start' ? x : otherX);
    line.setAttribute('y1', y);
    line.setAttribute('x2', endpointType === 'start' ? otherX : x);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#1976d2');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '5,5');

    ctx.svg.appendChild(line);
  }

  /**
   * Find the nearest lifeline (participant) to an X position
   */
  function findNearestLifeline(x) {
    const modelState = ctx.model.getState();
    let nearestNode = null;
    let minDistance = Infinity;
    let nearestX = 0;

    modelState.nodes.forEach(node => {
      const dims = getDefaultDimensions(node.shape);
      const lifelineX = node.x + dims.width / 2;
      const distance = Math.abs(x - lifelineX);

      if (distance < minDistance) {
        minDistance = distance;
        nearestNode = node;
        nearestX = lifelineX;
      }
    });

    // Snap threshold: 50 pixels
    return minDistance < 50 ? { node: nearestNode, x: nearestX } : null;
  }

  /**
   * Find the best snap position for a note being dragged
   * Returns { participant, position, snapX, lifelineX } or null
   */
  function findNoteSnapPosition(noteX, noteY) {
    const modelState = ctx.model.getState();
    const NOTE_WIDTH = 100;
    const NOTE_OFFSET = 20;

    let bestMatch = null;
    let minDistance = Infinity;

    // Check each participant
    modelState.nodes.forEach(node => {
      const dims = getDefaultDimensions(node.shape);
      const lifelineX = node.x + dims.width / 2;

      // Calculate positions for left, over, right
      const leftX = lifelineX - NOTE_WIDTH - NOTE_OFFSET;
      const overX = lifelineX - NOTE_WIDTH / 2;
      const rightX = lifelineX + NOTE_OFFSET;

      // Check each position
      const positions = [
        { position: 'left of', x: leftX, snapX: leftX },
        { position: 'over', x: overX, snapX: overX },
        { position: 'right of', x: rightX, snapX: rightX }
      ];

      positions.forEach(p => {
        const distance = Math.abs(noteX - p.x);
        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = {
            participant: node.id,
            position: p.position,
            snapX: p.snapX,
            lifelineX: lifelineX
          };
        }
      });
    });

    // Return best match if within reasonable distance (100px)
    return minDistance < 100 ? bestMatch : null;
  }

  /** Show/hide snap indicators */
  function showSnapIndicator(x, y) {
    let ind = ctx.svg.querySelector('.snap-indicator');
    if (!ind) { ind = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); ind.setAttribute('class', 'snap-indicator'); ind.setAttribute('r', 12); ctx.svg.appendChild(ind); }
    ind.setAttribute('cx', x); ind.setAttribute('cy', y); ind.classList.add('visible');
  }
  function hideSnapIndicator() { const ind = ctx.svg.querySelector('.snap-indicator'); if (ind) ind.classList.remove('visible'); }
  function showSnapIndicatorSecond(x, y) {
    let ind = ctx.svg.querySelector('.snap-indicator-second');
    if (!ind) { ind = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); ind.setAttribute('class', 'snap-indicator-second'); ind.setAttribute('r', 12); ctx.svg.appendChild(ind); }
    ind.setAttribute('cx', x); ind.setAttribute('cy', y); ind.classList.add('visible');
  }
  function hideSnapIndicatorSecond() { const ind = ctx.svg.querySelector('.snap-indicator-second'); if (ind) ind.classList.remove('visible'); }

  /** Create visual indicators for where the edge can be dropped (reorder) */
  function createEdgeDropZones() {
    ctx.svg.querySelectorAll('.edge-drop-zone').forEach(el => el.remove());
    const edgeCount = ctx.model.getState().edges.length;
    for (let i = 0; i <= edgeCount; i++) {
      const y = MESSAGE_Y_START + (i * MESSAGE_Y_SPACING) - 25;
      const dropZone = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      dropZone.setAttribute('class', 'edge-drop-zone'); dropZone.setAttribute('x', '50'); dropZone.setAttribute('y', y);
      dropZone.setAttribute('width', ctx.container.clientWidth - 100); dropZone.setAttribute('height', '50');
      dropZone.setAttribute('fill', 'transparent'); dropZone.setAttribute('data-drop-index', i);
      ctx.layers.edges.appendChild(dropZone);
    }
  }

  function removeEdgeDropZones() { ctx.svg.querySelectorAll('.edge-drop-zone').forEach(el => el.remove()); }

  /** Calculate which drop index the current Y position corresponds to */
  function getDropIndexFromY(y) {
    const edgeCount = ctx.model.getState().edges.length;
    for (let i = 0; i < edgeCount; i++) { if (y < MESSAGE_Y_START + (i * MESSAGE_Y_SPACING)) return i; }
    return edgeCount - 1;
  }

  /** Handle endpoint dragging during mouse move */
  function handleEndpointDragMove(pos) {
    if (!ctx.state.isDraggingEndpoint || !ctx.state.draggingEndpointEdgeId) return;
    const edge = ctx.model.getState().edges.find(e => e.id === ctx.state.draggingEndpointEdgeId);
    if (!edge) return;
    createEndpointDragLine(pos.x, ctx.state.draggingEndpointY, ctx.state.draggingEndpointType, edge);
    const nearest = findNearestLifeline(pos.x);
    nearest ? showSnapIndicator(nearest.x, ctx.state.draggingEndpointY) : hideSnapIndicator();
  }

  /**
   * Handle endpoint drag end
   */
  function handleEndpointDragEnd(pos) {
    if (!ctx.state.isDraggingEndpoint || !ctx.state.draggingEndpointEdgeId) return;

    const nearest = findNearestLifeline(pos.x);

    // If we found a valid lifeline to snap to
    if (nearest && nearest.node) {
      const targetNodeId = nearest.node.id;
      const originalNodeId = ctx.state.draggingEndpointOriginalNodeId;
      const modelState = ctx.model.getState();
      const edge = modelState.edges.find(e => e.id === ctx.state.draggingEndpointEdgeId);

      // Don't update if dropped on the same node or would create self-message
      if (edge && targetNodeId !== originalNodeId) {
        const otherEndNodeId = ctx.state.draggingEndpointType === 'start' ? edge.to : edge.from;

        // Prevent self-messages (from = to)
        if (targetNodeId !== otherEndNodeId) {
          const update = ctx.state.draggingEndpointType === 'start'
            ? { from: targetNodeId }
            : { to: targetNodeId };

          ctx.model.updateEdge(ctx.state.draggingEndpointEdgeId, update);
        }
      }
    }

    // Clean up
    ctx.svg.querySelectorAll('.endpoint-drag-line').forEach(el => el.remove());
    hideSnapIndicator();

    ctx.state.isDraggingEndpoint = false;
    ctx.state.draggingEndpointEdgeId = null;
    ctx.state.draggingEndpointType = null;
    ctx.state.draggingEndpointOriginalNodeId = null;
    ctx.state.draggingEndpointY = 0;

    // Re-render to show the updated connection
    ctx.render();
    ctx.selection.notifyChange();
  }

  /**
   * Handle edge drag move (reorder + horizontal shift)
   */
  function handleEdgeDragMove(pos) {
    if (!ctx.state.isDraggingEdge || !ctx.state.draggingEdgeId) return;

    const deltaX = pos.x - ctx.state.draggingEdgeStartX;
    const deltaY = pos.y - ctx.state.draggingEdgeStartY;
    const newIndex = getDropIndexFromY(pos.y);

    // Highlight the appropriate drop zone
    ctx.svg.querySelectorAll('.edge-drop-zone').forEach(zone => {
      zone.classList.remove('active');
      const zoneIndex = parseInt(zone.getAttribute('data-drop-index'), 10);
      if (zoneIndex === newIndex || zoneIndex === newIndex + 1) {
        zone.classList.add('active');
      }
    });

    // Move the dragged edge visually (temporary preview) - both X and Y
    const edgeGroup = ctx.svg.querySelector(`[data-edge-id="${ctx.state.draggingEdgeId}"]`);
    if (edgeGroup) {
      edgeGroup.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      edgeGroup.style.opacity = '0.7';
    }

    // Show snap indicators for horizontal shift if significant movement
    if (Math.abs(deltaX) > 20) {
      const modelState = ctx.model.getState();
      const edge = modelState.edges.find(e => e.id === ctx.state.draggingEdgeId);
      if (edge) {
        const fromNode = modelState.nodes.find(n => n.id === edge.from);
        const toNode = modelState.nodes.find(n => n.id === edge.to);
        if (fromNode && toNode) {
          const dims = getDefaultDimensions(fromNode.shape);
          const edgeIndex = modelState.edges.findIndex(e => e.id === edge.id);
          const messageY = MESSAGE_Y_START + (edgeIndex * MESSAGE_Y_SPACING);

          // Calculate where shifted endpoints would land
          const shiftedFromX = fromNode.x + dims.width / 2 + deltaX;
          const shiftedToX = toNode.x + dims.width / 2 + deltaX;

          const newFrom = findNearestLifeline(shiftedFromX);
          const newTo = findNearestLifeline(shiftedToX);

          // Show snap indicators for both endpoints
          hideSnapIndicator();
          if (newFrom && newTo && newFrom.node.id !== newTo.node.id) {
            showSnapIndicator(newFrom.x, messageY);
            showSnapIndicatorSecond(newTo.x, messageY);
          }
        }
      }
    } else {
      hideSnapIndicator();
      hideSnapIndicatorSecond();
    }
  }

  /**
   * Handle edge drag end (commit reorder + horizontal shift)
   */
  function handleEdgeDragEnd(pos) {
    if (!ctx.state.isDraggingEdge || !ctx.state.draggingEdgeId) return;

    const deltaX = pos.x - ctx.state.draggingEdgeStartX;
    const deltaY = pos.y - ctx.state.draggingEdgeStartY;
    const newIndex = getDropIndexFromY(pos.y);

    // Track if any actual changes were made
    let didChange = false;

    // Minimum drag threshold - must move at least 15 pixels to be considered a drag
    const MIN_DRAG_THRESHOLD = 15;
    const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const isActualDrag = totalMovement >= MIN_DRAG_THRESHOLD;

    // 1. Reorder vertically if the position changed AND user actually dragged
    if (isActualDrag && newIndex !== ctx.state.draggingEdgeOriginalIndex) {
      ctx.model.reorderEdge(ctx.state.draggingEdgeId, newIndex);
      didChange = true;
    }

    // 2. Shift endpoints horizontally if X changed significantly (threshold: 30px)
    if (Math.abs(deltaX) > 30) {
      const modelState = ctx.model.getState();
      const edge = modelState.edges.find(e => e.id === ctx.state.draggingEdgeId);
      if (edge) {
        const fromNode = modelState.nodes.find(n => n.id === edge.from);
        const toNode = modelState.nodes.find(n => n.id === edge.to);
        if (fromNode && toNode) {
          const dims = getDefaultDimensions(fromNode.shape);

          // Calculate where shifted endpoints would land
          const shiftedFromX = fromNode.x + dims.width / 2 + deltaX;
          const shiftedToX = toNode.x + dims.width / 2 + deltaX;

          const newFrom = findNearestLifeline(shiftedFromX);
          const newTo = findNearestLifeline(shiftedToX);

          // Validate: both must snap to valid participants, and they must be different
          if (newFrom?.node && newTo?.node && newFrom.node.id !== newTo.node.id) {
            ctx.model.updateEdge(ctx.state.draggingEdgeId, {
              from: newFrom.node.id,
              to: newTo.node.id
            });
            didChange = true;
          }
        }
      }
    }

    // Clean up
    removeEdgeDropZones();
    hideSnapIndicator();
    hideSnapIndicatorSecond();
    const edgeGroup = ctx.svg.querySelector(`[data-edge-id="${ctx.state.draggingEdgeId}"]`);
    if (edgeGroup) {
      edgeGroup.classList.remove('dragging');
      edgeGroup.style.transform = '';
      edgeGroup.style.opacity = '';
    }

    ctx.state.isDraggingEdge = false;
    ctx.state.draggingEdgeId = null;
    ctx.state.draggingEdgeOriginalIndex = -1;

    // Only re-render if something actually changed (preserves double-click detection)
    if (didChange) {
      ctx.render();
      ctx.selection.notifyChange();
    }
  }

  // =============================================
  // MESSAGE DRAWING FROM LIFELINES
  // =============================================

  /**
   * Start drawing a message from a lifeline
   */
  function startMessageDrawing(e, participantId, lifelineX, startY, endY) {
    const pos = ctx.getMousePosition(e);

    // Clamp Y to within the lifeline area
    const clampedY = Math.max(startY, Math.min(endY, pos.y));

    ctx.state.isDrawingMessage = true;
    ctx.state.drawingMessageFromId = participantId;
    ctx.state.drawingMessageStartX = lifelineX;
    ctx.state.drawingMessageStartY = clampedY;

    // Show snap indicator on source lifeline
    showSnapIndicator(lifelineX, clampedY);

    // Create preview line
    createMessagePreviewLine(lifelineX, clampedY, pos.x, clampedY);

    // Add drawing class to body for cursor styling
    document.body.classList.add('drawing-message');
  }

  /**
   * Handle mouse move while drawing a message
   */
  function handleMessageDrawMove(pos) {
    if (!ctx.state.isDrawingMessage) return;

    const startX = ctx.state.drawingMessageStartX;
    const startY = ctx.state.drawingMessageStartY;

    // Find if hovering over a target lifeline
    const target = findNearestLifeline(pos.x);

    if (target && target.node) {
      // Snap to target lifeline
      updateMessagePreviewLine(startX, startY, target.x, startY);
      showSnapIndicatorSecond(target.x, startY);
    } else {
      // Follow cursor
      updateMessagePreviewLine(startX, startY, pos.x, startY);
      hideSnapIndicatorSecond();
    }
  }

  /**
   * Handle mouse up to complete message drawing
   */
  function handleMessageDrawEnd(pos) {
    if (!ctx.state.isDrawingMessage) return;

    const fromId = ctx.state.drawingMessageFromId;
    const startY = ctx.state.drawingMessageStartY;

    // Find target lifeline
    const target = findNearestLifeline(pos.x);

    // Clean up
    removeMessagePreviewLine();
    hideSnapIndicator();
    hideSnapIndicatorSecond();
    document.body.classList.remove('drawing-message');

    // Check minimum drag distance to prevent accidental triggers
    const startX = ctx.state.drawingMessageStartX;
    const dragDistance = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
    const MIN_DRAG_DISTANCE = 20;

    // Reset state
    ctx.state.isDrawingMessage = false;
    ctx.state.drawingMessageFromId = null;
    ctx.state.drawingMessageStartX = null;
    ctx.state.drawingMessageStartY = null;

    // Must have valid target lifeline and minimum drag distance (unless self-message)
    if (!target || !target.node) return;

    const toId = target.node.id;
    const isSelfMessage = fromId === toId;

    // For non-self messages, require minimum drag distance
    if (!isSelfMessage && dragDistance < MIN_DRAG_DISTANCE) return;

    // Calculate insertion index based on Y position
    const insertIndex = getInsertIndexFromY(startY);

    // Create new edge/message
    const newEdge = ctx.model.addEdge({
      from: fromId,
      to: toId,
      label: ''
    }, insertIndex);

    // Render the updated diagram
    ctx.render();
    ctx.selection.notifyChange();

    // Open label editor for the new message
    if (newEdge && ctx.editors && ctx.editors.editEdgeLabel) {
      // Small delay to let render complete
      setTimeout(() => {
        ctx.editors.editEdgeLabel(newEdge.id);
      }, 50);
    }
  }

  /**
   * Get the insertion index for a new message based on Y position
   */
  function getInsertIndexFromY(y) {
    const modelState = ctx.model.getState();
    const edgeCount = modelState.edges.length;

    // Find where this Y position falls among existing messages
    for (let i = 0; i < edgeCount; i++) {
      const messageY = MESSAGE_Y_START + (i * MESSAGE_Y_SPACING);
      if (y < messageY) return i;
    }

    // Append at end
    return edgeCount;
  }

  /**
   * Create the message preview line during drawing
   */
  function createMessagePreviewLine(fromX, fromY, toX, toY) {
    removeMessagePreviewLine();

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'message-preview-line');
    line.setAttribute('x1', fromX);
    line.setAttribute('y1', fromY);
    line.setAttribute('x2', toX);
    line.setAttribute('y2', toY);
    line.setAttribute('stroke', '#1976d2');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '5,5');
    line.setAttribute('marker-end', 'url(#arrowhead-end)');

    ctx.layers.connecting.appendChild(line);
  }

  /**
   * Update the message preview line position
   */
  function updateMessagePreviewLine(fromX, fromY, toX, toY) {
    const line = ctx.svg.querySelector('.message-preview-line');
    if (line) {
      line.setAttribute('x2', toX);
      line.setAttribute('y2', toY);
    }
  }

  /**
   * Remove the message preview line
   */
  function removeMessagePreviewLine() {
    ctx.svg.querySelectorAll('.message-preview-line').forEach(el => el.remove());
  }

  /**
   * Recalculate participant spacing based on message label widths
   * Called after edge labels are edited to ensure text fits
   */
  function recalculateParticipantSpacing() {
    const modelState = ctx.model.getState();
    if (modelState.type !== 'sequence') return;
    if (modelState.nodes.length < 2) return;

    const MIN_SPACING = 180;
    const CHAR_WIDTH = 8;  // Slightly larger for safety margin
    const LABEL_PADDING = 50;

    // Sort nodes by X position to get participant order
    const sortedNodes = [...modelState.nodes].sort((a, b) => a.x - b.x);

    // Calculate optimal spacing for each gap based on message labels
    const spacings = [];
    let needsUpdate = false;

    for (let i = 0; i < sortedNodes.length - 1; i++) {
      const left = sortedNodes[i].id;
      const right = sortedNodes[i + 1].id;
      let maxLabelWidth = 0;

      // Find the longest label between these two adjacent participants
      for (const edge of modelState.edges) {
        const isAdjacent = (edge.from === left && edge.to === right) ||
                           (edge.from === right && edge.to === left);
        if (isAdjacent && edge.label) {
          const labelWidth = edge.label.length * CHAR_WIDTH + LABEL_PADDING;
          maxLabelWidth = Math.max(maxLabelWidth, labelWidth);
        }
      }

      const requiredSpacing = Math.max(MIN_SPACING, maxLabelWidth);
      spacings.push(requiredSpacing);

      // Check if current spacing is less than required
      const currentSpacing = sortedNodes[i + 1].x - sortedNodes[i].x;
      if (currentSpacing < requiredSpacing - 5) {
        needsUpdate = true;
      }
    }

    // Only update if spacing needs to increase
    if (!needsUpdate) return;

    // Reposition participants with calculated spacings
    const startX = sortedNodes[0].x;
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

  return {
    renderLifelines,
    renderNotes,
    computeActivations,
    renderActivationBoxes,
    createEndpointHandle,
    startEndpointDrag,
    createEndpointDragLine,
    findNearestLifeline,
    showSnapIndicator,
    hideSnapIndicator,
    showSnapIndicatorSecond,
    hideSnapIndicatorSecond,
    createEdgeDropZones,
    removeEdgeDropZones,
    getDropIndexFromY,
    handleEndpointDragMove,
    handleEndpointDragEnd,
    handleEdgeDragMove,
    handleEdgeDragEnd,
    recalculateParticipantSpacing,
    // Message drawing from lifelines
    handleMessageDrawMove,
    handleMessageDrawEnd,
    // Note dragging
    handleNoteDragMove,
    handleNoteDragEnd
  };
}
