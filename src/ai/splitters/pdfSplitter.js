/**
 * PDF Splitter
 *
 * Extracts text and images from PDF files using pdfjs-dist.
 * Text is chunked per-page. Images can be described via multimodal LLM.
 * Uses sharp to convert raw image data to PNG for LLM.
 */

const { BaseSplitter } = require('./baseSplitter');
const path = require('path');
const crypto = require('crypto');

// pdfjs-dist loaded lazily via dynamic import (ESM-only in v4+)
let pdfjsLibPromise = null;

const MAX_IMAGES_PER_PDF = 10;
const MIN_IMAGE_DIM = 50; // Skip images smaller than 50x50
const MAX_IMAGE_DIM = 1024; // Resize images larger than this before sending to LLM

/**
 * Load pdfjs-dist with legacy build (no web worker needed for Node.js)
 */
async function getPdfLib() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs').catch(err => {
      pdfjsLibPromise = null; // Reset so next call retries
      throw err;
    });
  }
  return await pdfjsLibPromise;
}

/**
 * Get sharp module (lazy load for optional dependency)
 */
function getSharp() {
  try {
    return require('sharp');
  } catch {
    console.warn('[PdfSplitter] sharp not available, image extraction disabled');
    return null;
  }
}

class PdfSplitter extends BaseSplitter {
  getContentType() {
    return 'prose';
  }

  /**
   * Split a PDF buffer into text chunks and optional image description chunks.
   * @param {Buffer} content - Raw PDF buffer
   * @param {string} filePath - Source file path
   * @param {Object} options - { llmClient, qualityLevel }
   * @returns {Promise<Array<Object>>} Array of chunk objects
   */
  async split(content, filePath, options = {}) {
    const pages = await this.extractPages(content);
    const chunks = [];
    const fileName = path.basename(filePath);

    for (const page of pages) {
      if (page.text && page.text.trim().length > 0) {
        const chunkId = crypto.createHash('md5')
          .update(`${filePath}:page${page.pageNum}:text`)
          .digest('hex')
          .substring(0, 12);

        chunks.push({
          id: chunkId,
          content: page.text.trim(),
          metadata: {
            source: filePath,
            fileName,
            pageNum: page.pageNum,
            type: 'pdf-text',
            language: 'text'
          }
        });
      }

      // Handle images
      if (page.images && page.images.length > 0 && options.llmClient) {
        const imageChunks = await this.describeImages(
          page.images, page.pageNum, filePath, options
        );
        chunks.push(...imageChunks);
      } else if (page.images && page.images.length > 0) {
        // No LLM - add placeholder
        const chunkId = crypto.createHash('md5')
          .update(`${filePath}:page${page.pageNum}:images`)
          .digest('hex')
          .substring(0, 12);

        chunks.push({
          id: chunkId,
          content: `[Page ${page.pageNum} contains ${page.images.length} image(s) that were not described - LLM not available]`,
          metadata: {
            source: filePath,
            fileName,
            pageNum: page.pageNum,
            type: 'pdf-image-placeholder',
            language: 'text'
          }
        });
      }

      // Detect scanned pages (no text but might have images from page rendering)
      if ((!page.text || page.text.trim().length === 0) && (!page.images || page.images.length === 0)) {
        const chunkId = crypto.createHash('md5')
          .update(`${filePath}:page${page.pageNum}:empty`)
          .digest('hex')
          .substring(0, 12);

        chunks.push({
          id: chunkId,
          content: `[Page ${page.pageNum} appears to be a scanned or empty page with no extractable text]`,
          metadata: {
            source: filePath,
            fileName,
            pageNum: page.pageNum,
            type: 'pdf-empty-page',
            language: 'text'
          }
        });
      }
    }

    return chunks;
  }

  /**
   * Extract text and image references from each page.
   * @param {Buffer} buffer - PDF file buffer
   * @returns {Promise<Array<{pageNum, text, images}>>}
   */
  async extractPages(buffer) {
    let pdfjs;
    try {
      pdfjs = await getPdfLib();
    } catch (err) {
      throw new Error(`Failed to load PDF library (pdfjs-dist): ${err.message}`);
    }

    const data = new Uint8Array(buffer);
    let doc;
    try {
      doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    } catch (err) {
      throw new Error(`Failed to parse PDF document: ${err.message}`);
    }
    const pages = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);

