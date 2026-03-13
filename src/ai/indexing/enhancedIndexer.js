/**
 * Enhanced Indexer
 * Multi-tier orchestrator supporting Low/Medium/High quality indexing
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const ignore = require('ignore');
const manifestParser = require('./manifestParser');
const { withRateLimitRetry } = require('./retryUtils');

// Quality tier definitions
const QUALITY_TIERS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

// Default callback that does nothing
const noop = () => {};

/**
 * Build embedding text that includes overlap context for better semantic search
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

// Active task cancellation tokens: taskId -> { cancelled: boolean }
const cancellationTokens = new Map();

/**
 * Cancel an active indexing task
 * @param {string} taskId - Task to cancel
 */
function cancelTask(taskId) {
  const token = cancellationTokens.get(taskId);
  if (token) {
    token.cancelled = true;
    console.log(`[Enhanced Indexer] Cancellation requested for task ${taskId}`);
  } else {
    console.log(`[Enhanced Indexer] No active task found for ${taskId}`);
  }
}

/**
 * Enhanced indexing with quality tiers
 * @param {Object} options - Indexing options
 * @param {string} options.catalogName - Catalog name
 * @param {string} options.qualityLevel - Quality level (low/medium/high)
 * @param {string[]} options.rootPaths - Root paths to index
 * @param {string[]} options.extensions - File extensions to include
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onFileStatus - Per-file status update
 * @param {Function} callbacks.onLLMStream - LLM streaming content
 * @param {Function} callbacks.onPhaseChange - Phase change notification
 * @param {Function} callbacks.onTokenUpdate - Token usage update
 * @param {Function} callbacks.onComplete - Completion callback
 * @param {Object} indexManager - Reference to the index manager module
 * @param {Object} vectorStore - Reference to the vector store module
 * @param {Object} llmClient - Reference to LLM client for high quality
 * @returns {Promise<Object>} Indexing result
 */
