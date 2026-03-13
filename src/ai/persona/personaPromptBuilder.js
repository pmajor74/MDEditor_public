/**
 * Persona Prompt Builder
 *
 * Builds the final system prompt for persona-mode conversations.
 * Combines the persona's system prompt template with mode-specific
 * instructions (edit vs QA vs create) and optional context.
 */

const { MERMAID_CONTEXT } = require('../prompts/mermaidContext');
const { MARKDOWN_RULES } = require('../prompts/markdownRules');
const { EDIT_INSTRUCTIONS } = require('../prompts/editInstructions');

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
 * Check if message contains any keywords
 */
function containsKeywords(message, keywords) {
  const lowerMessage = message.toLowerCase();
  return keywords.some(keyword => lowerMessage.includes(keyword));
}

const PERSONA_EDIT_SUFFIX = `

## Editing Content

When editing or modifying document content, bring your perspective and voice to the changes while following the required response format.

${EDIT_INSTRUCTIONS}

## Azure Wiki Markdown Reference
${MARKDOWN_RULES}
`;

const PERSONA_QA_SUFFIX = `

## How You Respond

You are in a conversation. The person speaking with you wants to hear YOUR perspective -- your genuine thoughts, drawn from your experience and your writings.

- Speak naturally and directly, as yourself. Do not narrate or describe your views from the outside.
- When your writings are relevant, draw on them as lived knowledge -- not as something you are quoting or referencing, but as things you know and have thought deeply about.
- If someone asks about a topic you have written about, respond from that understanding as if recalling your own thoughts.
- If a topic falls outside what you know, say so honestly and connect it to what you do understand.
- Use markdown formatting for readability when it helps.
- Never preface your answers with "As [name], I think..." -- just speak.
- Do NOT add a Sources or References section. Source attribution is handled separately.
`;

const PERSONA_CREATE_SUFFIX = `

## Writing a New Document

You have been asked to write something new. Write it in your own voice -- the same voice you use in all your work. This document should be unmistakably yours in style, structure, and substance.

- Draw on your existing ideas and philosophy as the foundation
- Structure the content the way you naturally organize your thinking
- Use Azure DevOps Wiki markdown formatting
- Include [[_TOC_]] for multi-section documents (CRITICAL: use UNDERSCORES [[_TOC_]], NEVER asterisks [[*TOC*]])
- Do NOT include a Sources or References section in the document content. Source attribution is handled automatically.

You MUST return your response in this exact JSON format:
\`\`\`json
{
  "title": "Article Title",
  "content": "Full markdown content...",
  "summary": "Brief description of what was created"
}
\`\`\`

## Azure Wiki Markdown Reference
${MARKDOWN_RULES}
`;

/**
 * Build the system prompt for a persona-mode conversation
 * @param {Object} persona - Full persona object with systemPromptTemplate
 * @param {string} userMessage - The user's message (for keyword detection)
 * @param {string} mode - 'edit' | 'qa' | 'create'
 * @returns {string} Complete system prompt
 */
function buildPersonaSystemPrompt(persona, userMessage, mode = 'qa') {
  if (!persona || !persona.systemPromptTemplate) {
    throw new Error('Persona has no system prompt template');
  }

  let prompt = persona.systemPromptTemplate;

  // Add mode-specific suffix
  switch (mode) {
    case 'edit':
      prompt += PERSONA_EDIT_SUFFIX;
      break;
    case 'create':
      prompt += PERSONA_CREATE_SUFFIX;
      break;
    case 'qa':
    default:
      prompt += PERSONA_QA_SUFFIX;
      break;
  }

  // Add Mermaid context if relevant keywords detected
  if (containsKeywords(userMessage, MERMAID_KEYWORDS)) {
    prompt += '\n\n## Mermaid Diagram Syntax\n' + MERMAID_CONTEXT;
  }

  return prompt;
}

module.exports = {
  buildPersonaSystemPrompt
};
