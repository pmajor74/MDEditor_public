/**
 * Anthropic Claude Provider
 *
 * Creates LangChain-compatible Anthropic model instance
 */

const { ChatAnthropic } = require('@langchain/anthropic');

/**
 * Create an Anthropic model instance
 * @param {Object} config - Provider configuration
 * @param {string} config.apiKey - Anthropic API key
 * @param {string} config.model - Model name (e.g., 'claude-sonnet-4-20250514')
 * @returns {ChatAnthropic} LangChain model instance
 */
function createModel(config) {
  if (!config.apiKey) {
    throw new Error('Anthropic API key not configured. Add ANTHROPIC_API_KEY to your .env file.');
  }

  return new ChatAnthropic({
    modelName: config.model,
    anthropicApiKey: config.apiKey,
    temperature: 0.7,
    maxTokens: config.maxOutputTokens || 8192
  });
}

/**
 * Get provider info
 */
function getProviderInfo() {
  return {
    id: 'anthropic',
    name: 'Anthropic Claude',
    maxTokens: 8192,
    contextWindow: 200000 // Claude 3 context window
  };
}

module.exports = {
  createModel,
  getProviderInfo
};
