/**
 * Unified LLM Client
 *
 * Provides a unified interface for interacting with multiple LLM providers
 * using LangChain.js. Supports Gemini, OpenAI, Azure OpenAI, and Anthropic.
 */

const { HumanMessage, SystemMessage, AIMessage } = require('@langchain/core/messages');
const providerFactory = require('./providers');
const configManager = require('./llmConfigManager');
const { buildSystemPrompt, buildContextualPrompt } = require('./prompts/systemPrompt');

// Chat history for multi-turn conversations (session-only)
let chatHistory = [];

// Cached model instance
let cachedModel = null;
let cachedProvider = null;

/**
 * Get or create the LLM model instance
 */
function getModel() {
  const config = configManager.getActiveConfig();

  // Recreate model if provider changed
  if (cachedModel && cachedProvider === config.provider) {
    return cachedModel;
  }

  cachedModel = providerFactory.createModel(config.provider, config);
  cachedProvider = config.provider;

  console.log(`[LLM Client] Created ${config.provider} model: ${config.model}`);

  return cachedModel;
}

/**
 * Parse the LLM response to extract article and summary
 * Improved parsing with multiple fallback strategies
 */
function parseResponse(responseText) {
  // Strategy 1: Try to find JSON in markdown code block (```json ... ```)
  const jsonBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (parsed.updatedArticle !== undefined) {
        console.log('[LLM Client] Successfully parsed JSON from code block');
        return {
          updatedArticle: parsed.updatedArticle || '',
          changeSummary: parsed.changeSummary || 'Changes applied'
        };
      }
    } catch (e) {
      console.log('[LLM Client] Failed to parse JSON from code block:', e.message);
    }
  }

  // Strategy 2: Try to find raw JSON object with updatedArticle field
  const jsonMatch = responseText.match(/\{[\s\S]*"updatedArticle"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('[LLM Client] Successfully parsed raw JSON object');
      return {
        updatedArticle: parsed.updatedArticle || '',
        changeSummary: parsed.changeSummary || 'Changes applied'
      };
    } catch (e) {
      console.log('[LLM Client] Failed to parse raw JSON:', e.message);
    }
  }

  // Strategy 3: Try to parse entire response as JSON
  try {
    const parsed = JSON.parse(responseText.trim());
    if (parsed.updatedArticle !== undefined) {
      console.log('[LLM Client] Successfully parsed entire response as JSON');
      return {
        updatedArticle: parsed.updatedArticle,
        changeSummary: parsed.changeSummary || 'Changes applied'
      };
    }
  } catch {
    // Not valid JSON
  }

  // Fallback: No valid JSON found - return as summary only (no article changes)
  console.log('[LLM Client] No valid JSON found, returning response as summary');
  return {
    updatedArticle: null,
    changeSummary: responseText.substring(0, 500)
  };
}

/**
 * Estimate token count for a string (rough approximation)
 * ~4 characters per token for English text
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Send a message to the LLM and get a response
 * @param {string} userMessage - The user's message/request
 * @param {string} articleContent - Current article content
 * @returns {Promise<Object>} Response with updatedArticle and changeSummary
 */
