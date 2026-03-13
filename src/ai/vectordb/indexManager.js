/**
 * Index Manager
 *
 * Manages vector catalogs, file indexing, and document chunking.
 * Coordinates between file system, markdown splitter, and vector store.
 *
 * A "catalog" is a named collection of indexed files that can be used
 * for RAG (Retrieval-Augmented Generation) in the AI Copilot.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const vectorStore = require('./vectorStore');
const markdownSplitter = require('../splitters/markdownSplitter');
const splitterFactory = require('../splitters');

// Catalog metadata storage (in-memory, backed by file)
let catalogMeta = {};
let metaPath = null;

// Cancellation tokens for long-running operations
const cancellationTokens = new Map();

// Track active indexing operations for real-time status display
const activeIndexingOps = new Map();  // catalogName -> { started, processed, total, status }

// Callback for broadcasting indexing status changes
let statusBroadcaster = null;

/**
 * Set the status broadcaster callback
 * @param {Function} callback - Function to call with status updates
 */
function setStatusBroadcaster(callback) {
  statusBroadcaster = callback;
}

/**
 * Set indexing status for a catalog
 * @param {string} catalogName - Catalog name
 * @param {boolean} active - Whether indexing is active
 * @param {Object} progress - Progress info (processed, total, status)
 */
function setIndexingActive(catalogName, active, progress = null) {
  if (active) {
    activeIndexingOps.set(catalogName, {
      started: Date.now(),
      processed: progress?.processed || 0,
      total: progress?.total || 0,
      status: progress?.status || 'scanning'
    });
  } else {
    activeIndexingOps.delete(catalogName);
  }

  // Broadcast status change
  if (statusBroadcaster) {
    statusBroadcaster(getActiveIndexingOps());
  }
}

/**
 * Update indexing progress for a catalog
 * @param {string} catalogName - Catalog name
 * @param {Object} progress - Progress info
 */
function updateIndexingProgress(catalogName, progress) {
  const current = activeIndexingOps.get(catalogName);
  if (current) {
    activeIndexingOps.set(catalogName, {
      ...current,
      processed: progress.processed ?? current.processed,
      total: progress.total ?? current.total,
      status: progress.status ?? current.status
    });

    // Broadcast status change
    if (statusBroadcaster) {
      statusBroadcaster(getActiveIndexingOps());
    }
  }
}

/**
 * Get all active indexing operations
 * @returns {Object} Map of catalog name to indexing status
 */
function getActiveIndexingOps() {
  const result = {};
  for (const [name, info] of activeIndexingOps) {
    result[name] = { ...info };
  }
  return result;
}

/**
 * Initialize the index manager
 * @param {string} storagePath - Path to store metadata
 */
async function initialize(storagePath) {
  metaPath = path.join(storagePath, 'catalogs-meta.json');

  try {
    const data = await fs.readFile(metaPath, 'utf-8');
    catalogMeta = JSON.parse(data);
    console.log(`[Index Manager] Loaded metadata for ${Object.keys(catalogMeta).length} catalogs`);
  } catch (error) {
    // Try loading from old collections-meta.json for backward compatibility
    try {
      const oldMetaPath = path.join(storagePath, 'collections-meta.json');
      const data = await fs.readFile(oldMetaPath, 'utf-8');
      catalogMeta = JSON.parse(data);
      console.log(`[Index Manager] Migrated ${Object.keys(catalogMeta).length} catalogs from legacy format`);
      // Save to new path
      await saveMetadata();
    } catch (migrationError) {
      // Neither file exists - start fresh
      catalogMeta = {};
      console.log('[Index Manager] Starting with fresh metadata');
    }
  }
}

/**
 * Save metadata to disk
 */
async function saveMetadata() {
  if (!metaPath) return;

  try {
    await fs.writeFile(metaPath, JSON.stringify(catalogMeta, null, 2));
  } catch (error) {
    console.error('[Index Manager] Failed to save metadata:', error.message);
  }
}

/**
 * Generate a unique ID for a document chunk
 * @param {string} filePath - Source file path
 * @param {number} chunkIndex - Chunk index within file
 * @returns {string} Unique ID
 */
function generateChunkId(filePath, chunkIndex) {
  const hash = crypto.createHash('md5').update(filePath).digest('hex').substring(0, 8);
  return `${hash}_${chunkIndex}`;
}

/**
 * Generate file hash for change detection
 * @param {string} content - File content
 * @returns {string} Content hash
 */
function generateContentHash(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Check if file content appears to be binary (not text)
 * Checks for null bytes and high proportion of non-printable characters
 * @param {Buffer} buffer - First portion of file content
 * @returns {boolean} True if file appears to be binary
 */
function isBinaryContent(buffer) {
  // Check for null bytes (common in binary files)
  if (buffer.includes(0)) {
    return true;
  }

  // Count non-text characters
  let nonTextCount = 0;
  const sampleSize = Math.min(buffer.length, 8192);

  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];
    // Allow common text characters: printable ASCII, tabs, newlines, carriage returns
    // Also allow UTF-8 multi-byte sequences (bytes >= 128)
    const isTextChar = (byte >= 32 && byte <= 126) || // printable ASCII
                       byte === 9 ||  // tab
                       byte === 10 || // newline
                       byte === 13 || // carriage return
                       byte >= 128;   // UTF-8 continuation bytes

    if (!isTextChar) {
      nonTextCount++;
    }
  }

  // If more than 10% of bytes are non-text, treat as binary
  const nonTextRatio = nonTextCount / sampleSize;
  return nonTextRatio > 0.1;
}

