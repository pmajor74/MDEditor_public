/**
 * Mermaid Template Picker
 *
 * A modal dialog that shows diagram type options with live previews.
 * Users can select a template to insert into the editor.
 */

import mermaid from 'mermaid';
import { showVisualMermaidEditor } from './mermaid-visual-editor/index.js';

// Mermaid templates with sample code
const MERMAID_TEMPLATES = [
  {
    id: 'visual-editor',
    name: 'Visual Editor',
    description: 'Create diagram visually',
    code: `flowchart TD
    A[Start]`,
    isVisualEditor: true,
    icon: '✎'
  },
  {
    id: 'flowchart',
    name: 'Flowchart',
    description: 'Decision flow with branches',
    code: `graph TD
    A[Start] --> B{Decision?}
    B -->|Yes| C[Do This]
    B -->|No| D[Do That]
    C --> E[End]
    D --> E`
  },
  {
    id: 'sequence',
    name: 'Sequence',
    description: 'Actor interactions',
    code: `sequenceDiagram
    participant User
    participant System
    User->>System: Request
    System-->>User: Response
    User->>System: Confirm
    System-->>User: Done`
  },
  {
    id: 'class',
    name: 'Class Diagram',
    description: 'OOP relationships',
    code: `classDiagram
    class Animal {
        +String name
        +move()
    }
    class Dog {
        +bark()
    }
    class Cat {
        +meow()
    }
    Animal <|-- Dog
    Animal <|-- Cat`
  },
  {
    id: 'state',
    name: 'State Diagram',
    description: 'State transitions',
    code: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: Start
    Processing --> Complete: Success
    Processing --> Error: Failure
    Complete --> [*]
    Error --> Idle: Retry`
  },
  {
    id: 'er',
    name: 'ER Diagram',
    description: 'Database relationships',
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "ordered in"
    CUSTOMER {
        int id
        string name
    }
    ORDER {
        int id
        date created
    }`
  },
  {
    id: 'pie',
    name: 'Pie Chart',
    description: 'Data visualization',
    code: `pie title Project Status
    "Complete" : 45
    "In Progress" : 30
    "Not Started" : 25`
  },
  {
    id: 'gantt',
    name: 'Gantt Chart',
    description: 'Project timeline',
    code: `gantt
    title Project Plan
    dateFormat YYYY-MM-DD
    section Phase 1
    Design    :a1, 2024-01-01, 7d
    Develop   :a2, after a1, 14d
    section Phase 2
    Test      :a3, after a2, 7d
    Deploy    :a4, after a3, 3d`
  },
  {
    id: 'swimlane',
    name: 'Swimlane',
    description: 'API request flow',
    code: `sequenceDiagram
    participant Client
    participant API
    participant Service
    participant Database

    Client->>API: POST /users
    API->>API: Validate token
    API->>Service: createUser(data)
    Service->>Service: Validate input
    Service->>Database: INSERT user
    Database-->>Service: user record
    Service-->>API: User created
    API-->>Client: 201 Created

    Note over Client,API: Error handling
    Client->>API: GET /users/999
    API->>Service: getUser(999)
    Service->>Database: SELECT user
    Database-->>Service: not found
    Service-->>API: null
    API-->>Client: 404 Not Found`
  }
];

let currentCallback = null;
let previewsRendered = false;

/**
 * Initialize mermaid for preview rendering
 */
function initMermaidForPreviews() {
  mermaid.initialize({
    startOnLoad: false,
    theme: document.body.classList.contains('dark-mode') ? 'dark' : 'default',
    securityLevel: 'loose',
    flowchart: { useMaxWidth: true },
    sequence: { useMaxWidth: true }
  });
}

/**
 * Render a single preview SVG
 */
async function renderPreview(template, container) {
  const id = `preview-${template.id}-${Date.now()}`;

  try {
    const { svg } = await mermaid.render(id, template.code);
    container.innerHTML = svg;
    container.classList.remove('loading');
    container.classList.add('loaded');
  } catch (error) {
    container.innerHTML = `<div class="preview-error">Preview unavailable</div>`;
    container.classList.remove('loading');
    container.classList.add('error');
  }
}