async function indexWithQuality(options, callbacks, dependencies) {
  const {
    catalogName,
    qualityLevel = QUALITY_TIERS.LOW,
    rootPaths,
    extensions,
    taskId,
    resumeFromFile = null,
    preScannedFiles = null
  } = options;

  const {
    onFileStatus = noop,
    onFilesDiscovered = noop,
    onLLMStream = noop,
    onPhaseChange = noop,
    onTokenUpdate = noop,
    onComplete = noop
  } = callbacks;

  const { indexManager, vectorStore, llmClient, splitterFactory } = dependencies;

  console.log(`[Enhanced Indexer] Starting ${qualityLevel} quality indexing for ${catalogName}`);

  // Create cancellation token for this task
  const cancellationToken = { cancelled: false };
  cancellationTokens.set(taskId, cancellationToken);

  const startTime = Date.now();
  let result = {
    success: true,
    indexed: 0,
    skipped: 0,
    errors: 0,
    totalFiles: 0,
    tokenUsage: { input: 0, output: 0 }
  };

  try {
    // Phase 1: Scan files (or use pre-scanned list)
    let files;
    if (preScannedFiles && preScannedFiles.length > 0) {
      files = preScannedFiles;
      console.log(`[Enhanced Indexer] Using ${files.length} pre-scanned files`);
    } else {
      onPhaseChange({ taskId, phase: 'scanning', message: 'Scanning for files...' });
      files = await scanFiles(rootPaths, extensions);
    }
    result.totalFiles = files.length;

    console.log(`[Enhanced Indexer] Found ${files.length} files`);

    // Send all files at once so UI can populate the grid in a single render
    onFilesDiscovered({
      taskId,
      files: files.map(f => f.path),
      total: files.length
    });

    // Determine start index for resumption
    let startIndex = 0;
    if (resumeFromFile) {
      startIndex = files.findIndex(f => f.path === resumeFromFile);
      if (startIndex === -1) startIndex = 0;
    }

    // Phase 2: Medium/High - Parse manifests
    let manifestChunks = [];
    if (qualityLevel !== QUALITY_TIERS.LOW) {
      onPhaseChange({ taskId, phase: 'manifests', message: 'Parsing project manifests...' });
      manifestChunks = await manifestParser.createManifestChunks(rootPaths);
      console.log(`[Enhanced Indexer] Created ${manifestChunks.length} manifest chunks`);
    }

    // Phase 3: Find README files for prioritization
    let readmeFiles = [];
    if (qualityLevel !== QUALITY_TIERS.LOW) {
      readmeFiles = files.filter(f =>
        f.name.toLowerCase().includes('readme') &&
        (f.name.endsWith('.md') || f.name.endsWith('.txt'))
      );
      console.log(`[Enhanced Indexer] Found ${readmeFiles.length} README files`);
    }

    // Clear existing data before full re-index to prevent duplicate accumulation
    console.log(`[Enhanced Indexer] Clearing existing collection "${catalogName}" before re-index`);
    await vectorStore.clearCollection(catalogName);

    // Phase 4: Process files
    onPhaseChange({ taskId, phase: 'indexing', message: 'Indexing files...' });

    const allDocuments = [];
    const filesMeta = {};  // Track file metadata for catalog detail view

    // First, add manifest chunks
    if (manifestChunks.length > 0) {
      allDocuments.push(...manifestChunks.map(chunk => ({
        id: chunk.id,
        text: chunk.content,
        metadata: chunk.metadata
      })));
    }

    // Process README files first (priority)
    const processedPaths = new Set();
    for (const readmeFile of readmeFiles) {
      // Mark as processing
      onFileStatus({
        taskId,
        filePath: readmeFile.path,
        status: 'processing',
        processed: result.indexed + result.skipped,
        total: files.length
      });

      const fileResult = await processFile(
        readmeFile,
        catalogName,
        { qualityLevel, llmClient, splitterFactory, onLLMStream, taskId, onTokenUpdate },
        true // isReadme
      );
      if (fileResult) {
        allDocuments.push(...fileResult.documents);
        filesMeta[readmeFile.path] = fileResult.fileMeta;
        processedPaths.add(readmeFile.path);
        result.indexed++;

        // Keep as processing - will be completed after embedding
        onFileStatus({
          taskId,
          filePath: readmeFile.path,
          status: 'processing',
          statusDetail: 'Chunked, waiting for embedding',
          tokens: fileResult.documents.reduce((sum, d) => sum + (d.metadata?.estimatedTokens || 0), 0),
          processed: result.indexed + result.skipped,
          total: files.length
        });
      } else {
        result.skipped++;
        onFileStatus({
          taskId,
          filePath: readmeFile.path,
          status: 'skipped',
          processed: result.indexed + result.skipped,
          total: files.length
        });
      }
    }

    // Process remaining files
    console.log(`[Enhanced Indexer] Processing ${files.length - processedPaths.size} remaining files...`);
    for (let i = startIndex; i < files.length; i++) {
      // Check cancellation
      if (cancellationToken.cancelled) {
        console.log('[Enhanced Indexer] Indexing cancelled during file processing');
        break;
      }

      const file = files[i];

      // Skip if already processed (README)
      if (processedPaths.has(file.path)) {
        continue;
      }

      // Notify processing started
      onFileStatus({
        taskId,
        filePath: file.path,
        status: 'processing',
        processed: result.indexed + result.skipped,
        total: files.length
      });

      try {
        const fileResult = await processFile(
          file,
          catalogName,
          { qualityLevel, llmClient, splitterFactory, onLLMStream, taskId, onTokenUpdate },
          false
        );

        if (fileResult) {
          allDocuments.push(...fileResult.documents);
          filesMeta[file.path] = fileResult.fileMeta;
          result.indexed++;
          console.log(`[Enhanced Indexer] Processed file ${result.indexed}/${files.length}: ${file.name} (${fileResult.documents.length} chunks)`);

          // Keep status as 'processing' - will be 'completed' after embedding succeeds
          onFileStatus({
            taskId,
            filePath: file.path,
            status: 'processing',
            statusDetail: 'Chunked, waiting for embedding',
            tokens: fileResult.documents.reduce((sum, d) => sum + (d.metadata?.estimatedTokens || 0), 0),
            timeMs: Date.now() - startTime,
            processed: result.indexed + result.skipped,
            total: files.length
          });
        } else {
          result.skipped++;
          console.log(`[Enhanced Indexer] Skipped file: ${file.name}`);
          onFileStatus({
            taskId,
            filePath: file.path,
            status: 'skipped',
            processed: result.indexed + result.skipped,
            total: files.length
          });
        }
      } catch (error) {
        console.error(`[Enhanced Indexer] Error processing ${file.path}:`, error.message);
        result.errors++;

        onFileStatus({
          taskId,
          filePath: file.path,
          status: 'error',
          error: error.message,
          processed: result.indexed + result.skipped + result.errors,
          total: files.length
        });
      }
    }

    // Phase 5: Generate embeddings
    if (allDocuments.length > 0 && !cancellationToken.cancelled) {
      console.log(`[Enhanced Indexer] Starting embedding phase for ${allDocuments.length} chunks...`);
      onPhaseChange({ taskId, phase: 'embedding', message: 'Generating embeddings...' });

      // Build map: filePath → last document index (0-based) in allDocuments
      // A file is fully embedded once processed > its last index
      const fileLastChunkIndex = new Map();
      for (let idx = 0; idx < allDocuments.length; idx++) {
        const fp = allDocuments[idx].metadata?.filePath;
        if (fp) {
          fileLastChunkIndex.set(fp, idx); // overwrites → ends up with highest index
        }
      }

      // Track which files have been marked completed during embedding
      const completedFiles = new Set();

      try {
        console.log(`[Enhanced Indexer] Calling vectorStore.addDocuments for catalog: ${catalogName}`);
        await vectorStore.addDocuments(catalogName, allDocuments, (progress) => {
          // Forward embedding progress
          console.log(`[Enhanced Indexer] Embedding progress: ${progress.percent || 0}%`);
          onPhaseChange({
            taskId,
            phase: 'embedding',
            message: `Generating embeddings... ${progress.percent || 0}%`,
            progress: progress.percent
          });

          // Mark files whose last chunk has been embedded
          // progress.processed is 1-based count; lastIdx is 0-based
          for (const [filePath, lastIdx] of fileLastChunkIndex) {
            if (!completedFiles.has(filePath) && progress.processed > lastIdx) {
              completedFiles.add(filePath);
              onFileStatus({
                taskId,
                filePath,
                status: 'completed',
                processed: result.indexed + result.skipped,
                total: files.length
              });
            }
          }
        }, cancellationToken);

        // Safety net: mark any files not caught by progressive completion
        for (const [filePath] of fileLastChunkIndex) {
          if (!completedFiles.has(filePath)) {
            completedFiles.add(filePath);
            onFileStatus({
              taskId, filePath, status: 'completed',
              processed: result.indexed + result.skipped, total: files.length
            });
          }
        }

        console.log(`[Enhanced Indexer] Successfully embedded ${allDocuments.length} chunks from ${fileLastChunkIndex.size} files`);

        // Update catalog metadata with file info so the catalog detail view works
        if (Object.keys(filesMeta).length > 0) {
          await indexManager.updateFilesMeta(catalogName, filesMeta, true);
          console.log(`[Enhanced Indexer] Updated metadata for ${Object.keys(filesMeta).length} files`);
        }

      } catch (embeddingError) {
        console.error('[Enhanced Indexer] Embedding failed:', embeddingError.message);
        console.error('[Enhanced Indexer] Embedding error stack:', embeddingError.stack);

        // Mark only non-completed files as error (already-completed files were persisted)
        for (const [filePath] of fileLastChunkIndex) {
          if (!completedFiles.has(filePath)) {
            onFileStatus({
              taskId, filePath, status: 'error',
              error: `Embedding failed: ${embeddingError.message}`,
              processed: result.indexed + result.skipped, total: files.length
            });
          }
        }

        // Only count files that weren't already completed as errors
        const failedCount = fileLastChunkIndex.size - completedFiles.size;
        result.errors += failedCount;
        result.indexed -= failedCount;

        // Re-throw to let outer catch handle it
        throw embeddingError;
      }
    }

    // Phase 6: Code graph analysis (all quality tiers — fast, no LLM calls)
    if (!cancellationToken.cancelled) {
      onPhaseChange({ taskId, phase: 'analysis', message: 'Building code graph...' });

      try {
        const codeGraphStore = require('../analysis/codeGraphStore');
        const codeGraph = await codeGraphStore.buildCodeGraph({
          catalogName,
          rootPaths,
          extensions,
          onProgress: (progress) => {
            onPhaseChange({
              taskId,
              phase: 'analysis',
              message: progress.message || 'Building code graph...',
              progress: progress.progress
            });
          }
        });

        // Inject searchable summary chunks into LanceDB
        if (codeGraph) {
          const searchableChunks = codeGraphStore.generateSearchableChunks(codeGraph);
          if (searchableChunks.length > 0) {
            console.log(`[Enhanced Indexer] Injecting ${searchableChunks.length} code graph chunks into LanceDB`);
            await vectorStore.addDocuments(catalogName, searchableChunks);
          }
          result.codeGraphStats = codeGraph.stats;
        }
      } catch (analysisError) {
        console.error('[Enhanced Indexer] Code graph analysis failed (non-fatal):', analysisError.message);
        // Non-fatal — indexing continues without code graph
      }
    }

    // Phase 7: High quality - Generate project overview (now enhanced with code graph)
    if (qualityLevel === QUALITY_TIERS.HIGH && llmClient && !cancellationToken.cancelled) {
      onPhaseChange({ taskId, phase: 'overview', message: 'Generating project overview...' });

      // Load code graph if available (built in Phase 6)
      let codeGraph = null;
      try {
        const codeGraphStore = require('../analysis/codeGraphStore');
        codeGraph = await codeGraphStore.loadCodeGraph(catalogName);
      } catch { /* code graph not available */ }

      const overview = await generateProjectOverview(
        allDocuments,
        manifestChunks,
        { llmClient, onLLMStream, taskId, onTokenUpdate, codeGraph }
      );

      if (overview) {
        await vectorStore.addDocuments(catalogName, [{
          id: 'project_overview',
          text: overview,
          metadata: {
            structureType: 'overview',
            fileType: 'generated',
            fileName: 'Project Overview'
          }
        }]);
      }
    }

    result.success = !cancellationToken.cancelled;
    result.cancelled = cancellationToken.cancelled;
    result.durationMs = Date.now() - startTime;

    onComplete({ taskId, summary: result });

  } catch (error) {
    // Don't log cancellation as a failure
    if (error.message === 'Indexing cancelled') {
      console.log('[Enhanced Indexer] Indexing was cancelled');
      result.success = false;
      result.cancelled = true;
    } else {
      console.error('[Enhanced Indexer] Indexing failed:', error);
      result.success = false;
      result.error = error.message;
    }
    onComplete({ taskId, summary: result });
  } finally {
    cancellationTokens.delete(taskId);
  }

  return result;
}

