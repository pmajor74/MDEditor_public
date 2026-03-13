/**
 * Azure DevOps Image Plugin for Toast UI Editor
 *
 * Handles image paths with /.attachments/ syntax used in Azure DevOps Wiki.
 * Uses DOM observation to intercept images and update their src to full URLs.
 *
 * Also handles Azure Wiki image sizing syntax: ![alt](/.attachments/img.png =300x200)
 */

// Azure connection context - updated via setAzureImageContext()
let azureContext = {
  isAzureMode: false,
  org: null,
  project: null,
  wikiId: null
};

// Local file context - updated via setLocalFileContext()
let localContext = {
  currentFilePath: null
};

// MutationObserver instance
let imageObserver = null;

// Flag to indicate if context has been initialized
let contextInitialized = false;

/**
 * Set the Azure connection context for image URL resolution
 * Call this when connecting/disconnecting from Azure DevOps
 *
 * @param {Object} context - Azure connection details
 * @param {boolean} context.isAzureMode - Whether connected to Azure
 * @param {string} context.org - Azure DevOps organization
 * @param {string} context.project - Azure DevOps project name
 * @param {string} context.wikiId - Wiki identifier
 */
export function setAzureImageContext(context) {
  azureContext = {
    isAzureMode: context?.isAzureMode || false,
    org: context?.org || null,
    project: context?.project || null,
    wikiId: context?.wikiId || null
  };
  contextInitialized = true;
  console.log('[Azure Image Plugin] Context updated:', azureContext);

  // Re-process any existing images when context changes
  processAllAttachmentImages();
}

/**
 * Mark the context as initialized (even if not connected to Azure)
 * This allows local file resolution to proceed
 */
export function markContextInitialized() {
  contextInitialized = true;
  console.log('[Azure Image Plugin] Context marked as initialized');
  processAllAttachmentImages();
}

/**
 * Set the local file context for resolving attachment paths
 * Call this when switching tabs or loading local files
 *
 * @param {string} filePath - Absolute path to the current markdown file
 */
export function setLocalFileContext(filePath) {
  localContext.currentFilePath = filePath || null;
  console.log('[Azure Image Plugin] Local context updated:', localContext.currentFilePath);
}

/**
 * Build full Azure DevOps attachment URL
 *
 * @param {string} filename - Attachment filename
 * @returns {string|null} Full Azure DevOps URL or null if context incomplete
 */
function buildAzureUrl(filename) {
  if (!azureContext.org || !azureContext.project || !azureContext.wikiId) {
    console.warn('[Azure Image Plugin] Incomplete Azure context for URL building');
    return null;
  }

  // Encode the filename for URL safety
  const encodedFilename = encodeURIComponent(filename);

  // Azure DevOps Wiki attachment URL format:
  // https://dev.azure.com/{org}/{project}/_wiki/wikis/{wikiId}/.attachments/{filename}
  return `https://dev.azure.com/${azureContext.org}/${azureContext.project}/_wiki/wikis/${azureContext.wikiId}/.attachments/${encodedFilename}`;
}

/**
 * Check if a URL/src is an Azure attachment path that needs resolution
 *
 * @param {string} src - Image src to check
 * @returns {boolean} True if this is an unresolved attachment path
 */
function isAttachmentPath(src) {
  if (!src) return false;

  // Skip if already resolved to full Azure URL or file:// URL
  if (src.startsWith('https://dev.azure.com/')) return false;
  if (src.startsWith('file://')) return false;

  return src.startsWith('/.attachments/') ||
         src.startsWith('.attachments/') ||
         src.includes('/.attachments/');
}

/**
 * Extract filename from attachment path
 *
 * @param {string} src - Attachment URL path
 * @returns {string} Filename
 */
function getAttachmentFilename(src) {
  // Handle various formats:
  // /.attachments/file.png
  // .attachments/file.png
  // /path/.attachments/file.png
  const match = src.match(/\.attachments\/([^?\s]+)/);
  return match ? match[1] : src;
}

/**
 * Process a single image element and update its src if it's an attachment
 *
 * @param {HTMLImageElement} img - Image element to process
 */
