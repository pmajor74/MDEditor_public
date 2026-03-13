/**
 * Configuration Service
 *
 * Central config manager using config.json file.
 * Auto-migrates from .env if config.json doesn't exist.
 * Provides getConfig(), updateConfig(), getSafeConfig() for IPC.
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');

const DEFAULT_CONFIG = {
  azure: {
    org: '',
    project: '',
    pat: '',
    wikiId: '',
    wikiRootPath: '',
    wikiUrl: ''
  },
  llm: {
    provider: 'gemini',
    maxOutputTokens: 0,
    gemini: { apiKey: '', model: 'gemini-2.0-flash' },
    openai: { apiKey: '', model: 'gpt-4o' },
    azure: {
      apiKey: '',
      endpoint: '',
      deployment: '',
      model: 'gpt-4o',
      apiVersion: '2024-02-15-preview',
      embeddingDeployment: ''
    },
    anthropic: { apiKey: '', model: 'claude-sonnet-4-20250514' }
  },
  editor: {
    fontSize: 14,
    tabSize: 4,
    autoSaveInterval: 0,
    theme: 'system',
    wikiCacheTTL: 5,
    imageInsertMode: 'ask',
    debugLogMode: 'session'
  },
  transcription: {
    whisperPath: '',
    modelPath: '',
    modelName: 'medium',
    language: 'en',
    flashAttention: true,
    beamSize: 1,
    threads: 0
  }
};

let currentConfig = null;
let configFilePath = null;
let changeListeners = [];

/**
 * Get the config file path (next to exe when packaged, project root in dev)
 */
function getConfigPath() {
  if (configFilePath) return configFilePath;
  const basePath = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : path.resolve('.');
  configFilePath = path.join(basePath, 'config.json');
  return configFilePath;
}

/**
 * Deep merge two objects (target wins for non-object values)
 */
function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    if (
      overrides[key] !== null &&
      typeof overrides[key] === 'object' &&
      !Array.isArray(overrides[key]) &&
      typeof defaults[key] === 'object' &&
      defaults[key] !== null
    ) {
      result[key] = deepMerge(defaults[key], overrides[key]);
    } else if (overrides[key] !== undefined) {
      result[key] = overrides[key];
    }
  }
  return result;
}

/**
 * Attempt to migrate settings from .env file
 */
function migrateFromEnv() {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    require('dotenv').config();
  } catch {
    return config;
  }

  const env = process.env;

  // Azure
  config.azure.org = env.AZURE_ORG || '';
  config.azure.project = env.AZURE_PROJECT || '';
  config.azure.pat = env.AZURE_PAT || '';
  config.azure.wikiId = env.AZURE_WIKI_ID || '';
  config.azure.wikiRootPath = env.AZURE_WIKI_ROOT_PATH || '';
  config.azure.wikiUrl = env.AZURE_WIKI_URL || '';

  // LLM
  config.llm.provider = (env.LLM_PROVIDER || 'gemini').toLowerCase();
  config.llm.gemini.apiKey = env.GEMINI_API_KEY || '';
  config.llm.gemini.model = env.GEMINI_MODEL || DEFAULT_CONFIG.llm.gemini.model;
  config.llm.openai.apiKey = env.OPENAI_API_KEY || '';
  config.llm.openai.model = env.OPENAI_MODEL || DEFAULT_CONFIG.llm.openai.model;
  config.llm.azure.apiKey = env.AZURE_OPENAI_API_KEY || '';
  config.llm.azure.endpoint = env.AZURE_OPENAI_ENDPOINT || '';
  config.llm.azure.deployment = env.AZURE_OPENAI_DEPLOYMENT || '';
  config.llm.azure.model = env.AZURE_OPENAI_MODEL || DEFAULT_CONFIG.llm.azure.model;
  config.llm.azure.apiVersion = env.AZURE_OPENAI_API_VERSION || DEFAULT_CONFIG.llm.azure.apiVersion;
  config.llm.azure.embeddingDeployment = env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || '';
  config.llm.anthropic.apiKey = env.ANTHROPIC_API_KEY || '';
  config.llm.anthropic.model = env.ANTHROPIC_MODEL || DEFAULT_CONFIG.llm.anthropic.model;

  return config;
}

/**
 * Load config from disk. Creates file if missing, migrates from .env if available.
 */
