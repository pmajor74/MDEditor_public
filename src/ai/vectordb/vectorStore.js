/**
 * Vector Store
 *
 * LanceDB wrapper for persistent vector storage using @lancedb/lancedb (v2).
 * Each catalog is stored as a separate LanceDB table.
 *
 * Features:
 * - Hybrid search: vector similarity + native full-text search (FTS)
 * - Case-insensitive search via query normalization
 * - No sentinel records: uses Arrow schema for empty table creation
 */

const lancedb = require('@lancedb/lancedb');
const path = require('path');
const { app } = require('electron');
const embeddingProvider = require('./embeddingProvider');

/**
 * Normalize text for search (lowercase, trim, normalize whitespace)
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
function normalizeForSearch(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// Database connection
let db = null;
let dbPath = null;

// Track which tables have FTS indexes
const ftsIndexedTables = new Set();

/**
 * Get the database storage path
 * @returns {string} Path to vector database storage
 */
function getDbPath() {
  if (!dbPath) {
    const userDataPath = app?.getPath('userData') || path.join(process.cwd(), '.vector-data');
    dbPath = path.join(userDataPath, 'vector-indexes');
  }
  return dbPath;
}

/**
 * Connect to the LanceDB database
 * @returns {Promise<Object>} Database connection
 */
async function connect() {
  if (db) {
    return db;
  }

  const storagePath = getDbPath();
  console.log(`[Vector Store] Connecting to database at: ${storagePath}`);

  try {
    db = await lancedb.connect(storagePath);
    console.log('[Vector Store] Connected successfully');
    return db;
  } catch (error) {
    console.error('[Vector Store] Connection failed:', error.message);
    throw error;
  }
}

/**
 * List all collections (tables) in the database
 * @returns {Promise<string[]>} Array of collection names
 */
async function listCollections() {
  const database = await connect();
  try {
    return await database.tableNames();
  } catch (error) {
    console.error('[Vector Store] Failed to list collections:', error.message);
    return [];
  }
}

/**
 * Create a new collection with the appropriate schema
 * @param {string} name - Collection name
 * @param {Object} options - Collection options
 * @returns {Promise<Object>} Collection/table handle
 */