/**
 * Scan files from root paths
 * @param {string[]} rootPaths - Root directories to scan
 * @param {string[]} extensions - File extensions to include (e.g. ['.js', '.ts'])
 * @param {Object} [options] - Scan options
 * @param {number} [options.maxFiles=5000] - Maximum files to return
 * @param {boolean} [options.respectGitignore=true] - Whether to apply .gitignore rules
 */
async function scanFiles(rootPaths, extensions, options = {}) {
  const { maxFiles = 5000, respectGitignore = true } = (typeof options === 'number')
    ? { maxFiles: options }  // backward compat: scanFiles(paths, exts, 5000)
    : options;

  const files = [];

  /**
   * Load .gitignore from a directory and return an ignore instance, or null
   */
  async function loadGitignore(dir) {
    try {
      const content = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8');
      return ignore().add(content);
    } catch {
      return null;
    }
  }

  async function scan(dir, rootPath, parentIg) {
    if (files.length >= maxFiles) return;

    // Load .gitignore in this directory and merge with parent rules
    let ig = parentIg;
    if (respectGitignore) {
      const localIg = await loadGitignore(dir);
      if (localIg) {
        if (ig) {
          // Merge parent + local rules into a new instance
          ig = ignore().add(ig).add(localIg);
        } else {
          ig = localIg;
        }
      }
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= maxFiles) break;

        const fullPath = path.join(dir, entry.name);

        // Skip hidden and common ignore patterns
        if (entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === '__pycache__' ||
            entry.name === 'dist' ||
            entry.name === 'build' ||
            entry.name === '.git') {
          continue;
        }

        // Check .gitignore rules using path relative to root
        if (respectGitignore && ig) {
          const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
          const testPath = entry.isDirectory() ? relativePath + '/' : relativePath;
          if (ig.ignores(testPath)) {
            continue;
          }
        }

        if (entry.isDirectory()) {
          await scan(fullPath, rootPath, ig);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            files.push({
              path: fullPath,
              name: entry.name,
              rootPath,
              relativePath: path.relative(rootPath, fullPath)
            });
          }
        }
      }
    } catch (error) {
      console.error(`[Enhanced Indexer] Error scanning ${dir}:`, error.message);
    }
  }

  for (const rootPath of rootPaths) {
    const stat = await fs.stat(rootPath).catch(() => null);
    if (!stat) continue;

    if (stat.isFile()) {
      // Handle individual file paths directly
      const ext = path.extname(rootPath).toLowerCase();
      if (extensions.includes(ext)) {
        files.push({
          path: rootPath,
          name: path.basename(rootPath),
          rootPath: path.dirname(rootPath),
          relativePath: path.basename(rootPath)
        });
      }
    } else {
      const rootIg = respectGitignore ? await loadGitignore(rootPath) : null;
      await scan(rootPath, rootPath, rootIg);
    }
    if (files.length >= maxFiles) break;
  }

  return files;
}

