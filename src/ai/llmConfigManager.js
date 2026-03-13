/**
 * LLM Configuration Manager
 *
 * Handles multi-provider configuration from environment variables.
 * Supports: Gemini, OpenAI, Azure OpenAI, Anthropic
 */

// Config values are populated in process.env by configService

// Cached config to avoid redundant env reads and console spam
let _cachedConfig = null;

// Supported LLM providers
const PROVIDERS = {
  GEMINI: 'gemini',
  OPENAI: 'openai',
  AZURE: 'azure',
  ANTHROPIC: 'anthropic'
};

// Default models for each provider
const DEFAULT_MODELS = {
  [PROVIDERS.GEMINI]: 'gemini-2.0-flash',
  [PROVIDERS.OPENAI]: 'gpt-4o',
  [PROVIDERS.AZURE]: 'gpt-4o',
  [PROVIDERS.ANTHROPIC]: 'claude-sonnet-4-20250514'
};

/**
 * Load configuration for the active LLM provider
 */
function loadConfig() {
  if (_cachedConfig) {
    return _cachedConfig;
  }

  const provider = (process.env.LLM_PROVIDER || PROVIDERS.GEMINI).toLowerCase();

  console.log('[LLM Config] Loading config, provider:', provider);

  const maxOutputTokens = parseInt(process.env.LLM_MAX_OUTPUT_TOKENS, 10) || 0;

  const config = {
    provider,
    maxOutputTokens,
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || DEFAULT_MODELS[PROVIDERS.GEMINI]
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || DEFAULT_MODELS[PROVIDERS.OPENAI]
    },
    azure: {
      apiKey: process.env.AZURE_OPENAI_API_KEY || '',
      endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT || '',
      model: process.env.AZURE_OPENAI_MODEL || DEFAULT_MODELS[PROVIDERS.AZURE],
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
      embeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || ''
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODELS[PROVIDERS.ANTHROPIC]
    }
  };

  _cachedConfig = config;
  return config;
}

/**
 * Invalidate cached config (call when settings/env change)
 */
function invalidateCache() {
  _cachedConfig = null;
}

/**
 * Get active provider configuration
 */
function getActiveConfig() {
  const config = loadConfig();
  const provider = config.provider;

  switch (provider) {
    case PROVIDERS.GEMINI:
      return {
        provider,
        maxOutputTokens: config.maxOutputTokens,
        apiKey: config.gemini.apiKey,
        model: config.gemini.model
      };
    case PROVIDERS.OPENAI:
      return {
        provider,
        maxOutputTokens: config.maxOutputTokens,
        apiKey: config.openai.apiKey,
        model: config.openai.model
      };
    case PROVIDERS.AZURE:
      return {
        provider,
        maxOutputTokens: config.maxOutputTokens,
        apiKey: config.azure.apiKey,
        endpoint: config.azure.endpoint,
        deploymentName: config.azure.deploymentName,
        model: config.azure.model,
        apiVersion: config.azure.apiVersion,
        embeddingDeployment: config.azure.embeddingDeployment
      };
    case PROVIDERS.ANTHROPIC:
      return {
        provider,
        maxOutputTokens: config.maxOutputTokens,
        apiKey: config.anthropic.apiKey,
        model: config.anthropic.model
      };
    default:
      console.warn(`[LLM Config] Unknown provider: ${provider}, defaulting to Gemini`);
      return {
        provider: PROVIDERS.GEMINI,
        maxOutputTokens: config.maxOutputTokens,
        apiKey: config.gemini.apiKey,
        model: config.gemini.model
      };
  }
}

/**
 * Check if the active provider is properly configured
 */
function isConfigured() {
  const config = getActiveConfig();

  switch (config.provider) {
    case PROVIDERS.GEMINI:
    case PROVIDERS.OPENAI:
    case PROVIDERS.ANTHROPIC:
      return !!config.apiKey;
    case PROVIDERS.AZURE:
      return !!(config.apiKey && config.endpoint && config.deploymentName);
    default:
      return false;
  }
}

/**
 * Get safe config for renderer (no API keys)
 */
function getSafeConfig() {
  const config = getActiveConfig();

  return {
    provider: config.provider,
    model: config.model,
    isConfigured: isConfigured()
  };
}

/**
 * Get list of available providers with their configuration status
 */
function getAvailableProviders() {
  const config = loadConfig();

  return [
    {
      id: PROVIDERS.GEMINI,
      name: 'Google Gemini',
      model: config.gemini.model,
      isConfigured: !!config.gemini.apiKey
    },
    {
      id: PROVIDERS.OPENAI,
      name: 'OpenAI',
      model: config.openai.model,
      isConfigured: !!config.openai.apiKey
    },
    {
      id: PROVIDERS.AZURE,
      name: 'Azure OpenAI',
      model: config.azure.model,
      isConfigured: !!(config.azure.apiKey && config.azure.endpoint && config.azure.deploymentName)
    },
    {
      id: PROVIDERS.ANTHROPIC,
      name: 'Anthropic Claude',
      model: config.anthropic.model,
      isConfigured: !!config.anthropic.apiKey
    }
  ];
}

/**
 * Get the current active provider name
 */
function getActiveProvider() {
  const config = loadConfig();
  return config.provider;
}

module.exports = {
  PROVIDERS,
  DEFAULT_MODELS,
  loadConfig,
  invalidateCache,
  getActiveConfig,
  isConfigured,
  getSafeConfig,
  getAvailableProviders,
  getActiveProvider
};
