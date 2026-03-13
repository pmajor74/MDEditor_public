/**
 * Configuration Manager for Azure DevOps integration
 *
 * Handles:
 * - Loading .env configuration (supports AZURE_WIKI_URL or individual vars)
 * - Managing favorites storage
 * - Connection state
 */

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

/**
 * Parse an Azure Wiki URL to extract connection parameters
 * URL format: https://dev.azure.com/{org}/{project}/_wiki/wikis/{wikiId}/{pageId}/{pagePath}
 *
 * NOTE: The pageId is extracted so we can look up the actual page path via API.
 * This is more reliable than trying to convert the URL-friendly path.
 */
function parseWikiUrl(url) {
  if (!url) return null;
  try {
    // Pattern: https://dev.azure.com/{org}/{project}/_wiki/wikis/{wikiId}/{pageId}/{pagePath}
    // The pageId is numeric, pagePath is the URL-friendly title
    const regex = /dev\.azure\.com\/([^\/]+)\/([^\/]+)\/_wiki\/wikis\/([^\/]+)(?:\/(\d+)(?:\/(.+))?)?/;
    const match = url.match(regex);
    if (!match) {
      console.warn('[Config] Could not parse wiki URL:', url);
      return null;
    }

    const result = {
      org: decodeURIComponent(match[1]),
      project: decodeURIComponent(match[2]),
      wikiId: decodeURIComponent(match[3]),
      pageId: match[4] ? parseInt(match[4], 10) : null,  // Extract numeric page ID
      rootPath: '/'  // Will be resolved from pageId via API
    };
    console.log('[Config] Parsed wiki URL:', result);
    return result;
  } catch (e) {
    console.error('[Config] Failed to parse wiki URL:', e);
    return null;
  }
}

// Store connection state in memory
let connectionState = {
  connected: false,
  org: null,
  project: null,
  pat: null,
  wikiId: null,
  wikiName: null,
  rootPath: null
};

// Current page state for conflict detection
let currentPageState = {
  wikiId: null,
  path: null,
  eTag: null
};

/**
 * Load configuration from .env file
 * Supports AZURE_WIKI_URL (preferred) or individual variables (fallback)
 */
async function loadEnvConfig() {
  try {
    // Read from configService (values are synced to process.env for compatibility)
    // First try URL-based config (recommended)
    const wikiUrl = process.env.AZURE_WIKI_URL;
    if (wikiUrl) {
      const parsed = parseWikiUrl(wikiUrl);
      if (parsed) {
        return {
          ...parsed,
          pat: process.env.AZURE_PAT || ''
        };
      }
    }

    // Fall back to individual variables (populated by configService)
    return {
      org: process.env.AZURE_ORG || '',
      project: process.env.AZURE_PROJECT || '',
      pat: process.env.AZURE_PAT || '',
      wikiId: process.env.AZURE_WIKI_ID || '',
      rootPath: process.env.AZURE_WIKI_ROOT_PATH || ''
    };
  } catch (error) {
    console.error('[Config] Failed to load config:', error);
    return { org: '', project: '', pat: '', wikiId: '', rootPath: '' };
  }
}

/**
 * Get favorites file path
 */
function getFavoritesPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'azure-wiki-favorites.json');
}

/**
 * Load favorites from storage
 */
async function loadFavorites() {
  try {
    const favoritesPath = getFavoritesPath();
    const data = await fs.readFile(favoritesPath, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * Save favorites to storage
 */
async function saveFavorites(favorites) {
  const favoritesPath = getFavoritesPath();
  await fs.writeFile(favoritesPath, JSON.stringify(favorites, null, 2), 'utf8');
}

/**
 * Add a page to favorites
 */
async function addFavorite(favorite) {
  const favorites = await loadFavorites();

  // Check if already exists
  const exists = favorites.some(f =>
    f.org === favorite.org &&
    f.project === favorite.project &&
    f.wikiId === favorite.wikiId &&
    f.path === favorite.path
  );

  if (!exists) {
    favorites.push({
      ...favorite,
      addedAt: new Date().toISOString()
    });
    await saveFavorites(favorites);
  }

  return favorites;
}

/**
 * Remove a page from favorites
 */
async function removeFavorite(org, project, wikiId, pagePath) {
  let favorites = await loadFavorites();

  favorites = favorites.filter(f =>
    !(f.org === org && f.project === project && f.wikiId === wikiId && f.path === pagePath)
  );

  await saveFavorites(favorites);
  return favorites;
}

/**
 * Set connection state
 */
function setConnection(org, project, pat, wikiId, wikiName, rootPath = null) {
  connectionState = {
    connected: true,
    org,
    project,
    pat,
    wikiId,
    wikiName,
    rootPath
  };
}

/**
 * Clear connection state
 */
function clearConnection() {
  connectionState = {
    connected: false,
    org: null,
    project: null,
    pat: null,
    wikiId: null,
    wikiName: null,
    rootPath: null
  };
  currentPageState = { wikiId: null, path: null, eTag: null };
}

/**
 * Get current connection state
 */
function getConnection() {
  return { ...connectionState };
}

/**
 * Set current page state (for conflict detection)
 */
function setCurrentPage(wikiId, pagePath, eTag) {
  currentPageState = { wikiId, path: pagePath, eTag };
}

/**
 * Get current page state
 */
function getCurrentPage() {
  return { ...currentPageState };
}

/**
 * Check if connected
 */
function isConnected() {
  return connectionState.connected;
}

module.exports = {
  loadEnvConfig,
  loadFavorites,
  saveFavorites,
  addFavorite,
  removeFavorite,
  setConnection,
  clearConnection,
  getConnection,
  setCurrentPage,
  getCurrentPage,
  isConnected
};