/**
 * Process a single file
 */
async function processFile(file, catalogName, options, isReadme = false) {
  const { qualityLevel, llmClient, splitterFactory, onLLMStream, taskId, onTokenUpdate } = options;

  try {
    const buffer = await fs.readFile(file.path);
    const ext = require('path').extname(file.path).toLowerCase();

    // PDF files are binary but supported - handle specially
    const isPdf = ext === '.pdf';

    // Check for binary content (skip for PDFs which are expected to be binary)
    if (!isPdf && isBinaryContent(buffer)) {
      console.log(`[Enhanced Indexer] Skipping binary file: ${file.path}`);
      return null;
    }

    // For PDFs, pass raw buffer; for text files, convert to string
    const content = isPdf ? buffer : buffer.toString('utf-8');
    const contentHash = crypto.createHash('md5').update(buffer).digest('hex');

    // Basic chunking - pass options with llmClient for PDF image descriptions
    const splitterOptions = isPdf ? { llmClient, qualityLevel } : {};
    const chunks = await splitterFactory.splitDocument(content, file.path, {}, splitterOptions);

    // For high quality, generate summary
    let summary = null;
    if (qualityLevel === QUALITY_TIERS.HIGH && llmClient && !isPdf) {
      summary = await generateFileSummary(file, content, llmClient, onLLMStream, taskId, onTokenUpdate);
    }

    // Create documents
    const documents = [];

    // Add file summary chunk if available
    if (summary) {
      documents.push({
        id: `summary_${contentHash.substring(0, 8)}`,
        text: `[File Summary: ${file.relativePath}]\n${summary}`,
        metadata: {
          filePath: file.path,
          relativePath: file.relativePath,
          fileName: file.name,
          structureType: 'summary',
          fileType: 'generated',
          isReadme
        }
      });
    }

    // Add content chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = chunk.id || `${contentHash.substring(0, 8)}_${i}`;
      const chunkText = `[File: ${file.relativePath}]\n${chunk.content}`;

      documents.push({
        id: chunkId,
        text: chunkText,
        embeddingText: buildEmbeddingText(chunkText, chunk),
        metadata: {
          filePath: file.path,
          relativePath: file.relativePath,
          fileName: file.name,
          rootPath: file.rootPath,
          chunkIndex: i,
          totalChunks: chunks.length,
          title: chunk.metadata?.title || null,
          headerLevel: chunk.metadata?.level || null,
          startLine: chunk.startLine || null,
          endLine: chunk.endLine || null,
          fileType: chunk.metadata?.fileType || null,
          language: chunk.metadata?.language || null,
          structureType: chunk.metadata?.structureType || null,
          estimatedTokens: chunk.estimatedTokens || null,
          isReadme,
          searchBoost: isReadme ? 1.5 : 1.0,
          overlapBefore: chunk.metadata?.overlapBefore || '',
          overlapAfter: chunk.metadata?.overlapAfter || ''
        }
      });
    }

    return {
      documents,
      fileMeta: {
        hash: contentHash,
        chunkIds: documents.map(d => d.id),
        chunkCount: chunks.length,
        indexedAt: new Date().toISOString(),
        relativePath: file.relativePath
      }
    };

  } catch (error) {
    console.error(`[Enhanced Indexer] Error processing ${file.path}:`, error.message, error.stack);
    // For PDFs, propagate the error so it's reported as an error (not silently skipped)
    const ext = require('path').extname(file.path).toLowerCase();
    if (ext === '.pdf') {
      throw new Error(`PDF processing failed: ${error.message}`);
    }
    return null;
  }
}

