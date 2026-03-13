/**
 * Canvas Zoom and Pan
 *
 * Handles zoom (mouse wheel) and pan (space+drag) functionality.
 */

// Zoom constraints
const MIN_ZOOM = 0.1;  // 10%
const MAX_ZOOM = 4.0;  // 400%
const ZOOM_STEP = 0.1; // 10% per scroll tick

/**
 * Create zoom/pan manager for the canvas
 */
export function createZoomPanManager(ctx) {
  // Zoom/pan state
  const zoomState = {
    scale: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    spacePressed: false
  };

  // Reference to content wrapper group
  let contentGroup = null;

  /**
   * Initialize zoom/pan - wrap all content layers in a transform group
   */
  function initialize() {
    // Create content wrapper group for transformations
    contentGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    contentGroup.setAttribute('class', 've-content-group');

    // Move all layer groups into the content wrapper
    const layers = [
      ctx.layers.lifelines,
      ctx.layers.edges,
      ctx.layers.nodes,
      ctx.layers.connecting
    ];

    layers.forEach(layer => {
      ctx.svg.removeChild(layer);
      contentGroup.appendChild(layer);
    });

    // Add content group to SVG (after defs if present)
    const defs = ctx.svg.querySelector('defs');
    if (defs) {
      ctx.svg.insertBefore(contentGroup, defs.nextSibling);
    } else {
      ctx.svg.appendChild(contentGroup);
    }

    // Add grid layer (behind content)
    const gridLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gridLayer.setAttribute('class', 've-grid-layer');
    ctx.svg.insertBefore(gridLayer, contentGroup);
    ctx.layers.grid = gridLayer;

    // Setup event handlers
    setupZoomPanEvents();

    // Apply initial transform
    applyTransform();
  }

  /**
   * Apply current zoom/pan transform to content group
   */
  function applyTransform() {
    if (!contentGroup) return;
    contentGroup.setAttribute(
      'transform',
      `translate(${zoomState.panX}, ${zoomState.panY}) scale(${zoomState.scale})`
    );
  }

  /**
   * Convert screen coordinates to canvas coordinates (accounting for zoom/pan)
   */
  function screenToCanvas(screenX, screenY) {
    return {
      x: (screenX - zoomState.panX) / zoomState.scale,
      y: (screenY - zoomState.panY) / zoomState.scale
    };
  }

  /**
   * Convert canvas coordinates to screen coordinates
   */
  function canvasToScreen(canvasX, canvasY) {
    return {
      x: canvasX * zoomState.scale + zoomState.panX,
      y: canvasY * zoomState.scale + zoomState.panY
    };
  }

  /**
   * Zoom to a specific level, centered on a point
   */
  function zoomTo(newScale, centerX, centerY) {
    // Clamp scale
    newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));

    if (newScale === zoomState.scale) return;

    // Calculate the point under the cursor in canvas coordinates before zoom
    const canvasPoint = screenToCanvas(centerX, centerY);

    // Update scale
    zoomState.scale = newScale;

    // Calculate new pan to keep the point under the cursor
    zoomState.panX = centerX - canvasPoint.x * zoomState.scale;
    zoomState.panY = centerY - canvasPoint.y * zoomState.scale;

    applyTransform();
    notifyZoomChange();
  }

  /**
   * Zoom in by one step
   */
  function zoomIn(centerX, centerY) {
    const svgRect = ctx.svg.getBoundingClientRect();
    const cx = centerX !== undefined ? centerX : svgRect.width / 2;
    const cy = centerY !== undefined ? centerY : svgRect.height / 2;
    zoomTo(zoomState.scale + ZOOM_STEP, cx, cy);
  }

  /**
   * Zoom out by one step
   */
  function zoomOut(centerX, centerY) {
    const svgRect = ctx.svg.getBoundingClientRect();
    const cx = centerX !== undefined ? centerX : svgRect.width / 2;
    const cy = centerY !== undefined ? centerY : svgRect.height / 2;
    zoomTo(zoomState.scale - ZOOM_STEP, cx, cy);
  }

  /**
   * Reset zoom and pan to default
   */
  function resetZoom() {
    zoomState.scale = 1;
    zoomState.panX = 0;
    zoomState.panY = 0;
    applyTransform();
    notifyZoomChange();
  }

  /**
   * Fit content to view
   */
  function fitToContent() {
    const modelState = ctx.model.getState();
    if (modelState.nodes.length === 0) {
      resetZoom();
      return;
    }

    // Calculate bounding box of all nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    modelState.nodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + 120); // Approximate node width
      maxY = Math.max(maxY, node.y + 60);  // Approximate node height
    });

    // Add padding
    const padding = 50;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    // Calculate scale to fit
    const svgRect = ctx.svg.getBoundingClientRect();
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const scaleX = svgRect.width / contentWidth;
    const scaleY = svgRect.height / contentHeight;
    const newScale = Math.min(scaleX, scaleY, 1); // Don't zoom in past 100%

    // Calculate pan to center content
    zoomState.scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
    zoomState.panX = (svgRect.width - contentWidth * zoomState.scale) / 2 - minX * zoomState.scale;
    zoomState.panY = (svgRect.height - contentHeight * zoomState.scale) / 2 - minY * zoomState.scale;

    applyTransform();
    notifyZoomChange();
  }

  /**
   * Handle mouse wheel for zooming
   */
  function handleWheel(e) {
    // Only zoom if over the SVG
    if (!ctx.svg.contains(e.target)) return;

    e.preventDefault();

    const svgRect = ctx.svg.getBoundingClientRect();
    const mouseX = e.clientX - svgRect.left;
    const mouseY = e.clientY - svgRect.top;

    // Determine zoom direction
    const delta = -Math.sign(e.deltaY) * ZOOM_STEP;
    const newScale = zoomState.scale + delta;

    zoomTo(newScale, mouseX, mouseY);
  }

  /**
   * Handle keydown for space (pan mode)
   */
  function handleKeyDown(e) {
    if (e.code === 'Space' && !zoomState.spacePressed) {
      // Don't trigger if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      e.preventDefault();
      zoomState.spacePressed = true;
      ctx.svg.style.cursor = 'grab';
    }
  }

  /**
   * Handle keyup for space
   */
  function handleKeyUp(e) {
    if (e.code === 'Space') {
      zoomState.spacePressed = false;
      if (!zoomState.isPanning) {
        ctx.svg.style.cursor = '';
      }
    }
  }

  /**
   * Handle mouse down for pan start
   */
  function handleMouseDown(e) {
    // Only pan with space+drag, middle mouse button, or right mouse button
    if (zoomState.spacePressed || e.button === 1 || e.button === 2) {
      e.preventDefault();
      zoomState.isPanning = true;
      zoomState.panStartX = e.clientX - zoomState.panX;
      zoomState.panStartY = e.clientY - zoomState.panY;
      ctx.svg.style.cursor = 'grabbing';
    }
  }

  /**
   * Handle context menu to prevent it when right-click panning
   */
  function handleContextMenu(e) {
    // Prevent context menu on the canvas to allow right-click panning
    e.preventDefault();
  }

  /**
   * Handle mouse move for panning
   */
  function handleMouseMove(e) {
    if (zoomState.isPanning) {
      zoomState.panX = e.clientX - zoomState.panStartX;
      zoomState.panY = e.clientY - zoomState.panStartY;
      applyTransform();
    }
  }

  /**
   * Handle mouse up to end panning
   */
  function handleMouseUp() {
    if (zoomState.isPanning) {
      zoomState.isPanning = false;
      ctx.svg.style.cursor = zoomState.spacePressed ? 'grab' : '';
    }
  }

  /**
   * Setup zoom/pan event handlers
   */
  function setupZoomPanEvents() {
    // Wheel zoom
    ctx.svg.addEventListener('wheel', handleWheel, { passive: false });

    // Space key for pan mode
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Pan drag
    ctx.svg.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Prevent context menu on canvas to allow right-click panning
    ctx.svg.addEventListener('contextmenu', handleContextMenu);
  }

  /**
   * Remove event handlers
   */
  function removeEventHandlers() {
    ctx.svg.removeEventListener('wheel', handleWheel);
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('keyup', handleKeyUp);
    ctx.svg.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    ctx.svg.removeEventListener('contextmenu', handleContextMenu);
  }

  /**
   * Notify zoom change (for toolbar update)
   */
  function notifyZoomChange() {
    if (ctx.state.onZoomChange) {
      ctx.state.onZoomChange(zoomState.scale);
    }
  }

  /**
   * Get current zoom level
   */
  function getZoom() {
    return zoomState.scale;
  }

  /**
   * Get current pan offset
   */
  function getPan() {
    return { x: zoomState.panX, y: zoomState.panY };
  }

  /**
   * Check if currently panning (to prevent other interactions)
   */
  function isPanning() {
    return zoomState.isPanning || zoomState.spacePressed;
  }

  /**
   * Render the grid layer
   */
  function renderGrid() {
    if (!ctx.layers.grid) return;

    // Clear existing grid
    ctx.layers.grid.innerHTML = '';

    if (!ctx.state.showGrid) return;

    const gridSize = ctx.state.gridSize || 20;

    // Get SVG dimensions
    const svgRect = ctx.svg.getBoundingClientRect();
    const width = svgRect.width / zoomState.scale + Math.abs(zoomState.panX / zoomState.scale);
    const height = svgRect.height / zoomState.scale + Math.abs(zoomState.panY / zoomState.scale);

    // Calculate visible area in canvas coordinates
    const startX = Math.floor((-zoomState.panX / zoomState.scale) / gridSize) * gridSize;
    const startY = Math.floor((-zoomState.panY / zoomState.scale) / gridSize) * gridSize;
    const endX = startX + width + gridSize * 2;
    const endY = startY + height + gridSize * 2;

    // Draw vertical lines
    for (let x = startX; x <= endX; x += gridSize) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x);
      line.setAttribute('y1', startY);
      line.setAttribute('x2', x);
      line.setAttribute('y2', endY);
      ctx.layers.grid.appendChild(line);
    }

    // Draw horizontal lines
    for (let y = startY; y <= endY; y += gridSize) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', startX);
      line.setAttribute('y1', y);
      line.setAttribute('x2', endX);
      line.setAttribute('y2', y);
      ctx.layers.grid.appendChild(line);
    }

    // Apply transform to match content
    ctx.layers.grid.setAttribute(
      'transform',
      `translate(${zoomState.panX}, ${zoomState.panY}) scale(${zoomState.scale})`
    );
  }

  /**
   * Toggle grid visibility
   */
  function setShowGrid(show) {
    ctx.state.showGrid = show;
    renderGrid();
  }

  /**
   * Toggle snap to grid
   */
  function setSnapToGrid(snap) {
    ctx.state.snapToGrid = snap;
  }

  /**
   * Snap a value to grid
   */
  function snapToGrid(value) {
    if (!ctx.state.snapToGrid) return value;
    const gridSize = ctx.state.gridSize || 20;
    return Math.round(value / gridSize) * gridSize;
  }

  return {
    initialize,
    screenToCanvas,
    canvasToScreen,
    zoomTo,
    zoomIn,
    zoomOut,
    resetZoom,
    fitToContent,
    getZoom,
    getPan,
    isPanning,
    renderGrid,
    setShowGrid,
    setSnapToGrid,
    snapToGrid,
    removeEventHandlers
  };
}