/**
 * Compute relative path from root to file
 * @param {string} rootPath - Root folder path
 * @param {string} filePath - Full file path
 * @returns {string} Relative path
 */
function getRelativePath(rootPath, filePath) {
  const normalized = path.relative(rootPath, filePath);
  return normalized.replace(/\\/g, '/');
}

/**
 * Build embedding text that includes overlap context for better semantic search
 * Returns null if no overlap is present (caller should omit embeddingText field)
 * @param {string} text - Clean document text
 * @param {Object} chunk - Chunk object with metadata
 * @returns {string|null} Text with overlap context, or null
 */
function buildEmbeddingText(text, chunk) {
  const overlapBefore = chunk.metadata?.overlapBefore || '';
  const overlapAfter = chunk.metadata?.overlapAfter || '';
  if (!overlapBefore && !overlapAfter) return null;
  return [overlapBefore, text, overlapAfter].filter(Boolean).join('\n');
}

/**
 * Get list of all catalogs with their metadata
 * @returns {Promise<Array>} Catalog list with stats
 */
async function getCatalogs() {
  const catalogs = await vectorStore.listCollections();

  const result = await Promise.all(catalogs.map(async name => {
    const stats = await vectorStore.getCollectionStats(name);
    const meta = catalogMeta[name] || {};

    return {
      name,
      displayName: meta.displayName || name,
      description: meta.description || '',
      documentCount: stats.documentCount,
      fileCount: meta.files ? Object.keys(meta.files).length : 0,
      rootPath: meta.rootPath || null,
      rootPaths: meta.rootPaths || (meta.rootPath ? [meta.rootPath] : []),
      createdAt: meta.createdAt || null,
      lastUpdated: meta.lastUpdated || null,
      extensions: meta.extensions || ['.md', '.txt']
    };
  }));

  return result;
}

// Alias for backward compatibility
const getCollections = getCatalogs;

/**
 * Create a new catalog for a folder
 * @param {string} name - Catalog name (unique identifier)
 * @param {string} rootPath - Root folder path
 * @param {Object} options - Catalog options
 * @returns {Promise<Object>} Created catalog info
 */
async function createCatalog(name, rootPath, options = {}) {
  const {
    extensions = ['.md', '.txt', '.markdown'],
    description = '',
    displayName = name
  } = options;

  // Create vector store collection
  await vectorStore.createCollection(name);

  // Store metadata with enhanced structure
  catalogMeta[name] = {
    displayName,
    rootPath,
    rootPaths: [rootPath], // Support multiple root paths
    extensions,
    description,
    files: {},
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };

  await saveMetadata();

  console.log(`[Index Manager] Created catalog "${name}" for ${rootPath}`);

  return {
    name,
    displayName,
    rootPath,
    rootPaths: [rootPath],
    extensions,
    description
  };
}

// Alias for backward compatibility
const createCollection = createCatalog;

/**
 * Delete a catalog
 * @param {string} name - Catalog name
 * @returns {Promise<boolean>} Success status
 */
async function deleteCatalog(name) {
  const success = await vectorStore.deleteCollection(name);

  if (success) {
    delete catalogMeta[name];
    await saveMetadata();
    console.log(`[Index Manager] Deleted catalog "${name}"`);
  }

  return success;
}

// Alias for backward compatibility
const deleteCollection = deleteCatalog;

/**
 * Index files from a folder into a catalog
 * @param {string} catalogName - Catalog name
 * @param {Object} options - Index options
 * @param {Function} progressCallback - Progress callback
 * @returns {Promise<Object>} Index result
 */