/**
 * Generate file summary using LLM
 */
async function generateFileSummary(file, content, llmClient, onLLMStream, taskId, onTokenUpdate) {
  const prompt = `Summarize this file in 2-3 sentences. Include its purpose, key exports/functions, and dependencies if applicable.

File: ${file.relativePath}

Content:
${content.substring(0, 8000)}${content.length > 8000 ? '\n...[truncated]' : ''}`;

  try {
    const summary = await withRateLimitRetry(async () => {
      let result = '';

      if (llmClient.streamMessage) {
        for await (const chunk of llmClient.streamMessage([{ role: 'user', content: prompt }])) {
          result += chunk;
          onLLMStream({ taskId, filePath: file.path, chunk, isComplete: false });
        }
        onLLMStream({ taskId, filePath: file.path, chunk: '', isComplete: true });
      } else {
        const response = await llmClient.sendMessage(prompt, '');
        result = response.changeSummary || response.updatedArticle || '';
      }

      return result;
    }, `Summary for ${file.relativePath}`);

    // Estimate tokens
    const inputTokens = estimateTokens(prompt);
    const outputTokens = estimateTokens(summary);
    onTokenUpdate({ taskId, inputTokens, outputTokens });

    return summary.trim();

  } catch (error) {
    console.error(`[Enhanced Indexer] LLM summary failed for ${file.path}:`, error.message);
    return null;
  }
}

