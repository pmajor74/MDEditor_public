/**
 * Azure DevOps Wiki API Client
 *
 * Handles all communication with Azure DevOps REST API for wiki operations.
 * Uses PAT (Personal Access Token) for authentication.
 * Includes caching, timeouts, and retry logic for resilience.
 */

const https = require('https');
const wikiCache = require('../cache/wikiCache');

// API version for Azure DevOps REST API
const API_VERSION = '7.1';

// Request configuration
const DEFAULT_TIMEOUT_MS = 15000; // 15 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 1000; // 1 second base, exponential backoff

/**
 * Check if an error is retryable
 * @param {Error} error - The error to check
 * @returns {boolean} True if the request should be retried
 */
function isRetryableError(error) {
  const message = error.message || '';

  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return true;
  }

  // HTTP status codes that warrant retry
  if (message.includes('API Error 503') || // Service Unavailable
      message.includes('API Error 429') || // Too Many Requests
      message.includes('API Error 500') || // Internal Server Error
      message.includes('API Error 502') || // Bad Gateway
      message.includes('API Error 504')) { // Gateway Timeout
    return true;
  }

  return false;
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after the delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap a function with retry logic
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise} Result of the function
 */
async function withRetry(fn, maxRetries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt < maxRetries - 1 && isRetryableError(error)) {
        const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
        console.log(`[Azure API] Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries}):`, error.message);
        await sleep(delay);
      } else {
        break;
      }
    }
  }

  throw lastError;
}

/**
 * Make an authenticated request to Azure DevOps API with timeout
 * @param {Object} options - Request options
 * @param {*} body - Request body (optional)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise} Response data
 */
