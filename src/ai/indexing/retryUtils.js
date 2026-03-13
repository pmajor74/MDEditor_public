/**
 * Retry utilities for rate-limited LLM calls during indexing
 */

// Delay schedule for exponential backoff (milliseconds)
const DEFAULT_DELAYS = [5000, 15000, 30000, 60000];

/**
 * Check if an error is a rate limit / quota error
 * @param {Error} error - Error to check
 * @returns {boolean}
 */
function isRateLimitError(error) {
  if (!error) return false;

  // Check HTTP status code
  const status = error.status || error.statusCode || error.code;
  if (status === 429) return true;

  // Check error message patterns
  const msg = (error.message || '').toLowerCase();
  const patterns = [
    'rate limit',
    'rate_limit',
    'too many requests',
    'resource_exhausted',
    'quota exceeded',
    'quota_exceeded',
    'overloaded',
    'throttl',
    '429'
  ];

  return patterns.some(p => msg.includes(p));
}

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap an async function with rate-limit retry logic
 * @param {Function} fn - Async function to call (takes no arguments; caller should bind/close over them)
 * @param {string} label - Label for console logging (e.g. "Summary for foo.js")
 * @param {Object} [options] - Options
 * @param {number[]} [options.delays] - Delay schedule in ms (default: [5s, 15s, 30s, 60s])
 * @param {number} [options.maxRetries] - Max retries (default: delays.length)
 * @returns {Promise<*>} Result of fn(), or null if all retries exhausted
 */
async function withRateLimitRetry(fn, label, options = {}) {
  const delays = options.delays || DEFAULT_DELAYS;
  const maxRetries = options.maxRetries || delays.length;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRateLimitError(error) || attempt >= maxRetries) {
        // Not a rate limit error, or we've exhausted retries — rethrow
        throw error;
      }

      const delay = delays[Math.min(attempt, delays.length - 1)];
      console.log(`[Retry] ${label}: Rate limit hit, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(delay);
    }
  }

  // Should not reach here, but just in case
  throw lastError;
}

module.exports = {
  isRateLimitError,
  withRateLimitRetry,
  sleep
};
