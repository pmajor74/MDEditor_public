/**
 * Visual Mermaid Editor - Main Entry Point
 *
 * Full-screen modal for visually editing mermaid diagrams.
 */

import mermaid from 'mermaid';
import { createDiagramModel } from './model.js';
import { createCanvas } from './canvas/index.js';
import { createToolbar } from './toolbar.js';
import { createPieEditor } from './pie-editor.js';
import { createGanttEditor } from './gantt-editor.js';
import { generateMermaidCode, wrapInCodeBlock } from './mermaid-generator.js';
import { parseMermaidCode, canParseMermaid } from './mermaid-parser.js';
import { applyAutoLayout } from './auto-layout.js';

// Initialize mermaid for preview
let mermaidInitialized = false;
let previewId = 0;

function initMermaidPreview() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: document.body.classList.contains('dark-mode') ? 'dark' : 'default',
    securityLevel: 'loose',
    flowchart: { useMaxWidth: true },
    sequence: { useMaxWidth: true }
  });
  mermaidInitialized = true;
}

let modal = null;
let model = null;
let canvas = null;
let toolbar = null;
let pieEditor = null;
let ganttEditor = null;
let codeEditor = null;
let previewContainer = null;
let onApplyCallback = null;
let previewDebounceTimer = null;

/**
 * Create the modal structure
 */