async function processImageElement(img) {
  const src = img.getAttribute('src') || '';

  // Skip if already processed or not an attachment
  if (img.dataset.azureProcessed === 'true') return;
  if (!isAttachmentPath(src)) return;

  // Wait for context to be initialized before processing
  if (!contextInitialized) {
    console.log('[Azure Image Plugin] Context not initialized, skipping:', src);
    return;
  }

  console.log('[Azure Image Plugin] Processing image:', src);

  // Mark as being processed to avoid duplicate processing
  img.dataset.azureProcessed = 'true';

  // Extract filename
  const filename = getAttachmentFilename(src);
  console.log('[Azure Image Plugin] Extracted filename:', filename);

  // Add pending class for loading indicator
  img.classList.add('azure-attachment-image', 'azure-attachment-pending');

  let resolvedUrl = null;

  // Try Azure fetch first if in Azure mode (requires authentication)
  if (azureContext.isAzureMode && window.electronAPI?.fetchAzureAttachment) {
    try {
      console.log('[Azure Image Plugin] Fetching Azure attachment with auth:', filename);
      const result = await window.electronAPI.fetchAzureAttachment(filename);
      if (result?.success && result.dataUrl) {
        resolvedUrl = result.dataUrl;
        console.log('[Azure Image Plugin] Got Azure attachment as data URL');
      } else {
        console.warn('[Azure Image Plugin] Azure fetch failed:', result?.error);
      }
    } catch (error) {
      console.warn('[Azure Image Plugin] Failed to fetch Azure attachment:', error);
    }
  }

  // If no Azure URL, try local resolution
  if (!resolvedUrl && window.electronAPI?.resolveAttachmentPath) {
    try {
      const result = await window.electronAPI.resolveAttachmentPath(filename);
      if (result?.success && result.url) {
        resolvedUrl = result.url;
        console.log('[Azure Image Plugin] Resolved local URL:', resolvedUrl);
      }
    } catch (error) {
      console.warn('[Azure Image Plugin] Failed to resolve local attachment:', error);
    }
  }

  // Update the image
  if (resolvedUrl) {
    img.src = resolvedUrl;
    img.classList.remove('azure-attachment-pending');

    // Handle load error
    img.onerror = () => {
      console.warn('[Azure Image Plugin] Failed to load image');
      img.classList.add('azure-attachment-error');
    };
  } else {
    // No resolution available
    console.warn('[Azure Image Plugin] Could not resolve attachment:', filename);
    img.classList.remove('azure-attachment-pending');
    img.classList.add('azure-attachment-error');
  }
}

/**
 * Process all attachment images in the document
 */
function processAllAttachmentImages() {
  const editorEl = document.querySelector('#editor');
  if (!editorEl) return;

  // Find all images with attachment paths
  const images = editorEl.querySelectorAll('img');
  images.forEach(img => {
    // Reset processed flag so images can be re-evaluated with new context
    delete img.dataset.azureProcessed;
    processImageElement(img);
  });
}

/**
 * Start observing for new images in the editor
 */
function startImageObserver() {
  if (imageObserver) return; // Already observing

  const editorEl = document.querySelector('#editor');
  if (!editorEl) {
    console.warn('[Azure Image Plugin] Editor element not found, delaying observer start');
    setTimeout(startImageObserver, 500);
    return;
  }

  console.log('[Azure Image Plugin] Starting image observer');

  imageObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Check added nodes for images
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Check if the node itself is an image
        if (node.tagName === 'IMG') {
          processImageElement(node);
        }

        // Check for images within the added node
        const images = node.querySelectorAll?.('img');
        if (images) {
          images.forEach(img => processImageElement(img));
        }
      }

    }
  });

  imageObserver.observe(editorEl, {
    childList: true,
    subtree: true
  });

  // Process any existing images
  processAllAttachmentImages();
}

/**
 * Stop the image observer
 */
function stopImageObserver() {
  if (imageObserver) {
    imageObserver.disconnect();
    imageObserver = null;
  }
}

/**
 * Toast UI Editor plugin for Azure DevOps image handling
 * This plugin doesn't modify the markdown rendering directly,
 * but sets up DOM observation to intercept and fix image URLs
 *
 * @returns {Object} Plugin configuration
 */
export function azureImagePlugin() {
  // Start observing when plugin is loaded
  // Use setTimeout to ensure DOM is ready
  setTimeout(() => {
    startImageObserver();
  }, 100);

  // Return empty plugin config - actual work is done via DOM observation
  return {
    toHTMLRenderers: {}
  };
}

/**
 * Process pending attachment images in the editor
 * Called after editor content is loaded to resolve image paths
 *
 * @param {HTMLElement} container - Container element to search for images
 */
export async function processPendingAttachments(container) {
  if (!container) return;

  const images = container.querySelectorAll('img');
  for (const img of images) {
    // Reset processed flag to force re-evaluation
    delete img.dataset.azureProcessed;
    await processImageElement(img);
  }
}
