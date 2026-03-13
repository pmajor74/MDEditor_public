/**
 * Mermaid Image Renderer
 *
 * Renders Mermaid diagrams to PNG images using Puppeteer.
 * Used for visual verification by the LLM after generating diagrams.
 */

const puppeteer = require('puppeteer');

// Cache browser instance for performance
let browserInstance = null;

/**
 * Get or create a puppeteer browser instance
 */
async function getBrowser() {
  if (!browserInstance) {
    console.log('[Mermaid Renderer] Launching puppeteer browser...');
    browserInstance = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browserInstance;
}

/**
 * Close the browser instance (call on app shutdown)
 */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Extract mermaid code blocks from markdown content
 * @param {string} content - Markdown content
 * @returns {Array<{code: string, index: number}>} Array of mermaid blocks
 */
function extractMermaidBlocks(content) {
  const blocks = [];
  const regex = /```mermaid\s*([\s\S]*?)```/g;
  let match;
  let index = 0;

  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      code: match[1].trim(),
      index: index++
    });
  }

  return blocks;
}

/**
 * Render a single mermaid diagram to PNG
 * @param {string} mermaidCode - The mermaid diagram code
 * @param {Object} options - Rendering options
 * @returns {Promise<{success: boolean, data?: string, error?: string}>}
 */
async function renderMermaidToPng(mermaidCode, options = {}) {
  const {
    width = 1200,
    height = 800,
    backgroundColor = '#ffffff',
    theme = 'default'
  } = options;

  let page = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Set viewport
    await page.setViewport({ width, height });

    // Create HTML with mermaid
    const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background-color: ${backgroundColor};
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    #mermaid-container {
      max-width: 100%;
    }
    .mermaid {
      display: inline-block;
    }
  </style>
</head>
<body>
  <div id="mermaid-container">
    <pre class="mermaid">
${mermaidCode}
    </pre>
  </div>
  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: '${theme}',
      flowchart: { useMaxWidth: true, htmlLabels: true },
      securityLevel: 'loose'
    });
  </script>
</body>
</html>`;

    // Load the HTML content
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Wait for mermaid to render
    await page.waitForSelector('.mermaid svg', { timeout: 10000 });

    // Get the SVG element's bounding box
    const svgElement = await page.$('.mermaid svg');
    if (!svgElement) {
      throw new Error('Mermaid SVG not found after rendering');
    }

    const boundingBox = await svgElement.boundingBox();
    if (!boundingBox) {
      throw new Error('Could not get SVG bounding box');
    }

    // Take screenshot of just the SVG area with some padding
    const padding = 20;
    const screenshot = await page.screenshot({
      type: 'png',
      clip: {
        x: Math.max(0, boundingBox.x - padding),
        y: Math.max(0, boundingBox.y - padding),
        width: boundingBox.width + (padding * 2),
        height: boundingBox.height + (padding * 2)
      },
      encoding: 'base64'
    });

    return {
      success: true,
      data: screenshot,
      mimeType: 'image/png',
      width: boundingBox.width + (padding * 2),
      height: boundingBox.height + (padding * 2)
    };

  } catch (error) {
    console.error('[Mermaid Renderer] Error rendering diagram:', error.message);
    return {
      success: false,
      error: error.message
    };
  } finally {
    if (page) {
      await page.close();
    }
  }
}

/**
 * Render all mermaid diagrams in content to PNG images
 * @param {string} content - Markdown content with mermaid blocks
 * @param {Object} options - Rendering options
 * @returns {Promise<Array<{index: number, success: boolean, data?: string, error?: string}>>}
 */
async function renderAllMermaidDiagrams(content, options = {}) {
  const blocks = extractMermaidBlocks(content);

  if (blocks.length === 0) {
    return [];
  }

  console.log(`[Mermaid Renderer] Rendering ${blocks.length} diagram(s)...`);

  const results = [];

  for (const block of blocks) {
    const result = await renderMermaidToPng(block.code, options);
    results.push({
      index: block.index,
      ...result
    });
  }

  return results;
}

/**
 * Render the first mermaid diagram in content (most common use case)
 * @param {string} content - Markdown content with mermaid blocks
 * @param {Object} options - Rendering options
 * @returns {Promise<{success: boolean, data?: string, error?: string}>}
 */
async function renderFirstMermaidDiagram(content, options = {}) {
  const blocks = extractMermaidBlocks(content);

  if (blocks.length === 0) {
    return {
      success: false,
      error: 'No mermaid diagrams found in content'
    };
  }

  return renderMermaidToPng(blocks[0].code, options);
}

module.exports = {
  renderMermaidToPng,
  renderAllMermaidDiagrams,
  renderFirstMermaidDiagram,
  extractMermaidBlocks,
  closeBrowser
};
