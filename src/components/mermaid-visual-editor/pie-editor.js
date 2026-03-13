/**
 * Pie Chart Editor Component
 *
 * Table-based visual editor for Mermaid pie charts.
 * Allows editing title, showData option, and segment label/value pairs.
 */

/**
 * Create a pie chart editor
 */
export function createPieEditor(container, model, options = {}) {
  const state = {
    model,
    onChange: options.onChange || null
  };

  // Build editor HTML
  const editorEl = document.createElement('div');
  editorEl.className = 've-pie-editor';
  editorEl.innerHTML = `
    <div class="ve-pie-header">
      <div class="ve-pie-title-group">
        <label class="ve-pie-label">Title:</label>
        <input type="text" id="ve-pie-title" class="ve-pie-input ve-pie-title-input"
               placeholder="Chart title (optional)">
      </div>
      <div class="ve-pie-showdata-group">
        <label class="ve-pie-checkbox-label">
          <input type="checkbox" id="ve-pie-showdata">
          <span>Show Data Values</span>
        </label>
      </div>
    </div>
    <div class="ve-pie-table-container">
      <table class="ve-pie-table">
        <thead>
          <tr>
            <th class="ve-pie-col-num">#</th>
            <th class="ve-pie-col-label">Label</th>
            <th class="ve-pie-col-value">Value</th>
            <th class="ve-pie-col-actions">Actions</th>
          </tr>
        </thead>
        <tbody id="ve-pie-segments">
        </tbody>
      </table>
    </div>
    <div class="ve-pie-footer">
      <button id="ve-pie-add-segment" class="ve-btn">
        <span class="ve-btn-icon">+</span>
        <span class="ve-btn-text">Add Segment</span>
      </button>
    </div>
  `;

  container.appendChild(editorEl);

  // Get element references
  const titleInput = editorEl.querySelector('#ve-pie-title');
  const showDataCheckbox = editorEl.querySelector('#ve-pie-showdata');
  const segmentsBody = editorEl.querySelector('#ve-pie-segments');
  const addSegmentBtn = editorEl.querySelector('#ve-pie-add-segment');

  // Initialize from model state
  function syncFromModel() {
    const modelState = state.model.getState();
    titleInput.value = modelState.pieTitle || '';
    showDataCheckbox.checked = modelState.pieShowData || false;
    renderSegments();
  }

  // Render segments table
  function renderSegments() {
    const modelState = state.model.getState();
    const segments = modelState.pieSegments || [];

    segmentsBody.innerHTML = '';

    if (segments.length === 0) {
      segmentsBody.innerHTML = `
        <tr class="ve-pie-empty-row">
          <td colspan="4">No segments. Click "Add Segment" to add one.</td>
        </tr>
      `;
      return;
    }

    segments.forEach((segment, index) => {
      const row = document.createElement('tr');
      row.className = 've-pie-segment-row';
      row.dataset.segmentId = segment.id;

      row.innerHTML = `
        <td class="ve-pie-col-num">${index + 1}</td>
        <td class="ve-pie-col-label">
          <input type="text" class="ve-pie-input ve-pie-segment-label"
                 value="${escapeHtml(segment.label)}"
                 data-segment-id="${segment.id}">
        </td>
        <td class="ve-pie-col-value">
          <input type="number" class="ve-pie-input ve-pie-segment-value"
                 value="${segment.value}"
                 min="0" step="0.1"
                 data-segment-id="${segment.id}">
        </td>
        <td class="ve-pie-col-actions">
          <button class="ve-btn ve-btn-danger ve-btn-small ve-pie-delete-btn"
                  data-segment-id="${segment.id}" title="Delete segment">
            <span class="ve-btn-icon">×</span>
          </button>
        </td>
      `;

      segmentsBody.appendChild(row);
    });

    // Attach event listeners to new inputs
    attachSegmentListeners();
  }

  // Attach event listeners to segment inputs
  function attachSegmentListeners() {
    // Label inputs
    segmentsBody.querySelectorAll('.ve-pie-segment-label').forEach(input => {
      input.addEventListener('input', (e) => {
        const segmentId = e.target.dataset.segmentId;
        state.model.updatePieSegment(segmentId, { label: e.target.value });
        notifyChange();
      });
    });

    // Value inputs
    segmentsBody.querySelectorAll('.ve-pie-segment-value').forEach(input => {
      input.addEventListener('input', (e) => {
        const segmentId = e.target.dataset.segmentId;
        const value = parseFloat(e.target.value) || 0;
        state.model.updatePieSegment(segmentId, { value });
        notifyChange();
      });
    });

    // Delete buttons
    segmentsBody.querySelectorAll('.ve-pie-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const segmentId = e.currentTarget.dataset.segmentId;
        state.model.deletePieSegment(segmentId);
        renderSegments();
        notifyChange();
      });
    });
  }

  // Escape HTML for safe display
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Notify parent of changes
  function notifyChange() {
    if (state.onChange) {
      state.onChange();
    }
  }

  // Event handlers
  titleInput.addEventListener('input', (e) => {
    state.model.setPieTitle(e.target.value);
    notifyChange();
  });

  showDataCheckbox.addEventListener('change', (e) => {
    state.model.setPieShowData(e.target.checked);
    notifyChange();
  });

  addSegmentBtn.addEventListener('click', () => {
    const modelState = state.model.getState();
    const segmentNum = (modelState.pieSegments?.length || 0) + 1;
    state.model.addPieSegment({
      label: `Segment ${segmentNum}`,
      value: 25
    });
    renderSegments();
    notifyChange();

    // Focus the new label input
    const lastLabelInput = segmentsBody.querySelector('.ve-pie-segment-row:last-child .ve-pie-segment-label');
    if (lastLabelInput) {
      lastLabelInput.focus();
      lastLabelInput.select();
    }
  });

  // Initialize
  syncFromModel();

  // Public API
  function refresh() {
    syncFromModel();
  }

  function destroy() {
    editorEl.remove();
  }

  return {
    refresh,
    destroy
  };
}