async function sendMessage(userMessage, articleContent) {
  const model = getModel();
  const config = configManager.getActiveConfig();
  const providerInfo = providerFactory.getProviderInfo(config.provider);

  // Build system prompt with contextual additions based on user request
  const systemPrompt = buildContextualPrompt(userMessage);

  // Build messages array for LangChain
  const messages = [
    new SystemMessage(systemPrompt)
  ];

  // Add chat history for context (limited)
  const recentHistory = chatHistory.slice(-10);
  for (const msg of recentHistory) {
    if (msg.role === 'user') {
      messages.push(new HumanMessage(msg.content));
    } else {
      messages.push(new AIMessage(msg.content));
    }
  }

  // Build current request with article content
  const userRequest = articleContent
    ? `Here is the current article content:\n\n---\n${articleContent}\n---\n\nUser request: ${userMessage}`
    : userMessage;

  messages.push(new HumanMessage(userRequest));

  // Check token count and decide on strategy
  const totalTokens = estimateTokens(userRequest) + estimateTokens(systemPrompt);
  const contextLimit = providerInfo?.contextWindow || 100000;

  if (totalTokens > contextLimit * 0.8) {
    console.warn(`[LLM Client] Request approaching context limit (${totalTokens} estimated tokens)`);
    // In future, this would trigger chunking agent instead
  }

  console.log(`[LLM Client] Sending request to ${config.provider} (${config.model})`);
  console.log(`[LLM Client] Estimated tokens: ${totalTokens}`);

  try {
    // Invoke the model
    const response = await model.invoke(messages);

    // Extract text from response
    const responseText = response.content || '';

    if (!responseText) {
      throw new Error('Empty response from LLM');
    }

    // Check for truncation (if response has metadata indicating truncation)
    if (response.response_metadata?.finish_reason === 'length' ||
        response.response_metadata?.stop_reason === 'max_tokens') {
      console.warn('[LLM Client] Response was truncated due to token limit');
      return {
        updatedArticle: null,
        changeSummary: 'Error: Response was truncated. The document may be too large. Try making smaller, focused changes.',
        error: true
      };
    }

    // Parse response
    const result = parseResponse(responseText);

    // Add to chat history
    chatHistory.push({
      role: 'user',
      content: userMessage
    });

    chatHistory.push({
      role: 'assistant',
      content: result.changeSummary
    });

    // Limit history length to prevent token overflow
    if (chatHistory.length > 20) {
      chatHistory = chatHistory.slice(-20);
    }

    return result;

  } catch (error) {
    console.error('[LLM Client] API error:', error.message);
    throw error;
  }
}

/**
 * Clear chat history
 */
function clearHistory() {
  chatHistory = [];
  console.log('[LLM Client] Chat history cleared');
}

/**
 * Get current chat history (for debugging)
 */
function getHistory() {
  return [...chatHistory];
}

/**
 * Invalidate cached model (call when provider config changes)
 */
function invalidateCache() {
  cachedModel = null;
  cachedProvider = null;
  console.log('[LLM Client] Model cache invalidated');
}

/**
 * Get current provider info
 */
function getCurrentProviderInfo() {
  const config = configManager.getActiveConfig();
  return {
    provider: config.provider,
    model: config.model,
    info: providerFactory.getProviderInfo(config.provider)
  };
}

/**
 * Stream a message to the LLM and yield response chunks
 * @param {Array} messages - Array of message objects with role and content
 * @yields {string} Response text chunks
 */
async function* streamMessage(messages) {
  const model = getModel();
  const config = configManager.getActiveConfig();

  console.log(`[LLM Client] Starting streaming request to ${config.provider}`);

  try {
    // Convert simple message format to LangChain messages
    const langchainMessages = messages.map(msg => {
      if (msg.role === 'system') {
        return new SystemMessage(msg.content);
      } else if (msg.role === 'user') {
        return new HumanMessage(msg.content);
      } else {
        return new AIMessage(msg.content);
      }
    });

    // Check if model supports streaming
    if (typeof model.stream === 'function') {
      const stream = await model.stream(langchainMessages);

      for await (const chunk of stream) {
        const content = chunk.content || '';
        if (content) {
          yield content;
        }
      }
    } else {
      // Fallback: invoke and return entire response
      console.log('[LLM Client] Model does not support streaming, using invoke');
      const response = await model.invoke(langchainMessages);
      yield response.content || '';
    }

  } catch (error) {
    console.error('[LLM Client] Streaming error:', error.message);
    throw error;
  }
}

/**
 * Send a simple message without article context
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string>} Response text
 */
async function sendSimpleMessage(prompt) {
  const model = getModel();
  const config = configManager.getActiveConfig();

  console.log(`[LLM Client] Sending simple message to ${config.provider}`);

  const messages = [new HumanMessage(prompt)];

  try {
    const response = await model.invoke(messages);
    return response.content || '';
  } catch (error) {
    console.error('[LLM Client] Simple message error:', error.message);
    throw error;
  }
}

module.exports = {
  sendMessage,
  streamMessage,
  sendSimpleMessage,
  clearHistory,
  getHistory,
  invalidateCache,
  getCurrentProviderInfo,
  estimateTokens
};