/**
 * Build the modal HTML structure
 */
function buildModalHTML() {
  const modal = document.getElementById('mermaid-picker-modal');
  if (!modal) return;

  modal.innerHTML = `
    <div class="mermaid-picker-backdrop"></div>
    <div class="mermaid-picker-dialog">
      <div class="mermaid-picker-header">
        <h2>Insert Mermaid Diagram</h2>
        <button class="mermaid-picker-close" title="Close">&times;</button>
      </div>
      <div class="mermaid-picker-body">
        <div class="mermaid-picker-grid">
          ${MERMAID_TEMPLATES.map(template => `
            <div class="mermaid-template-card" data-template-id="${template.id}">
              <div class="template-preview loading" id="preview-${template.id}">
                <div class="preview-loading">Loading...</div>
              </div>
              <div class="template-info">
                <div class="template-name">${template.name}</div>
                <div class="template-desc">${template.description}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Attach event listeners
  modal.querySelector('.mermaid-picker-backdrop').addEventListener('click', hideMermaidPicker);
  modal.querySelector('.mermaid-picker-close').addEventListener('click', hideMermaidPicker);

  // Card click handlers
  modal.querySelectorAll('.mermaid-template-card').forEach(card => {
    card.addEventListener('click', () => {
      const templateId = card.dataset.templateId;
      const template = MERMAID_TEMPLATES.find(t => t.id === templateId);
      if (template) {
        // Special handling for visual editor
        if (template.isVisualEditor) {
          // Save callback before hiding (hideMermaidPicker clears currentCallback)
          const savedCallback = currentCallback;
          hideMermaidPicker();
          // Open visual editor with callback to insert the result
          showVisualMermaidEditor(template.code, (finalCode) => {
            console.log('[Mermaid Picker] Visual editor callback, savedCallback exists:', !!savedCallback);
            if (savedCallback) {
              const cleanCode = finalCode.replace(/^```mermaid\s*|\s*```$/g, '');
              console.log('[Mermaid Picker] Calling savedCallback with code:', cleanCode.substring(0, 50) + '...');
              savedCallback({ code: cleanCode });
            }
          });
        } else if (currentCallback) {
          currentCallback(template);
          hideMermaidPicker();
        }
      }
    });
  });

  // Keyboard handler for Escape
  document.addEventListener('keydown', handleEscapeKey);
}

function handleEscapeKey(event) {
  if (event.key === 'Escape') {
    hideMermaidPicker();
  }
}

/**
 * Render all previews (called when modal opens)
 */
async function renderAllPreviews() {
  if (previewsRendered) return;

  initMermaidForPreviews();

  for (const template of MERMAID_TEMPLATES) {
    const container = document.getElementById(`preview-${template.id}`);
    if (container) {
      // Special handling for visual editor - show icon instead of preview
      if (template.isVisualEditor) {
        container.innerHTML = `<div class="visual-editor-preview">${template.icon || '✎'}<span>Visual</span></div>`;
        container.classList.remove('loading');
        container.classList.add('loaded');
      } else {
        await renderPreview(template, container);
      }
    }
  }

  previewsRendered = true;
}

/**
 * Show the mermaid picker modal
 * @param {Function} onSelect - Callback when a template is selected
 */
export function showMermaidPicker(onSelect) {
  currentCallback = onSelect;

  const modal = document.getElementById('mermaid-picker-modal');
  if (!modal) {
    console.error('Mermaid picker modal not found in DOM');
    return;
  }

  // Build modal if not already built
  if (!modal.querySelector('.mermaid-picker-dialog')) {
    buildModalHTML();
  }

  // Show modal
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');

  // Render previews (async, non-blocking)
  renderAllPreviews();
}

/**
 * Hide the mermaid picker modal
 */
export function hideMermaidPicker() {
  const modal = document.getElementById('mermaid-picker-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  document.body.classList.remove('modal-open');
  currentCallback = null;
}

/**
 * Get template by ID (for external use)
 */
export function getTemplateById(id) {
  return MERMAID_TEMPLATES.find(t => t.id === id);
}

/**
 * Get all templates
 */
export function getAllTemplates() {
  return MERMAID_TEMPLATES;
}