async function indexFiles(catalogName, options = {}, progressCallback) {
  const meta = catalogMeta[catalogName];
  if (!meta) {
    throw new Error(`Catalog "${catalogName}" not found`);
  }

  const {
    forceReindex = false,
    maxFiles = 1000,
    specificFiles = null  // Array of specific file paths to index (instead of scanning root paths)
  } = options;

  const cancellationToken = { cancelled: false };
  cancellationTokens.set(catalogName, cancellationToken);

  // Mark indexing as active
  setIndexingActive(catalogName, true, { status: 'scanning' });

  // Support multiple root paths
  const rootPaths = meta.rootPaths || (meta.rootPath ? [meta.rootPath] : []);
  const extensions = meta.extensions || ['.md', '.txt'];

  let allFiles = [];

  if (specificFiles && specificFiles.length > 0) {
    // Index only the specific files provided (filter by extension)
    console.log(`[Index Manager] Indexing ${specificFiles.length} specific file(s)`);
    for (const filePath of specificFiles) {
      const ext = path.extname(filePath).toLowerCase();
      if (extensions.includes(ext)) {
        // Find which root path this file belongs to
        const rootPath = rootPaths.find(rp => filePath.startsWith(rp)) || rootPaths[0] || path.dirname(filePath);
        allFiles.push({ path: filePath, rootPath });
      }
    }
  } else {
    // Scan all root paths for matching files
    console.log(`[Index Manager] Indexing files from ${rootPaths.length} root path(s)`);
    for (const rootPath of rootPaths) {
      const files = await findFiles(rootPath, extensions, maxFiles - allFiles.length);
      allFiles = allFiles.concat(files.map(f => ({ path: f, rootPath })));
      if (allFiles.length >= maxFiles) break;
    }
  }

  // Update progress with total
  updateIndexingProgress(catalogName, { total: allFiles.length, status: 'indexing' });

  if (progressCallback) {
    progressCallback({
      type: 'scanning',
      message: `Found ${allFiles.length} files to index`,
      total: allFiles.length
    });
  }

  let indexed = 0;
  let skipped = 0;
  let binarySkipped = 0;
  let errors = 0;
  const allDocuments = [];

  for (const { path: filePath, rootPath } of allFiles) {
    if (cancellationToken.cancelled) {
      console.log('[Index Manager] Indexing cancelled');
      break;
    }

    try {
      // First read as buffer to check for binary content
      const buffer = await fs.readFile(filePath);
      if (isBinaryContent(buffer)) {
        console.log(`[Index Manager] Skipping binary file: ${filePath}`);
        binarySkipped++;
        continue;
      }

      // Convert buffer to string for processing
      const content = buffer.toString('utf-8');
      const contentHash = generateContentHash(content);

      // Check if file needs reindexing
      const existingFile = meta.files[filePath];
      if (!forceReindex && existingFile && existingFile.hash === contentHash) {
        skipped++;
        continue;
      }

      // Remove old chunks if file was previously indexed
      if (existingFile && existingFile.chunkIds) {
        await vectorStore.removeDocuments(catalogName, existingFile.chunkIds);
      }

      // Compute relative path for context
      const relativePath = getRelativePath(rootPath, filePath);

      // Use the advanced splitter factory for intelligent chunking
      const chunkConfig = meta.chunkingConfig || {};
      const chunks = await splitterFactory.splitDocument(content, filePath, chunkConfig);

      // Prepare documents for vector store
      const chunkIds = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = chunk.id || generateChunkId(filePath, i);
        chunkIds.push(chunkId);

        // Include file path in indexed text for path-based search
        const pathContext = `[File: ${relativePath}]`;
        const textWithPath = `${pathContext}\n${chunk.content}`;

        allDocuments.push({
          id: chunkId,
          text: textWithPath,
          embeddingText: buildEmbeddingText(textWithPath, chunk),
          metadata: {
            filePath,
            relativePath,
            rootPath,
            fileName: path.basename(filePath),
            chunkIndex: i,
            totalChunks: chunks.length,
            title: chunk.metadata?.title || chunk.metadata?.structureName || null,
            headerLevel: chunk.metadata?.level || null,
            startLine: chunk.startLine || null,
            endLine: chunk.endLine || null,
            fullPath: chunk.metadata?.fullPath || null,
            fileType: chunk.metadata?.fileType || null,
            language: chunk.metadata?.language || null,
            structureType: chunk.metadata?.structureType || null,
            structureName: chunk.metadata?.structureName || null,
            estimatedTokens: chunk.estimatedTokens || null,
            hasOverlap: chunk.metadata?.hasOverlap || false,
            overlapBefore: chunk.metadata?.overlapBefore || '',
            overlapAfter: chunk.metadata?.overlapAfter || ''
          }
        });
      }

      // Update file metadata
      meta.files[filePath] = {
        hash: contentHash,
        chunkIds,
        chunkCount: chunks.length,
        indexedAt: new Date().toISOString(),
        relativePath
      };

      indexed++;

      // Update active indexing progress
      updateIndexingProgress(catalogName, {
        processed: indexed + skipped,
        total: allFiles.length,
        status: 'indexing'
      });

      if (progressCallback) {
        progressCallback({
          type: 'processing',
          file: path.basename(filePath),
          processed: indexed + skipped,
          total: allFiles.length,
          percent: Math.round(((indexed + skipped) / allFiles.length) * 100)
        });
      }

    } catch (error) {
      console.error(`[Index Manager] Error indexing ${filePath}:`, error.message);
      errors++;
    }
  }

  // Add all documents to vector store in batches
  if (allDocuments.length > 0 && !cancellationToken.cancelled) {
    updateIndexingProgress(catalogName, { status: 'embedding' });

    if (progressCallback) {
      progressCallback({
        type: 'embedding',
        message: 'Generating embeddings...',
        total: allDocuments.length
      });
    }

    await vectorStore.addDocuments(catalogName, allDocuments, progressCallback);
  }

  // Update metadata
  meta.lastUpdated = new Date().toISOString();
  await saveMetadata();

  cancellationTokens.delete(catalogName);

  // Mark indexing as inactive
  setIndexingActive(catalogName, false);

  const result = {
    success: true,
    indexed,
    skipped,
    binarySkipped,
    errors,
    total: allFiles.length,
    cancelled: cancellationToken.cancelled
  };

  console.log(`[Index Manager] Indexing complete:`, result);
  return result;
}

