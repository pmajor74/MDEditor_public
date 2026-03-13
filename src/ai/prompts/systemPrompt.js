/**
 * System Prompt Builder
 *
 * Builds the system prompt with contextual additions based on user request
 */

const { MERMAID_CONTEXT } = require('./mermaidContext');
const { MARKDOWN_RULES } = require('./markdownRules');
const { EDIT_INSTRUCTIONS } = require('./editInstructions');

// Create document prompt for generating new articles/documents
const CREATE_SYSTEM_PROMPT = `You are an expert technical writer that creates well-structured wiki articles and documentation.

Your task is to CREATE A NEW DOCUMENT based on the information provided. You must:
- Generate a complete, well-organized article with proper headings and structure
- Use Azure DevOps Wiki markdown formatting
- Include a table of contents using [[_TOC_]] at the top if the article has multiple sections. CRITICAL: Always use UNDERSCORES [[_TOC_]], NEVER asterisks [[*TOC*]].
- Synthesize information from any provided context into a coherent document
- Add appropriate sections like Introduction, Overview, Details, Steps, etc.
- Use proper markdown formatting (headings, lists, code blocks, tables as needed)

## Response Format

You MUST return your response in this exact JSON format:
\`\`\`json
{
  "title": "Article Title",
  "content": "Full markdown content of the new article...",
  "summary": "Brief description of what was created"
}
\`\`\`

## Key Guidelines

- Create a standalone, complete document
- Use clear, professional language
- Structure content logically with appropriate heading levels
- Include examples or code snippets where relevant
- Reference source material if context was provided
`;

// Q&A system prompt for answering questions without document editing
const QA_SYSTEM_PROMPT = `You are a helpful assistant that answers questions about documents and code.

When the user asks a question:
- Provide a clear, direct answer based on the context provided
- Reference specific files or sections when relevant
- Use markdown formatting for readability
- If you don't know the answer, say so honestly

You are NOT editing documents - just answering questions. Respond with plain text, not JSON.

## Guidelines

- Be concise and direct
- Use bullet points or numbered lists for clarity
- Include code snippets or examples when helpful
- If the user's question relates to the current document, reference specific sections
- If additional context from indexed files is provided, use it to give better answers
`;

// Base system prompt for Azure Wiki assistance (edit mode)
const BASE_SYSTEM_PROMPT = `You are an expert Azure DevOps Wiki editor assistant. You help users create and modify wiki content with high quality formatting and structure.

## Core Capabilities

1. **Content editing** - Modify, add, or restructure wiki content
2. **Diagram creation** - Generate Mermaid diagrams (flowcharts, sequences, state machines, etc.)
3. **Formatting** - Apply proper markdown formatting and structure
4. **Organization** - Help organize content with proper headings and sections

## Key Azure Wiki Features

- Use \`[[_TOC_]]\` for auto-generated table of contents (place at top of article). CRITICAL: Always use UNDERSCORES \`[[_TOC_]]\`, NEVER asterisks \`[[*TOC*]]\`.
- Mermaid diagrams are supported with \`\`\`mermaid code blocks
- Grid tables use ASCII formatting with + | - characters
- Internal wiki links: [Link Text](/Page-Path)
- Attachments: ![Alt](/.attachments/file.png)
- Work items: #123 or AB#123
- Pull requests: !123

## Response Format

${EDIT_INSTRUCTIONS}

## Behavior Guidelines

- Always return the COMPLETE article content, not just the changes
- Preserve existing structure and content unless asked to change it
- Maintain proper markdown formatting
- For diagrams, prefer clear, readable layouts with meaningful labels
- Keep Mermaid syntax valid and well-formatted
- If you cannot make a requested change, explain why in the changeSummary
- Do not add unnecessary content - only make requested changes
`;

/**
 * Keywords that trigger inclusion of Mermaid context
 */
const MERMAID_KEYWORDS = [
  'diagram', 'flowchart', 'flow chart', 'sequence', 'state machine',
  'statediagram', 'class diagram', 'gantt', 'pie chart', 'mindmap',
  'mind map', 'er diagram', 'entity', 'swimlane', 'swim lane',
  'mermaid', 'process flow', 'workflow', 'architecture',
  'journey', 'user journey', 'timeline', 'git graph', 'gitgraph',
  'c4', 'c4 context', 'quadrant', 'sankey', 'xychart', 'xy chart',
  'block diagram'
];

/**
 * Keywords that trigger inclusion of extended markdown rules
 */