function createModal() {
  const modalEl = document.createElement('div');
  modalEl.id = 'visual-mermaid-editor-modal';
  modalEl.className = 've-modal hidden';

  modalEl.innerHTML = `
    <div class="ve-modal-backdrop"></div>
    <div class="ve-modal-dialog">
      <div class="ve-modal-header">
        <h3 class="ve-modal-title">Visual Mermaid Editor</h3>
        <button class="ve-modal-close" title="Close">&times;</button>
      </div>
      <div class="ve-toolbar-container" id="ve-toolbar-container"></div>
      <div class="ve-modal-content">
        <div class="ve-canvas-container" id="ve-canvas-container"></div>
        <div class="ve-pie-editor-container" id="ve-pie-editor-container" style="display: none;"></div>
        <div class="ve-gantt-editor-container" id="ve-gantt-editor-container" style="display: none;"></div>
        <div class="ve-right-panel">
          <div class="ve-panel-tabs">
            <button class="ve-tab active" data-tab="preview">Preview</button>
            <button class="ve-tab" data-tab="code">Code</button>
          </div>
          <div class="ve-panel-content">
            <div class="ve-preview-panel active" id="ve-preview-panel">
              <div class="ve-preview-container" id="ve-preview-container">
                <div class="ve-preview-loading">Loading preview...</div>
              </div>
            </div>
            <div class="ve-code-panel" id="ve-code-panel-content">
              <div class="ve-code-actions">
                <button id="ve-sync-from-code" class="ve-btn ve-btn-small" title="Parse code to canvas">
                  ← Parse Code
                </button>
              </div>
              <textarea id="ve-code-editor" class="ve-code-editor" spellcheck="false"></textarea>
            </div>
          </div>
        </div>
      </div>
      <div class="ve-modal-footer">
        <button id="ve-cancel" class="ve-btn ve-btn-secondary">Cancel</button>
        <button id="ve-apply" class="ve-btn ve-btn-primary">Apply to Document</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);
  return modalEl;
}

/**
 * Show pie editor and hide canvas/gantt
 */
function showPieEditor() {
  const canvasContainer = document.getElementById('ve-canvas-container');
  const pieEditorContainer = document.getElementById('ve-pie-editor-container');
  const ganttEditorContainer = document.getElementById('ve-gantt-editor-container');

  canvasContainer.style.display = 'none';
  pieEditorContainer.style.display = 'flex';
  ganttEditorContainer.style.display = 'none';

  // Destroy gantt editor if it exists
  if (ganttEditor) {
    ganttEditor.destroy();
    ganttEditor = null;
  }

  // Create pie editor if it doesn't exist
  if (!pieEditor && model) {
    pieEditor = createPieEditor(pieEditorContainer, model, {
      onChange: () => {
        updateCodeEditor();
        updatePreviewDebounced();
      }
    });
  }
}

/**
 * Show gantt editor and hide canvas/pie
 */
function showGanttEditor() {
  const canvasContainer = document.getElementById('ve-canvas-container');
  const pieEditorContainer = document.getElementById('ve-pie-editor-container');
  const ganttEditorContainer = document.getElementById('ve-gantt-editor-container');

  canvasContainer.style.display = 'none';
  pieEditorContainer.style.display = 'none';
  ganttEditorContainer.style.display = 'flex';

  // Destroy pie editor if it exists
  if (pieEditor) {
    pieEditor.destroy();
    pieEditor = null;
  }

  // Create gantt editor if it doesn't exist
  if (!ganttEditor && model) {
    ganttEditor = createGanttEditor(ganttEditorContainer, model, {
      onChange: () => {
        updateCodeEditor();
        updatePreviewDebounced();
      }
    });
  }
}

/**
 * Show canvas and hide pie/gantt editors
 */
function showCanvasEditor() {
  const canvasContainer = document.getElementById('ve-canvas-container');
  const pieEditorContainer = document.getElementById('ve-pie-editor-container');
  const ganttEditorContainer = document.getElementById('ve-gantt-editor-container');

  canvasContainer.style.display = 'block';
  pieEditorContainer.style.display = 'none';
  ganttEditorContainer.style.display = 'none';

  // Destroy pie editor if it exists
  if (pieEditor) {
    pieEditor.destroy();
    pieEditor = null;
  }

  // Destroy gantt editor if it exists
  if (ganttEditor) {
    ganttEditor.destroy();
    ganttEditor = null;
  }
}

/**
 * Initialize the visual editor
 */
function initEditor(initialCode) {
  // Initialize mermaid for preview
  initMermaidPreview();

  // Create model
  model = createDiagramModel();

  // Parse initial code if provided
  let isPieChart = false;
  let isGanttChart = false;
  if (initialCode && canParseMermaid(initialCode)) {
    const parsed = parseMermaidCode(initialCode);
    if (parsed) {
      model.setState(parsed);
      isPieChart = parsed.type === 'pie';
      isGanttChart = parsed.type === 'gantt';
    }
  } else {
    // Start with a default flowchart
    model.reset('flowchart', 'TD');
    model.addNode({ shape: 'rect', label: 'Start', x: 200, y: 50 });
  }

  // Create canvas
  const canvasContainer = document.getElementById('ve-canvas-container');
  canvas = createCanvas(canvasContainer, model, {
    onChange: () => {
      updateUI();
      // Update message dropdowns based on selection for sequence diagrams
      if (toolbar && model.getState().type === 'sequence') {
        toolbar.updateDropdownsFromSelection();
      }
    },
    onZoomChange: (scale) => {
      // Update toolbar zoom display
      if (toolbar) {
        toolbar.setZoomLevel(scale);
      }
    }
  });

  // Create toolbar
  const toolbarContainer = document.getElementById('ve-toolbar-container');
  const modelState = model.getState();
  toolbar = createToolbar(toolbarContainer, {
    diagramType: modelState.type,
    direction: modelState.direction,
    onAddNode: (shape, options) => canvas.addNode(shape, options),
    onAddParticipant: () => {
      // Add a new participant to sequence diagram
      const state = model.getState();
      const participantNum = state.nodes.length + 1;

      // Find the rightmost participant and place new one to the right with proper spacing
      const PARTICIPANT_WIDTH = 120;
      const PARTICIPANT_GAP = 60; // Gap between participants
      let newX = 50; // Default starting position
      let newY = 50; // Default Y position

      if (state.nodes.length > 0) {
        // Find the rightmost participant
        const rightmostX = Math.max(...state.nodes.map(n => n.x));
        newX = rightmostX + PARTICIPANT_WIDTH + PARTICIPANT_GAP;
        // Use the same Y position as existing participants (use first one as reference)
        newY = state.nodes[0].y;
      }

      model.addNode({
        shape: 'rect',
        label: `Participant ${participantNum}`,
        x: newX,
        y: newY
      });
      canvas.render();
      updateCodeEditor();
      updatePreview();
      // Update dropdowns with new participant
      toolbar.updateParticipantDropdowns();
    },
    onAddMessage: (edgeType, fromId, toId) => {
      // Add a new message to sequence diagram
      const state = model.getState();
      const nodes = state.nodes;
      if (nodes.length < 1) {
        alert('Add at least 1 participant before adding messages');
        return;
      }
      // Use provided from/to or default
      const from = fromId || nodes[0].id;
      // For self-messages, to can be the same as from
      const to = toId || (nodes.length > 1 ? nodes[1].id : nodes[0].id);

      // Generate unique label to avoid duplicate rejection
      const messageNum = state.edges.length + 1;
      const newEdge = model.addEdge({
        from,
        to,
        label: from === to ? `Self ${messageNum}` : `Message ${messageNum}`,
        type: edgeType
      });
      if (newEdge) {
        canvas.render();
        updateCodeEditor();
        updatePreview();
        // Update toolbar dropdowns
        toolbar.updateParticipantDropdowns();
        // Open editor for the new edge after a brief delay to ensure render completes
        setTimeout(() => {
          canvas.editEdgeLabel(newEdge.id);
        }, 50);
      }
    },
    getParticipants: () => {
      // Return current participants (nodes) for the toolbar dropdowns
      return model.getState().nodes;
    },
    onAddNote: (position, participantId) => {
      // Add a note to sequence diagram
      const state = model.getState();
      if (state.nodes.length < 1) {
        alert('Add at least 1 participant before adding notes');
        return;
      }
      const participant = participantId || state.nodes[0].id;
      const noteNum = (state.notes?.length || 0) + 1;
      // Calculate Y position - place note after last message in the message area
      const edgeCount = state.edges.length;
      const MESSAGE_Y_START = 150;
      const MESSAGE_Y_SPACING = 50;
      const noteY = MESSAGE_Y_START + (Math.max(0, edgeCount) * MESSAGE_Y_SPACING) - 25;
      model.addNote({
        position: position,
        participant: participant,
        text: `Note ${noteNum}`,
        y: noteY
      });
      canvas.render();
      updateCodeEditor();
      updatePreview();
    },
    // ER diagram callbacks
    getEntities: () => {
      // Return current entities (nodes) for the toolbar dropdowns
      return model.getState().nodes;
    },
    onAddERRelationship: (fromId, toId, fromCardinality, toCardinality) => {
      // Add a new relationship to ER diagram
      const state = model.getState();
      if (state.nodes.length < 1) {
        alert('Add at least 1 entity before adding relationships');
        return;
      }
      // Use provided from/to or default
      const from = fromId || state.nodes[0].id;
      const to = toId || (state.nodes.length > 1 ? state.nodes[1].id : state.nodes[0].id);

      // Generate relationship label
      const relNum = state.edges.length + 1;
      const newEdge = model.addEdge({
        from,
        to,
        label: `relates ${relNum}`,
        type: 'er-relationship',
        fromCardinality: fromCardinality || 'one',
        toCardinality: toCardinality || 'many'
      });
      if (newEdge) {
        canvas.render();
        updateCodeEditor();
        updatePreview();
        // Update entity dropdowns
        toolbar.updateEntityDropdowns();
        // Open editor for the new edge after a brief delay to ensure render completes
        setTimeout(() => {
          canvas.editEdgeLabel(newEdge.id);
        }, 50);
      }
    },
    onERCardinalityChange: (side, cardinality) => {
      // Update the selected edge's cardinality
      const selectedEdge = canvas.getSelectedEdge();
      if (selectedEdge) {
        if (side === 'from') {
          model.updateEdge(selectedEdge.id, { fromCardinality: cardinality });
        } else {
          model.updateEdge(selectedEdge.id, { toCardinality: cardinality });
        }
        canvas.render();
        updateCodeEditor();
        updatePreview();
      }
    },
    onDelete: () => canvas.deleteSelected(),
    onUndo: () => { model.undo(); canvas.render(); updateCodeEditor(); updatePreview(); },
    onRedo: () => { model.redo(); canvas.render(); updateCodeEditor(); updatePreview(); },
    onDirectionChange: (dir) => {
      // Apply auto-layout when direction changes
      model.setDirection(dir);
      const layouted = applyAutoLayout(model.getState());
      model.setState(layouted);
      canvas.render();
      updateCodeEditor();
      updatePreview();
    },
    onTypeChange: (type) => {
      model.setType(type);
      // ER diagrams don't support direction in Mermaid, always use TD
      if (type === 'erDiagram') {
        model.setDirection('TD');
        toolbar.setDirection('TD');
      }
      // Pie charts don't support direction either
      if (type === 'pie') {
        model.setDirection('TD');
        toolbar.setDirection('TD');
        // Initialize with a default segment if empty
        const state = model.getState();
        if (!state.pieSegments || state.pieSegments.length === 0) {
          model.addPieSegment({ label: 'Segment 1', value: 50 });
          model.addPieSegment({ label: 'Segment 2', value: 50 });
        }
        showPieEditor();
      } else if (type === 'gantt') {
        model.setDirection('TD');
        toolbar.setDirection('TD');
        // Initialize with a default section and task if empty
        const state = model.getState();
        if (!state.ganttSections || state.ganttSections.length === 0) {
          const section = model.addGanttSection({ name: 'Phase 1' });
          model.addGanttTask({
            label: 'Task 1',
            sectionId: section.id,
            taskId: 't1',
            startDate: '',
            duration: '7d',
            status: 'normal'
          });
        }
        showGanttEditor();
      } else {
        showCanvasEditor();
      }
      updateCodeEditor();
      updatePreview();
    },
    onEdgeTypeChange: (edgeType) => { canvas.setSelectedEdgeType(edgeType); updateCodeEditor(); updatePreview(); },
    onAutoLayout: () => {
      // Apply auto-layout to arrange nodes
      const layouted = applyAutoLayout(model.getState());
      model.setState(layouted);
      canvas.render();
      updateCodeEditor();
      updatePreview();
    },
    getSelectedEdge: () => canvas.getSelectedEdge(),
    getSelection: () => canvas.getSelection(),
    // Zoom controls
    onZoomIn: () => canvas.zoomIn(),
    onZoomOut: () => canvas.zoomOut(),
    onZoomReset: () => canvas.resetZoom(),
    onFitToContent: () => canvas.fitToContent(),
    // Grid controls
    onToggleGrid: (enabled) => {
      canvas.setShowGrid(enabled);
    },
    onToggleSnap: (enabled) => {
      canvas.setSnapToGrid(enabled);
    }
  });

  // Set up code editor and preview
  codeEditor = document.getElementById('ve-code-editor');
  previewContainer = document.getElementById('ve-preview-container');
  updateCodeEditor();
  updatePreview();

  // Set up tab switching
  setupTabSwitching();

  // Listen for model changes
  model.setOnChange(() => {
    updateCodeEditor();
    updatePreviewDebounced();
    updateUI();
  });

  // Set up sync from code button
  document.getElementById('ve-sync-from-code').addEventListener('click', syncFromCode);

  // Show appropriate editor based on diagram type
  if (isPieChart) {
    showPieEditor();
  } else if (isGanttChart) {
    showGanttEditor();
  } else {
    showCanvasEditor();
  }
}

/**
 * Set up tab switching between preview and code
 */
function setupTabSwitching() {
  const tabs = modal.querySelectorAll('.ve-tab');
  const previewPanel = document.getElementById('ve-preview-panel');
  const codePanel = document.getElementById('ve-code-panel-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Update tab active state
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide panels
      const tabName = tab.dataset.tab;
      if (tabName === 'preview') {
        previewPanel.classList.add('active');
        codePanel.classList.remove('active');
        updatePreview(); // Refresh preview when switching to it
      } else {
        previewPanel.classList.remove('active');
        codePanel.classList.add('active');
      }
    });
  });
}

/**
 * Update preview with debounce for performance
 */
function updatePreviewDebounced() {
  if (previewDebounceTimer) {
    clearTimeout(previewDebounceTimer);
  }
  previewDebounceTimer = setTimeout(updatePreview, 150);
}

/**
 * Update the mermaid preview
 */
async function updatePreview() {
  if (!previewContainer || !model) return;

  const code = generateMermaidCode(model.getState());
  if (!code.trim()) {
    previewContainer.innerHTML = '<div class="ve-preview-empty">Add nodes to see preview</div>';
    return;
  }

  try {
    const id = `ve-preview-${previewId++}`;
    const { svg } = await mermaid.render(id, code);
    previewContainer.innerHTML = svg;
  } catch (error) {
    previewContainer.innerHTML = `<div class="ve-preview-error">Preview error: ${error.message || 'Invalid diagram'}</div>`;
  }
}

/**
 * Update code editor with current model
 */
function updateCodeEditor() {
  if (!codeEditor || !model) return;
  const code = generateMermaidCode(model.getState());
  codeEditor.value = code;
}

/**
 * Sync canvas from code editor
 */
function syncFromCode() {
  if (!codeEditor || !model) return;

  const code = codeEditor.value;
  if (!canParseMermaid(code)) {
    alert('Unable to parse the mermaid code. Please check the syntax.');
    return;
  }

  const parsed = parseMermaidCode(code);
  if (parsed) {
    model.setState(parsed);
    toolbar.setDiagramType(parsed.type);
    toolbar.setDirection(parsed.direction);

    // Handle diagram type-specific UI
    if (parsed.type === 'pie') {
      showPieEditor();
      // Refresh pie editor if it exists
      if (pieEditor) {
        pieEditor.refresh();
      }
    } else if (parsed.type === 'gantt') {
      showGanttEditor();
      // Refresh gantt editor if it exists
      if (ganttEditor) {
        ganttEditor.refresh();
      }
    } else {
      showCanvasEditor();
      canvas.render();
      // Update participant dropdowns for sequence diagrams
      if (parsed.type === 'sequence') {
        toolbar.updateParticipantDropdowns();
      }
      // Update entity dropdowns for ER diagrams
      if (parsed.type === 'erDiagram') {
        toolbar.updateEntityDropdowns();
      }
    }
  }
}

/**
 * Update toolbar state based on model/selection
 */
function updateUI() {
  if (!toolbar || !model) return;

  toolbar.setUndoEnabled(model.canUndo());
  toolbar.setRedoEnabled(model.canRedo());

  const selection = canvas?.getSelection();
  toolbar.setDeleteEnabled(!!selection?.nodeId || !!selection?.edgeId);

  // Update edge type selector based on selected edge
  toolbar.updateEdgeTypeFromSelection();

  // Update ER cardinality dropdowns based on selected edge (for ER diagrams)
  if (model.getState().type === 'erDiagram') {
    toolbar.updateERCardinalityFromSelection();
  }
}

/**
 * Show the visual editor modal
 */
export function showVisualMermaidEditor(initialCode, onApply) {
  // Create modal if it doesn't exist
  if (!modal) {
    modal = createModal();

    // Set up event handlers
    modal.querySelector('.ve-modal-backdrop').addEventListener('click', hideVisualMermaidEditor);
    modal.querySelector('.ve-modal-close').addEventListener('click', hideVisualMermaidEditor);
    modal.querySelector('#ve-cancel').addEventListener('click', hideVisualMermaidEditor);
    modal.querySelector('#ve-apply').addEventListener('click', handleApply);

    // Keyboard shortcut
    document.addEventListener('keydown', handleKeyDown);
  }

  onApplyCallback = onApply;

  // Show modal
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Initialize editor
  initEditor(initialCode);
}

/**
 * Hide the visual editor modal
 */
export function hideVisualMermaidEditor() {
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';

    // Clean up
    if (canvas) {
      canvas.destroy();
      canvas = null;
    }
    if (toolbar) {
      toolbar.destroy();
      toolbar = null;
    }
    if (pieEditor) {
      pieEditor.destroy();
      pieEditor = null;
    }
    if (ganttEditor) {
      ganttEditor.destroy();
      ganttEditor = null;
    }
    model = null;
    codeEditor = null;
  }
}

/**
 * Handle apply button click
 */
function handleApply() {
  if (!codeEditor) return;

  const code = codeEditor.value;
  const wrappedCode = wrapInCodeBlock(code);

  console.log('[Visual Editor] Apply clicked, callback exists:', !!onApplyCallback);
  console.log('[Visual Editor] Code to apply:', code.substring(0, 50) + '...');

  if (onApplyCallback) {
    onApplyCallback(wrappedCode);
  }

  hideVisualMermaidEditor();
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyDown(e) {
  if (!modal || modal.classList.contains('hidden')) return;

  // Escape to close
  if (e.key === 'Escape') {
    hideVisualMermaidEditor();
    return;
  }

  // Ctrl+Z for undo
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (model?.canUndo()) {
      model.undo();
      canvas?.render();
      updateCodeEditor();
    }
    return;
  }

  // Ctrl+Y or Ctrl+Shift+Z for redo
  if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
    e.preventDefault();
    if (model?.canRedo()) {
      model.redo();
      canvas?.render();
      updateCodeEditor();
    }
    return;
  }
}

/**
 * Check if a mermaid code can be edited visually
 */
export function canEditVisually(code) {
  return canParseMermaid(code);
}