/**
 * Find files matching extensions in a directory
 * @param {string} dir - Directory path
 * @param {string[]} extensions - File extensions to match
 * @param {number} maxFiles - Maximum files to return
 * @returns {Promise<string[]>} Array of file paths
 */
async function findFiles(dir, extensions, maxFiles = 1000) {
  const files = [];

  async function scan(currentDir) {
    if (files.length >= maxFiles) return;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= maxFiles) break;

        const fullPath = path.join(currentDir, entry.name);

        // Skip hidden files and common ignore patterns
        if (entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === '__pycache__') {
          continue;
        }

        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.error(`[Index Manager] Error scanning ${currentDir}:`, error.message);
    }
  }

  await scan(dir);
  return files;
}

/**
 * Add a single file to a catalog
 * @param {string} catalogName - Catalog name
 * @param {string} filePath - File path
 * @param {string} content - File content (optional, will read if not provided)
 * @returns {Promise<Object>} Result
 */
async function addFile(catalogName, filePath, content = null) {
  const meta = catalogMeta[catalogName];
  if (!meta) {
    throw new Error(`Catalog "${catalogName}" not found`);
  }

  // Read content if not provided
  if (content === null) {
    content = await fs.readFile(filePath, 'utf-8');
  }

  const contentHash = generateContentHash(content);

  // Remove old chunks if file was previously indexed
  const existingFile = meta.files[filePath];
  if (existingFile && existingFile.chunkIds) {
    await vectorStore.removeDocuments(catalogName, existingFile.chunkIds);
  }

  // Determine root path for relative path calculation
  const rootPaths = meta.rootPaths || (meta.rootPath ? [meta.rootPath] : []);
  let rootPath = rootPaths[0] || path.dirname(filePath);
  for (const rp of rootPaths) {
    if (filePath.startsWith(rp)) {
      rootPath = rp;
      break;
    }
  }
  const relativePath = getRelativePath(rootPath, filePath);

  // Use the advanced splitter factory for intelligent chunking
  const chunkConfig = meta.chunkingConfig || {};
  const chunks = await splitterFactory.splitDocument(content, filePath, chunkConfig);

  const documents = [];
  const chunkIds = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkId = chunk.id || generateChunkId(filePath, i);
    chunkIds.push(chunkId);

    // Include file path in indexed text
    const pathContext = `[File: ${relativePath}]`;
    const textWithPath = `${pathContext}\n${chunk.content}`;

    documents.push({
      id: chunkId,
      text: textWithPath,
      embeddingText: buildEmbeddingText(textWithPath, chunk),
      metadata: {
        filePath,
        relativePath,
        rootPath,
        fileName: path.basename(filePath),
        chunkIndex: i,
        totalChunks: chunks.length,
        title: chunk.metadata?.title || chunk.metadata?.structureName || null,
        headerLevel: chunk.metadata?.level || null,
        startLine: chunk.startLine || null,
        endLine: chunk.endLine || null,
        fullPath: chunk.metadata?.fullPath || null,
        fileType: chunk.metadata?.fileType || null,
        language: chunk.metadata?.language || null,
        structureType: chunk.metadata?.structureType || null,
        structureName: chunk.metadata?.structureName || null,
        estimatedTokens: chunk.estimatedTokens || null,
        hasOverlap: chunk.metadata?.hasOverlap || false,
        overlapBefore: chunk.metadata?.overlapBefore || '',
        overlapAfter: chunk.metadata?.overlapAfter || ''
      }
    });
  }

  await vectorStore.addDocuments(catalogName, documents);

  // Update metadata
  meta.files[filePath] = {
    hash: contentHash,
    chunkIds,
    chunkCount: chunks.length,
    indexedAt: new Date().toISOString(),
    relativePath
  };
  meta.lastUpdated = new Date().toISOString();
  await saveMetadata();

  return {
    success: true,
    filePath,
    chunks: chunks.length
  };
}

/**
 * Remove a file from a catalog
 * @param {string} catalogName - Catalog name
 * @param {string} filePath - File path
 * @returns {Promise<Object>} Result
 */
async function removeFile(catalogName, filePath) {
  const meta = catalogMeta[catalogName];
  if (!meta) {
    throw new Error(`Catalog "${catalogName}" not found`);
  }

  const existingFile = meta.files[filePath];
  if (!existingFile) {
    return { success: true, removed: false };
  }

  // Remove chunks from vector store
  if (existingFile.chunkIds) {
    await vectorStore.removeDocuments(catalogName, existingFile.chunkIds);
  }

  // Remove from metadata
  delete meta.files[filePath];
  meta.lastUpdated = new Date().toISOString();
  await saveMetadata();

  return { success: true, removed: true };
}