async function loadConfig() {
  const configPath = getConfigPath();

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    currentConfig = deepMerge(DEFAULT_CONFIG, parsed);
    console.log('[ConfigService] Loaded config from', configPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // No config.json - try migrating from .env
      console.log('[ConfigService] No config.json found, attempting .env migration');
      currentConfig = migrateFromEnv();
      await saveConfig();
      console.log('[ConfigService] Created config.json from .env migration');
    } else {
      console.error('[ConfigService] Error reading config.json:', err.message);
      currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  // Sync config values into process.env for backward compatibility
  syncToProcessEnv(currentConfig);

  return currentConfig;
}

/**
 * Write current config to disk
 */
async function saveConfig() {
  const configPath = getConfigPath();
  await fs.writeFile(configPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
}

/**
 * Sync config values to process.env for backward compatibility with
 * modules that still read process.env directly.
 */
function syncToProcessEnv(config) {
  const env = process.env;
  // Azure
  env.AZURE_ORG = config.azure.org || '';
  env.AZURE_PROJECT = config.azure.project || '';
  env.AZURE_PAT = config.azure.pat || '';
  env.AZURE_WIKI_ID = config.azure.wikiId || '';
  env.AZURE_WIKI_ROOT_PATH = config.azure.wikiRootPath || '';
  env.AZURE_WIKI_URL = config.azure.wikiUrl || '';

  // LLM
  env.LLM_PROVIDER = config.llm.provider || 'gemini';
  env.LLM_MAX_OUTPUT_TOKENS = String(config.llm.maxOutputTokens || 0);
  env.GEMINI_API_KEY = config.llm.gemini.apiKey || '';
  env.GEMINI_MODEL = config.llm.gemini.model || '';
  env.OPENAI_API_KEY = config.llm.openai.apiKey || '';
  env.OPENAI_MODEL = config.llm.openai.model || '';
  env.AZURE_OPENAI_API_KEY = config.llm.azure.apiKey || '';
  env.AZURE_OPENAI_ENDPOINT = config.llm.azure.endpoint || '';
  env.AZURE_OPENAI_DEPLOYMENT = config.llm.azure.deployment || '';
  env.AZURE_OPENAI_MODEL = config.llm.azure.model || '';
  env.AZURE_OPENAI_API_VERSION = config.llm.azure.apiVersion || '';
  env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = config.llm.azure.embeddingDeployment || '';
  env.ANTHROPIC_API_KEY = config.llm.anthropic.apiKey || '';
  env.ANTHROPIC_MODEL = config.llm.anthropic.model || '';
}

/**
 * Get full config (main process use)
 */
function getConfig() {
  return currentConfig || JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

/**
 * Get a single config key using dot notation (e.g. 'azure.org')
 */
function getConfigValue(key) {
  const parts = key.split('.');
  let obj = getConfig();
  for (const part of parts) {
    if (obj == null) return undefined;
    obj = obj[part];
  }
  return obj;
}

/**
 * Update config with partial values (deep merge), save to disk, sync env
 */
async function updateConfig(partial) {
  currentConfig = deepMerge(currentConfig || DEFAULT_CONFIG, partial);
  syncToProcessEnv(currentConfig);
  await saveConfig();
  for (const listener of changeListeners) {
    try { listener(currentConfig); } catch (e) { console.error('[ConfigService] Listener error:', e); }
  }
  return currentConfig;
}

/**
 * Get safe config for renderer (masks API keys/secrets)
 */
function getSafeConfig() {
  const config = getConfig();
  const mask = (val) => val ? '••••' + val.slice(-4) : '';

  return {
    azure: {
      ...config.azure,
      pat: mask(config.azure.pat)
    },
    llm: {
      provider: config.llm.provider,
      gemini: { ...config.llm.gemini, apiKey: mask(config.llm.gemini.apiKey) },
      openai: { ...config.llm.openai, apiKey: mask(config.llm.openai.apiKey) },
      azure: { ...config.llm.azure, apiKey: mask(config.llm.azure.apiKey) },
      anthropic: { ...config.llm.anthropic, apiKey: mask(config.llm.anthropic.apiKey) }
    },
    editor: { ...config.editor },
    transcription: { ...config.transcription }
  };
}

/**
 * Register a change listener
 */
function onConfigChange(listener) {
  changeListeners.push(listener);
}

/**
 * Get full config for settings UI (includes real API keys)
 */
function getFullConfig() {
  return JSON.parse(JSON.stringify(getConfig()));
}

module.exports = {
  loadConfig,
  getConfig,
  getConfigValue,
  updateConfig,
  getSafeConfig,
  getFullConfig,
  getConfigPath,
  onConfigChange,
  DEFAULT_CONFIG
};