      // Extract text
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map(item => item.str)
        .join(' ')
        .replace(/\s+/g, ' ');

      // Detect images via operator list
      const images = [];
      try {
        const ops = await page.getOperatorList();
        const OPS = pdfjs.OPS;

        for (let j = 0; j < ops.fnArray.length; j++) {
          if (ops.fnArray[j] === OPS.paintImageXObject || ops.fnArray[j] === OPS.paintJpegXObject) {
            const imgName = ops.argsArray[j][0];
            try {
              const imgData = await page.objs.get(imgName);
              if (imgData && imgData.width >= MIN_IMAGE_DIM && imgData.height >= MIN_IMAGE_DIM) {
                images.push({
                  name: imgName,
                  width: imgData.width,
                  height: imgData.height,
                  data: imgData.data, // Raw RGBA/RGB pixel data
                  kind: imgData.kind  // 1=GRAYSCALE, 2=RGB, 3=RGBA
                });
              }
            } catch {
              // Image object might not be accessible
            }
          }
        }
      } catch (err) {
        console.warn(`[PdfSplitter] Error extracting images from page ${i}:`, err.message);
      }

      pages.push({ pageNum: i, text, images: images.slice(0, MAX_IMAGES_PER_PDF) });
    }

    doc.destroy();
    return pages;
  }

  /**
   * Convert raw image data to PNG and send to multimodal LLM for description.
   * @param {Array} images - Image objects from extractPages
   * @param {number} pageNum - Page number
   * @param {string} filePath - Source file path
   * @param {Object} options - { llmClient }
   * @returns {Promise<Array<Object>>} Image description chunks
   */
  async describeImages(images, pageNum, filePath, options) {
    const sharp = getSharp();
    if (!sharp) return [];

    const chunks = [];
    const fileName = path.basename(filePath);
    let processedCount = 0;

    for (const img of images) {
      if (processedCount >= MAX_IMAGES_PER_PDF) break;

      try {
        // Determine channels from kind
        const channels = img.kind === 1 ? 1 : img.kind === 2 ? 3 : 4;

        // Convert raw pixel data to PNG via sharp
        let sharpImg = sharp(Buffer.from(img.data), {
          raw: {
            width: img.width,
            height: img.height,
            channels
          }
        });

        // Resize large images
        if (img.width > MAX_IMAGE_DIM || img.height > MAX_IMAGE_DIM) {
          sharpImg = sharpImg.resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: 'inside' });
        }

        const pngBuffer = await sharpImg.png().toBuffer();
        const base64 = pngBuffer.toString('base64');

        // Send to multimodal LLM for description
        const description = await this.callLLMForImageDescription(
          base64, pageNum, fileName, options.llmClient
        );

        if (description) {
          const chunkId = crypto.createHash('md5')
            .update(`${filePath}:page${pageNum}:img${processedCount}`)
            .digest('hex')
            .substring(0, 12);

          chunks.push({
            id: chunkId,
            content: `[Image from page ${pageNum} of ${fileName}]\n${description}`,
            metadata: {
              source: filePath,
              fileName,
              pageNum,
              type: 'pdf-image-description',
              language: 'text'
            }
          });
        }

        processedCount++;
      } catch (err) {
        console.warn(`[PdfSplitter] Error processing image on page ${pageNum}:`, err.message);
      }
    }

    return chunks;
  }

  /**
   * Call multimodal LLM to describe an image.
   * @param {string} base64Png - Base64-encoded PNG
   * @param {number} pageNum - Page number context
   * @param {string} fileName - File name context
   * @param {Object} llmClient - LLM client instance
   * @returns {Promise<string|null>} Description or null
   */
  async callLLMForImageDescription(base64Png, pageNum, fileName, llmClient) {
    try {
      const prompt = `Describe this image from page ${pageNum} of "${fileName}". ` +
        `Focus on the key information, data, or concepts shown. ` +
        `If it's a chart or diagram, describe the data and relationships. ` +
        `Keep the description concise (2-4 sentences).`;

      // Use the same pattern as wikiSynthesisAgent for multimodal calls
      const response = await llmClient.invoke([
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64Png}` }
            }
          ]
        }
      ]);

      return typeof response === 'string' ? response : response?.content || null;
    } catch (err) {
      console.warn(`[PdfSplitter] LLM image description failed:`, err.message);
      return null;
    }
  }
}

module.exports = { PdfSplitter };