/**
 * Generate project overview from all file summaries (enhanced with code graph)
 */
async function generateProjectOverview(documents, manifestChunks, options) {
  const { llmClient, onLLMStream, taskId, onTokenUpdate, codeGraph } = options;

  // Collect summaries and manifest info
  const summaries = documents
    .filter(d => d.metadata?.structureType === 'summary')
    .map(d => d.text)
    .slice(0, 20);  // Limit to prevent context overflow

  const manifests = manifestChunks.map(c => c.content).join('\n\n');

  // Build code graph context if available
  let codeGraphContext = '';
  if (codeGraph) {
    const parts = [];
    if (codeGraph.stats) {
      parts.push(`Code Analysis: ${codeGraph.stats.totalFiles} files, ${codeGraph.stats.totalSignatures} functions, ${codeGraph.stats.totalEdges} dependency edges`);
    }
    if (codeGraph.directory?.modules) {
      parts.push('Modules: ' + codeGraph.directory.modules.map(m => `${m.path}(${m.fileCount})`).join(', '));
    }
    if (codeGraph.dependencyGraph?.layers) {
      parts.push('Layers: ' + Object.entries(codeGraph.dependencyGraph.layers).map(([l, f]) => `${l}(${f.length})`).join(', '));
    }
    if (codeGraph.dependencyGraph?.entryPoints?.length > 0) {
      parts.push('Entry Points: ' + codeGraph.dependencyGraph.entryPoints.slice(0, 5).join(', '));
    }
    if (codeGraph.directory?.patterns?.buildTool) {
      parts.push(`Build Tool: ${codeGraph.directory.patterns.buildTool}`);
    }
    codeGraphContext = '\n\nCode Analysis:\n' + parts.join('\n');
  }

  const prompt = `Based on these file summaries and project manifests, write a comprehensive project overview (3-5 paragraphs) covering:
1. Project purpose and main functionality
2. Architecture and key components
3. Tech stack and frameworks used
4. Notable patterns or approaches

Manifests:
${manifests}

File Summaries:
${summaries.join('\n\n')}${codeGraphContext}`;

  try {
    const overview = await withRateLimitRetry(async () => {
      let result = '';

      if (llmClient.streamMessage) {
        for await (const chunk of llmClient.streamMessage([{ role: 'user', content: prompt }])) {
          result += chunk;
          onLLMStream({ taskId, filePath: 'Project Overview', chunk, isComplete: false });
        }
        onLLMStream({ taskId, filePath: 'Project Overview', chunk: '', isComplete: true });
      } else {
        const response = await llmClient.sendMessage(prompt, '');
        result = response.changeSummary || response.updatedArticle || '';
      }

      return result;
    }, 'Project overview');

    const inputTokens = estimateTokens(prompt);
    const outputTokens = estimateTokens(overview);
    onTokenUpdate({ taskId, inputTokens, outputTokens });

    return overview.trim();

  } catch (error) {
    console.error('[Enhanced Indexer] Project overview generation failed:', error.message);
    return null;
  }
}

/**
 * Check if content is binary
 */
function isBinaryContent(buffer) {
  // Check first 8KB for null bytes
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Estimate token count (rough approximation)
 */
function estimateTokens(text) {
  if (!text) return 0;
  // Rough estimate: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens for files
 * @param {Array} files - Array of file objects with content
 * @returns {Object} Token estimate
 */
function estimateTokenCost(files) {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const file of files) {
    // Estimate input: file content (up to 8K chars) + prompt
    inputTokens += Math.min(file.contentLength || 2000, 8000) / 4 + 50;
    // Estimate output: ~150 tokens per summary
    outputTokens += 150;
  }

  return {
    inputTokens: Math.ceil(inputTokens),
    outputTokens: Math.ceil(outputTokens),
    total: Math.ceil(inputTokens + outputTokens)
  };
}

module.exports = {
  indexWithQuality,
  scanFiles,
  cancelTask,
  estimateTokenCost,
  QUALITY_TIERS
};