/**
 * Smart refresh a catalog - detect and sync changes
 * Finds deleted files (removes from index), new files (adds to index),
 * and modified files (re-indexes based on hash).
 *
 * @param {string} catalogName - Catalog name
 * @param {Function} progressCallback - Progress callback
 * @returns {Promise<Object>} Refresh result with counts
 */
async function refreshCatalog(catalogName, progressCallback) {
  const meta = catalogMeta[catalogName];
  if (!meta) {
    throw new Error(`Catalog "${catalogName}" not found`);
  }

  const cancellationToken = { cancelled: false };
  cancellationTokens.set(catalogName, cancellationToken);

  // Mark refresh as active
  setIndexingActive(catalogName, true, { status: 'scanning' });

  const rootPaths = meta.rootPaths || (meta.rootPath ? [meta.rootPath] : []);
  const extensions = meta.extensions || ['.md', '.txt'];

  console.log(`[Index Manager] Refreshing catalog "${catalogName}"`);

  if (progressCallback) {
    progressCallback({
      type: 'scanning',
      message: 'Scanning for file changes...'
    });
  }

  // Build set of currently indexed file paths
  const indexedFiles = new Set(Object.keys(meta.files || {}));

  // Scan disk for current files
  let currentFiles = [];
  for (const rootPath of rootPaths) {
    const files = await findFiles(rootPath, extensions, 10000);
    currentFiles = currentFiles.concat(files.map(f => ({ path: f, rootPath })));
  }
  const currentFilePaths = new Set(currentFiles.map(f => f.path));

  // Identify changes
  const deletedFiles = [...indexedFiles].filter(fp => !currentFilePaths.has(fp));
  const newFiles = currentFiles.filter(f => !indexedFiles.has(f.path));

  // Check for modified files (hash changed)
  const modifiedFiles = [];
  const unchangedCount = { count: 0 };
  let binarySkippedInRefresh = 0;

  for (const { path: filePath, rootPath } of currentFiles) {
    if (cancellationToken.cancelled) break;
    if (!indexedFiles.has(filePath)) continue; // Already in newFiles

    try {
      // Read as buffer to check for binary content
      const buffer = await fs.readFile(filePath);
      if (isBinaryContent(buffer)) {
        console.log(`[Index Manager] Skipping binary file during refresh: ${filePath}`);
        binarySkippedInRefresh++;
        continue;
      }

      const content = buffer.toString('utf-8');
      const contentHash = generateContentHash(content);
      const existingFile = meta.files[filePath];

      if (existingFile && existingFile.hash !== contentHash) {
        modifiedFiles.push({ path: filePath, rootPath, content, hash: contentHash });
      } else {
        unchangedCount.count++;
      }
    } catch (error) {
      // File might have been deleted after scan
      console.warn(`[Index Manager] Could not read ${filePath}:`, error.message);
    }
  }

  if (progressCallback) {
    progressCallback({
      type: 'analyzing',
      message: `Found ${deletedFiles.length} deleted, ${newFiles.length} new, ${modifiedFiles.length} modified`,
      deleted: deletedFiles.length,
      added: newFiles.length,
      modified: modifiedFiles.length,
      unchanged: unchangedCount.count
    });
  }

  let removed = 0;
  let added = 0;
  let updated = 0;
  let errors = 0;
  const allNewDocuments = [];

  // Remove deleted files from index
  for (const filePath of deletedFiles) {
    if (cancellationToken.cancelled) break;

    try {
      const existingFile = meta.files[filePath];
      if (existingFile && existingFile.chunkIds) {
        await vectorStore.removeDocuments(catalogName, existingFile.chunkIds);
      }
      delete meta.files[filePath];
      removed++;
    } catch (error) {
      console.error(`[Index Manager] Error removing ${filePath}:`, error.message);
      errors++;
    }
  }

  // Process new files
  for (const { path: filePath, rootPath } of newFiles) {
    if (cancellationToken.cancelled) break;

    try {
      // Read as buffer to check for binary content
      const buffer = await fs.readFile(filePath);
      if (isBinaryContent(buffer)) {
        console.log(`[Index Manager] Skipping binary new file: ${filePath}`);
        binarySkippedInRefresh++;
        continue;
      }

      const content = buffer.toString('utf-8');
      const contentHash = generateContentHash(content);
      const relativePath = getRelativePath(rootPath, filePath);

      // Use the advanced splitter factory for intelligent chunking
      const chunkConfig = meta.chunkingConfig || {};
      const chunks = await splitterFactory.splitDocument(content, filePath, chunkConfig);

      const chunkIds = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = chunk.id || generateChunkId(filePath, i);
        chunkIds.push(chunkId);

        const pathContext = `[File: ${relativePath}]`;
        const textWithPath = `${pathContext}\n${chunk.content}`;

        allNewDocuments.push({
          id: chunkId,
          text: textWithPath,
          embeddingText: buildEmbeddingText(textWithPath, chunk),
          metadata: {
            filePath,
            relativePath,
            rootPath,
            fileName: path.basename(filePath),
            chunkIndex: i,
            totalChunks: chunks.length,
            title: chunk.metadata?.title || chunk.metadata?.structureName || null,
            headerLevel: chunk.metadata?.level || null,
            startLine: chunk.startLine || null,
            endLine: chunk.endLine || null,
            fullPath: chunk.metadata?.fullPath || null,
            fileType: chunk.metadata?.fileType || null,
            language: chunk.metadata?.language || null,
            structureType: chunk.metadata?.structureType || null,
            structureName: chunk.metadata?.structureName || null,
            estimatedTokens: chunk.estimatedTokens || null,
            hasOverlap: chunk.metadata?.hasOverlap || false,
            overlapBefore: chunk.metadata?.overlapBefore || '',
            overlapAfter: chunk.metadata?.overlapAfter || ''
          }
        });
      }

      meta.files[filePath] = {
        hash: contentHash,
        chunkIds,
        chunkCount: chunks.length,
        indexedAt: new Date().toISOString(),
        relativePath
      };

      added++;

      if (progressCallback) {
        progressCallback({
          type: 'processing',
          file: path.basename(filePath),
          action: 'adding',
          processed: removed + added + updated,
          total: deletedFiles.length + newFiles.length + modifiedFiles.length
        });
      }
    } catch (error) {
      console.error(`[Index Manager] Error adding ${filePath}:`, error.message);
      errors++;
    }
  }

  // Process modified files
  for (const { path: filePath, rootPath, content, hash: contentHash } of modifiedFiles) {
    if (cancellationToken.cancelled) break;

    try {
      // Remove old chunks
      const existingFile = meta.files[filePath];
      if (existingFile && existingFile.chunkIds) {
        await vectorStore.removeDocuments(catalogName, existingFile.chunkIds);
      }

      const relativePath = getRelativePath(rootPath, filePath);

      // Use the advanced splitter factory for intelligent chunking
      const chunkConfig = meta.chunkingConfig || {};
      const chunks = await splitterFactory.splitDocument(content, filePath, chunkConfig);

      const chunkIds = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = chunk.id || generateChunkId(filePath, i);
        chunkIds.push(chunkId);

        const pathContext = `[File: ${relativePath}]`;
        const textWithPath = `${pathContext}\n${chunk.content}`;

        allNewDocuments.push({
          id: chunkId,
          text: textWithPath,
          embeddingText: buildEmbeddingText(textWithPath, chunk),
          metadata: {
            filePath,
            relativePath,
            rootPath,
            fileName: path.basename(filePath),
            chunkIndex: i,
            totalChunks: chunks.length,
            title: chunk.metadata?.title || chunk.metadata?.structureName || null,
            headerLevel: chunk.metadata?.level || null,
            startLine: chunk.startLine || null,
            endLine: chunk.endLine || null,
            fullPath: chunk.metadata?.fullPath || null,
            fileType: chunk.metadata?.fileType || null,
            language: chunk.metadata?.language || null,
            structureType: chunk.metadata?.structureType || null,
            structureName: chunk.metadata?.structureName || null,
            estimatedTokens: chunk.estimatedTokens || null,
            hasOverlap: chunk.metadata?.hasOverlap || false,
            overlapBefore: chunk.metadata?.overlapBefore || '',
            overlapAfter: chunk.metadata?.overlapAfter || ''
          }
        });
      }

      meta.files[filePath] = {
        hash: contentHash,
        chunkIds,
        chunkCount: chunks.length,
        indexedAt: new Date().toISOString(),
        relativePath
      };

      updated++;

      if (progressCallback) {
        progressCallback({
          type: 'processing',
          file: path.basename(filePath),
          action: 'updating',
          processed: removed + added + updated,
          total: deletedFiles.length + newFiles.length + modifiedFiles.length
        });
      }
    } catch (error) {
      console.error(`[Index Manager] Error updating ${filePath}:`, error.message);
      errors++;
    }
  }

  // Add new documents to vector store
  if (allNewDocuments.length > 0 && !cancellationToken.cancelled) {
    if (progressCallback) {
      progressCallback({
        type: 'embedding',
        message: 'Generating embeddings...',
        total: allNewDocuments.length
      });
    }

    await vectorStore.addDocuments(catalogName, allNewDocuments, progressCallback);
  }

  // Update metadata
  meta.lastUpdated = new Date().toISOString();
  await saveMetadata();

  cancellationTokens.delete(catalogName);

  // Mark refresh as inactive
  setIndexingActive(catalogName, false);

  const result = {
    success: true,
    removed,
    added,
    updated,
    unchanged: unchangedCount.count,
    binarySkipped: binarySkippedInRefresh,
    errors,
    cancelled: cancellationToken.cancelled
  };

  console.log(`[Index Manager] Refresh complete:`, result);
  return result;
}

