/**
 * Gantt Chart Editor Component
 *
 * Table-based visual editor for Mermaid Gantt charts.
 * Allows editing title, sections, tasks with dates, durations, and dependencies.
 */

// Status options for tasks
const TASK_STATUS_OPTIONS = [
  { value: 'normal', label: 'Normal', class: '' },
  { value: 'done', label: 'Done', class: 've-gantt-status-done' },
  { value: 'active', label: 'Active', class: 've-gantt-status-active' },
  { value: 'critical', label: 'Critical', class: 've-gantt-status-critical' },
  { value: 'milestone', label: 'Milestone', class: 've-gantt-status-milestone' }
];

// Date format options
const DATE_FORMAT_OPTIONS = [
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (ISO)' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'DD-MM-YYYY', label: 'DD-MM-YYYY' }
];

/**
 * Create a Gantt chart editor
 */
export function createGanttEditor(container, model, options = {}) {
  const state = {
    model,
    onChange: options.onChange || null,
    collapsedSections: new Set()
  };

  // Build editor HTML
  const editorEl = document.createElement('div');
  editorEl.className = 've-gantt-editor';
  editorEl.innerHTML = `
    <div class="ve-gantt-header">
      <div class="ve-gantt-title-group">
        <label class="ve-gantt-label">Title:</label>
        <input type="text" id="ve-gantt-title" class="ve-gantt-input ve-gantt-title-input"
               placeholder="Chart title (optional)">
      </div>
      <div class="ve-gantt-format-group">
        <label class="ve-gantt-label">Date Format:</label>
        <select id="ve-gantt-date-format" class="ve-gantt-select">
          ${DATE_FORMAT_OPTIONS.map(opt =>
            `<option value="${opt.value}">${opt.label}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    <div class="ve-gantt-sections-container" id="ve-gantt-sections">
    </div>
    <div class="ve-gantt-footer">
      <button id="ve-gantt-add-section" class="ve-btn">
        <span class="ve-btn-icon">+</span>
        <span class="ve-btn-text">Add Section</span>
      </button>
    </div>
  `;

  container.appendChild(editorEl);

  // Get element references
  const titleInput = editorEl.querySelector('#ve-gantt-title');
  const dateFormatSelect = editorEl.querySelector('#ve-gantt-date-format');
  const sectionsContainer = editorEl.querySelector('#ve-gantt-sections');
  const addSectionBtn = editorEl.querySelector('#ve-gantt-add-section');

  // Initialize from model state
  function syncFromModel() {
    const modelState = state.model.getState();
    titleInput.value = modelState.ganttTitle || '';
    dateFormatSelect.value = modelState.ganttDateFormat || 'YYYY-MM-DD';
    renderSections();
  }

  // Render all sections and their tasks
  function renderSections() {
    const modelState = state.model.getState();
    const sections = modelState.ganttSections || [];
    const tasks = modelState.ganttTasks || [];

    sectionsContainer.innerHTML = '';

    if (sections.length === 0) {
      sectionsContainer.innerHTML = `
        <div class="ve-gantt-empty">
          No sections yet. Click "Add Section" to create one, then add tasks to it.
        </div>
      `;
      return;
    }

    sections.forEach((section, sectionIndex) => {
      const sectionEl = document.createElement('div');
      sectionEl.className = 've-gantt-section';
      sectionEl.dataset.sectionId = section.id;

      const sectionTasks = tasks.filter(t => t.sectionId === section.id);
      const isCollapsed = state.collapsedSections.has(section.id);

      sectionEl.innerHTML = `
        <div class="ve-gantt-section-header">
          <button class="ve-gantt-collapse-btn" data-section-id="${section.id}" title="${isCollapsed ? 'Expand' : 'Collapse'}">
            ${isCollapsed ? '▶' : '▼'}
          </button>
          <input type="text" class="ve-gantt-input ve-gantt-section-name"
                 value="${escapeHtml(section.name)}"
                 data-section-id="${section.id}">
          <span class="ve-gantt-task-count">(${sectionTasks.length} task${sectionTasks.length !== 1 ? 's' : ''})</span>
          <div class="ve-gantt-section-actions">
            ${sectionIndex > 0 ? `<button class="ve-btn ve-btn-small ve-gantt-move-section-up" data-section-id="${section.id}" title="Move up">↑</button>` : ''}
            ${sectionIndex < sections.length - 1 ? `<button class="ve-btn ve-btn-small ve-gantt-move-section-down" data-section-id="${section.id}" title="Move down">↓</button>` : ''}
            <button class="ve-btn ve-btn-small ve-gantt-add-task-btn" data-section-id="${section.id}" title="Add task">+ Task</button>
            <button class="ve-btn ve-btn-small ve-btn-danger ve-gantt-delete-section" data-section-id="${section.id}" title="Delete section">×</button>
          </div>
        </div>
        <div class="ve-gantt-tasks-container ${isCollapsed ? 've-gantt-collapsed' : ''}" data-section-id="${section.id}">
          ${renderTasksTable(sectionTasks, section.id)}
        </div>
      `;

      sectionsContainer.appendChild(sectionEl);
    });

    // Attach event listeners
    attachSectionListeners();
    attachTaskListeners();
  }

  // Render tasks table for a section
  function renderTasksTable(tasks, sectionId) {
    if (tasks.length === 0) {
      return `
        <div class="ve-gantt-no-tasks">
          No tasks in this section. Click "+ Task" to add one.
        </div>
      `;
    }

    const modelState = state.model.getState();
    const allTasks = modelState.ganttTasks || [];

    return `
      <table class="ve-gantt-table">
        <thead>
          <tr>
            <th class="ve-gantt-col-drag"></th>
            <th class="ve-gantt-col-label">Task Name</th>
            <th class="ve-gantt-col-taskid">Task ID</th>
            <th class="ve-gantt-col-start">Start</th>
            <th class="ve-gantt-col-duration">Duration</th>
            <th class="ve-gantt-col-status">Status</th>
            <th class="ve-gantt-col-deps">Dependencies</th>
            <th class="ve-gantt-col-actions"></th>
          </tr>
        </thead>
        <tbody>
          ${tasks.map((task, index) => `
            <tr class="ve-gantt-task-row" data-task-id="${task.id}" draggable="true">
              <td class="ve-gantt-col-drag">
                <span class="ve-gantt-drag-handle" title="Drag to reorder">⋮⋮</span>
              </td>
              <td class="ve-gantt-col-label">
                <input type="text" class="ve-gantt-input ve-gantt-task-label"
                       value="${escapeHtml(task.label)}"
                       data-task-id="${task.id}">
              </td>
              <td class="ve-gantt-col-taskid">
                <input type="text" class="ve-gantt-input ve-gantt-task-id-input"
                       value="${escapeHtml(task.taskId || '')}"
                       data-task-id="${task.id}"
                       placeholder="auto">
              </td>
              <td class="ve-gantt-col-start">
                <div class="ve-gantt-start-container">
                  <input type="text" class="ve-gantt-input ve-gantt-task-start"
                         value="${escapeHtml(task.startDate || '')}"
                         data-task-id="${task.id}"
                         placeholder="YYYY-MM-DD or after...">
                </div>
              </td>
              <td class="ve-gantt-col-duration">
                <input type="text" class="ve-gantt-input ve-gantt-task-duration"
                       value="${escapeHtml(task.duration || '1d')}"
                       data-task-id="${task.id}"
                       placeholder="1d">
              </td>
              <td class="ve-gantt-col-status">
                <select class="ve-gantt-select ve-gantt-task-status" data-task-id="${task.id}">
                  ${TASK_STATUS_OPTIONS.map(opt =>
                    `<option value="${opt.value}" ${task.status === opt.value ? 'selected' : ''}>${opt.label}</option>`
                  ).join('')}
                </select>
              </td>
              <td class="ve-gantt-col-deps">
                <select class="ve-gantt-select ve-gantt-task-deps" data-task-id="${task.id}">
                  <option value="">None</option>
                  ${allTasks.filter(t => t.id !== task.id).map(t =>
                    `<option value="${t.taskId}" ${task.startDate === `after ${t.taskId}` ? 'selected' : ''}>${t.label} (${t.taskId})</option>`
                  ).join('')}
                </select>
              </td>
              <td class="ve-gantt-col-actions">
                <button class="ve-btn ve-btn-danger ve-btn-small ve-gantt-delete-task"
                        data-task-id="${task.id}" title="Delete task">×</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Attach event listeners to sections
  function attachSectionListeners() {
    // Section name inputs
    sectionsContainer.querySelectorAll('.ve-gantt-section-name').forEach(input => {
      input.addEventListener('input', (e) => {
        const sectionId = e.target.dataset.sectionId;
        state.model.updateGanttSection(sectionId, { name: e.target.value });
        notifyChange();
      });
    });

    // Collapse buttons
    sectionsContainer.querySelectorAll('.ve-gantt-collapse-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sectionId = e.currentTarget.dataset.sectionId;
        if (state.collapsedSections.has(sectionId)) {
          state.collapsedSections.delete(sectionId);
        } else {
          state.collapsedSections.add(sectionId);
        }
        renderSections();
      });
    });

    // Move section up buttons
    sectionsContainer.querySelectorAll('.ve-gantt-move-section-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sectionId = e.currentTarget.dataset.sectionId;
        const sections = state.model.getState().ganttSections;
        const currentIndex = sections.findIndex(s => s.id === sectionId);
        if (currentIndex > 0) {
          state.model.reorderGanttSection(sectionId, currentIndex - 1);
          renderSections();
          notifyChange();
        }
      });
    });

    // Move section down buttons
    sectionsContainer.querySelectorAll('.ve-gantt-move-section-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sectionId = e.currentTarget.dataset.sectionId;
        const sections = state.model.getState().ganttSections;
        const currentIndex = sections.findIndex(s => s.id === sectionId);
        if (currentIndex < sections.length - 1) {
          state.model.reorderGanttSection(sectionId, currentIndex + 1);
          renderSections();
          notifyChange();
        }
      });
    });

    // Add task buttons
    sectionsContainer.querySelectorAll('.ve-gantt-add-task-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sectionId = e.currentTarget.dataset.sectionId;
        addTaskToSection(sectionId);
      });
    });

    // Delete section buttons
    sectionsContainer.querySelectorAll('.ve-gantt-delete-section').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sectionId = e.currentTarget.dataset.sectionId;
        if (confirm('Delete this section and all its tasks?')) {
          state.model.deleteGanttSection(sectionId);
          renderSections();
          notifyChange();
        }
      });
    });
  }

  // Attach event listeners to tasks
  function attachTaskListeners() {
    // Task label inputs
    sectionsContainer.querySelectorAll('.ve-gantt-task-label').forEach(input => {
      input.addEventListener('input', (e) => {
        const taskId = e.target.dataset.taskId;
        state.model.updateGanttTask(taskId, { label: e.target.value });
        notifyChange();
      });
    });

    // Task ID inputs
    sectionsContainer.querySelectorAll('.ve-gantt-task-id-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const taskId = e.target.dataset.taskId;
        state.model.updateGanttTask(taskId, { taskId: e.target.value || taskId });
        notifyChange();
      });
    });

    // Task start inputs
    sectionsContainer.querySelectorAll('.ve-gantt-task-start').forEach(input => {
      input.addEventListener('input', (e) => {
        const taskId = e.target.dataset.taskId;
        state.model.updateGanttTask(taskId, { startDate: e.target.value });
        notifyChange();
      });
    });

    // Task duration inputs
    sectionsContainer.querySelectorAll('.ve-gantt-task-duration').forEach(input => {
      input.addEventListener('input', (e) => {
        const taskId = e.target.dataset.taskId;
        state.model.updateGanttTask(taskId, { duration: e.target.value || '1d' });
        notifyChange();
      });
    });

    // Task status selects
    sectionsContainer.querySelectorAll('.ve-gantt-task-status').forEach(select => {
      select.addEventListener('change', (e) => {
        const taskId = e.target.dataset.taskId;
        state.model.updateGanttTask(taskId, { status: e.target.value });
        notifyChange();
      });
    });

    // Task dependency selects
    sectionsContainer.querySelectorAll('.ve-gantt-task-deps').forEach(select => {
      select.addEventListener('change', (e) => {
        const taskId = e.target.dataset.taskId;
        const depTaskId = e.target.value;
        if (depTaskId) {
          state.model.updateGanttTask(taskId, {
            startDate: `after ${depTaskId}`,
            dependencies: [depTaskId]
          });
        } else {
          state.model.updateGanttTask(taskId, {
            startDate: '',
            dependencies: []
          });
        }
        renderSections(); // Re-render to update start date display
        notifyChange();
      });
    });

    // Delete task buttons
    sectionsContainer.querySelectorAll('.ve-gantt-delete-task').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const taskId = e.currentTarget.dataset.taskId;
        state.model.deleteGanttTask(taskId);
        renderSections();
        notifyChange();
      });
    });

    // Drag and drop for tasks
    setupTaskDragAndDrop();
  }

  // Setup drag and drop for task reordering
  function setupTaskDragAndDrop() {
    let draggedTask = null;

    sectionsContainer.querySelectorAll('.ve-gantt-task-row').forEach(row => {
      row.addEventListener('dragstart', (e) => {
        draggedTask = row;
        row.classList.add('ve-gantt-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      row.addEventListener('dragend', () => {
        if (draggedTask) {
          draggedTask.classList.remove('ve-gantt-dragging');
          draggedTask = null;
        }
        sectionsContainer.querySelectorAll('.ve-gantt-drag-over').forEach(el => {
          el.classList.remove('ve-gantt-drag-over');
        });
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedTask && draggedTask !== row) {
          row.classList.add('ve-gantt-drag-over');
        }
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('ve-gantt-drag-over');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        if (draggedTask && draggedTask !== row) {
          const draggedTaskId = draggedTask.dataset.taskId;
          const targetTaskId = row.dataset.taskId;

          const tasks = state.model.getState().ganttTasks;
          const targetIndex = tasks.findIndex(t => t.id === targetTaskId);
          const targetTask = tasks.find(t => t.id === targetTaskId);

          if (targetIndex !== -1 && targetTask) {
            state.model.reorderGanttTask(draggedTaskId, targetIndex, targetTask.sectionId);
            renderSections();
            notifyChange();
          }
        }
        row.classList.remove('ve-gantt-drag-over');
      });
    });
  }

  // Add a task to a section
  function addTaskToSection(sectionId) {
    const modelState = state.model.getState();
    const sectionTasks = (modelState.ganttTasks || []).filter(t => t.sectionId === sectionId);
    const taskNum = sectionTasks.length + 1;

    // Generate a unique task ID
    const allTasks = modelState.ganttTasks || [];
    let taskIdNum = allTasks.length + 1;
    let taskId = `t${taskIdNum}`;
    while (allTasks.some(t => t.taskId === taskId)) {
      taskIdNum++;
      taskId = `t${taskIdNum}`;
    }

    // Determine start date - either after the last task in this section or today
    let startDate = '';
    if (sectionTasks.length > 0) {
      const lastTask = sectionTasks[sectionTasks.length - 1];
      startDate = `after ${lastTask.taskId}`;
    }

    state.model.addGanttTask({
      label: `Task ${taskNum}`,
      sectionId: sectionId,
      taskId: taskId,
      startDate: startDate,
      duration: '1d',
      status: 'normal',
      dependencies: startDate ? [sectionTasks[sectionTasks.length - 1]?.taskId] : []
    });

    // Expand section if collapsed
    state.collapsedSections.delete(sectionId);

    renderSections();
    notifyChange();

    // Focus the new task label
    const newTaskInput = sectionsContainer.querySelector(`.ve-gantt-task-label[data-task-id="${state.model.getState().ganttTasks.slice(-1)[0]?.id}"]`);
    if (newTaskInput) {
      newTaskInput.focus();
      newTaskInput.select();
    }
  }

  // Escape HTML for safe display
  function escapeHtml(text) {
    if (!text) return '';
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
    state.model.setGanttTitle(e.target.value);
    notifyChange();
  });

  dateFormatSelect.addEventListener('change', (e) => {
    state.model.setGanttDateFormat(e.target.value);
    notifyChange();
  });

  addSectionBtn.addEventListener('click', () => {
    const modelState = state.model.getState();
    const sectionNum = (modelState.ganttSections?.length || 0) + 1;
    state.model.addGanttSection({
      name: `Section ${sectionNum}`
    });
    renderSections();
    notifyChange();

    // Focus the new section name
    const lastSection = sectionsContainer.querySelector('.ve-gantt-section:last-child .ve-gantt-section-name');
    if (lastSection) {
      lastSection.focus();
      lastSection.select();
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