async function makeRequest(options, body = null, timeout = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', chunk => { data += chunk; });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ data: data ? JSON.parse(data) : null, headers: res.headers });
          } catch {
            resolve({ data, headers: res.headers });
          }
        } else {
          const error = new Error(`API Error ${res.statusCode}: ${data}`);
          error.statusCode = res.statusCode;
          reject(error);
        }
      });
    });

    // Set timeout
    req.setTimeout(timeout, () => {
      req.destroy();
      const error = new Error(`Request timeout after ${timeout}ms`);
      error.code = 'ETIMEDOUT';
      reject(error);
    });

    req.on('error', (err) => {
      // Enhance error with code if not present
      if (!err.code) {
        err.code = 'UNKNOWN';
      }
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Create authorization header from PAT
 */
function createAuthHeader(pat) {
  const token = Buffer.from(`:${pat}`).toString('base64');
  return `Basic ${token}`;
}

/**
 * Build request options for Azure DevOps API
 */
function buildOptions(org, path, pat, method = 'GET', additionalHeaders = {}) {
  return {
    hostname: 'dev.azure.com',
    path: `/${org}${path}`,
    method,
    headers: {
      'Authorization': createAuthHeader(pat),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...additionalHeaders
    }
  };
}

/**
 * Validate connection credentials
 */
async function validateConnection(org, project, pat) {
  try {
    const path = `/${project}/_apis/wiki/wikis?api-version=${API_VERSION}`;
    const options = buildOptions(org, path, pat);
    await makeRequest(options);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get list of wikis in a project
 */
async function getWikis(org, project, pat) {
  const path = `/${project}/_apis/wiki/wikis?api-version=${API_VERSION}`;
  const options = buildOptions(org, path, pat);
  const { data } = await makeRequest(options);
  return data.value || [];
}

/**
 * Get wiki page tree with caching and retry logic
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} pat - Personal Access Token
 * @param {string} wikiId - Wiki identifier
 * @param {string} pagePath - Page path
 * @param {boolean} forceRefresh - Skip cache and fetch fresh data
 * @param {string} recursionLevel - Recursion level: 'oneLevel' (default), 'oneLevelPlusNestedEmptyFolders', or 'full'
 * @returns {Object} Wiki tree data
 */
async function getWikiPages(org, project, pat, wikiId, pagePath = '/', forceRefresh = false, recursionLevel = 'oneLevel') {
  // Check cache first (unless force refresh)
  // Include recursionLevel in cache key to avoid serving partial data as full
  const cacheKey = `${pagePath}:${recursionLevel}`;
  if (!forceRefresh) {
    const cached = wikiCache.get(org, project, wikiId, cacheKey);
    if (cached) {
      console.log('[Azure API] Cache hit for:', { pagePath, recursionLevel });
      return cached;
    }
  }

  // Fetch from API with retry logic
  const fetchData = async () => {
    const encodedPath = encodeURIComponent(pagePath);
    const apiPath = `/${project}/_apis/wiki/wikis/${wikiId}/pages?path=${encodedPath}&recursionLevel=${recursionLevel}&api-version=${API_VERSION}`;
    console.log('[Azure API] getWikiPages:', { org, project, wikiId, pagePath, forceRefresh, recursionLevel });
    console.log('[Azure API] Full URL:', `https://dev.azure.com/${org}${apiPath}`);
    const options = buildOptions(org, apiPath, pat);
    const { data } = await makeRequest(options);
    console.log('[Azure API] Response:', JSON.stringify(data, null, 2).substring(0, 1000));
    console.log('[Azure API] Response subPages count:', data?.subPages?.length || 0);
    return data;
  };

  const data = await withRetry(fetchData);

  // Cache the result with recursionLevel in key
  wikiCache.set(org, project, wikiId, cacheKey, data);

  return data;
}

/**
 * Invalidate wiki tree cache for a specific path or entire wiki
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} wikiId - Wiki identifier
 * @param {string} path - Specific path to invalidate (null for entire wiki)
 */
function invalidateWikiCache(org, project, wikiId, path = null) {
  wikiCache.invalidate(org, project, wikiId, path);
}

/**
 * Clear all wiki caches (call on disconnect)
 * @param {string} org - Azure DevOps organization (optional, clears all if not provided)
 */
function clearWikiCache(org = null) {
  if (org) {
    wikiCache.clearOrg(org);
    wikiCache.clearPageContentCache(org);
  } else {
    wikiCache.clear();
    wikiCache.clearPageContentCache();
  }
}

/**
 * Get page content (with LRU caching)
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} pat - Personal Access Token
 * @param {string} wikiId - Wiki identifier
 * @param {string} pagePath - Page path
 * @param {boolean} skipCache - Skip cache and fetch fresh data
 */
async function getPageContent(org, project, pat, wikiId, pagePath, skipCache = false) {
  // Check cache first (unless skipping)
  if (!skipCache) {
    const cached = wikiCache.getPageContent(org, project, wikiId, pagePath);
    if (cached) {
      return {
        content: cached.content,
        eTag: cached.eTag,
        page: { path: pagePath },
        cached: true
      };
    }
  }

  // Fetch from API
  const encodedPath = encodeURIComponent(pagePath);
  const path = `/${project}/_apis/wiki/wikis/${wikiId}/pages?path=${encodedPath}&includeContent=true&api-version=${API_VERSION}`;
  const options = buildOptions(org, path, pat);
  const { data, headers } = await makeRequest(options);

  const result = {
    content: data.content || '',
    eTag: headers.etag || headers['etag'],
    page: data
  };

  // Cache the result
  wikiCache.setPageContent(org, project, wikiId, pagePath, result.content, result.eTag);

  return result;
}

/**
 * Update page content (invalidates cache on success)
 */
async function updatePageContent(org, project, pat, wikiId, pagePath, content, eTag) {
  const encodedPath = encodeURIComponent(pagePath);
  const path = `/${project}/_apis/wiki/wikis/${wikiId}/pages?path=${encodedPath}&api-version=${API_VERSION}`;

  const additionalHeaders = {};
  if (eTag) {
    additionalHeaders['If-Match'] = eTag;
  }

  const options = buildOptions(org, path, pat, 'PUT', additionalHeaders);
  const { data, headers } = await makeRequest(options, { content });

  const newETag = headers.etag || headers['etag'];

  // Invalidate old cache and store new content
  wikiCache.invalidatePageContent(org, project, wikiId, pagePath);
  wikiCache.setPageContent(org, project, wikiId, pagePath, content, newETag);

  return {
    page: data,
    eTag: newETag
  };
}

/**
 * Check if page has been modified remotely
 */
async function checkForConflict(org, project, pat, wikiId, pagePath, localETag) {
  try {
    const { eTag: remoteETag } = await getPageContent(org, project, pat, wikiId, pagePath);
    return remoteETag !== localETag;
  } catch {
    return false;
  }
}

/**
 * Create a new wiki page
 */
async function createPage(org, project, pat, wikiId, pagePath, content) {
  const encodedPath = encodeURIComponent(pagePath);
  const path = `/${project}/_apis/wiki/wikis/${wikiId}/pages?path=${encodedPath}&api-version=${API_VERSION}`;
  const options = buildOptions(org, path, pat, 'PUT');
  const { data } = await makeRequest(options, { content });
  return data;
}

/**
 * Delete a wiki page
 */
async function deletePage(org, project, pat, wikiId, pagePath) {
  const encodedPath = encodeURIComponent(pagePath);
  const path = `/${project}/_apis/wiki/wikis/${wikiId}/pages?path=${encodedPath}&api-version=${API_VERSION}`;
  const options = buildOptions(org, path, pat, 'DELETE');
  await makeRequest(options);
  return true;
}

/**
 * Get a wiki page by its numeric ID
 * This is useful for resolving page paths from URLs
 */
async function getPageById(org, project, pat, wikiId, pageId) {
  const apiPath = `/${project}/_apis/wiki/wikis/${wikiId}/pages/${pageId}?api-version=${API_VERSION}`;
  console.log('[Azure API] getPageById:', { org, project, wikiId, pageId });
  const options = buildOptions(org, apiPath, pat);
  const { data } = await makeRequest(options);
  console.log('[Azure API] Page found:', { path: data?.path, id: data?.id });
  return data;
}

/**
 * Make a binary request to Azure DevOps API (for attachments/images)
 */
async function makeBinaryRequest(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];

      res.on('data', chunk => { chunks.push(chunk); });

      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({
            buffer,
            contentType: res.headers['content-type'] || 'application/octet-stream',
            statusCode: res.statusCode
          });
        } else {
          reject(new Error(`API Error ${res.statusCode}: ${buffer.toString()}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Cache for wiki repository IDs
const wikiRepoCache = new Map();

/**
 * Get the repository ID for a wiki
 * Wikis are backed by git repositories with GUIDs
 */
async function getWikiRepositoryId(org, project, wikiId, pat) {
  const cacheKey = `${org}/${project}/${wikiId}`;
  if (wikiRepoCache.has(cacheKey)) {
    return wikiRepoCache.get(cacheKey);
  }

  try {
    // Get wiki details which includes the repositoryId
    const path = `/${project}/_apis/wiki/wikis/${wikiId}?api-version=${API_VERSION}`;
    const options = buildOptions(org, path, pat);
    const { data } = await makeRequest(options);

    // The repositoryId is the GUID of the git repository backing the wiki
    const repoId = data.repositoryId || data.id;
    console.log('[Azure API] Wiki repository ID:', repoId);

    wikiRepoCache.set(cacheKey, repoId);
    return repoId;
  } catch (error) {
    console.error('[Azure API] Failed to get wiki repository ID:', error.message);
    return null;
  }
}

/**
 * Get a wiki attachment (image or file)
 * Wiki attachments are stored in the wiki's git repository under .attachments/
 */
async function getAttachment(org, project, wikiId, filename, pat) {
  try {
    // First, get the actual repository ID for the wiki
    const repoId = await getWikiRepositoryId(org, project, wikiId, pat);
    if (!repoId) {
      return { success: false, error: 'Could not determine wiki repository ID' };
    }

    // Wiki attachments are stored in the wiki's git repository
    // The path format is: .attachments/{filename}
    // Decode first in case the filename is already URL-encoded (e.g., %20 for spaces)
    const decodedFilename = decodeURIComponent(filename);
    const attachmentPath = `/.attachments/${decodedFilename}`;
    const encodedPath = encodeURIComponent(attachmentPath);

    // Use the git items API with the actual repository GUID
    // $format=octetStream is required to get raw binary content
    // versionDescriptor.version=wikiMaster specifies the wiki branch
    const apiPath = `/${project}/_apis/git/repositories/${repoId}/items?path=${encodedPath}&$format=octetStream&versionDescriptor.version=wikiMaster&versionDescriptor.versionType=branch&api-version=${API_VERSION}`;

    console.log('[Azure API] getAttachment:', { org, project, repoId, filename: decodedFilename });
    console.log('[Azure API] Attachment URL:', `https://dev.azure.com/${org}${apiPath}`);

    let buffer, contentType;

    try {
      // Try git items API with $format=octetStream
      const options = {
        hostname: 'dev.azure.com',
        path: `/${org}${apiPath}`,
        method: 'GET',
        headers: {
          'Authorization': createAuthHeader(pat),
          'Accept': 'application/octet-stream'
        }
      };

      const result = await makeBinaryRequest(options);
      buffer = result.buffer;
      contentType = result.contentType;
    } catch (gitError) {
      console.log('[Azure API] Git items API failed:', gitError.message);
      console.log('[Azure API] Trying wiki blobs API...');

      // Fallback: Try wiki-specific blobs API
      // This endpoint is specifically for wiki attachments
      const wikiApiPath = `/${project}/_apis/wiki/wikis/${encodeURIComponent(wikiId)}/attachments?name=${encodeURIComponent(filename)}&api-version=${API_VERSION}`;

      const wikiOptions = {
        hostname: 'dev.azure.com',
        path: `/${org}${wikiApiPath}`,
        method: 'GET',
        headers: {
          'Authorization': createAuthHeader(pat),
          'Accept': 'application/octet-stream'
        }
      };

      try {
        const result = await makeBinaryRequest(wikiOptions);
        buffer = result.buffer;
        contentType = result.contentType;
      } catch (wikiError) {
        console.log('[Azure API] Wiki blobs API failed:', wikiError.message);
        console.log('[Azure API] Trying direct path...');

        // Final fallback: Try direct repository path without leading slash
        const directPath = `/${project}/_apis/git/repositories/${repoId}/items?path=${encodeURIComponent('.attachments/' + filename)}&$format=octetStream&versionDescriptor.version=wikiMaster&versionDescriptor.versionType=branch&api-version=${API_VERSION}`;

        const directOptions = {
          hostname: 'dev.azure.com',
          path: `/${org}${directPath}`,
          method: 'GET',
          headers: {
            'Authorization': createAuthHeader(pat),
            'Accept': 'application/octet-stream'
          }
        };

        const result = await makeBinaryRequest(directOptions);
        buffer = result.buffer;
        contentType = result.contentType;
      }
    }

    // Determine the proper MIME type for images
    let mimeType = contentType;
    if (contentType === 'application/octet-stream') {
      // Infer from filename extension
      const ext = filename.split('.').pop()?.toLowerCase();
      const mimeTypes = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'bmp': 'image/bmp'
      };
      mimeType = mimeTypes[ext] || 'application/octet-stream';
    }

    // Convert to base64 data URL
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    console.log('[Azure API] Attachment fetched successfully:', filename, `(${buffer.length} bytes)`);
    return { success: true, dataUrl };
  } catch (error) {
    console.error('[Azure API] getAttachment error:', error.message);
    // Provide helpful message for 401 errors
    if (error.message.includes('401')) {
      console.error('[Azure API] 401 Unauthorized - Your PAT may need "Code (Read)" scope to access wiki attachments');
      return {
        success: false,
        error: 'Unauthorized - PAT may need "Code (Read)" scope to access wiki attachments'
      };
    }
    return { success: false, error: error.message };
  }
}

/**
 * Convert wiki page path to Git repository file path
 * Wiki pages store spaces as hyphens in the actual Git repo
 * @param {string} pagePath - Wiki page path (e.g., "/Folder Name/Page Name")
 * @returns {string} Git file path (e.g., "Folder-Name/Page-Name.md")
 */
function wikiPathToGitPath(pagePath) {
  // Remove leading slash
  let gitPath = pagePath.startsWith('/') ? pagePath.substring(1) : pagePath;

  // Replace spaces with hyphens (Azure DevOps wiki convention)
  gitPath = gitPath.split('/').map(segment => segment.replace(/ /g, '-')).join('/');

  // Add .md extension if not present
  if (!gitPath.endsWith('.md')) {
    gitPath = gitPath + '.md';
  }

  return gitPath;
}

/**
 * Convert Git repository path to wiki page path
 * Reverses the hyphen-to-space conversion used in Azure Wiki git paths
 * @param {string} gitPath - Git path (e.g., "/IT---App-Delivery-Home-Page/Page-Name.md")
 * @returns {string} Wiki path (e.g., "/IT - App Delivery Home Page/Page Name")
 */
function gitPathToWikiPath(gitPath) {
  // Remove .md extension if present
  let wikiPath = gitPath.replace(/\.md$/, '');

  // Process each path segment
  wikiPath = wikiPath.split('/').map(segment => {
    // First, handle the special case of " - " which becomes "---" in git
    // We use a placeholder to avoid conflicts
    let result = segment.replace(/---/g, '\x00DASH\x00');

    // Then replace remaining single hyphens with spaces
    // But be careful: some hyphens are intentional (like in "dead-page")
    // Heuristic: replace hyphens that are between word characters
    result = result.replace(/-/g, ' ');

    // Restore the " - " pattern
    result = result.replace(/\x00DASH\x00/g, ' - ');

    return result;
  }).join('/');

  return wikiPath;
}

/**
 * Get page revision history
 * Wiki pages are stored in a Git repository, so we use the Git commits API
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} pat - Personal Access Token
 * @param {string} wikiId - Wiki identifier
 * @param {string} pagePath - Page path
 * @param {number} [maxResults=50] - Maximum number of commits to return
 * @returns {Array} Array of commit objects
 */
async function getPageHistory(org, project, pat, wikiId, pagePath, maxResults = 50) {
  // First get the repository ID for this wiki
  const repoId = await getWikiRepositoryId(org, project, wikiId, pat);
  if (!repoId) {
    throw new Error('Could not determine wiki repository ID');
  }

  console.log('[Azure API] getPageHistory - repoId:', repoId);

  // DIAGNOSTIC: First test if we can access ANY commits from the wiki repo
  // This verifies permissions before trying path-specific queries
  try {
    const testApiPath = `/${project}/_apis/git/repositories/${repoId}/commits?searchCriteria.$top=1&api-version=${API_VERSION}`;
    console.log('[Azure API] Testing repo access (no path filter)...');
    const testOptions = buildOptions(org, testApiPath, pat);
    const { data: testData } = await makeRequest(testOptions);
    console.log('[Azure API] Repo access OK - found commits:', testData.value?.length || 0);
  } catch (testError) {
    console.log('[Azure API] DIAGNOSTIC: Cannot access wiki repo commits at all:', testError.message);
    console.log('[Azure API] This indicates a permissions issue - PAT may need "Code (Read)" scope');
    throw new Error('Cannot access wiki repository. Ensure PAT has "Code (Read)" permission.');
  }

  // Get the gitItemPath from the wiki page API (it has the correct encoding)
  const pageInfo = await getWikiPageInfo(org, project, pat, wikiId, pagePath);
  if (!pageInfo || !pageInfo.gitItemPath) {
    throw new Error('Could not determine git path for wiki page');
  }

  console.log('[Azure API] Page info from API:', {
    path: pageInfo.path,
    gitItemPath: pageInfo.gitItemPath,
    id: pageInfo.id
  });

  // Try multiple path formats - Azure DevOps can be picky about exact format
  const pathVariations = [
    // 1. Fully decoded path (e.g., "IT---App-Delivery-Home-Page/Page-Name.md")
    decodeURIComponent(pageInfo.gitItemPath).replace(/^\//, ''),
    // 2. With leading slash
    decodeURIComponent(pageInfo.gitItemPath),
    // 3. Just the page name with .md extension
    pagePath.replace(/\//g, '/').replace(/ /g, '-') + '.md',
    // 4. The raw gitItemPath without leading slash
    pageInfo.gitItemPath.replace(/^\//, ''),
  ];

  console.log('[Azure API] Will try path variations:', pathVariations);

  // Try each path variation
  for (const pathToTry of pathVariations) {
    try {
      const apiPath = `/${project}/_apis/git/repositories/${repoId}/commits?searchCriteria.itemPath=${encodeURIComponent(pathToTry)}&searchCriteria.$top=${maxResults}&api-version=${API_VERSION}`;

      console.log('[Azure API] Trying path:', pathToTry);

      const options = buildOptions(org, apiPath, pat);
      const { data } = await makeRequest(options);

      if (data.value && data.value.length > 0) {
        console.log('[Azure API] SUCCESS with path:', pathToTry);
        console.log('[Azure API] Found', data.value.length, 'commits');

        // Transform commits to a simpler format
        const commits = data.value.map(commit => ({
          commitId: commit.commitId,
          author: commit.author?.name || 'Unknown',
          authorEmail: commit.author?.email,
          date: commit.author?.date,
          message: commit.comment || 'No message',
          shortId: commit.commitId?.substring(0, 7)
        }));

        return commits;
      } else {
        console.log('[Azure API] Path returned empty results:', pathToTry);
      }
    } catch (error) {
      console.log('[Azure API] Path failed:', pathToTry, '-', error.message);
      // Continue to next variation
    }
  }

  // If we get here, we could access the repo but couldn't find commits for this file
  // Let's try to list files in the repo to help debug
  try {
    console.log('[Azure API] Attempting to list repo items for debugging...');
    const itemsApiPath = `/${project}/_apis/git/repositories/${repoId}/items?recursionLevel=oneLevel&api-version=${API_VERSION}`;
    const itemsOptions = buildOptions(org, itemsApiPath, pat);
    const { data: itemsData } = await makeRequest(itemsOptions);
    console.log('[Azure API] Root items in wiki repo:', itemsData.value?.map(i => i.path).slice(0, 10));
  } catch (itemsError) {
    console.log('[Azure API] Could not list repo items:', itemsError.message);
  }

  console.log('[Azure API] No commits found for any path variation');
  return [];
}

/**
 * Get wiki page info including gitItemPath
 */
async function getWikiPageInfo(org, project, pat, wikiId, pagePath) {
  const encodedPath = encodeURIComponent(pagePath);
  const apiPath = `/${project}/_apis/wiki/wikis/${wikiId}/pages?path=${encodedPath}&api-version=${API_VERSION}`;

  const options = buildOptions(org, apiPath, pat);
  const { data } = await makeRequest(options);
  return data;
}

/**
 * Get page content at a specific version (commit)
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} pat - Personal Access Token
 * @param {string} wikiId - Wiki identifier
 * @param {string} pagePath - Page path
 * @param {string} commitId - Git commit ID
 * @returns {Object} Page content at that version
 */
async function getPageAtVersion(org, project, pat, wikiId, pagePath, commitId) {
  // First get the repository ID for this wiki
  const repoId = await getWikiRepositoryId(org, project, wikiId, pat);
  if (!repoId) {
    throw new Error('Could not determine wiki repository ID');
  }

  // Get the gitItemPath from the wiki page API (it has the correct encoding)
  const pageInfo = await getWikiPageInfo(org, project, pat, wikiId, pagePath);
  if (!pageInfo || !pageInfo.gitItemPath) {
    throw new Error('Could not determine git path for wiki page');
  }

  // The gitItemPath contains special encoding like %2D for dashes in folder names
  // We need to preserve this encoding - use the raw path without decoding
  let rawGitPath = pageInfo.gitItemPath;
  if (rawGitPath.startsWith('/')) {
    rawGitPath = rawGitPath.substring(1);
  }

  console.log('[Azure API] getPageAtVersion:', {
    pagePath,
    rawGitPath,
    commitId: commitId.substring(0, 7)
  });

  // Try the raw path first (with %2D encoding preserved)
  const pathsToTry = [
    rawGitPath,
    decodeURIComponent(rawGitPath)
  ];

  for (const gitPath of pathsToTry) {
    try {
      const encodedPath = encodeURIComponent(gitPath);
      const apiPath = `/${project}/_apis/git/repositories/${repoId}/items?path=${encodedPath}&versionDescriptor.version=${commitId}&versionDescriptor.versionType=commit&api-version=${API_VERSION}`;

      console.log('[Azure API] Trying version path:', gitPath);

      const options = buildOptions(org, apiPath, pat);
      const { data } = await makeRequest(options);

      console.log('[Azure API] SUCCESS getting version with path:', gitPath);
      console.log('[Azure API] Response type:', typeof data);
      console.log('[Azure API] Response data:', typeof data === 'string' ? data.substring(0, 200) : JSON.stringify(data).substring(0, 500));

      // The API may return metadata (JSON) or raw content (string)
      // If it returns metadata, we need to make another request with $format=text
      if (typeof data === 'object' && data.objectId) {
        // Got metadata, need to fetch actual content
        console.log('[Azure API] Got metadata, fetching actual content with $format=text...');
        const contentApiPath = `/${project}/_apis/git/repositories/${repoId}/items?path=${encodedPath}&versionDescriptor.version=${commitId}&versionDescriptor.versionType=commit&$format=text&api-version=${API_VERSION}`;
        const contentOptions = buildOptions(org, contentApiPath, pat);
        const { data: contentData } = await makeRequest(contentOptions);
        console.log('[Azure API] Content fetched, length:', contentData?.length);
        return {
          content: typeof contentData === 'string' ? contentData : '',
          commitId
        };
      }

      // The API returns the raw content as a string for text files
      return {
        content: typeof data === 'string' ? data : data.content || '',
        commitId
      };
    } catch (error) {
      console.log('[Azure API] Version path failed:', gitPath, '-', error.message);
      // Try next path
    }
  }

  throw new Error(`Could not retrieve page content at version ${commitId.substring(0, 7)}`);
}

/**
 * Generate a unique filename for uploads
 * Adds timestamp and short ID to ensure uniqueness
 * @param {string} originalName - Original filename
 * @param {string} mimeType - MIME type (for extension fallback)
 * @returns {string} Unique filename
 */
function generateUniqueFilename(originalName, mimeType) {
  // Get extension from original name or mime type
  const originalExt = originalName.split('.').pop()?.toLowerCase();
  const mimeExt = mimeType?.split('/').pop()?.toLowerCase();
  const ext = originalExt || mimeExt || 'png';

  // Clean the base name (remove extension, replace special chars)
  const baseName = originalName
    .replace(/\.[^/.]+$/, '') // Remove extension
    .replace(/[^a-zA-Z0-9-_]/g, '-') // Replace special chars with hyphen
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    || 'image'; // Default if nothing left

  // Generate timestamp and short ID for uniqueness
  const timestamp = Date.now();
  const shortId = Math.random().toString(36).substring(2, 8);

  return `${baseName}-${timestamp}-${shortId}.${ext}`;
}

/**
 * Make a binary upload request to Azure DevOps API
 * @param {Object} options - HTTPS request options
 * @param {Buffer} buffer - Binary data to upload
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise} Response data
 */
async function makeBinaryUploadRequest(options, buffer, timeout = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', chunk => { data += chunk; });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ data: data ? JSON.parse(data) : null, statusCode: res.statusCode });
          } catch {
            resolve({ data, statusCode: res.statusCode });
          }
        } else {
          const error = new Error(`API Error ${res.statusCode}: ${data}`);
          error.statusCode = res.statusCode;
          reject(error);
        }
      });
    });

    // Set timeout
    req.setTimeout(timeout, () => {
      req.destroy();
      const error = new Error(`Upload timeout after ${timeout}ms`);
      error.code = 'ETIMEDOUT';
      reject(error);
    });

    req.on('error', (err) => {
      if (!err.code) {
        err.code = 'UNKNOWN';
      }
      reject(err);
    });

    // Write binary data
    req.write(buffer);
    req.end();
  });
}

