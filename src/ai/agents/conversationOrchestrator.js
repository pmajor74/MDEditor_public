/**
 * Conversation Orchestrator
 *
 * Manages multi-persona conversations:
 * - Turn-taking between personas
 * - Rate limiting between API calls
 * - User interjection handling
 * - Edit suggestion collection
 * - Conversation lifecycle
 */

const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const providerFactory = require('../providers');
const configManager = require('../llmConfigManager');
const { ConversationObserver, CHAT_MODES } = require('./conversationObserver');
const {
  buildMultiPersonaPrompt,
  formatConversationHistory
} = require('../prompts/multiPersonaPrompt');

/**
 * Default configuration for orchestrator
 */
const DEFAULT_CONFIG = {
  maxTurnsPerPersona: 3,
  maxTotalTurns: 15,
  minTurnDelay: 1000,  // ms between API calls
  maxPersonas: 6,
  chatMode: 'roundRobin'  // roundRobin, relevance, debate, panel
};

/**
 * ConversationOrchestrator class
 * Manages the flow of multi-persona conversations
 */
class ConversationOrchestrator {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.personas = [];
    this.conversationHistory = [];
    this.turnCounts = {};
    this.editSuggestions = [];
    this.originalQuestion = '';
    this.documentContext = '';
    this.mode = 'qa';  // 'qa', 'edit', or 'create'
    this.isRunning = false;
    this.isPaused = false;
    this.userInterjectionQueue = [];
    this.observer = null;
    this.model = null;
    this.lastTurnTime = 0;
    this.conversationId = null;
  }

  /**
   * Initialize the orchestrator with personas
   * @param {Array} personaNames - Names of personas to include
   * @returns {Promise<Object>} Initialization result
   */
  async initialize(personaNames) {
    console.log('[Orchestrator] Initializing with personas:', personaNames);

    if (!personaNames || personaNames.length < 2) {
      throw new Error('Multi-persona conversation requires at least 2 personas');
    }

    if (personaNames.length > this.config.maxPersonas) {
      throw new Error(`Maximum ${this.config.maxPersonas} personas allowed`);
    }

    // Get persona manager
    const personaManager = require('../persona/personaManager');

    // Load each persona
    this.personas = [];
    for (const name of personaNames) {
      const persona = personaManager.getPersona(name);
      if (!persona) {
        throw new Error(`Persona "${name}" not found`);
      }
      if (!persona.systemPromptTemplate) {
        throw new Error(`Persona "${name}" has no style profile. Please analyze their writings first.`);
      }
      this.personas.push(persona);
      this.turnCounts[name] = 0;
    }

    // Initialize the model
    const config = configManager.getActiveConfig();
    this.model = providerFactory.createModel(config.provider, config);

    // Initialize observer
    this.observer = new ConversationObserver({
      maxTotalTurns: this.config.maxTotalTurns,
      maxTurnsPerPersona: this.config.maxTurnsPerPersona,
      chatMode: this.config.chatMode
    });
    await this.observer.initialize();

    // Generate unique conversation ID
    this.conversationId = `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log('[Orchestrator] Initialized successfully. Conversation ID:', this.conversationId);

    return {
      success: true,
      conversationId: this.conversationId,
      personas: this.personas.map(p => ({
        name: p.name,
        displayName: p.displayName,
        description: p.description
      }))
    };
  }

  /**
   * Start a new conversation
   * @param {string} userMessage - The user's initial message
   * @param {string} documentContext - Current document content (for edit mode)
   * @param {string} mode - 'qa' or 'edit'
   * @returns {Object} Conversation start info
   */
  startConversation(userMessage, documentContext = '', mode = 'qa') {
    console.log('[Orchestrator] Starting conversation in', mode, 'mode');

    this.originalQuestion = userMessage;
    this.documentContext = documentContext;
    this.mode = mode;
    this.conversationHistory = [];
    this.editSuggestions = [];
    this.isRunning = true;
    this.isPaused = false;

    // Reset turn counts
    for (const persona of this.personas) {
      this.turnCounts[persona.name] = 0;
    }

    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage
    });

    return {
      conversationId: this.conversationId,
      mode: this.mode,
      personaCount: this.personas.length
    };
  }

  /**
   * Run the conversation loop as an async generator
   * Yields each persona's response as it's generated
   * @yields {Object} Persona response or control message
   */
  async *runConversationLoop() {
    console.log('[Orchestrator] Starting conversation loop');

    while (this.isRunning) {
      // Check for user interjections
      if (this.userInterjectionQueue.length > 0) {
        const interjection = this.userInterjectionQueue.shift();
        this.conversationHistory.push({
          role: 'user',
          content: interjection
        });
        yield {
          type: 'user_interjection',
          content: interjection
        };
      }

      // Wait if paused
      while (this.isPaused && this.isRunning) {
        await this.delay(100);
      }

      if (!this.isRunning) break;

      // Evaluate conversation and get next speaker
      const evaluation = await this.observer.evaluate(
        this.personas,
        this.conversationHistory,
        this.originalQuestion,
        this.turnCounts
      );

      if (!evaluation.shouldContinue) {
        console.log('[Orchestrator] Observer decided to terminate:', evaluation.reason);

        // If mode is 'create', generate the article before terminating
        if (this.mode === 'create') {
          console.log('[Orchestrator] Create mode - generating article from conversation');
          const articleResult = await this.observer.generateArticle(
            this.conversationHistory,
            this.originalQuestion,
            this.personas
          );

          if (articleResult.success) {
            yield {
              type: 'article_complete',
              title: articleResult.title,
              content: articleResult.content,
              summary: articleResult.summary,
              reason: evaluation.reason
            };
          } else {
            yield {
              type: 'termination',
              reason: evaluation.reason,
              summary: evaluation.summary,
              articleError: articleResult.error
            };
          }
        } else {
          yield {
            type: 'termination',
            reason: evaluation.reason,
            summary: evaluation.summary
          };
        }
        this.isRunning = false;
        break;
      }

      // Get next speaker
      const nextSpeakerName = evaluation.nextSpeaker;
      const nextPersona = this.personas.find(p => p.name === nextSpeakerName);

      if (!nextPersona) {
        console.error('[Orchestrator] Could not find next speaker:', nextSpeakerName);
        yield {
          type: 'error',
          message: 'Could not determine next speaker'
        };
        this.isRunning = false;
        break;
      }

      // Rate limiting
      await this.enforceRateLimit();

      // Generate persona response
      yield {
        type: 'speaking',
        personaName: nextPersona.name,
        displayName: nextPersona.displayName
      };

      try {
        const response = await this.generatePersonaResponse(nextPersona);

        // Update turn count
        this.turnCounts[nextPersona.name]++;
        const totalTurns = Object.values(this.turnCounts).reduce((a, b) => a + b, 0);

        // Add to history
        this.conversationHistory.push({
          role: 'persona',
          personaName: nextPersona.name,
          displayName: nextPersona.displayName,
          content: response.content
        });

        // Collect edit suggestions if in edit mode
        if (this.mode === 'edit' && response.suggestion) {
          this.editSuggestions.push({
            personaName: nextPersona.name,
            personaDisplayName: nextPersona.displayName,
            suggestion: response.suggestion
          });
        }

        yield {
          type: 'persona_response',
          personaName: nextPersona.name,
          displayName: nextPersona.displayName,
          content: response.content,
          hasSuggestion: !!response.suggestion,
          turn: this.turnCounts[nextPersona.name],
          totalTurns
        };

      } catch (error) {
        console.error('[Orchestrator] Error generating response:', error.message);
        yield {
          type: 'error',
          personaName: nextPersona.name,
          message: error.message
        };
      }
    }

    // Finalize if in edit mode
    if (this.mode === 'edit' && this.editSuggestions.length > 0) {
      const editResult = await this.finalizeEdits();
      yield {
        type: 'edit_complete',
        ...editResult
      };
    }
  }

  /**
   * Generate a response from a specific persona
   * @param {Object} persona - The persona to generate from
   * @returns {Promise<Object>} The response with content and optional suggestion
   */
  async generatePersonaResponse(persona) {
    console.log('[Orchestrator] Generating response from:', persona.displayName);

    // Build the system prompt for this persona
    const systemPrompt = buildMultiPersonaPrompt(
      persona,
      this.personas,
      this.originalQuestion,
      this.mode
    );

    // Build conversation context
    const historyMessages = formatConversationHistory(
      this.conversationHistory,
      persona.name
    );

    // Build the current context message
    let contextMessage = '';
    if (this.documentContext && this.mode === 'edit') {
      contextMessage = `## Document Being Edited\n\n\`\`\`markdown\n${this.documentContext.substring(0, 3000)}${this.documentContext.length > 3000 ? '\n...(truncated)' : ''}\n\`\`\`\n\n`;
    }
    contextMessage += 'Please share your perspective on this discussion.';

    const messages = [
      new SystemMessage(systemPrompt),
      ...historyMessages,
      new HumanMessage(contextMessage)
    ];

    const response = await this.model.invoke(messages);
    const content = response?.content || '';

    // Extract suggestion if in edit mode
    let suggestion = null;
    if (this.mode === 'edit') {
      const suggestionMatch = content.match(/```suggestion\s*([\s\S]*?)```/);
      if (suggestionMatch) {
        suggestion = suggestionMatch[1].trim();
      }
    }

    this.lastTurnTime = Date.now();

    return {
      content,
      suggestion
    };
  }

  /**
   * Handle a user interjection during the conversation
   * @param {string} message - The user's message
   */
  handleUserInterjection(message) {
    console.log('[Orchestrator] User interjection received');
    this.userInterjectionQueue.push(message);
  }

  /**
   * Collect all edit suggestions made during the conversation
   * @returns {Array} Array of edit suggestions
   */
  collectEditSuggestions() {
    return [...this.editSuggestions];
  }

  /**
   * Finalize edits by combining all suggestions
   * @returns {Promise<Object>} Combined edit result
   */
  async finalizeEdits() {
    console.log('[Orchestrator] Finalizing edits...');

    if (this.editSuggestions.length === 0) {
      return {
        hasEdits: false,
        summary: 'No edit suggestions were made during the conversation.'
      };
    }

    return await this.observer.summarizeForEdit(
      this.conversationHistory,
      this.editSuggestions,
      this.documentContext
    );
  }

  /**
   * Stop the conversation
   * @returns {Promise<Object>} Final summary or article
   */
  async stop() {
    console.log('[Orchestrator] Stopping conversation');
    this.isRunning = false;

    // If mode is 'create', generate the article
    if (this.mode === 'create' && this.conversationHistory.length > 1) {
      console.log('[Orchestrator] Create mode - generating article on stop');
      const articleResult = await this.observer.generateArticle(
        this.conversationHistory,
        this.originalQuestion,
        this.personas
      );

      if (articleResult.success) {
        return {
          conversationId: this.conversationId,
          articleGenerated: true,
          title: articleResult.title,
          content: articleResult.content,
          summary: articleResult.summary,
          turnCounts: { ...this.turnCounts },
          totalMessages: this.conversationHistory.length
        };
      }
    }

    // Generate final summary (default behavior)
    const summary = await this.observer.generateSummary(
      this.conversationHistory,
      this.originalQuestion
    );

    return {
      conversationId: this.conversationId,
      summary,
      turnCounts: { ...this.turnCounts },
      totalMessages: this.conversationHistory.length
    };
  }

  /**
   * Pause the conversation
   */
  pause() {
    console.log('[Orchestrator] Pausing conversation');
    this.isPaused = true;
  }

  /**
   * Resume the conversation
   */
  resume() {
    console.log('[Orchestrator] Resuming conversation');
    this.isPaused = false;
  }

  /**
   * Get conversation state
   */
  getState() {
    return {
      conversationId: this.conversationId,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      mode: this.mode,
      personas: this.personas.map(p => ({
        name: p.name,
        displayName: p.displayName,
        turns: this.turnCounts[p.name] || 0,
        maxTurns: this.config.maxTurnsPerPersona
      })),
      totalTurns: Object.values(this.turnCounts).reduce((a, b) => a + b, 0),
      maxTotalTurns: this.config.maxTotalTurns,
      historyLength: this.conversationHistory.length,
      editSuggestionCount: this.editSuggestions.length
    };
  }

  /**
   * Enforce rate limiting between API calls
   */
  async enforceRateLimit() {
    const elapsed = Date.now() - this.lastTurnTime;
    if (elapsed < this.config.minTurnDelay) {
      const waitTime = this.config.minTurnDelay - elapsed;
      console.log('[Orchestrator] Rate limiting, waiting', waitTime, 'ms');
      await this.delay(waitTime);
    }
  }

  /**
   * Helper: delay for specified milliseconds
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Store active orchestrators by conversation ID
const activeOrchestrators = new Map();

/**
 * Get or create an orchestrator for a conversation
 */
function getOrchestrator(conversationId) {
  return activeOrchestrators.get(conversationId);
}

/**
 * Create a new orchestrator
 */
async function createOrchestrator(personaNames, options = {}) {
  const orchestrator = new ConversationOrchestrator(options);
  await orchestrator.initialize(personaNames);
  activeOrchestrators.set(orchestrator.conversationId, orchestrator);
  return orchestrator;
}

/**
 * Remove an orchestrator
 */
function removeOrchestrator(conversationId) {
  activeOrchestrators.delete(conversationId);
}

module.exports = {
  ConversationOrchestrator,
  getOrchestrator,
  createOrchestrator,
  removeOrchestrator,
  CHAT_MODES
};
