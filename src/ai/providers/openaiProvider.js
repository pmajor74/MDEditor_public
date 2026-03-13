/**
 * OpenAI Provider
 *
 * Creates LangChain-compatible OpenAI model instance
 */

const { ChatOpenAI } = require('@langchain/openai');

/**
 * Check if a model is an o-series reasoning model (o1, o3, etc.)
 * These models require max_completion_tokens instead of max_tokens
 * and do not support the temperature parameter.
 */
function isReasoningModel(modelName) {
  if (!modelName) return false;
  return /^o[1-9]/i.test(modelName);
}

/**
 * Create an OpenAI model instance
 * @param {Object} config - Provider configuration
 * @param {string} config.apiKey - OpenAI API key
 * @param {string} config.model - Model name (e.g., 'gpt-4o')
 * @returns {ChatOpenAI} LangChain model instance
 */
function createModel(config) {
  if (!config.apiKey) {
    throw new Error('OpenAI API key not configured. Add OPENAI_API_KEY to your .env file.');
  }

  const reasoning = isReasoningModel(config.model);

  const modelConfig = {
    modelName: config.model,
    openAIApiKey: config.apiKey,
    // Use max_completion_tokens for all models — newer API versions
    // reject the legacy max_tokens parameter
    modelKwargs: { max_completion_tokens: config.maxOutputTokens || 16384 },
  };

  if (!reasoning) {
    // o-series reasoning models don't support the temperature parameter
    modelConfig.temperature = 0.7;
  }

  return new ChatOpenAI(modelConfig);
}

/**
 * Get provider info
 */
function getProviderInfo() {
  return {
    id: 'openai',
    name: 'OpenAI',
    maxTokens: 16384,
    contextWindow: 128000 // GPT-4o context window
  };
}

module.exports = {
  createModel,
  getProviderInfo
};