/**
 * Make a binary upload request using base64 string data
 * Azure Wiki Attachments API expects base64-encoded content in the body
 * @param {Object} options - HTTPS request options
 * @param {string} base64Data - Base64 encoded string data
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise} Response data
 */
async function makeBase64UploadRequest(options, base64Data, timeout = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', chunk => { data += chunk; });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ data: data ? JSON.parse(data) : null, statusCode: res.statusCode });
          } catch {
            resolve({ data, statusCode: res.statusCode });
          }
        } else {
          const error = new Error(`API Error ${res.statusCode}: ${data}`);
          error.statusCode = res.statusCode;
          reject(error);
        }
      });
    });

    // Set timeout
    req.setTimeout(timeout, () => {
      req.destroy();
      const error = new Error(`Upload timeout after ${timeout}ms`);
      error.code = 'ETIMEDOUT';
      reject(error);
    });

    req.on('error', (err) => {
      if (!err.code) {
        err.code = 'UNKNOWN';
      }
      reject(err);
    });

    // Write base64 string data as UTF-8
    req.write(base64Data, 'utf8');
    req.end();
  });
}

/**
 * Upload an attachment to Azure DevOps Wiki
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} pat - Personal Access Token
 * @param {string} wikiId - Wiki identifier
 * @param {string} filename - Target filename for the attachment
 * @param {string} base64Data - File data as base64 string (Azure expects base64 in body)
 * @returns {Object} Result with success, path, or error
 */
