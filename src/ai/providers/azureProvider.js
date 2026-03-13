/**
 * Azure OpenAI Provider
 *
 * Creates LangChain-compatible Azure OpenAI model instance
 */

const { AzureChatOpenAI } = require('@langchain/openai');

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
 * Create an Azure OpenAI model instance
 * @param {Object} config - Provider configuration
 * @param {string} config.apiKey - Azure OpenAI API key
 * @param {string} config.endpoint - Azure OpenAI endpoint URL
 * @param {string} config.deploymentName - Azure deployment name
 * @param {string} config.apiVersion - API version (optional)
 * @param {string} config.model - Model name for parameter compatibility detection
 * @returns {AzureChatOpenAI} LangChain model instance
 */
function createModel(config) {
  if (!config.apiKey) {
    throw new Error('Azure OpenAI API key not configured. Add AZURE_OPENAI_API_KEY to your .env file.');
  }

  if (!config.endpoint) {
    throw new Error('Azure OpenAI endpoint not configured. Add AZURE_OPENAI_ENDPOINT to your .env file.');
  }

  if (!config.deploymentName) {
    throw new Error('Azure OpenAI deployment not configured. Add AZURE_OPENAI_DEPLOYMENT to your .env file.');
  }

  const reasoning = isReasoningModel(config.model) || isReasoningModel(config.deploymentName);

  const modelConfig = {
    azureOpenAIApiKey: config.apiKey,
    azureOpenAIApiInstanceName: extractInstanceName(config.endpoint),
    azureOpenAIApiDeploymentName: config.deploymentName,
    azureOpenAIApiVersion: config.apiVersion || '2024-02-15-preview',
    // Use max_completion_tokens for all models — newer Azure API versions
    // reject the legacy max_tokens parameter
    modelKwargs: { max_completion_tokens: config.maxOutputTokens || 16384 },
  };

  if (!reasoning) {
    // o-series reasoning models don't support the temperature parameter
    modelConfig.temperature = 0.7;
  }

  return new AzureChatOpenAI(modelConfig);
}

/**
 * Extract instance name from Azure endpoint URL
 * E.g., 'https://my-resource.openai.azure.com' -> 'my-resource'
 */
function extractInstanceName(endpoint) {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname;
    const parts = hostname.split('.');
    return parts[0];
  } catch (e) {
    console.warn('[Azure Provider] Failed to parse endpoint, using as-is:', endpoint);
    return endpoint;
  }
}

/**
 * Get provider info
 */
function getProviderInfo() {
  return {
    id: 'azure',
    name: 'Azure OpenAI',
    maxTokens: 16384,
    contextWindow: 128000 // Depends on deployed model
  };
}

module.exports = {
  createModel,
  getProviderInfo
};