/**
 * Rename a catalog
 * @param {string} oldName - Current catalog name
 * @param {string} newName - New catalog name
 * @returns {Promise<Object>} Result
 */
async function renameCatalog(oldName, newName) {
  const meta = catalogMeta[oldName];
  if (!meta) {
    throw new Error(`Catalog "${oldName}" not found`);
  }

  if (catalogMeta[newName]) {
    throw new Error(`Catalog "${newName}" already exists`);
  }

  // Note: LanceDB doesn't support renaming tables directly
  // We would need to copy data, but for now just update metadata
  // The underlying table name stays the same

  // Update display name in metadata
  meta.displayName = newName;
  await saveMetadata();

  console.log(`[Index Manager] Renamed catalog "${oldName}" display name to "${newName}"`);

  return { success: true, oldName, newName };
}

/**
 * Add a root path to an existing catalog
 * @param {string} catalogName - Catalog name
 * @param {string} rootPath - New root path to add
 * @returns {Promise<Object>} Result
 */
async function addRootPath(catalogName, rootPath) {
  const meta = catalogMeta[catalogName];
  if (!meta) {
    throw new Error(`Catalog "${catalogName}" not found`);
  }

  if (!meta.rootPaths) {
    meta.rootPaths = meta.rootPath ? [meta.rootPath] : [];
  }

  if (!meta.rootPaths.includes(rootPath)) {
    meta.rootPaths.push(rootPath);
    await saveMetadata();
    console.log(`[Index Manager] Added root path "${rootPath}" to catalog "${catalogName}"`);
  }

  return { success: true, rootPaths: meta.rootPaths };
}

