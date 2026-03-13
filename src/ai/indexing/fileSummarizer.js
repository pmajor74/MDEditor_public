/**
 * File Summarizer
 * Generates LLM-powered summaries for files during high quality indexing
 */

const path = require('path');
const { withRateLimitRetry } = require('./retryUtils');

// Default max content length to send to LLM
const MAX_CONTENT_LENGTH = 8000;

// Summary prompt template
const SUMMARY_PROMPT = `Analyze this source file and provide a concise summary (2-4 sentences).

Include:
1. The file's primary purpose
2. Key exports, functions, or classes
3. Important dependencies or integrations

File: {fileName}
Path: {filePath}

Content:
{content}

Respond with just the summary text, no JSON or formatting.`;

/**
 * Generate a summary for a single file
 * @param {Object} options - Options
 * @param {string} options.filePath - File path
 * @param {string} options.content - File content
 * @param {Object} options.llmClient - LLM client instance
 * @param {Function} options.onStream - Stream callback (chunk) => void
 * @returns {Promise<Object>} Summary result with text and token usage
 */
async function summarizeFile(options) {
  const { filePath, content, llmClient, onStream } = options;

  const fileName = path.basename(filePath);
  const truncatedContent = content.length > MAX_CONTENT_LENGTH
    ? content.substring(0, MAX_CONTENT_LENGTH) + '\n...[content truncated]'
    : content;

  const prompt = SUMMARY_PROMPT
    .replace('{fileName}', fileName)
    .replace('{filePath}', filePath)
    .replace('{content}', truncatedContent);

  const startTime = Date.now();
  let summary = '';
  let inputTokens = estimateTokens(prompt);
  let outputTokens = 0;

  try {
    summary = await withRateLimitRetry(async () => {
      let result = '';

      if (llmClient.streamMessage) {
        for await (const chunk of llmClient.streamMessage([{ role: 'user', content: prompt }])) {
          result += chunk;
          if (onStream) {
            onStream(chunk);
          }
        }
      } else if (llmClient.sendSimpleMessage) {
        result = await llmClient.sendSimpleMessage(prompt);
        if (onStream) {
          onStream(result);
        }
      } else {
        const response = await llmClient.sendMessage(prompt, '');
        result = response.changeSummary || response.updatedArticle || '';
        if (onStream) {
          onStream(result);
        }
      }

      return result;
    }, `Summary for ${fileName}`);

    outputTokens = estimateTokens(summary);

    return {
      success: true,
      summary: summary.trim(),
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens
      },
      durationMs: Date.now() - startTime
    };

  } catch (error) {
    console.error(`[File Summarizer] Error summarizing ${filePath}:`, error.message);
    return {
      success: false,
      error: error.message,
      summary: null,
      tokenUsage: { input: inputTokens, output: 0, total: inputTokens }
    };
  }
}

/**
 * Batch summarize multiple files
 * @param {Array} files - Array of {filePath, content}
 * @param {Object} llmClient - LLM client
 * @param {Object} callbacks - Callback functions
 * @returns {Promise<Array>} Array of summary results
 */
async function batchSummarize(files, llmClient, callbacks = {}) {
  const { onFileStart, onFileComplete, onStream, onProgress } = callbacks;
  const results = [];
  let totalTokens = { input: 0, output: 0 };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (onFileStart) {
      onFileStart(file.filePath, i, files.length);
    }

    const result = await summarizeFile({
      filePath: file.filePath,
      content: file.content,
      llmClient,
      onStream: (chunk) => {
        if (onStream) {
          onStream(file.filePath, chunk);
        }
      }
    });

    results.push({
      filePath: file.filePath,
      ...result
    });

    if (result.success) {
      totalTokens.input += result.tokenUsage.input;
      totalTokens.output += result.tokenUsage.output;
    }

    if (onFileComplete) {
      onFileComplete(file.filePath, result, i + 1, files.length);
    }

    if (onProgress) {
      onProgress({
        completed: i + 1,
        total: files.length,
        currentFile: file.filePath,
        totalTokens
      });
    }
  }

  return {
    results,
    totalTokens,
    successCount: results.filter(r => r.success).length,
    errorCount: results.filter(r => !r.success).length
  };
}

/**
 * Estimate token count (rough)
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Pre-estimate token cost for files
 * @param {Array} files - Array of {filePath, contentLength}
 * @returns {Object} Estimated tokens
 */
function estimateBatchCost(files) {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const file of files) {
    const contentLength = file.contentLength || 2000;
    // Input: truncated content + prompt overhead
    inputTokens += Math.min(contentLength, MAX_CONTENT_LENGTH) / 4 + 100;
    // Output: ~150 tokens per summary on average
    outputTokens += 150;
  }

  return {
    inputTokens: Math.ceil(inputTokens),
    outputTokens: Math.ceil(outputTokens),
    total: Math.ceil(inputTokens + outputTokens)
  };
}

module.exports = {
  summarizeFile,
  batchSummarize,
  estimateBatchCost,
  estimateTokens
};
