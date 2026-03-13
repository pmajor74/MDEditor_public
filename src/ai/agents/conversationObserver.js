/**
 * Conversation Observer
 *
 * Monitors multi-persona conversations and decides:
 * 1. When to terminate the conversation
 * 2. Which persona should speak next (relevance-based selection)
 * 3. How to summarize the conversation for editing purposes
 */

const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const providerFactory = require('../providers');
const configManager = require('../llmConfigManager');
const {
  buildObserverEvaluationPrompt,
  OBSERVER_SYSTEM_PROMPT
} = require('../prompts/multiPersonaPrompt');

/**
 * Chat mode definitions
 */
const CHAT_MODES = {
  roundRobin: {
    id: 'roundRobin',
    name: 'Round Robin',
    description: 'Each persona speaks in turn, cycling through the group. Good for ensuring equal participation.'
  },
  relevance: {
    id: 'relevance',
    name: 'Relevance-Based',
    description: 'AI decides who speaks next based on expertise and conversation flow. Best for complex topics.'
  },
  debate: {
    id: 'debate',
    name: 'Debate',
    description: 'Personas present contrasting viewpoints and respond to each other. Great for exploring different angles.'
  },
  panel: {
    id: 'panel',
    name: 'Expert Panel',
    description: 'Each persona gives their complete perspective before the next speaks. Ideal for comprehensive analysis.'
  }
};

/**
 * ConversationObserver class
 * Evaluates ongoing conversations and makes decisions about continuation
 */
class ConversationObserver {
  constructor(options = {}) {
    this.maxTotalTurns = options.maxTotalTurns || 15;
    this.maxTurnsPerPersona = options.maxTurnsPerPersona || 3;
    this.chatMode = options.chatMode || 'roundRobin';
    this.model = null;
    this.roundRobinIndex = 0;  // Track position for round-robin mode
    this.panelCurrentPersona = 0;  // Track current persona in panel mode
  }

  /**
   * Initialize the observer with a model
   */
  async initialize() {
    const config = configManager.getActiveConfig();
    this.model = providerFactory.createModel(config.provider, config);
    console.log('[Observer] Initialized with provider:', config.provider);
  }

  /**
   * Evaluate the current conversation state
   * Returns decision about whether to continue and who should speak next
   * @param {Array} personas - All personas in the conversation
   * @param {Array} conversationHistory - Full conversation history
   * @param {string} originalQuestion - The user's original question
   * @param {Object} turnCounts - Map of personaName -> turnCount
   * @returns {Promise<Object>} Evaluation result
   */
  async evaluate(personas, conversationHistory, originalQuestion, turnCounts) {
    console.log('[Observer] Evaluating conversation state...');

    // Check hard limits first
    const totalTurns = Object.values(turnCounts).reduce((a, b) => a + b, 0);

    if (totalTurns >= this.maxTotalTurns) {
      console.log('[Observer] Max total turns reached');
      return {
        shouldContinue: false,
        nextSpeaker: null,
        reason: 'Maximum conversation length reached',
        summary: await this.generateSummary(conversationHistory, originalQuestion)
      };
    }

    // Check if all personas have exhausted their turns
    const availablePersonas = personas.filter(p =>
      (turnCounts[p.name] || 0) < this.maxTurnsPerPersona
    );

    if (availablePersonas.length === 0) {
      console.log('[Observer] All personas have exhausted their turns');
      return {
        shouldContinue: false,
        nextSpeaker: null,
        reason: 'All participants have reached their turn limits',
        summary: await this.generateSummary(conversationHistory, originalQuestion)
      };
    }

    // Select next speaker based on chat mode
    try {
      let result;

      switch (this.chatMode) {
        case 'roundRobin':
          result = this.selectRoundRobin(personas, availablePersonas, turnCounts);
          break;
        case 'panel':
          result = this.selectPanel(personas, availablePersonas, turnCounts);
          break;
        case 'debate':
          result = await this.selectDebate(personas, availablePersonas, conversationHistory, originalQuestion, turnCounts);
          break;
        case 'relevance':
        default:
          result = await this.selectRelevanceBased(personas, availablePersonas, conversationHistory, originalQuestion, turnCounts);
          break;
      }

      console.log('[Observer] Mode:', this.chatMode, '- Decision:', result.shouldContinue ? 'continue' : 'terminate',
        result.shouldContinue ? `(next: ${result.nextSpeaker})` : '');

      return result;
    } catch (error) {
      console.error('[Observer] Evaluation error:', error.message);
      // Default: continue with round-robin selection
      return {
        shouldContinue: true,
        nextSpeaker: availablePersonas[0].name,
        reason: 'Evaluation failed, continuing with next available speaker',
        summary: null
      };
    }
  }