/**
 * Update catalog extensions
 * Used when adding to an existing catalog with different extension selection
 * @param {string} catalogName - Catalog name
 * @param {string[]} extensions - New extensions array
 * @returns {Promise<Object>} Result
 */
async function updateCatalogExtensions(catalogName, extensions) {
  const meta = catalogMeta[catalogName];
  if (!meta) {
    throw new Error(`Catalog "${catalogName}" not found`);
  }

  // Merge new extensions with existing ones (don't lose existing)
  const existingExtensions = new Set(meta.extensions || []);
  for (const ext of extensions) {
    existingExtensions.add(ext);
  }

  meta.extensions = [...existingExtensions];
  await saveMetadata();

  console.log(`[Index Manager] Updated extensions for catalog "${catalogName}": ${meta.extensions.join(', ')}`);

  return { success: true, extensions: meta.extensions };
}

/**
 * Remove a root path from a catalog
 * @param {string} catalogName - Catalog name
 * @param {string} rootPath - Root path to remove
 * @returns {Promise<Object>} Result
 */
async function removeRootPath(catalogName, rootPath) {
  const meta = catalogMeta[catalogName];
  if (!meta) {
    throw new Error(`Catalog "${catalogName}" not found`);
  }

  if (!meta.rootPaths) {
    return { success: true, rootPaths: [] };
  }

  const index = meta.rootPaths.indexOf(rootPath);
  if (index > -1) {
    meta.rootPaths.splice(index, 1);
    // Also update legacy rootPath if it matches
    if (meta.rootPath === rootPath) {
      meta.rootPath = meta.rootPaths[0] || null;
    }
    await saveMetadata();
    console.log(`[Index Manager] Removed root path "${rootPath}" from catalog "${catalogName}"`);
  }

  return { success: true, rootPaths: meta.rootPaths };
}

/**
 * Normalize a string by removing separators and lowercasing
 * @param {string} str - String to normalize
 * @returns {string} Normalized string
 */
function normalizeForMatch(str) {
  if (!str) return '';
  // Split camelCase: "UATAgent" -> "uat agent"
  let normalized = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Remove common separators and collapse whitespace
  normalized = normalized.replace(/[._\-\/\\]/g, ' ').toLowerCase().replace(/\s+/g, '');
  return normalized;
}

/**
 * Split a string into segments (camelCase + separator boundaries)
 * @param {string} str - String to segment
 * @returns {string[]} Segments
 */
function getSegments(str) {
  if (!str) return [];
  // Split camelCase
  let expanded = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Split on separators
  expanded = expanded.replace(/[._\-\/\\]/g, ' ');
  return expanded.toLowerCase().split(/\s+/).filter(s => s.length >= 2);
}

/**
 * Find a catalog by fuzzy name matching
 * Matching priority: exact > case-insensitive stripped > display name > segment match
 * @param {string} query - Search query (e.g., "uatagent", "UAT Agent")
 * @returns {Promise<Object|null>} Matched catalog info { name, displayName, matchType } or null
 */