async function createCollection(name, options = {}) {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await _createCollectionAttempt(name, options);
    } catch (error) {
      const isPanic = error.message && error.message.includes('Panic');
      if (isPanic && attempt < maxRetries) {
        console.warn(`[Vector Store] LanceDB panic creating "${name}", retrying (attempt ${attempt + 1})...`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

async function _createCollectionAttempt(name, options = {}) {
  const database = await connect();
  const dimensions = embeddingProvider.getEmbeddingDimensions();

  const existing = await listCollections();
  if (existing.includes(name)) {
    console.log(`[Vector Store] Collection "${name}" already exists`);
    return await database.openTable(name);
  }

  console.log(`[Vector Store] Creating collection "${name}" with ${dimensions} dimensions`);

  try {
    // Create empty table with Arrow schema (no sentinel record needed)
    const arrow = require('apache-arrow');
    const schema = new arrow.Schema([
      new arrow.Field('id', new arrow.Utf8()),
      new arrow.Field('text', new arrow.Utf8()),
      new arrow.Field('vector', new arrow.FixedSizeList(
        dimensions,
        new arrow.Field('item', new arrow.Float32())
      )),
      new arrow.Field('metadata', new arrow.Utf8())
    ]);
    const table = await database.createEmptyTable(name, schema);
    console.log(`[Vector Store] Collection "${name}" created`);
    return table;
  } catch (schemaError) {
    // Fallback: create with initial data record then remove it
    console.warn('[Vector Store] Empty table creation failed, using fallback:', schemaError.message);
    const initRecord = {
      id: '__schema_init__',
      text: '',
      vector: new Array(dimensions).fill(0),
      metadata: '{}'
    };
    const table = await database.createTable(name, [initRecord]);
    try {
      await table.delete("id = '__schema_init__'");
    } catch (e) {
      // Ignore delete failure on init record
    }
    console.log(`[Vector Store] Collection "${name}" created (fallback)`);
    return table;
  }
}

/**
 * Open an existing collection
 * @param {string} name - Collection name
 * @returns {Promise<Object>} Collection/table handle
 */
async function openCollection(name) {
  const database = await connect();
  try {
    return await database.openTable(name);
  } catch (error) {
    console.error(`[Vector Store] Failed to open collection "${name}":`, error.message);
    throw error;
  }
}

/**
 * Delete a collection
 * @param {string} name - Collection name
 * @returns {Promise<boolean>} Success status
 */
async function deleteCollection(name) {
  const database = await connect();
  try {
    await database.dropTable(name);
    ftsIndexedTables.delete(name);
    console.log(`[Vector Store] Collection "${name}" deleted`);
    return true;
  } catch (error) {
    console.error(`[Vector Store] Failed to delete collection "${name}":`, error.message);
    return false;
  }
}

/**
 * Ensure FTS index exists on the text column for a table
 * @param {Object} table - LanceDB table handle
 * @param {string} tableName - Table name for tracking
 */
async function ensureFtsIndex(table, tableName) {
  if (ftsIndexedTables.has(tableName)) return;

  try {
    await table.createIndex("text", { config: lancedb.Index.fts() });
    ftsIndexedTables.add(tableName);
    console.log(`[Vector Store] FTS index created for "${tableName}"`);
  } catch (error) {
    // Index may already exist or table may be empty
    if (error.message?.includes('already') || error.message?.includes('exist')) {
      ftsIndexedTables.add(tableName);
    } else {
      console.warn(`[Vector Store] FTS index creation failed for "${tableName}":`, error.message);
    }
  }
}

/**
 * Add documents to a collection
 * @param {string} collectionName - Collection name
 * @param {Array<Object>} documents - Documents to add
 *   Each document: { id, text, embeddingText?, metadata }
 * @param {Function} progressCallback - Optional progress callback
 * @param {Object} cancellationToken - Optional { cancelled: boolean } to abort
 * @returns {Promise<Object>} Result with count
 */
async function addDocuments(collectionName, documents, progressCallback, cancellationToken) {
  if (!documents || documents.length === 0) {
    return { success: true, count: 0 };
  }

  const table = await openCollection(collectionName);
  const batchSize = 10;
  let processed = 0;

  try {
    console.log(`[Vector Store] Starting addDocuments: ${documents.length} docs, batch size: ${batchSize}`);
    for (let i = 0; i < documents.length; i += batchSize) {
      if (cancellationToken?.cancelled) {
        console.log(`[Vector Store] Embedding cancelled after ${processed}/${documents.length} documents`);
        throw new Error('Indexing cancelled');
      }

      const batch = documents.slice(i, i + batchSize);
      // Use embeddingText (includes overlap context) if available, otherwise text
      const embeddingTexts = batch.map(doc => doc.embeddingText || doc.text);
      const normalizedTexts = embeddingTexts.map(t => normalizeForSearch(t));

      console.log(`[Vector Store] Generating embeddings for batch ${Math.floor(i / batchSize) + 1} (${batch.length} texts)...`);
      const embeddings = await embeddingProvider.embedTexts(normalizedTexts);
      console.log(`[Vector Store] Embeddings generated: ${embeddings.length} vectors`);

      const records = batch.map((doc, idx) => ({
        id: doc.id,
        text: doc.text,
        vector: embeddings[idx],
        metadata: JSON.stringify(doc.metadata || {})
      }));

      // Retry table.add on LanceDB native panics
      const addMaxRetries = 2;
      for (let addAttempt = 0; addAttempt <= addMaxRetries; addAttempt++) {
        try {
          await table.add(records);
          break;
        } catch (addError) {
          const isPanic = addError.message && addError.message.includes('Panic');
          if (isPanic && addAttempt < addMaxRetries) {
            console.warn(`[Vector Store] LanceDB panic adding records, retrying (attempt ${addAttempt + 1})...`);
            await new Promise(r => setTimeout(r, 500 * (addAttempt + 1)));
            continue;
          }
          throw addError;
        }
      }

      processed += batch.length;

      if (progressCallback) {
        progressCallback({
          type: 'embedding',
          processed,
          total: documents.length,
          percent: Math.round((processed / documents.length) * 100)
        });
      }
    }

    // Build/rebuild FTS index after adding documents
    await ensureFtsIndex(table, collectionName);

    console.log(`[Vector Store] Added ${processed} documents to "${collectionName}"`);
    return { success: true, count: processed };

  } catch (error) {
    console.error(`[Vector Store] Failed to add documents:`, error.message);
    throw error;
  }
}

/**
 * Search for similar documents using hybrid search (vector + native FTS)
 * @param {string} collectionName - Collection name
 * @param {string} query - Search query text
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Search results with scores
 */
async function search(collectionName, query, options = {}) {
  const {
    limit = 10,
    minScore = 0.0,
    filter = null,
    hybridWeight = 0.7
  } = options;

  try {
    const table = await openCollection(collectionName);
    const normalizedQuery = normalizeForSearch(query);
    const queryVector = await embeddingProvider.embedText(normalizedQuery);

    // 1. Vector search
    let vectorResults = [];
    try {
      let vectorSearch = table.search(queryVector)
        .distanceType("cosine")
        .limit(limit * 2);

      if (filter) {
        vectorSearch = vectorSearch.where(filter);
      }

      vectorResults = await vectorSearch.toArray();
    } catch (vectorError) {
      console.warn('[Vector Store] Vector search failed:', vectorError.message);
    }

    // 2. Native FTS search (replaces manual keyword extraction)
    let ftsResults = [];
    try {
      ftsResults = await table.search(normalizedQuery, "fts")
        .limit(limit * 2)
        .toArray();
      console.log(`[Vector Store] FTS found ${ftsResults.length} matches`);
    } catch (ftsError) {
      // FTS index may not exist (old catalog or empty table)
      if (!ftsError.message?.includes('No full text index')) {
        console.warn('[Vector Store] FTS search unavailable:', ftsError.message);
      }
    }

    // 3. Merge results with weighted scoring
    const resultMap = new Map();

    for (const r of vectorResults) {
      if (r.id === '__init__' || r.id === '__schema_init__') continue;
      const vectorScore = r._distance !== undefined
        ? Math.max(0, 1 - r._distance)
        : 0;

      resultMap.set(r.id, {
        id: r.id,
        text: r.text,
        metadata: JSON.parse(r.metadata || '{}'),
        vectorScore,
        keywordScore: 0
      });
    }

    // Normalize FTS scores (BM25 scores can vary widely)
    const maxFtsScore = ftsResults.length > 0
      ? Math.max(...ftsResults.map(r => r._score ?? r._relevance_score ?? 0), 1)
      : 1;

    for (const r of ftsResults) {
      if (r.id === '__init__' || r.id === '__schema_init__') continue;
      const rawScore = r._score ?? r._relevance_score ?? 0;
      const normalizedFtsScore = rawScore / maxFtsScore;

      if (resultMap.has(r.id)) {
        resultMap.get(r.id).keywordScore = normalizedFtsScore;
      } else {
        resultMap.set(r.id, {
          id: r.id,
          text: r.text,
          metadata: JSON.parse(r.metadata || '{}'),
          vectorScore: 0,
          keywordScore: normalizedFtsScore
        });
      }
    }

    const processed = Array.from(resultMap.values())
      .map(r => ({
        id: r.id,
        text: r.text,
        metadata: r.metadata,
        score: (r.vectorScore * hybridWeight) + (r.keywordScore * (1 - hybridWeight)),
        vectorScore: r.vectorScore,
        keywordScore: r.keywordScore
      }))
      .filter(r => r.score >= minScore || r.keywordScore > 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    console.log(`[Vector Store] Hybrid search in "${collectionName}" returned ${processed.length} results`);
    return processed;

  } catch (error) {
    console.error(`[Vector Store] Search failed:`, error.message);
    throw error;
  }
}

/**
 * Remove documents from a collection by ID
 * @param {string} collectionName - Collection name
 * @param {string[]} ids - Document IDs to remove
 * @returns {Promise<Object>} Result
 */
async function removeDocuments(collectionName, ids) {
  try {
    const table = await openCollection(collectionName);
    const idList = ids.map(id => `'${id}'`).join(',');
    await table.delete(`id IN (${idList})`);

    console.log(`[Vector Store] Removed ${ids.length} documents from "${collectionName}"`);
    return { success: true, count: ids.length };
  } catch (error) {
    console.error(`[Vector Store] Failed to remove documents:`, error.message);
    throw error;
  }
}

/**
 * Get collection statistics
 * @param {string} collectionName - Collection name
 * @returns {Promise<Object>} Collection stats
 */
async function getCollectionStats(collectionName) {
  try {
    const table = await openCollection(collectionName);
    const count = await table.countRows();

    // Subtract legacy __init__ records if they exist
    let initCount = 0;
    try {
      initCount = await table.countRows("id = '__init__'");
    } catch (e) {
      // Filter syntax may not work on all schemas
    }

    return {
      name: collectionName,
      documentCount: count - initCount,
      dimensions: embeddingProvider.getEmbeddingDimensions(),
      embeddingProvider: embeddingProvider.getProviderInfo()
    };
  } catch (error) {
    console.error(`[Vector Store] Failed to get stats for "${collectionName}":`, error.message);
    return {
      name: collectionName,
      documentCount: 0,
      error: error.message
    };
  }
}

/**
 * Clear all documents from a collection (keeps the collection)
 * @param {string} collectionName - Collection name
 * @returns {Promise<boolean>} Success status
 */
async function clearCollection(collectionName) {
  try {
    const table = await openCollection(collectionName);
    const count = await table.countRows();

    if (count > 0) {
      await table.delete("id IS NOT NULL");
    }

    // Reset FTS index tracking (will be rebuilt on next addDocuments)
    ftsIndexedTables.delete(collectionName);

    console.log(`[Vector Store] Cleared collection "${collectionName}"`);
    return true;
  } catch (error) {
    console.error(`[Vector Store] Failed to clear collection "${collectionName}":`, error.message);
    return false;
  }
}

/**
 * Get all chunks for a specific file in a collection
 * @param {string} collectionName - Collection name
 * @param {string} filePath - File path to get chunks for
 * @returns {Promise<Array>} Array of chunks with text and metadata
 */
async function getFileChunks(collectionName, filePath) {
  try {
    const table = await openCollection(collectionName);

    // Use query() instead of dummy vector search
    const allRecords = await table.query()
      .select(["id", "text", "metadata"])
      .limit(10000)
      .toArray();

    const chunks = allRecords
      .filter(r => {
        if (r.id === '__init__' || r.id === '__schema_init__') return false;
        try {
          const metadata = JSON.parse(r.metadata || '{}');
          return metadata.filePath === filePath;
        } catch {
          return false;
        }
      })
      .map((r, index) => {
        const metadata = JSON.parse(r.metadata || '{}');
        return {
          id: r.id,
          index: index + 1,
          text: r.text,
          charCount: r.text?.length || 0,
          metadata: {
            filePath: metadata.filePath,
            relativePath: metadata.relativePath,
            chunkIndex: metadata.chunkIndex,
            totalChunks: metadata.totalChunks,
            startLine: metadata.startLine,
            endLine: metadata.endLine,
            overlapBefore: metadata.overlapBefore || '',
            overlapAfter: metadata.overlapAfter || ''
          }
        };
      })
      .sort((a, b) => (a.metadata.chunkIndex || 0) - (b.metadata.chunkIndex || 0));

    console.log(`[Vector Store] Found ${chunks.length} chunks for file "${filePath}" in "${collectionName}"`);
    return chunks;
  } catch (error) {
    console.error(`[Vector Store] Failed to get file chunks:`, error.message);
    throw error;
  }
}

/**
 * Check if a collection uses the old schema and needs migration
 * Old schema: has text_lower field and/or __init__ sentinel record
 * New schema: no text_lower, no sentinel, has FTS index on text
 * @param {string} collectionName - Collection name
 * @returns {Promise<boolean>} True if migration is needed
 */
async function needsMigration(collectionName) {
  try {
    const table = await openCollection(collectionName);
    const sample = await table.query().limit(1).toArray();

    if (sample.length === 0) return false;

    // Old schema has text_lower field or __init__ sentinel
    return sample[0].text_lower !== undefined || sample[0].id === '__init__';
  } catch (error) {
    console.error(`[Vector Store] Migration check failed:`, error.message);
    return false;
  }
}

/**
 * Sample chunks directly from a collection without vector search.
 * Used as a fallback when the embedding provider is unavailable.
 * @param {string} collectionName - Collection name
 * @param {number} limit - Max chunks to return
 * @returns {Promise<Array>} Array of { id, text } objects
 */
async function sampleChunksDirect(collectionName, limit = 50) {
  const table = await openCollection(collectionName);
  const records = await table.query()
    .select(["id", "text"])
    .limit(limit)
    .toArray();

  return records
    .filter(r => r.id !== '__init__' && r.id !== '__schema_init__' && r.text)
    .map(r => ({ id: r.id, text: r.text }));
}

/**
 * Close the database connection
 */
async function close() {
  if (db) {
    db = null;
    ftsIndexedTables.clear();
    console.log('[Vector Store] Connection closed');
  }
}

module.exports = {
  connect,
  listCollections,
  createCollection,
  openCollection,
  deleteCollection,
  addDocuments,
  search,
  removeDocuments,
  getCollectionStats,
  clearCollection,
  getFileChunks,
  sampleChunksDirect,
  needsMigration,
  normalizeForSearch,
  close,
  getDbPath
};