async function uploadAttachment(org, project, pat, wikiId, filename, base64Data) {
  try {
    // Validate file size (10MB max for wiki attachments, base64 is ~4/3 of original)
    const estimatedOriginalSize = Math.ceil(base64Data.length * 3 / 4);
    const MAX_SIZE = 10 * 1024 * 1024;
    if (estimatedOriginalSize > MAX_SIZE) {
      return { success: false, error: 'File too large. Maximum size is 10MB.' };
    }

    // Encode filename for URL
    const encodedFilename = encodeURIComponent(filename);
    const apiPath = `/${project}/_apis/wiki/wikis/${encodeURIComponent(wikiId)}/attachments?name=${encodedFilename}&api-version=${API_VERSION}`;

    console.log('[Azure API] uploadAttachment:', { org, project, wikiId, filename, size: estimatedOriginalSize });
    console.log('[Azure API] Upload URL:', `https://dev.azure.com/${org}${apiPath}`);

    // Calculate byte length of base64 string (for Content-Length header)
    const contentLength = Buffer.byteLength(base64Data, 'utf8');

    const options = {
      hostname: 'dev.azure.com',
      path: `/${org}${apiPath}`,
      method: 'PUT',
      headers: {
        'Authorization': createAuthHeader(pat),
        'Content-Type': 'application/octet-stream',
        'Content-Length': contentLength
      }
    };

    // Make the upload request with retry logic
    const uploadFn = async () => {
      const result = await makeBase64UploadRequest(options, base64Data, 60000); // 60s timeout for uploads
      return result;
    };

    const response = await withRetry(uploadFn, 2); // 2 retries for uploads

    // Extract the attachment path from response
    // Response format: { name: "image.png", path: "/.attachments/image.png" }
    const attachmentPath = response.data?.path || `/.attachments/${filename}`;

    console.log('[Azure API] Attachment uploaded successfully:', attachmentPath);

    return {
      success: true,
      path: attachmentPath,
      name: response.data?.name || filename
    };
  } catch (error) {
    console.error('[Azure API] uploadAttachment error:', error.message);

    // Provide helpful error messages
    if (error.message.includes('401')) {
      return {
        success: false,
        error: 'Unauthorized - Your PAT may need "Wiki (Read & Write)" scope for uploads'
      };
    }
    if (error.message.includes('413')) {
      return {
        success: false,
        error: 'File too large for Azure DevOps'
      };
    }

    return { success: false, error: error.message };
  }
}

