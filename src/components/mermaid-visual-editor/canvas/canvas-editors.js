/**
 * Canvas Editors
 *
 * Handles inline text editing and property panels for nodes/edges.
 */

import { SHAPES, getDefaultDimensions, getBestConnectionPoints, MESSAGE_Y_START, MESSAGE_Y_SPACING } from '../shapes.js';

/**
 * Create editors manager for the canvas
 */
export function createEditorsManager(ctx) {
  // Inline editor state
  let activeInlineEditor = null;
  // Property panel editing state
  let editingNode = null;

  // Get panel references from context
  const flowchartPanel = ctx.panels.flowchart;
  const propertyPanel = ctx.panels.property;

  // =============================================
  // INLINE EDITOR FUNCTIONS
  // =============================================

  /**
   * Create inline text editor overlay on a node
   */
  function createInlineEditor(node) {
    destroyInlineEditor();

    const dims = getDefaultDimensions(node.shape);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 've-inline-editor';
    input.value = node.label || node.id;

    // Position over the node label
    input.style.left = `${node.x}px`;
    input.style.top = `${node.y + (dims.height / 2) - 12}px`;
    input.style.width = `${dims.width}px`;
    input.style.height = '24px';

    // Event handlers
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commitInlineEdit(node, input.value);
      } else if (e.key === 'Escape') {
        destroyInlineEditor();
      }
      e.stopPropagation();
    });

    input.addEventListener('blur', () => {
      // Small delay to allow click events to process first
      setTimeout(() => {
        if (activeInlineEditor) {
          commitInlineEdit(node, input.value);
        }
      }, 100);
    });

    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());

    ctx.container.appendChild(input);
    activeInlineEditor = { input, nodeId: node.id };

    input.focus();
    input.select();
  }

  function commitInlineEdit(node, newValue) {
    if (newValue !== null && newValue.trim() !== '' && newValue !== node.label) {
      ctx.model.updateNode(node.id, { label: newValue.trim() });
      ctx.render();
    }
    destroyInlineEditor();
  }

  function destroyInlineEditor() {
    if (activeInlineEditor) {
      activeInlineEditor.input.remove();
      activeInlineEditor = null;
    }
  }

  // =============================================
  // FLOWCHART MINI PROPERTY PANEL
  // =============================================

  function showFlowchartPropertyPanel(node) {
    editingNode = node;
    const dims = getDefaultDimensions(node.shape);

    // Position near the node
    const panelX = Math.min(node.x + dims.width + 10, ctx.container.clientWidth - 240);
    const panelY = Math.max(10, node.y);

    flowchartPanel.style.left = `${panelX}px`;
    flowchartPanel.style.top = `${panelY}px`;

    // Populate fields
    flowchartPanel.querySelector('#ve-fc-label').value = node.label || node.id;
    flowchartPanel.querySelector('#ve-fc-shape').value = node.shape || 'rect';

    flowchartPanel.classList.remove('hidden');

    // Focus and select
    const labelInput = flowchartPanel.querySelector('#ve-fc-label');
    labelInput.focus();
    labelInput.select();
  }

  function hideFlowchartPanel() {
    flowchartPanel.classList.add('hidden');
    editingNode = null;
  }

  function applyFlowchartChanges() {
    if (!editingNode) return;

    const label = flowchartPanel.querySelector('#ve-fc-label').value.trim();
    const shape = flowchartPanel.querySelector('#ve-fc-shape').value;

    if (label) {
      ctx.model.updateNode(editingNode.id, { label, shape });
      ctx.render();
    }
    hideFlowchartPanel();
  }

  // =============================================
  // COMPLEX PROPERTY PANEL (CLASS/ER DIAGRAMS)
  // =============================================

  let currentDiagramType = 'classDiagram'; // Track current diagram type for attribute placeholders

  function showPropertyPanel(node, diagramType) {
    editingNode = node;
    currentDiagramType = diagramType;

    // Update title based on diagram type
    const title = diagramType === 'classDiagram' ? 'Class Properties' : 'Entity Properties';
    propertyPanel.querySelector('.ve-property-panel-title').textContent = title;

    // Show/hide methods group based on diagram type
    const methodsGroup = propertyPanel.querySelector('.ve-methods-group');
    methodsGroup.classList.toggle('hidden', diagramType !== 'classDiagram');

    // Populate fields
    propertyPanel.querySelector('#ve-prop-name').value = node.label || node.id;

    // Populate attributes with diagram-specific placeholder
    renderAttributesList(node.attributes || [], diagramType);

    // Populate methods (for class diagrams)
    if (diagramType === 'classDiagram') {
      renderMethodsList(node.methods || []);
    }

    propertyPanel.classList.remove('hidden');

    // Focus the name input
    propertyPanel.querySelector('#ve-prop-name').focus();
  }

  function hidePropertyPanel() {
    propertyPanel.classList.add('hidden');
    editingNode = null;
  }

  // Common data types for ER diagrams
  const ER_DATA_TYPES = ['string', 'int', 'float', 'boolean', 'date', 'datetime', 'text', 'uuid'];

  // Parse an ER attribute string into type and name parts
  function parseERAttribute(attr) {
    if (!attr) return { type: 'string', name: '' };
    const parts = attr.trim().split(/\s+/);
    if (parts.length >= 2) {
      // Check if first part looks like a known type or PK/FK prefix
      const firstPart = parts[0].toLowerCase();
      if (firstPart === 'pk' || firstPart === 'fk') {
        // PK/FK prefix: "PK int id" -> type="PK int", name="id"
        return { type: parts.slice(0, 2).join(' '), name: parts.slice(2).join(' ') };
      }
      return { type: parts[0], name: parts.slice(1).join(' ') };
    }
    // Single word - treat as name with default type
    return { type: 'string', name: parts[0] || '' };
  }

  // Generate type dropdown HTML
  function generateTypeDropdown(selectedType, index) {
    const normalizedType = selectedType.toLowerCase();
    const options = ER_DATA_TYPES.map(t =>
      `<option value="${t}" ${normalizedType === t ? 'selected' : ''}>${t}</option>`
    ).join('');
    // Add the current type if it's custom (like "PK int")
    const isCustom = !ER_DATA_TYPES.includes(normalizedType);
    const customOption = isCustom ? `<option value="${escapeHtml(selectedType)}" selected>${escapeHtml(selectedType)}</option>` : '';
    return `<select class="ve-type-select ve-attr-type" data-index="${index}">${options}${customOption}</select>`;
  }

  function renderAttributesList(attributes, diagramType = currentDiagramType) {
    const listContainer = propertyPanel.querySelector('#ve-prop-attributes');

    if (diagramType === 'erDiagram') {
      // ER diagram: show type dropdown + name input
      listContainer.innerHTML = attributes.map((attr, i) => {
        const { type, name } = parseERAttribute(attr);
        return `
          <div class="ve-property-list-item ve-er-attr-item" data-index="${i}">
            ${generateTypeDropdown(type, i)}
            <input type="text" class="ve-property-input ve-attr-name" value="${escapeHtml(name)}" placeholder="name" />
            <button class="ve-btn ve-btn-small ve-btn-danger ve-remove-item">&times;</button>
          </div>
        `;
      }).join('');
    } else {
      // Class diagram: simple text input
      listContainer.innerHTML = attributes.map((attr, i) => `
        <div class="ve-property-list-item" data-index="${i}">
          <input type="text" class="ve-property-input ve-attr-input" value="${escapeHtml(attr)}" placeholder="attribute" />
          <button class="ve-btn ve-btn-small ve-btn-danger ve-remove-item">&times;</button>
        </div>
      `).join('');
    }
  }

  function renderMethodsList(methods) {
    const listContainer = propertyPanel.querySelector('#ve-prop-methods');
    listContainer.innerHTML = methods.map((method, i) => `
      <div class="ve-property-list-item" data-index="${i}">
        <input type="text" class="ve-property-input ve-method-input" value="${escapeHtml(method)}" placeholder="method()" />
        <button class="ve-btn ve-btn-small ve-btn-danger ve-remove-item">&times;</button>
      </div>
    `).join('');
  }

  function applyPropertyChanges() {
    if (!editingNode) return;

    const name = propertyPanel.querySelector('#ve-prop-name').value.trim();

    let attributes;
    if (currentDiagramType === 'erDiagram') {
      // ER diagram: combine type dropdown + name input
      const attrItems = propertyPanel.querySelectorAll('.ve-er-attr-item');
      attributes = Array.from(attrItems).map(item => {
        const type = item.querySelector('.ve-attr-type')?.value || 'string';
        const attrName = item.querySelector('.ve-attr-name')?.value.trim() || '';
        return attrName ? `${type} ${attrName}` : '';
      }).filter(v => v);
    } else {
      // Class diagram: simple text input
      attributes = Array.from(propertyPanel.querySelectorAll('.ve-attr-input'))
        .map(input => input.value.trim())
        .filter(v => v);
    }

    const methods = Array.from(propertyPanel.querySelectorAll('.ve-method-input'))
      .map(input => input.value.trim())
      .filter(v => v);

    if (name) {
      // For ER diagrams, the entity name is both the ID and label
      // If the name changed, we need to rename the node ID too
      if (currentDiagramType === 'erDiagram' && name !== editingNode.id) {
        // First rename the node ID (this also updates edge references)
        const renamed = ctx.model.renameNode(editingNode.id, name);
        if (renamed) {
          // Then update other properties (label will match the new ID)
          ctx.model.updateNode(name, {
            label: name,
            attributes: attributes
          });
        } else {
          // Rename failed (maybe name already exists) - just update label
          ctx.model.updateNode(editingNode.id, {
            label: name,
            attributes: attributes
          });
        }
      } else {
        // For other diagram types, just update normally
        ctx.model.updateNode(editingNode.id, {
          label: name,
          attributes: attributes,
          methods: methods
        });
      }
      ctx.render();
    }
    hidePropertyPanel();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // =============================================
  // EDGE LABEL EDITOR
  // =============================================

  /**
   * Create inline editor for edge labels (used on double-click)
   */
  function createEdgeLabelEditor(e, edge) {
    destroyInlineEditor();

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 've-inline-editor';
    input.value = edge.label || '';
    input.placeholder = 'Edge label';

    // Position at click location
    const containerRect = ctx.container.getBoundingClientRect();
    const clickX = e.clientX - containerRect.left + ctx.container.scrollLeft;
    const clickY = e.clientY - containerRect.top + ctx.container.scrollTop;

    input.style.left = `${clickX - 60}px`;
    input.style.top = `${clickY - 12}px`;
    input.style.width = '120px';
    input.style.height = '24px';

    // Event handlers
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const newLabel = input.value.trim();
        ctx.model.updateEdge(edge.id, { label: newLabel });
        ctx.render();
        // Recalculate participant spacing for sequence diagrams
        ctx.sequence.recalculateParticipantSpacing();
        destroyInlineEditor();
      } else if (ev.key === 'Escape') {
        destroyInlineEditor();
      }
      ev.stopPropagation();
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (activeInlineEditor) {
          const newLabel = input.value.trim();
          ctx.model.updateEdge(edge.id, { label: newLabel });
          ctx.render();
          // Recalculate participant spacing for sequence diagrams
          ctx.sequence.recalculateParticipantSpacing();
          destroyInlineEditor();
        }
      }, 100);
    });

    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('mousedown', (ev) => ev.stopPropagation());

    ctx.container.appendChild(input);
    activeInlineEditor = { input, edgeId: edge.id };

    input.focus();
    input.select();
  }

  /**
   * Programmatically open inline editor for an edge label
   * Used by "Add Message" button for sequence diagrams
   */
  function editEdgeLabel(edgeId) {
    const modelState = ctx.model.getState();
    const edge = modelState.edges.find(e => e.id === edgeId);
    if (!edge) {
      console.warn('[editEdgeLabel] Edge not found:', edgeId);
      return;
    }

    const edgeIndex = modelState.edges.findIndex(e => e.id === edgeId);
    const fromNode = modelState.nodes.find(n => n.id === edge.from);
    const toNode = modelState.nodes.find(n => n.id === edge.to);
    if (!fromNode || !toNode) {
      console.warn('[editEdgeLabel] Nodes not found for edge:', edge);
      return;
    }

    destroyInlineEditor();

    // Calculate edge midpoint based on diagram type
    let midX, midY;
    const diagramType = modelState.type || 'flowchart';

    if (diagramType === 'sequence') {
      const dims = getDefaultDimensions(fromNode.shape);
      const messageY = MESSAGE_Y_START + (edgeIndex * MESSAGE_Y_SPACING);
      // Center X between the two participants
      const fromCenterX = fromNode.x + dims.width / 2;
      const toCenterX = toNode.x + dims.width / 2;
      midX = (fromCenterX + toCenterX) / 2;
      midY = messageY;
    } else {
      const points = getBestConnectionPoints(fromNode, toNode);
      midX = (points.from.x + points.to.x) / 2;
      midY = (points.from.y + points.to.y) / 2;
    }

    // Create inline editor
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 've-inline-editor';
    input.value = edge.label || '';
    input.placeholder = 'Message text';

    // Position editor centered on the edge midpoint
    const editorWidth = 140;
    input.style.left = `${midX - editorWidth / 2}px`;
    input.style.top = `${midY - 12}px`;
    input.style.width = `${editorWidth}px`;
    input.style.height = '24px';

    // Event handlers
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const newLabel = input.value.trim();
        ctx.model.updateEdge(edge.id, { label: newLabel });
        ctx.render();
        // Recalculate participant spacing for sequence diagrams
        ctx.sequence.recalculateParticipantSpacing();
        destroyInlineEditor();
      } else if (ev.key === 'Escape') {
        destroyInlineEditor();
      }
      ev.stopPropagation();
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (activeInlineEditor) {
          const newLabel = input.value.trim();
          ctx.model.updateEdge(edge.id, { label: newLabel });
          ctx.render();
          // Recalculate participant spacing for sequence diagrams
          ctx.sequence.recalculateParticipantSpacing();
          destroyInlineEditor();
        }
      }, 100);
    });

    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('mousedown', (ev) => ev.stopPropagation());

    ctx.container.appendChild(input);
    activeInlineEditor = { input, edgeId: edge.id };

    input.focus();
    input.select();
  }

  // =============================================
  // HANDLE NODE DOUBLE CLICK (ROUTES TO CORRECT EDITOR)
  // =============================================

  function handleNodeDoubleClick(e, node) {
    console.log('[DEBUG] handleNodeDoubleClick called for node:', node.id);
    e.preventDefault();
    e.stopPropagation();

    // Close any open panels first
    destroyInlineEditor();
    hideFlowchartPanel();
    hidePropertyPanel();

    const modelState = ctx.model.getState();
    const diagramType = modelState.type;

    // Complex types get property panel
    if (diagramType === 'classDiagram' || diagramType === 'erDiagram') {
      showPropertyPanel(node, diagramType);
      return;
    }

    // Flowchart nodes get mini property panel (inline edit + shape)
    if (diagramType === 'flowchart' || diagramType === 'graph') {
      showFlowchartPropertyPanel(node);
      return;
    }

    // Simple types (sequence, state) get inline editing
    createInlineEditor(node);
  }

  // =============================================
  // SETUP PANEL EVENT HANDLERS
  // =============================================

  function setupPanelEventHandlers() {
    // Flowchart panel event handlers
    flowchartPanel.querySelector('.ve-fc-cancel').addEventListener('click', hideFlowchartPanel);
    flowchartPanel.querySelector('.ve-fc-apply').addEventListener('click', applyFlowchartChanges);
    flowchartPanel.querySelector('#ve-fc-label').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyFlowchartChanges();
      if (e.key === 'Escape') hideFlowchartPanel();
    });

    // Property panel event handlers
    propertyPanel.querySelector('.ve-property-panel-close').addEventListener('click', hidePropertyPanel);
    propertyPanel.querySelector('.ve-prop-cancel').addEventListener('click', hidePropertyPanel);
    propertyPanel.querySelector('.ve-prop-apply').addEventListener('click', applyPropertyChanges);

    propertyPanel.querySelector('.ve-add-attribute').addEventListener('click', () => {
      const listContainer = propertyPanel.querySelector('#ve-prop-attributes');
      const index = listContainer.children.length;
      const item = document.createElement('div');
      item.dataset.index = index;

      if (currentDiagramType === 'erDiagram') {
        // ER diagram: type dropdown + name input
        item.className = 've-property-list-item ve-er-attr-item';
        item.innerHTML = `
          ${generateTypeDropdown('string', index)}
          <input type="text" class="ve-property-input ve-attr-name" value="" placeholder="name" />
          <button class="ve-btn ve-btn-small ve-btn-danger ve-remove-item">&times;</button>
        `;
      } else {
        // Class diagram: simple text input
        item.className = 've-property-list-item';
        item.innerHTML = `
          <input type="text" class="ve-property-input ve-attr-input" value="" placeholder="attribute" />
          <button class="ve-btn ve-btn-small ve-btn-danger ve-remove-item">&times;</button>
        `;
      }

      listContainer.appendChild(item);
      item.querySelector('input').focus();
    });

    propertyPanel.querySelector('.ve-add-method').addEventListener('click', () => {
      const listContainer = propertyPanel.querySelector('#ve-prop-methods');
      const index = listContainer.children.length;
      const item = document.createElement('div');
      item.className = 've-property-list-item';
      item.dataset.index = index;
      item.innerHTML = `
        <input type="text" class="ve-property-input ve-method-input" value="" placeholder="method()" />
        <button class="ve-btn ve-btn-small ve-btn-danger ve-remove-item">&times;</button>
      `;
      listContainer.appendChild(item);
      item.querySelector('input').focus();
    });

    // Event delegation for remove buttons
    propertyPanel.addEventListener('click', (e) => {
      if (e.target.classList.contains('ve-remove-item')) {
        e.target.closest('.ve-property-list-item').remove();
      }
    });
  }

  // Initialize panel event handlers
  setupPanelEventHandlers();

  // =============================================
  // NOTE EDITOR (SEQUENCE DIAGRAMS)
  // =============================================

  /**
   * Handle double-click on a sequence diagram note for editing
   */
  function handleNoteDoubleClick(e, note, noteX, noteY, noteWidth) {
    destroyInlineEditor();

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 've-inline-editor';
    input.value = note.text || '';
    input.placeholder = 'Note text';

    // Position over the note
    input.style.left = `${noteX}px`;
    input.style.top = `${noteY + 8}px`;
    input.style.width = `${noteWidth}px`;
    input.style.height = '24px';

    // Event handlers
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const newText = input.value.trim();
        ctx.model.updateNote(note.id, { text: newText });
        ctx.render();
        destroyInlineEditor();
      } else if (ev.key === 'Escape') {
        destroyInlineEditor();
      }
      ev.stopPropagation();
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (activeInlineEditor) {
          const newText = input.value.trim();
          ctx.model.updateNote(note.id, { text: newText });
          ctx.render();
          destroyInlineEditor();
        }
      }, 100);
    });

    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('mousedown', (ev) => ev.stopPropagation());

    ctx.container.appendChild(input);
    activeInlineEditor = { input, noteId: note.id };

    input.focus();
    input.select();
  }

  return {
    createInlineEditor,
    destroyInlineEditor,
    showFlowchartPropertyPanel,
    hideFlowchartPanel,
    showPropertyPanel,
    hidePropertyPanel,
    createEdgeLabelEditor,
    editEdgeLabel,
    handleNodeDoubleClick,
    handleNoteDoubleClick
  };
}