async function findCatalog(query) {
  if (!query) return null;

  const catalogs = await vectorStore.listCollections();
  if (catalogs.length === 0) return null;

  // 1. Exact match
  if (catalogs.includes(query)) {
    const meta = catalogMeta[query] || {};
    return { name: query, displayName: meta.displayName || query, matchType: 'exact' };
  }

  // 2. Case-insensitive, separator-stripped match
  const queryNorm = normalizeForMatch(query);
  for (const name of catalogs) {
    if (normalizeForMatch(name) === queryNorm) {
      const meta = catalogMeta[name] || {};
      return { name, displayName: meta.displayName || name, matchType: 'normalized' };
    }
  }

  // 3. Display name match
  for (const name of catalogs) {
    const meta = catalogMeta[name] || {};
    const displayName = meta.displayName || name;
    if (normalizeForMatch(displayName) === queryNorm) {
      return { name, displayName, matchType: 'displayName' };
    }
  }

  // 4. Segment match - all query segments must appear in catalog name segments
  const querySegments = getSegments(query);
  if (querySegments.length > 0) {
    let bestMatch = null;
    let bestScore = 0;

    for (const name of catalogs) {
      const meta = catalogMeta[name] || {};
      const displayName = meta.displayName || name;
      const nameSegments = getSegments(name);
      const displaySegments = getSegments(displayName);
      const allSegments = [...new Set([...nameSegments, ...displaySegments])];

      // Count how many query segments match
      let matchCount = 0;
      for (const qs of querySegments) {
        if (allSegments.some(s => s.includes(qs) || qs.includes(s))) {
          matchCount++;
        }
      }

      const score = matchCount / querySegments.length;
      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = { name, displayName, matchType: 'segment', score };
      }
    }

    if (bestMatch) return bestMatch;
  }

  return null;
}

/**
 * Search across a catalog (with fuzzy name fallback)
 * @param {string} catalogName - Catalog name
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Search results
 */
async function search(catalogName, query, options = {}) {
  // Try exact name first
  const collections = await vectorStore.listCollections();
  if (collections.includes(catalogName)) {
    return await vectorStore.search(catalogName, query, options);
  }

  // Fallback to fuzzy matching
  const match = await findCatalog(catalogName);
  if (match) {
    console.log(`[Index Manager] Fuzzy matched "${catalogName}" -> "${match.name}" (${match.matchType})`);
    return await vectorStore.search(match.name, query, options);
  }

  // No match found - throw descriptive error
  throw new Error(`Catalog "${catalogName}" not found`);
}

/**
 * Cancel an ongoing indexing operation
 * @param {string} catalogName - Catalog name
 */
function cancelIndexing(catalogName) {
  const token = cancellationTokens.get(catalogName);
  if (token) {
    token.cancelled = true;
    console.log(`[Index Manager] Cancellation requested for "${catalogName}"`);
  }
}

/**
 * Rebuild a catalog (clear and reindex)
 * @param {string} catalogName - Catalog name
 * @param {Function} progressCallback - Progress callback
 * @returns {Promise<Object>} Result
 */
async function rebuildCatalog(catalogName, progressCallback) {
  const meta = catalogMeta[catalogName];
  if (!meta) {
    throw new Error(`Catalog "${catalogName}" not found`);
  }

  // Clear existing data
  await vectorStore.clearCollection(catalogName);
  meta.files = {};

  // Reindex all files
  return await indexFiles(catalogName, { forceReindex: true }, progressCallback);
}

// Alias for backward compatibility
const rebuildCollection = rebuildCatalog;

/**
 * Get catalog metadata
 * @param {string} catalogName - Catalog name
 * @returns {Object} Catalog metadata
 */
function getCatalogMeta(catalogName) {
  return catalogMeta[catalogName] || null;
}

/**
 * Bulk-update file metadata for a catalog and persist to disk.
 * Used by the enhanced indexer which processes files outside the normal indexManager flow.
 * @param {string} catalogName - Catalog name
 * @param {Object} filesMap - Map of filePath → { hash, chunkIds, chunkCount, indexedAt, relativePath }
 * @param {boolean} clearExisting - If true, replaces all file metadata (for full re-index)
 */
async function updateFilesMeta(catalogName, filesMap, clearExisting = false) {
  const meta = catalogMeta[catalogName];
  if (!meta) return;

  if (clearExisting) {
    meta.files = {};
  }
  if (!meta.files) {
    meta.files = {};
  }

  for (const [filePath, info] of Object.entries(filesMap)) {
    meta.files[filePath] = info;
  }

  meta.lastUpdated = new Date().toISOString();
  await saveMetadata();
}

// Alias for backward compatibility
const getCollectionMeta = getCatalogMeta;

module.exports = {
  initialize,

  // Catalog operations (new names)
  getCatalogs,
  createCatalog,
  deleteCatalog,
  rebuildCatalog,
  getCatalogMeta,
  refreshCatalog,
  renameCatalog,
  addRootPath,
  removeRootPath,
  updateCatalogExtensions,

  // Backward compatibility aliases
  getCollections,
  createCollection,
  deleteCollection,
  rebuildCollection,
  getCollectionMeta,

  // File operations
  indexFiles,
  addFile,
  removeFile,
  search,
  findCatalog,
  cancelIndexing,
  updateFilesMeta,

  // Active indexing status tracking
  setStatusBroadcaster,
  getActiveIndexingOps
};