/**
 * Search wiki pages using Azure DevOps Search API
 * This searches across the entire wiki, not just loaded pages
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} pat - Personal Access Token
 * @param {string} wikiId - Wiki identifier (optional, filters to specific wiki)
 * @param {string} searchText - Text to search for
 * @param {number} top - Maximum results to return (default 25)
 * @param {number} skip - Number of results to skip for pagination (default 0)
 * @returns {Object} Search results with count and results array
 */
async function searchWiki(org, project, pat, wikiId, searchText, top = 25, skip = 0) {
  if (!searchText || searchText.trim().length < 2) {
    return { count: 0, results: [] };
  }

  const requestBody = {
    searchText: searchText.trim(),
    $skip: skip,
    $top: top,
    filters: wikiId ? { Wiki: [wikiId] } : null,
    includeFacets: false
  };

  console.log('[Azure API] searchWiki:', { org, project, wikiId, searchText, top, skip });

  // Wiki search uses a different hostname: almsearch.dev.azure.com
  const apiPath = `/${project}/_apis/search/wikisearchresults?api-version=7.1`;

  const options = {
    hostname: 'almsearch.dev.azure.com',
    path: `/${org}${apiPath}`,
    method: 'POST',
    headers: {
      'Authorization': createAuthHeader(pat),
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };

  try {
    const { data } = await makeRequest(options, requestBody);

    console.log('[Azure API] Search returned', data.count, 'results');

    // Transform results to a simpler format
    // Search API returns git paths (hyphens instead of spaces)
    // We need to convert to wiki paths (with spaces)
    const results = (data.results || []).map(result => {
      let gitPath = result.path;

      // First decode URL encoding (e.g., %2D -> -, %3C -> <)
      try {
        gitPath = decodeURIComponent(result.path);
      } catch (e) {
        console.warn('[Azure API] Failed to decode search result path:', result.path);
      }

      // Convert git path to wiki path (hyphens to spaces)
      const wikiPath = gitPathToWikiPath(gitPath);
      console.log('[Azure API] Search path conversion:', { raw: result.path, git: gitPath, wiki: wikiPath });

      return {
        fileName: result.fileName,
        path: wikiPath,  // Use converted wiki path for navigation
        gitPath: gitPath,  // Keep git path for reference
        rawPath: result.path,  // Keep original for debugging
        wikiId: result.wiki?.id,
        wikiName: result.wiki?.name,
        projectName: result.project?.name,
        // Extract highlighted content snippets
        highlights: result.hits?.map(hit => ({
          field: hit.fieldReferenceName,
          snippets: hit.highlights || []
        })) || []
      };
    });

    return {
      count: data.count || 0,
      results
    };
  } catch (error) {
    console.error('[Azure API] searchWiki error:', error.message);
    throw error;
  }
}

module.exports = {
  validateConnection,
  getWikis,
  getWikiPages,
  getPageContent,
  updatePageContent,
  checkForConflict,
  createPage,
  deletePage,
  getPageById,
  getAttachment,
  uploadAttachment,
  generateUniqueFilename,
  getPageHistory,
  getPageAtVersion,
  searchWiki,
  // Cache management
  invalidateWikiCache,
  clearWikiCache
};
