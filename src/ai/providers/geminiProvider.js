/**
 * Google Gemini Provider
 *
 * Creates LangChain-compatible Gemini model instance
 */

const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');

/**
 * Create a Gemini model instance
 * @param {Object} config - Provider configuration
 * @param {string} config.apiKey - Google Gemini API key
 * @param {string} config.model - Model name (e.g., 'gemini-2.0-flash')
 * @returns {ChatGoogleGenerativeAI} LangChain model instance
 */
function createModel(config) {
  console.log('[Gemini Provider] Creating model with config:', {
    model: config.model,
    apiKeyLength: config.apiKey ? config.apiKey.length : 'undefined',
    apiKeyStart: config.apiKey ? config.apiKey.substring(0, 10) + '...' : 'undefined'
  });

  if (!config.apiKey) {
    throw new Error('Gemini API key not configured. Add GEMINI_API_KEY to your .env file.');
  }

  if (!config.model) {
    throw new Error('Gemini model not specified.');
  }

  const modelConfig = {
    model: config.model,  // Try 'model' instead of 'modelName'
    apiKey: config.apiKey,
    temperature: 0.7,
    maxOutputTokens: config.maxOutputTokens || 65536,
    topK: 40,
    topP: 0.95
  };

  console.log('[Gemini Provider] Model config keys:', Object.keys(modelConfig));

  return new ChatGoogleGenerativeAI(modelConfig);
}

/**
 * Get provider info
 */
function getProviderInfo() {
  return {
    id: 'gemini',
    name: 'Google Gemini',
    maxTokens: 65536,
    contextWindow: 1000000 // Gemini 2.0 supports 1M tokens
  };
}

module.exports = {
  createModel,
  getProviderInfo
};