  /**
   * Parse the LLM's evaluation response
   */
  parseEvaluationResponse(responseText) {
    try {
      // Try to find JSON in markdown code block
      const jsonBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonBlockMatch) {
        const parsed = JSON.parse(jsonBlockMatch[1].trim());
        return {
          shouldContinue: parsed.shouldContinue !== false,
          nextSpeaker: parsed.nextSpeaker || null,
          reason: parsed.reason || 'No reason provided',
          summary: parsed.summaryIfEnding || null
        };
      }

      // Try raw JSON
      const jsonMatch = responseText.match(/\{[\s\S]*"shouldContinue"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          shouldContinue: parsed.shouldContinue !== false,
          nextSpeaker: parsed.nextSpeaker || null,
          reason: parsed.reason || 'No reason provided',
          summary: parsed.summaryIfEnding || null
        };
      }
    } catch (e) {
      console.log('[Observer] Failed to parse evaluation response:', e.message);
    }

    // Default: continue
    return {
      shouldContinue: true,
      nextSpeaker: null,
      reason: 'Could not parse evaluation',
      summary: null
    };
  }

  /**
   * Round Robin selection - each persona speaks in turn
   */
  selectRoundRobin(personas, availablePersonas, turnCounts) {
    if (availablePersonas.length === 0) {
      return {
        shouldContinue: false,
        nextSpeaker: null,
        reason: 'All personas have reached their turn limits',
        summary: null
      };
    }

    // Find the next available persona in round-robin order
    let attempts = 0;
    while (attempts < personas.length) {
      const candidate = personas[this.roundRobinIndex % personas.length];
      this.roundRobinIndex++;
      attempts++;

      if (availablePersonas.find(p => p.name === candidate.name)) {
        return {
          shouldContinue: true,
          nextSpeaker: candidate.name,
          reason: 'Round robin selection',
          summary: null
        };
      }
    }

    // Fallback
    return {
      shouldContinue: true,
      nextSpeaker: availablePersonas[0].name,
      reason: 'Round robin fallback',
      summary: null
    };
  }

  /**
   * Panel mode - each persona gives complete perspective before moving on
   */
  selectPanel(personas, availablePersonas, turnCounts) {
    if (availablePersonas.length === 0) {
      return {
        shouldContinue: false,
        nextSpeaker: null,
        reason: 'All personas have shared their perspectives',
        summary: null
      };
    }

    // In panel mode, each persona speaks multiple times before moving to next
    const currentPersona = personas[this.panelCurrentPersona % personas.length];

    // Check if current persona can still speak
    if ((turnCounts[currentPersona.name] || 0) < this.maxTurnsPerPersona) {
      return {
        shouldContinue: true,
        nextSpeaker: currentPersona.name,
        reason: `${currentPersona.displayName} continuing their perspective`,
        summary: null
      };
    }

    // Move to next persona
    this.panelCurrentPersona++;
    if (this.panelCurrentPersona >= personas.length) {
      return {
        shouldContinue: false,
        nextSpeaker: null,
        reason: 'All personas have fully shared their perspectives',
        summary: null
      };
    }

    const nextPersona = personas[this.panelCurrentPersona];
    if (availablePersonas.find(p => p.name === nextPersona.name)) {
      return {
        shouldContinue: true,
        nextSpeaker: nextPersona.name,
        reason: `Moving to ${nextPersona.displayName}'s perspective`,
        summary: null
      };
    }

    // Find next available
    for (let i = this.panelCurrentPersona; i < personas.length; i++) {
      if (availablePersonas.find(p => p.name === personas[i].name)) {
        this.panelCurrentPersona = i;
        return {
          shouldContinue: true,
          nextSpeaker: personas[i].name,
          reason: `Moving to ${personas[i].displayName}'s perspective`,
          summary: null
        };
      }
    }

    return {
      shouldContinue: false,
      nextSpeaker: null,
      reason: 'Panel discussion complete',
      summary: null
    };
  }

  /**
   * Debate mode - LLM selects speakers to present opposing views
   */
  async selectDebate(personas, availablePersonas, conversationHistory, originalQuestion, turnCounts) {
    if (availablePersonas.length === 0) {
      return {
        shouldContinue: false,
        nextSpeaker: null,
        reason: 'Debate concluded - all participants have made their arguments',
        summary: null
      };
    }

    const debatePrompt = `You are moderating a debate between these participants:
${personas.map(p => `- ${p.displayName}: ${p.description || 'No description'}`).join('\n')}

Original topic: "${originalQuestion}"

Recent discussion:
${conversationHistory.slice(-6).map(entry => {
  if (entry.role === 'user') return `User: ${entry.content.substring(0, 200)}...`;
  if (entry.role === 'persona') return `${entry.displayName}: ${entry.content.substring(0, 200)}...`;
  return '';
}).join('\n')}

Available speakers (with turns remaining):
${availablePersonas.map(p => `- ${p.displayName} (${this.maxTurnsPerPersona - (turnCounts[p.name] || 0)} turns left)`).join('\n')}

Select the next speaker who can:
1. Present a contrasting viewpoint to what was just said
2. Challenge assumptions or add a new angle
3. Respond to points made by others

Return JSON: {"nextSpeaker": "persona display name", "reason": "why this speaker should go next", "shouldContinue": true/false}`;

    try {
      const messages = [
        new SystemMessage('You are a debate moderator. Select speakers to ensure diverse viewpoints and productive disagreement.'),
        new HumanMessage(debatePrompt)
      ];

      const response = await this.model.invoke(messages);
      const result = this.parseEvaluationResponse(response?.content || '');

      if (result.nextSpeaker) {
        // Match display name to persona name
        const matched = personas.find(p =>
          p.displayName.toLowerCase() === result.nextSpeaker.toLowerCase() ||
          p.name === result.nextSpeaker
        );
        if (matched && availablePersonas.find(p => p.name === matched.name)) {
          result.nextSpeaker = matched.name;
          return result;
        }
      }

      // Fallback to round-robin
      return this.selectRoundRobin(personas, availablePersonas, turnCounts);
    } catch (error) {
      console.error('[Observer] Debate selection error:', error.message);
      return this.selectRoundRobin(personas, availablePersonas, turnCounts);
    }
  }

  /**
   * Relevance-based selection - LLM decides based on expertise
   */
  async selectRelevanceBased(personas, availablePersonas, conversationHistory, originalQuestion, turnCounts) {
    const evaluationPrompt = buildObserverEvaluationPrompt(
      personas,
      conversationHistory,
      originalQuestion,
      turnCounts,
      this.maxTurnsPerPersona
    );

    const messages = [
      new SystemMessage(OBSERVER_SYSTEM_PROMPT),
      new HumanMessage(evaluationPrompt)
    ];

    const response = await this.model.invoke(messages);
    const result = this.parseEvaluationResponse(response?.content || '');

    // Validate the selected speaker
    if (result.shouldContinue && result.nextSpeaker) {
      const selectedPersona = personas.find(p => p.name === result.nextSpeaker);
      if (!selectedPersona) {
        const byDisplayName = personas.find(p =>
          p.displayName.toLowerCase() === result.nextSpeaker.toLowerCase()
        );
        if (byDisplayName) {
          result.nextSpeaker = byDisplayName.name;
        } else {
          result.nextSpeaker = availablePersonas[0].name;
        }
      }

      if ((turnCounts[result.nextSpeaker] || 0) >= this.maxTurnsPerPersona) {
        result.nextSpeaker = availablePersonas[0].name;
      }
    }

    return result;
  }

  /**
   * Select the next speaker based on relevance
   * Called directly when a quick selection is needed
   */
  async selectNextSpeaker(personas, conversationHistory, originalQuestion, turnCounts) {
    const result = await this.evaluate(personas, conversationHistory, originalQuestion, turnCounts);
    return result.nextSpeaker;
  }

  /**
   * Check if the conversation should terminate
   */
  async shouldTerminate(personas, conversationHistory, originalQuestion, turnCounts) {
    const result = await this.evaluate(personas, conversationHistory, originalQuestion, turnCounts);
    return {
      terminate: !result.shouldContinue,
      reason: result.reason,
      summary: result.summary
    };
  }

  /**
   * Generate a summary of the conversation
   * Used when terminating to provide the user with key insights
   */
  async generateSummary(conversationHistory, originalQuestion) {
    console.log('[Observer] Generating conversation summary...');

    const summaryPrompt = `Summarize the key insights from this multi-perspective discussion.

## Original Question
"${originalQuestion}"

## Conversation
${conversationHistory.map(entry => {
  if (entry.role === 'user') return `**User**: ${entry.content}`;
  if (entry.role === 'persona') return `**${entry.displayName}**: ${entry.content}`;
  return '';
}).join('\n\n')}

## Your Task
Provide a brief (2-3 paragraph) summary that:
1. Captures the key perspectives shared
2. Notes any areas of agreement or disagreement
3. Highlights actionable insights or conclusions

Write in a neutral voice, attributing viewpoints to the appropriate participants.`;

    try {
      const messages = [
        new SystemMessage('You are a skilled facilitator summarizing a multi-perspective discussion.'),
        new HumanMessage(summaryPrompt)
      ];

      const response = await this.model.invoke(messages);
      return response?.content || 'Summary not available';
    } catch (error) {
      console.error('[Observer] Summary generation error:', error.message);
      return 'Unable to generate summary';
    }
  }

  /**
   * Summarize the conversation for document editing
   * Combines edit suggestions from all personas
   */
  async summarizeForEdit(conversationHistory, editSuggestions, originalDocument) {
    console.log('[Observer] Summarizing for edit...');

    if (!editSuggestions || editSuggestions.length === 0) {
      return {
        hasEdits: false,
        summary: 'No specific edit suggestions were made.',
        combinedContent: null
      };
    }

    const suggestionsText = editSuggestions.map((s, i) =>
      `### Suggestion ${i + 1} from ${s.personaDisplayName}\n${s.suggestion}`
    ).join('\n\n');

    const combinePrompt = `Multiple perspectives have offered suggestions for editing this document.

## Original Document
\`\`\`markdown
${originalDocument.substring(0, 5000)}${originalDocument.length > 5000 ? '\n...(truncated)' : ''}
\`\`\`

## Edit Suggestions
${suggestionsText}

## Your Task
Combine these suggestions into a single coherent edit. If suggestions conflict, use your judgment to create the best outcome. If they complement each other, merge them appropriately.

Return your response in JSON format:
\`\`\`json
{
  "combinedEdit": "The complete updated content...",
  "summary": "Brief description of the combined changes",
  "incorporatedFrom": ["persona1", "persona2"]
}
\`\`\``;

    try {
      const messages = [
        new SystemMessage('You are an expert editor combining multiple perspectives into a unified document edit.'),
        new HumanMessage(combinePrompt)
      ];

      const response = await this.model.invoke(messages);
      const parsed = this.parseCombineResponse(response?.content || '');

      return {
        hasEdits: true,
        summary: parsed.summary || 'Combined edit suggestions from multiple perspectives',
        combinedContent: parsed.combinedEdit,
        incorporatedFrom: parsed.incorporatedFrom || []
      };
    } catch (error) {
      console.error('[Observer] Edit summarization error:', error.message);
      // Return the first suggestion as fallback
      return {
        hasEdits: true,
        summary: 'Using first suggestion (combination failed)',
        combinedContent: editSuggestions[0].suggestion,
        incorporatedFrom: [editSuggestions[0].personaName]
      };
    }
  }

  /**
   * Parse the combine response for edit suggestions
   */
  parseCombineResponse(responseText) {
    try {
      const jsonBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonBlockMatch) {
        return JSON.parse(jsonBlockMatch[1].trim());
      }
      const jsonMatch = responseText.match(/\{[\s\S]*"combinedEdit"[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log('[Observer] Failed to parse combine response:', e.message);
    }
    return { combinedEdit: null, summary: null, incorporatedFrom: [] };
  }

  /**
   * Generate a wiki article from the multi-persona conversation
   * Called when intent is 'create' - synthesizes perspectives into actual content
   * @param {Array} conversationHistory - Full conversation history
   * @param {string} originalQuestion - The user's original request
   * @param {Array} personas - The personas that participated
   * @returns {Promise<Object>} The generated article with title and content
   */
  async generateArticle(conversationHistory, originalQuestion, personas) {
    console.log('[Observer] Generating wiki article from conversation...');

    const personaContributions = conversationHistory
      .filter(entry => entry.role === 'persona')
      .map(entry => `**${entry.displayName}**:\n${entry.content}`)
      .join('\n\n---\n\n');

    const personaNames = personas.map(p => p.displayName).join(', ');

    // Use plain markdown output (not JSON) to avoid truncation issues with long articles
    const articlePrompt = `You are a skilled writer tasked with creating a wiki article based on a multi-perspective discussion.

## Original Request
"${originalQuestion}"

## Discussion Participants
${personaNames}

## Their Contributions
${personaContributions}

## Your Task
Based on the perspectives shared above, write a complete, well-structured wiki article.

**Output format:**
- First line: The article title (just the title text, no # or formatting)
- Second line: Empty
- Rest: The full article content in markdown format

The article should:
1. Open with an introduction/overview section
2. Organize the key insights from each perspective into logical sections
3. Use proper markdown formatting (## headers, lists, emphasis where appropriate)
4. Synthesize the different viewpoints into cohesive content
5. Attribute notable perspectives to specific participants where valuable
6. Include a conclusion or summary section

Write the COMPLETE article. Do not truncate or abbreviate.`;

    try {
      const messages = [
        new SystemMessage('You are an expert wiki author who synthesizes multiple perspectives into comprehensive, well-organized articles. Output the article directly in markdown format.'),
        new HumanMessage(articlePrompt)
      ];

      const response = await this.model.invoke(messages);
      const parsed = this.parseArticleResponse(response?.content || '');

      if (parsed.content) {
        console.log('[Observer] Generated article:', parsed.title);
        return {
          success: true,
          title: parsed.title || 'Untitled Article',
          content: parsed.content,
          summary: parsed.summary || 'Article generated from multi-persona discussion'
        };
      } else {
        console.error('[Observer] Failed to parse article response');
        return {
          success: false,
          error: 'Could not generate article from conversation'
        };
      }
    } catch (error) {
      console.error('[Observer] Article generation error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Parse the article generation response
   * Expects: Title on first line, blank line, then markdown content
   */
  parseArticleResponse(responseText) {
    if (!responseText || !responseText.trim()) {
      return { title: null, content: null, summary: null };
    }

    const text = responseText.trim();

    // Try to extract title from first line and content from rest
    const lines = text.split('\n');
    let title = lines[0].trim();
    let contentStartIdx = 1;

    // Skip blank lines after title
    while (contentStartIdx < lines.length && !lines[contentStartIdx].trim()) {
      contentStartIdx++;
    }

    // Clean up title (remove any markdown heading prefix if present)
    title = title.replace(/^#+\s*/, '').trim();

    // If title looks like it's part of the content (starts with common markdown)
    // then use the whole thing as content with a default title
    if (title.startsWith('##') || title.startsWith('**') || title.startsWith('- ') || title.startsWith('1.')) {
      console.log('[Observer] No clear title found, using full response as content');
      return {
        title: 'Generated Article',
        content: text,
        summary: 'Article generated from multi-persona discussion'
      };
    }

    const content = lines.slice(contentStartIdx).join('\n').trim();

    // If no content after title, the whole thing might be content
    if (!content) {
      return {
        title: 'Generated Article',
        content: text,
        summary: 'Article generated from multi-persona discussion'
      };
    }

    // Generate a brief summary from the first paragraph
    const firstParagraph = content.split('\n\n')[0] || '';
    const summary = firstParagraph.substring(0, 200).replace(/[#*`]/g, '').trim() +
      (firstParagraph.length > 200 ? '...' : '');

    return {
      title: title || 'Generated Article',
      content: content,
      summary: summary || 'Article generated from multi-persona discussion'
    };
  }
}

module.exports = { ConversationObserver, CHAT_MODES };
