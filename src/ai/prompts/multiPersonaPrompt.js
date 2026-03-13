/**
 * Multi-Persona Prompt Builder
 *
 * Builds system prompts for multi-persona conversations.
 * Each persona speaks in character while being aware of the other
 * personas in the conversation.
 */

const { MERMAID_CONTEXT } = require('./mermaidContext');
const { MARKDOWN_RULES } = require('./markdownRules');
const { EDIT_INSTRUCTIONS } = require('./editInstructions');

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

/**
 * Build multi-persona context section
 * Describes the conversation setup to each participant
 */
function buildMultiPersonaContext(currentPersona, allPersonas) {
  const others = allPersonas.filter(p => p.name !== currentPersona.name);

  if (others.length === 0) {
    return '';
  }

  let context = `\n\n## Conversation Setting\n\n`;
  context += `You are participating in a multi-perspective discussion with:\n`;

  for (const persona of others) {
    context += `- **${persona.displayName}**: ${persona.description || 'Another perspective'}\n`;
  }

  context += `\nYou will see their contributions in the conversation history. `;
  context += `Engage with their ideas naturally -- agree, disagree, build upon, or challenge them as fits your authentic perspective.\n`;
  context += `Keep your responses focused and conversational. You don't need to address everything at once.\n`;

  return context;
}

/**
 * Multi-persona Q&A suffix
 */
const MULTI_PERSONA_QA_SUFFIX = `

## How to Respond

You are in a collaborative conversation exploring a topic from multiple perspectives.

- Speak naturally and directly, as yourself
- Draw on your writings and philosophy as lived knowledge
- Engage with what others have said -- agree, disagree, or build upon their points
- Keep responses focused and conversational (2-4 paragraphs typically)
- If you have nothing meaningful to add, say so briefly
- Use markdown for readability when helpful
- Never preface answers with "As [name], I think..." -- just speak
- Do NOT add Sources or References sections
`;

/**
 * Multi-persona edit mode suffix
 */
const MULTI_PERSONA_EDIT_SUFFIX = `

## Making Edit Suggestions

This is a collaborative editing discussion. You can suggest changes to the document.

When you want to suggest an edit, include it in your response like this:
- Discuss your perspective and reasoning first
- If you have a specific edit suggestion, end with:

\`\`\`suggestion
Your specific text or content suggestion here
\`\`\`

Keep discussion focused on one change at a time. Build on or challenge others' suggestions as appropriate.

${EDIT_INSTRUCTIONS}

## Azure Wiki Markdown Reference
${MARKDOWN_RULES}
`;

/**
 * Build the system prompt for a persona in a multi-persona conversation
 * @param {Object} currentPersona - The persona who will be speaking
 * @param {Array} allPersonas - All personas in the conversation
 * @param {string} userMessage - The user's original message (for keyword detection)
 * @param {string} mode - 'qa' or 'edit'
 * @returns {string} Complete system prompt
 */
function buildMultiPersonaPrompt(currentPersona, allPersonas, userMessage, mode = 'qa') {
  if (!currentPersona || !currentPersona.systemPromptTemplate) {
    throw new Error('Persona has no system prompt template');
  }

  let prompt = currentPersona.systemPromptTemplate;

  // Add multi-persona context
  prompt += buildMultiPersonaContext(currentPersona, allPersonas);

  // Add mode-specific suffix
  if (mode === 'edit') {
    prompt += MULTI_PERSONA_EDIT_SUFFIX;
  } else {
    prompt += MULTI_PERSONA_QA_SUFFIX;
  }

  // Add Mermaid context if relevant keywords detected
  if (containsKeywords(userMessage, MERMAID_KEYWORDS)) {
    prompt += '\n\n## Mermaid Diagram Syntax\n' + MERMAID_CONTEXT;
  }

  return prompt;
}

/**
 * Format conversation history for a persona
 * Shows messages from other personas with their names
 * @param {Array} conversationHistory - Array of {persona, content} objects
 * @param {string} currentPersonaName - Name of persona about to speak
 * @returns {Array} Formatted messages for LangChain
 */
function formatConversationHistory(conversationHistory, currentPersonaName) {
  const { HumanMessage, AIMessage } = require('@langchain/core/messages');
  const messages = [];

  for (const entry of conversationHistory) {
    if (entry.role === 'user') {
      messages.push(new HumanMessage(entry.content));
    } else if (entry.role === 'persona') {
      // Other personas' messages appear as context
      if (entry.personaName === currentPersonaName) {
        // Our own previous messages
        messages.push(new AIMessage(entry.content));
      } else {
        // Other personas' messages - frame as human message with attribution
        messages.push(new HumanMessage(`[${entry.displayName}]: ${entry.content}`));
      }
    }
  }

  return messages;
}

/**
 * Observer system prompt for evaluating conversation progress
 */
const OBSERVER_SYSTEM_PROMPT = `You are an impartial conversation facilitator. Your role is to monitor a multi-perspective discussion and determine:

1. Whether the conversation should continue or conclude
2. Which participant should speak next based on relevance

## Your Responsibilities

- Evaluate whether the original question has been adequately addressed
- Identify when new perspectives would add value
- Recognize when participants are repeating themselves
- Determine when the conversation has reached a natural conclusion

## Speaker Selection Criteria

When choosing the next speaker, consider:
- Who has the most relevant expertise for the current discussion point
- Who hasn't spoken recently but has a pertinent perspective
- Whether a different viewpoint would enrich the discussion
- Whether any participant has been directly referenced or questioned

## Response Format

Always respond in this exact JSON format:
\`\`\`json
{
  "shouldContinue": true/false,
  "nextSpeaker": "persona_name or null if terminating",
  "reason": "Brief explanation for your decision",
  "summaryIfEnding": "If ending, a brief summary of key insights (null otherwise)"
}
\`\`\``;

/**
 * Build observer evaluation prompt
 * @param {Array} personas - All personas in conversation
 * @param {Array} conversationHistory - Full conversation history
 * @param {string} originalQuestion - The user's original question
 * @param {Object} turnCounts - Map of personaName -> turnCount
 * @param {number} maxTurnsPerPersona - Maximum turns allowed per persona
 * @returns {string} Prompt for observer evaluation
 */
function buildObserverEvaluationPrompt(personas, conversationHistory, originalQuestion, turnCounts, maxTurnsPerPersona) {
  let prompt = `## Original Question\n\n"${originalQuestion}"\n\n`;

  prompt += `## Participants\n\n`;
  for (const persona of personas) {
    const turns = turnCounts[persona.name] || 0;
    const remaining = maxTurnsPerPersona - turns;
    const status = remaining > 0 ? `${remaining} turns remaining` : 'turn limit reached';
    prompt += `- **${persona.displayName}** (${persona.name}): ${persona.description || 'Perspective'} [${status}]\n`;
  }

  prompt += `\n## Conversation So Far\n\n`;

  for (const entry of conversationHistory) {
    if (entry.role === 'user') {
      prompt += `**User**: ${entry.content}\n\n`;
    } else if (entry.role === 'persona') {
      prompt += `**${entry.displayName}**: ${entry.content}\n\n`;
    }
  }

  prompt += `\n## Your Task\n\n`;
  prompt += `Evaluate whether this conversation should continue and, if so, who should speak next.\n`;
  prompt += `Consider: Has the question been addressed from multiple angles? Would continuing add value?\n`;
  prompt += `Only select speakers who have turns remaining.\n`;

  return prompt;
}

module.exports = {
  buildMultiPersonaPrompt,
  formatConversationHistory,
  buildObserverEvaluationPrompt,
  OBSERVER_SYSTEM_PROMPT
};
