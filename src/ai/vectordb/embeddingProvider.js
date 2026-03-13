/**
 * Embedding Provider
 *
 * Creates embedding model instances based on the active LLM provider.
 * Reuses API keys from the main LLM configuration.
 *
 * Supported providers:
 * - Gemini: text-embedding-004
 * - OpenAI: text-embedding-3-small
 * - Azure: configured deployment
 * - Anthropic: Falls back to Gemini or OpenAI (no native embeddings)
 */

const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
const { OpenAIEmbeddings, AzureOpenAIEmbeddings } = require('@langchain/openai');
const configManager = require('../llmConfigManager');

// Default embedding models per provider
const EMBEDDING_MODELS = {
  gemini: 'text-embedding-004',
  openai: 'text-embedding-3-small',
  azure: 'text-embedding-3-large' // Most common Azure embedding deployment
};

// Embedding dimensions per model (for LanceDB schema)
const EMBEDDING_DIMENSIONS = {
  'text-embedding-004': 768,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536
};

// Cached embedding model
let cachedEmbeddings = null;
let cachedProvider = null;

/**
 * Get or create the embedding model instance
 * @returns {Object} LangChain embedding model
 */
function getEmbeddings() {
  const config = configManager.getActiveConfig();
  const fullConfig = configManager.loadConfig();

  // Reuse cached model if provider hasn't changed
  if (cachedEmbeddings && cachedProvider === config.provider) {
    return cachedEmbeddings;
  }

  let embeddings;
  let provider = config.provider;

  switch (provider) {
    case 'gemini':
      if (!config.apiKey) {
        throw new Error('Gemini API key not configured for embeddings');
      }
      embeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: config.apiKey,
        model: EMBEDDING_MODELS.gemini
      });
      console.log(`[Embedding Provider] Created Gemini embeddings (${EMBEDDING_MODELS.gemini})`);
      break;

    case 'openai':
      if (!config.apiKey) {
        throw new Error('OpenAI API key not configured for embeddings');
      }
      embeddings = new OpenAIEmbeddings({
        openAIApiKey: config.apiKey,
        modelName: EMBEDDING_MODELS.openai
      });
      console.log(`[Embedding Provider] Created OpenAI embeddings (${EMBEDDING_MODELS.openai})`);
      break;

    case 'azure':
      if (!config.apiKey || !config.endpoint) {
        throw new Error('Azure OpenAI not configured for embeddings');
      }

      // Get embedding deployment from config (env vars populated by configService)
      const embeddingDeployment = config.embeddingDeployment ||
                                   process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;

      if (!embeddingDeployment) {
        throw new Error(
          'Azure OpenAI embedding deployment not configured. ' +
          'Set the embedding deployment in Settings > AI / LLM Provider > Azure OpenAI.'
        );
      }

      // Build the base path from endpoint
      // Endpoint: https://xxx.services.ai.azure.com/ or https://xxx.openai.azure.com/
      // Base path: https://xxx.../openai/deployments
      const basePath = config.endpoint.replace(/\/$/, '') + '/openai/deployments';

      console.log(`[Embedding Provider] Azure endpoint: ${config.endpoint}`);
      console.log(`[Embedding Provider] Azure base path: ${basePath}`);
      console.log(`[Embedding Provider] Azure deployment: ${embeddingDeployment}`);

      // Use AzureOpenAIEmbeddings with azureOpenAIBasePath
      // This works with both .openai.azure.com and .services.ai.azure.com endpoints
      embeddings = new AzureOpenAIEmbeddings({
        azureOpenAIApiKey: config.apiKey,
        azureOpenAIBasePath: basePath,
        azureOpenAIApiDeploymentName: embeddingDeployment,
        azureOpenAIApiVersion: config.apiVersion || '2024-02-15-preview'
      });
      console.log(`[Embedding Provider] Created Azure OpenAI embeddings (deployment: ${embeddingDeployment})`);
      break;

    case 'anthropic':
      // Anthropic doesn't have embeddings - fall back to Gemini or OpenAI
      if (fullConfig.gemini.apiKey) {
        embeddings = new GoogleGenerativeAIEmbeddings({
          apiKey: fullConfig.gemini.apiKey,
          model: EMBEDDING_MODELS.gemini
        });
        provider = 'gemini';
        console.log(`[Embedding Provider] Anthropic fallback: using Gemini embeddings`);
      } else if (fullConfig.openai.apiKey) {
        embeddings = new OpenAIEmbeddings({
          openAIApiKey: fullConfig.openai.apiKey,
          modelName: EMBEDDING_MODELS.openai
        });
        provider = 'openai';
        console.log(`[Embedding Provider] Anthropic fallback: using OpenAI embeddings`);
      } else {
        throw new Error('No embedding provider available. Configure Gemini or OpenAI API key.');
      }
      break;

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  cachedEmbeddings = embeddings;
  cachedProvider = provider;

  return embeddings;
}