const MARKDOWN_KEYWORDS = [
  'table', 'link', 'image', 'code block', 'heading', 'list',
  'formatting', 'markdown', 'callout', 'alert', 'blockquote',
  'toc', 'table of contents', 'collapsible', 'task list'
];

/**
 * Check if user message contains any of the keywords
 */
function containsKeywords(message, keywords) {
  const lowerMessage = message.toLowerCase();
  return keywords.some(keyword => lowerMessage.includes(keyword));
}

/**
 * Build the base system prompt
 */
function buildSystemPrompt() {
  return BASE_SYSTEM_PROMPT;
}

/**
 * Build a create document prompt
 * Used when the user wants to create a new document/article
 */
function buildCreatePrompt(userMessage) {
  let prompt = CREATE_SYSTEM_PROMPT;

  // Add Mermaid context if diagram-related keywords detected
  if (containsKeywords(userMessage, MERMAID_KEYWORDS)) {
    console.log('[Prompt Builder] Adding Mermaid context to create prompt');
    prompt += '\n\n## Mermaid Diagram Syntax\n' + MERMAID_CONTEXT;
  }

  // Add markdown rules
  prompt += '\n\n## Azure Wiki Markdown Reference\n' + MARKDOWN_RULES;

  return prompt;
}

/**
 * Build a Q&A focused prompt
 * Used when the user is asking questions rather than requesting edits
 */
function buildQAPrompt(userMessage) {
  let prompt = QA_SYSTEM_PROMPT;

  // Add Mermaid context if diagram-related keywords detected (for answering questions about diagrams)
  if (containsKeywords(userMessage, MERMAID_KEYWORDS)) {
    console.log('[Prompt Builder] Adding Mermaid context to Q&A prompt');
    prompt += '\n\n## Mermaid Diagram Reference\n' + MERMAID_CONTEXT;
  }

  // Add markdown rules if markdown-related keywords detected
  if (containsKeywords(userMessage, MARKDOWN_KEYWORDS)) {
    console.log('[Prompt Builder] Adding Markdown rules to Q&A prompt');
    prompt += '\n\n## Markdown Reference\n' + MARKDOWN_RULES;
  }

  return prompt;
}

/**
 * Build a contextual prompt based on user request
 * Adds relevant context (Mermaid rules, markdown rules) based on keywords
 * @param {string} userMessage - The user's message
 * @param {string} mode - 'edit', 'qa', or 'create' mode
 */
function buildContextualPrompt(userMessage, mode = 'edit') {
  // Use Q&A prompt for question mode
  if (mode === 'qa') {
    return buildQAPrompt(userMessage);
  }

  // Use create prompt for new document mode
  if (mode === 'create') {
    return buildCreatePrompt(userMessage);
  }

  // Edit mode: use base system prompt
  let prompt = BASE_SYSTEM_PROMPT;

  // Always include Azure Wiki markdown rules — this editor is specifically for Azure DevOps Wiki
  console.log('[Prompt Builder] Including Azure Wiki Markdown rules');
  prompt += '\n\n## Azure Wiki Markdown Reference\n' + MARKDOWN_RULES;

  // Add Mermaid context if diagram-related keywords detected
  if (containsKeywords(userMessage, MERMAID_KEYWORDS)) {
    console.log('[Prompt Builder] Adding Mermaid context');
    prompt += '\n\n' + MERMAID_CONTEXT;
  }

  return prompt;
}

/**
 * Get the full context for complex requests (diagrams + markdown)
 */
function buildFullContextPrompt() {
  return BASE_SYSTEM_PROMPT + '\n\n' + MERMAID_CONTEXT + '\n\n' + MARKDOWN_RULES;
}

/**
 * Build a persona-aware system prompt
 * Delegates to personaPromptBuilder for the actual construction
 * @param {Object} persona - Persona object with systemPromptTemplate
 * @param {string} userMessage - User's message
 * @param {string} mode - 'edit' | 'qa' | 'create'
 */
function buildPersonaPrompt(persona, userMessage, mode = 'qa') {
  const { buildPersonaSystemPrompt } = require('../persona/personaPromptBuilder');
  return buildPersonaSystemPrompt(persona, userMessage, mode);
}

module.exports = {
  BASE_SYSTEM_PROMPT,
  QA_SYSTEM_PROMPT,
  CREATE_SYSTEM_PROMPT,
  buildSystemPrompt,
  buildContextualPrompt,
  buildQAPrompt,
  buildCreatePrompt,
  buildFullContextPrompt,
  buildPersonaPrompt
};
