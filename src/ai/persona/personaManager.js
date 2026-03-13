/**
 * Persona Manager
 *
 * CRUD operations for AI persona metadata.
 * A persona is a catalog with extra metadata (style profile, system prompt).
 * Persists personas-meta.json alongside catalogs-meta.json in userData.
 */

const fs = require('fs').promises;
const path = require('path');

let personaMeta = {};
let metaPath = null;

/**
 * Initialize the persona manager
 * @param {string} storagePath - Path to store metadata (userData directory)
 */
async function initialize(storagePath) {
  metaPath = path.join(storagePath, 'vector-indexes', 'personas-meta.json');

  try {
    const data = await fs.readFile(metaPath, 'utf-8');
    personaMeta = JSON.parse(data);
    console.log(`[Persona Manager] Loaded ${Object.keys(personaMeta).length} personas`);
  } catch (error) {
    personaMeta = {};
    console.log('[Persona Manager] Starting with fresh metadata');
  }
}

/**
 * Save metadata to disk
 */
async function saveMetadata() {
  if (!metaPath) {
    console.error('[Persona Manager] Not initialized - cannot save');
    return;
  }

  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(metaPath), { recursive: true });
    await fs.writeFile(metaPath, JSON.stringify(personaMeta, null, 2), 'utf-8');
  } catch (error) {
    console.error('[Persona Manager] Failed to save metadata:', error.message);
    throw error;
  }
}

/**
 * Generate a safe catalog name from a persona name
 * @param {string} name - Display name
 * @returns {string} Safe catalog name
 */
function generateCatalogName(name) {
  return 'persona-' + name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Create a new persona
 * @param {string} name - Unique persona identifier
 * @param {Object} options - Persona options
 * @returns {Promise<Object>} Created persona info
 */
async function createPersona(name, options = {}) {
  const {
    displayName = name,
    description = '',
    rootPath = '',
    extensions = ['.md', '.txt', '.text', '.rtf', '.pdf']
  } = options;

  if (personaMeta[name]) {
    throw new Error(`Persona "${name}" already exists`);
  }

  const catalogName = generateCatalogName(name);

  personaMeta[name] = {
    displayName,
    catalogName,
    description,
    rootPath,
    extensions,
    styleProfile: null,
    systemPromptTemplate: null,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };

  await saveMetadata();
  console.log(`[Persona Manager] Created persona "${name}" with catalog "${catalogName}"`);

  return { name, catalogName, ...personaMeta[name] };
}

/**
 * Delete a persona
 * @param {string} name - Persona identifier
 * @returns {Promise<Object>} Deleted persona info including catalogName for cleanup
 */
async function deletePersona(name) {
  const persona = personaMeta[name];
  if (!persona) {
    throw new Error(`Persona "${name}" not found`);
  }

  const catalogName = persona.catalogName;
  delete personaMeta[name];
  await saveMetadata();

  console.log(`[Persona Manager] Deleted persona "${name}"`);
  return { name, catalogName };
}

/**
 * Get all personas
 * @returns {Array} List of persona summaries
 */
function getPersonas() {
  return Object.entries(personaMeta).map(([name, meta]) => ({
    name,
    displayName: meta.displayName,
    catalogName: meta.catalogName,
    description: meta.description,
    hasStyleProfile: !!meta.styleProfile,
    createdAt: meta.createdAt,
    lastUpdated: meta.lastUpdated
  }));
}

/**
 * Get a single persona with full metadata
 * @param {string} name - Persona identifier
 * @returns {Object|null} Full persona object or null
 */
function getPersona(name) {
  const meta = personaMeta[name];
  if (!meta) return null;
  return { name, ...meta };
}

/**
 * Update persona metadata
 * @param {string} name - Persona identifier
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated persona
 */
async function updatePersona(name, updates = {}) {
  if (!personaMeta[name]) {
    throw new Error(`Persona "${name}" not found`);
  }

  // Only allow updating specific fields
  const allowedFields = [
    'displayName', 'description', 'styleProfile',
    'systemPromptTemplate', 'rootPath', 'extensions'
  ];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      personaMeta[name][field] = updates[field];
    }
  }

  personaMeta[name].lastUpdated = new Date().toISOString();
  await saveMetadata();

  console.log(`[Persona Manager] Updated persona "${name}"`);
  return { name, ...personaMeta[name] };
}

module.exports = {
  initialize,
  createPersona,
  deletePersona,
  getPersonas,
  getPersona,
  updatePersona,
  generateCatalogName
};