/**
 * Get embedding dimensions for the current provider
 * @returns {number} Embedding vector dimensions
 */
function getEmbeddingDimensions() {
  const config = configManager.getActiveConfig();
  const fullConfig = configManager.loadConfig();
  let provider = config.provider;

  // Handle Anthropic fallback
  if (provider === 'anthropic') {
    if (fullConfig.gemini.apiKey) {
      provider = 'gemini';
    } else if (fullConfig.openai.apiKey) {
      provider = 'openai';
    }
  }

  const model = EMBEDDING_MODELS[provider] || EMBEDDING_MODELS.openai;
  return EMBEDDING_DIMENSIONS[model] || 1536;
}

/**
 * Generate embeddings for a single text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} Embedding vector
 */
async function embedText(text) {
  const embeddings = getEmbeddings();
  return await embeddings.embedQuery(text);
}

/**
 * Generate embeddings for multiple texts
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
async function embedTexts(texts) {
  try {
    const embeddings = getEmbeddings();
    return await embeddings.embedDocuments(texts);
  } catch (error) {
    console.error(`[Embedding Provider] embedTexts failed:`, error.message);
    throw error;
  }
}

/**
 * Invalidate cached embeddings (call when config changes)
 */
function invalidateCache() {
  cachedEmbeddings = null;
  cachedProvider = null;
  console.log('[Embedding Provider] Cache invalidated');
}

/**
 * Get current embedding provider info
 */
function getProviderInfo() {
  const config = configManager.getActiveConfig();
  const fullConfig = configManager.loadConfig();
  let provider = config.provider;

  // Handle Anthropic fallback
  if (provider === 'anthropic') {
    if (fullConfig.gemini.apiKey) {
      provider = 'gemini';
    } else if (fullConfig.openai.apiKey) {
      provider = 'openai';
    }
  }

  return {
    provider,
    model: EMBEDDING_MODELS[provider] || EMBEDDING_MODELS.openai,
    dimensions: getEmbeddingDimensions()
  };
}

/**
 * Check if embedding provider is configured
 */
function isConfigured() {
  const config = configManager.getActiveConfig();
  const fullConfig = configManager.loadConfig();

  switch (config.provider) {
    case 'gemini':
      return !!config.apiKey;
    case 'openai':
      return !!config.apiKey;
    case 'azure':
      return !!(config.apiKey && config.endpoint);
    case 'anthropic':
      // Fallback to Gemini or OpenAI
      return !!(fullConfig.gemini.apiKey || fullConfig.openai.apiKey);
    default:
      return false;
  }
}

module.exports = {
  getEmbeddings,
  getEmbeddingDimensions,
  embedText,
  embedTexts,
  invalidateCache,
  getProviderInfo,
  isConfigured,
  EMBEDDING_MODELS,
  EMBEDDING_DIMENSIONS
};
