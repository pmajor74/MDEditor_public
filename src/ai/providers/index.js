/**
 * Provider Factory
 *
 * Creates LangChain model instances for the configured provider
 */

// Lazy-loaded providers — only the configured provider's SDK loads
const providers = {
  get gemini() { delete this.gemini; return (this.gemini = require('./geminiProvider')); },
  get openai() { delete this.openai; return (this.openai = require('./openaiProvider')); },
  get azure() { delete this.azure; return (this.azure = require('./azureProvider')); },
  get anthropic() { delete this.anthropic; return (this.anthropic = require('./anthropicProvider')); }
};

/**
 * Create a model instance for the specified provider
 * @param {string} providerId - Provider ID ('gemini', 'openai', 'azure', 'anthropic')
 * @param {Object} config - Provider-specific configuration
 * @returns {Object} LangChain model instance
 */
function createModel(providerId, config) {
  const provider = providers[providerId];

  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}. Supported: ${Object.keys(providers).join(', ')}`);
  }

  console.log(`[Provider Factory] Creating ${providerId} model with model: ${config.model}`);

  return provider.createModel(config);
}

/**
 * Get provider info
 * @param {string} providerId - Provider ID
 * @returns {Object} Provider info (maxTokens, contextWindow, etc.)
 */
function getProviderInfo(providerId) {
  const provider = providers[providerId];

  if (!provider) {
    return null;
  }

  return provider.getProviderInfo();
}

/**
 * Get all available provider IDs
 */
function getAvailableProviderIds() {
  return Object.keys(providers);
}

module.exports = {
  createModel,
  getProviderInfo,
  getAvailableProviderIds
};
