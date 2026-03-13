/**
 * Edit Agent
 *
 * Main orchestrator for document editing operations.
 * Uses different strategies based on document size:
 * - Small documents: Direct edit (send entire doc to LLM)
 * - Large documents: Chunking agent (split, find, edit, reassemble)
 */

const { HumanMessage, SystemMessage, AIMessage } = require('@langchain/core/messages');
const providerFactory = require('../providers');
const configManager = require('../llmConfigManager');
const splitter = require('../splitters/markdownSplitter');
const { buildContextualPrompt, QA_SYSTEM_PROMPT, CREATE_SYSTEM_PROMPT, buildPersonaPrompt } = require('../prompts/systemPrompt');
const { MERMAID_CRITICAL_RULES } = require('../prompts/mermaidContext');
const { LARGE_DOC_EDIT_INSTRUCTIONS, QA_INSTRUCTIONS } = require('../prompts/editInstructions');
const mermaidValidator = require('../mermaidValidator');
const markdownValidator = require('../markdownValidator');
const mermaidImageRenderer = require('../mermaidImageRenderer');

// Maximum attempts to fix mermaid errors
const MAX_MERMAID_FIX_ATTEMPTS = 3;

/**
 * Check if a LangChain model response was truncated due to hitting token limits.
 * @param {Object} response - LangChain AIMessage response
 * @returns {boolean} True if the response was truncated
 */
function wasResponseTruncated(response) {
  if (!response?.response_metadata) return false;
  const meta = response.response_metadata;
  return meta.finish_reason === 'length' ||
    meta.stop_reason === 'max_tokens' ||
    meta.finishReason === 'length';
}

// Maximum attempts for visual verification
const MAX_VISUAL_FIX_ATTEMPTS = 2;

// Threshold for switching to chunking mode (in estimated tokens)
const LARGE_DOC_THRESHOLD = 50000;

/**
 * Estimate token count for a string
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Parse the LLM response to extract article and summary
 */
function parseResponse(responseText) {
  // Try to find JSON in markdown code block
  const jsonBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());

      // Check for clarification request
      if (parsed.needsClarification) {
        console.log('[Edit Agent] LLM is asking for clarification');
        return {
          needsClarification: true,
          clarificationQuestion: parsed.clarificationQuestion || 'Could you please provide more details?',
          options: parsed.options || [],
          context: parsed.context || ''
        };
      }

      if (parsed.updatedArticle !== undefined) {
        return {
          updatedArticle: parsed.updatedArticle || '',
          changeSummary: parsed.changeSummary || 'Changes applied'
        };
      }
      // Check for targeted edit format
      if (parsed.editType !== undefined) {
        return {
          editType: parsed.editType,
          targetSection: parsed.targetSection,
          insertAfter: parsed.insertAfter,
          content: parsed.content,
          changeSummary: parsed.changeSummary || 'Edit specified'
        };
      }
    } catch (e) {
      console.log('[Edit Agent] Failed to parse JSON from code block:', e.message);
      // Try regex extraction as fallback for malformed JSON
      const extracted = extractWithRegex(jsonBlockMatch[1]);
      if (extracted) {
        console.log('[Edit Agent] Successfully extracted content with regex fallback');
        return extracted;
      }
    }
  }

  // Try raw JSON
  const jsonMatch = responseText.match(/\{[\s\S]*"updatedArticle"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        updatedArticle: parsed.updatedArticle || '',
        changeSummary: parsed.changeSummary || 'Changes applied'
      };
    } catch (e) {
      console.log('[Edit Agent] Failed to parse raw JSON:', e.message);
      // Try regex extraction as fallback
      const extracted = extractWithRegex(jsonMatch[0]);
      if (extracted) {
        console.log('[Edit Agent] Successfully extracted content with regex fallback');
        return extracted;
      }
    }
  }

  // Try entire response
  try {
    const parsed = JSON.parse(responseText.trim());
    if (parsed.updatedArticle !== undefined || parsed.editType !== undefined) {
      return parsed;
    }
  } catch {
    // Not valid JSON - try regex on entire response
    const extracted = extractWithRegex(responseText);
    if (extracted) {
      console.log('[Edit Agent] Successfully extracted content with regex fallback');
      return extracted;
    }
  }

  return {
    text: responseText,
    updatedArticle: null,
    changeSummary: null
  };
}

/**
 * Extract updatedArticle and changeSummary using regex when JSON parsing fails
 * This handles cases where the LLM returns JSON with unescaped newlines
 */
function extractWithRegex(text) {
  // Try to extract updatedArticle content between quotes
  // Pattern: "updatedArticle": "...content..." (handles multiline)
  const articleMatch = text.match(/"updatedArticle"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"changeSummary"|"\s*\})/);

  if (articleMatch) {
    let article = articleMatch[1];
    // Unescape common escape sequences
    article = article
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');

    // Try to extract changeSummary
    let summary = 'Changes applied';
    const summaryMatch = text.match(/"changeSummary"\s*:\s*"([^"]*)"/);
    if (summaryMatch) {
      summary = summaryMatch[1];
    }

    return {
      updatedArticle: article,
      changeSummary: summary
    };
  }

  return null;
}

/**
 * Build LangChain message objects from chat history
 * @param {Array} chatHistory - Array of {role, content} objects
 * @returns {Array} LangChain message objects
 */
function buildHistoryMessages(chatHistory) {
  if (!chatHistory || chatHistory.length === 0) return [];
  return chatHistory.map(msg => {
    if (msg.role === 'user') return new HumanMessage(msg.content);
    return new AIMessage(msg.content);
  });
}

/**
 * Direct edit mode - for small documents
 * Sends entire document to LLM
 * @param {Object} model - LangChain model instance
 * @param {string} userRequest - User's edit request
 * @param {string} articleContent - Current article content
 * @param {Array} images - Optional array of {data, mimeType, name} objects
 */
async function directEdit(model, userRequest, articleContent, images = [], visualVerifyMermaid = false, persona = null, chatHistory = null) {
  try {
    console.log('[Edit Agent] Building prompt...');
    let systemPrompt;
    if (persona && persona.systemPromptTemplate) {
      systemPrompt = buildPersonaPrompt(persona, userRequest, 'edit');
      console.log('[Edit Agent] Using persona prompt for edit:', persona.displayName);
    } else {
      systemPrompt = buildContextualPrompt(userRequest);
    }

    // Handle empty/null articleContent for new documents
    const content = articleContent || '';
    const contentSection = content
      ? `Here is the current article content:\n\n---\n${content}\n---\n\n`
      : 'This is a new empty document.\n\n';

    console.log('[Edit Agent] Creating messages...');

    // Build the human message content (can be multimodal with images)
    let humanContent;
    if (images && images.length > 0) {
      console.log(`[Edit Agent] Including ${images.length} image(s) in message`);
      // Multimodal message with images
      humanContent = [];

      // Add images first
      for (const img of images) {
        humanContent.push({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.data}` }
        });
      }

      // Add text content
      humanContent.push({
        type: 'text',
        text: `${contentSection}User request: ${userRequest}`
      });
    } else {
      // Simple text message
      humanContent = `${contentSection}User request: ${userRequest}`;
    }

    const messages = [
      new SystemMessage(systemPrompt),
      ...buildHistoryMessages(chatHistory),
      new HumanMessage({ content: humanContent })
    ];

    console.log('[Edit Agent] Using direct edit mode, invoking model...');

    const response = await model.invoke(messages);

    console.log('[Edit Agent] Model response received, extracting content...');
    console.log('[Edit Agent] Response type:', typeof response);
    console.log('[Edit Agent] Response keys:', response ? Object.keys(response) : 'null');

    const responseContent = response?.content || '';

    if (wasResponseTruncated(response)) {
      console.warn('[Edit Agent] Edit response was truncated due to token limit');
      return {
        updatedArticle: null,
        changeSummary: 'Response was truncated due to the output token limit. The document may be too large for a single edit. Try making smaller, focused changes, or increase "Max Output Tokens" in Settings > AI / LLM Provider.'
      };
    }

    if (!responseContent) {
      console.log('[Edit Agent] Empty response content');
      return {
        updatedArticle: null,
        changeSummary: 'No response received from AI'
      };
    }

    console.log('[Edit Agent] Parsing response...');
    let result = parseResponse(responseContent);

    // Auto-fix incorrect TOC syntax from LLM output
    if (result.updatedArticle) {
      result.updatedArticle = result.updatedArticle.replace(/\[\[\*TOC\*\]\]/g, '[[_TOC_]]');
    }

    // If we got an updated article, validate mermaid diagrams and markdown
    if (result.updatedArticle) {
      result = await validateAndRemediateMermaid(model, result, userRequest, images, visualVerifyMermaid);
      result = quickMarkdownValidation(result);
    }

    return result;
  } catch (error) {
    console.error('[Edit Agent] Error in directEdit:', error.message);
    console.error('[Edit Agent] Error stack:', error.stack);
    throw error;
  }
}

/**
 * Validate mermaid diagrams in the response and attempt to fix if invalid
 * @param {Object} model - LangChain model instance
 * @param {Object} result - Parsed response with updatedArticle
 * @param {string} originalRequest - Original user request
 * @param {Array} images - Optional images array
 * @returns {Object} Result with validated/fixed article
 */
async function validateAndRemediateMermaid(model, result, originalRequest, images = [], visualVerifyMermaid = false) {
  if (!result.updatedArticle) return result;

  // Validate mermaid diagrams
  let validation = await mermaidValidator.validateMermaidInContent(result.updatedArticle);

  if (validation.isValid || !validation.hasBlocks) {
    console.log('[Edit Agent] Mermaid validation passed (or no mermaid blocks)');

    // If there are mermaid blocks and visual verify is enabled, do visual verification
    if (validation.hasBlocks && visualVerifyMermaid) {
      result = await visuallyVerifyMermaid(model, result, originalRequest);
    } else if (validation.hasBlocks) {
      console.log('[Edit Agent] Skipping visual verification (disabled by user)');
    }

    return result;
  }

  console.log(`[Edit Agent] Mermaid validation failed with ${validation.errors.length} error(s)`);

  // Try programmatic auto-fix first (saves LLM calls)
  const autoFix = mermaidValidator.autoFixMermaidInContent(result.updatedArticle);
  if (autoFix.fixCount > 0) {
    console.log(`[Edit Agent] Programmatic auto-fix corrected ${autoFix.fixCount} label(s), re-validating...`);
    result.updatedArticle = autoFix.content;
    validation = await mermaidValidator.validateMermaidInContent(autoFix.content);
    if (validation.isValid) {
      console.log('[Edit Agent] Mermaid validation passed after auto-fix');
      if (validation.hasBlocks && visualVerifyMermaid) {
        result = await visuallyVerifyMermaid(model, result, originalRequest);
      }
      return result;
    }
    console.log(`[Edit Agent] Still ${validation.errors.length} error(s) after auto-fix, trying LLM remediation`);
  }

  // Attempt to fix remaining mermaid errors with LLM
  let currentArticle = result.updatedArticle;
  let attempts = 0;

  while (attempts < MAX_MERMAID_FIX_ATTEMPTS) {
    attempts++;
    console.log(`[Edit Agent] Mermaid fix attempt ${attempts}/${MAX_MERMAID_FIX_ATTEMPTS}`);

    // Format errors for the LLM
    const errorMessage = mermaidValidator.formatErrorsForLLM(validation.errors);

    // Build remediation prompt
    const remediationPrompt = buildRemediationPrompt(currentArticle, errorMessage);

    // Build message content (support images if present)
    let humanContent;
    if (images && images.length > 0) {
      humanContent = [];
      for (const img of images) {
        humanContent.push({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.data}` }
        });
      }
      humanContent.push({ type: 'text', text: remediationPrompt });
    } else {
      humanContent = remediationPrompt;
    }

    const messages = [
      new SystemMessage(getMermaidFixPrompt()),
      new HumanMessage({ content: humanContent })
    ];

    try {
      const fixResponse = await model.invoke(messages);
      const fixContent = fixResponse?.content || '';

      if (!fixContent) {
        console.log('[Edit Agent] Empty fix response');
        break;
      }

      const fixResult = parseResponse(fixContent);

      if (!fixResult.updatedArticle) {
        console.log('[Edit Agent] Fix response did not contain updated article');
        break;
      }

      currentArticle = fixResult.updatedArticle;

      // Validate again
      const revalidation = await mermaidValidator.validateMermaidInContent(currentArticle);

      if (revalidation.isValid) {
        console.log('[Edit Agent] Mermaid fix successful!');
        const fixedResult = {
          updatedArticle: currentArticle,
          changeSummary: result.changeSummary + ' (mermaid diagram corrected)'
        };
        // Only do visual verification if enabled
        if (visualVerifyMermaid) {
          return await visuallyVerifyMermaid(model, fixedResult, originalRequest);
        }
        console.log('[Edit Agent] Skipping visual verification (disabled by user)');
        return fixedResult;
      }

      // Update validation for next iteration
      validation.errors = revalidation.errors;
      console.log(`[Edit Agent] Still ${revalidation.errors.length} error(s) after fix attempt`);

    } catch (error) {
      console.error('[Edit Agent] Error during mermaid fix:', error.message);
      break;
    }
  }

  // If we couldn't fix it, return with a warning
  console.log('[Edit Agent] Could not fully fix mermaid errors after max attempts');
  return {
    updatedArticle: currentArticle,
    changeSummary: result.changeSummary + ' (Note: Mermaid diagram may have syntax issues)'
  };
}

/**
 * Quick local markdown validation — runs markdownValidator without any LLM calls.
 * Appends warnings to changeSummary if issues are found.
 * @param {Object} result - Parsed result with updatedArticle
 * @returns {Object} Result with any validation warnings appended
 */
function quickMarkdownValidation(result) {
  if (!result.updatedArticle) return result;

  const validation = markdownValidator.validateMarkdown(result.updatedArticle);
  if (!validation.isValid) {
    console.log(`[Edit Agent] Markdown validation found ${validation.errors.length} issue(s)`);
    validation.errors.forEach(err => console.log(`  - ${err}`));
    result.changeSummary = (result.changeSummary || 'Changes applied') +
      ` (Warning: ${validation.errors.join('; ')})`;
  } else {
    console.log('[Edit Agent] Markdown validation passed');
  }
  return result;
}

/**
 * Visually verify mermaid diagrams by rendering and having the LLM inspect them
 * @param {Object} model - LangChain model instance
 * @param {Object} result - Result with updatedArticle
 * @param {string} originalRequest - Original user request
 * @returns {Object} Result, potentially with fixes from visual verification
 */
async function visuallyVerifyMermaid(model, result, originalRequest) {
  console.log('[Edit Agent] Starting visual verification of mermaid diagram...');

  let currentArticle = result.updatedArticle;
  let attempts = 0;

  while (attempts < MAX_VISUAL_FIX_ATTEMPTS) {
    attempts++;

    try {
      // Render the mermaid diagram to an image
      console.log(`[Edit Agent] Visual verification attempt ${attempts}/${MAX_VISUAL_FIX_ATTEMPTS}`);
      const renderResult = await mermaidImageRenderer.renderFirstMermaidDiagram(currentArticle);

      if (!renderResult.success) {
        console.log('[Edit Agent] Failed to render mermaid diagram:', renderResult.error);
        // Can't verify visually, return as-is
        return {
          ...result,
          updatedArticle: currentArticle,
          changeSummary: result.changeSummary + ' (visual verification skipped - render failed)'
        };
      }

      console.log('[Edit Agent] Diagram rendered successfully, sending to LLM for visual verification...');

      // Send the rendered diagram to the LLM for verification
      const verificationPrompt = buildVisualVerificationPrompt(originalRequest, currentArticle);

      const humanContent = [
        {
          type: 'image_url',
          image_url: { url: `data:${renderResult.mimeType};base64,${renderResult.data}` }
        },
        {
          type: 'text',
          text: verificationPrompt
        }
      ];

      const messages = [
        new SystemMessage(getVisualVerificationSystemPrompt()),
        new HumanMessage({ content: humanContent })
      ];

      const verifyResponse = await model.invoke(messages);
      const verifyContent = verifyResponse?.content || '';

      // Parse the verification response
      const verification = parseVerificationResponse(verifyContent);

      if (verification.isCorrect) {
        console.log('[Edit Agent] Visual verification passed! LLM confirmed diagram is correct.');
        return {
          ...result,
          updatedArticle: currentArticle,
          changeSummary: result.changeSummary + ' (visually verified)'
        };
      }

      console.log('[Edit Agent] Visual verification failed:', verification.issues);

      // If this is the last attempt, return with warning
      if (attempts >= MAX_VISUAL_FIX_ATTEMPTS) {
        console.log('[Edit Agent] Max visual fix attempts reached');
        break;
      }

      // Try to fix the issues
      console.log('[Edit Agent] Attempting to fix visual issues...');
      const fixResult = await fixVisualIssues(model, currentArticle, originalRequest, verification.issues);

      if (fixResult.updatedArticle) {
        currentArticle = fixResult.updatedArticle;

        // Re-validate syntax after visual fix
        const revalidation = await mermaidValidator.validateMermaidInContent(currentArticle);
        if (!revalidation.isValid) {
          console.log('[Edit Agent] Visual fix introduced syntax errors, reverting');
          currentArticle = result.updatedArticle;
          break;
        }
      } else {
        console.log('[Edit Agent] Visual fix did not produce updated article');
        break;
      }

    } catch (error) {
      console.error('[Edit Agent] Error during visual verification:', error.message);
      break;
    }
  }

  // Return with whatever we have
  return {
    ...result,
    updatedArticle: currentArticle,
    changeSummary: result.changeSummary + ' (visual verification attempted)'
  };
}

/**
 * Build prompt for visual verification
 */
function buildVisualVerificationPrompt(originalRequest, article) {
  // Extract just the mermaid code for context
  const mermaidMatch = article.match(/```mermaid\s*([\s\S]*?)```/);
  const mermaidCode = mermaidMatch ? mermaidMatch[1].trim() : '';

  return `I generated a Mermaid diagram based on this user request:

"${originalRequest}"

Here is the Mermaid code I generated:
\`\`\`mermaid
${mermaidCode}
\`\`\`

The rendered diagram is shown in the image above.

Please verify if the rendered diagram correctly represents what the user asked for.

Respond in JSON format:
\`\`\`json
{
  "isCorrect": true/false,
  "issues": "Description of any issues if not correct (or null if correct)",
  "suggestions": "Specific suggestions to fix the issues (or null if correct)"
}
\`\`\`

Consider:
- Does the diagram show the correct relationships/flow?
- Are all the elements the user mentioned present?
- Is the layout readable and logical?
- Are there any missing connections or elements?`;
}

/**
 * Get system prompt for visual verification
 */
function getVisualVerificationSystemPrompt() {
  return `You are an expert at evaluating Mermaid diagrams. Your task is to visually verify that a rendered diagram correctly represents what the user requested.

You will be shown:
1. The original user request
2. The generated Mermaid code
3. A rendered image of the diagram

Evaluate whether the diagram accurately represents the user's request. Be thorough but practical - minor stylistic differences are acceptable, but missing elements, wrong relationships, or confusing layouts should be flagged.

Always respond in JSON format with isCorrect (boolean), issues (string or null), and suggestions (string or null).`;
}

/**
 * Parse the verification response from the LLM
 */
function parseVerificationResponse(responseText) {
  try {
    // Try to find JSON in markdown code block
    const jsonBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      return {
        isCorrect: parsed.isCorrect === true,
        issues: parsed.issues || null,
        suggestions: parsed.suggestions || null
      };
    }

    // Try raw JSON
    const jsonMatch = responseText.match(/\{[\s\S]*"isCorrect"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isCorrect: parsed.isCorrect === true,
        issues: parsed.issues || null,
        suggestions: parsed.suggestions || null
      };
    }

    // Default to assuming it's correct if we can't parse
    console.log('[Edit Agent] Could not parse verification response, assuming correct');
    return { isCorrect: true, issues: null, suggestions: null };

  } catch (e) {
    console.log('[Edit Agent] Error parsing verification response:', e.message);
    return { isCorrect: true, issues: null, suggestions: null };
  }
}

/**
 * Attempt to fix visual issues identified by the LLM
 */
async function fixVisualIssues(model, article, originalRequest, issues) {
  const fixPrompt = `The Mermaid diagram I generated has visual/logical issues that need to be fixed.

Original user request: "${originalRequest}"

Issues identified:
${issues}

Current article with the diagram:
---
${article}
---

Please fix the Mermaid diagram to address these issues. Keep everything else in the article exactly the same.

Return the fixed article in JSON format:
\`\`\`json
{
  "updatedArticle": "the complete fixed article",
  "changeSummary": "Fixed diagram issues"
}
\`\`\``;

  const messages = [
    new SystemMessage(buildContextualPrompt(originalRequest)),
    new HumanMessage(fixPrompt)
  ];

  try {
    const response = await model.invoke(messages);
    const responseContent = response?.content || '';

    if (!responseContent) {
      return { updatedArticle: null };
    }

    return parseResponse(responseContent);

  } catch (error) {
    console.error('[Edit Agent] Error fixing visual issues:', error.message);
    return { updatedArticle: null };
  }
}

/**
 * Build remediation prompt for fixing mermaid errors
 */
function buildRemediationPrompt(article, errorMessage) {
  return `The article I generated has mermaid diagram syntax errors that need to be fixed.

${errorMessage}

Here is the current article with the broken mermaid diagram:

---
${article}
---

Please fix ONLY the mermaid diagram syntax errors. Keep everything else exactly the same.

${MERMAID_CRITICAL_RULES}

Return the fixed article in JSON format:
\`\`\`json
{
  "updatedArticle": "the complete fixed article",
  "changeSummary": "Fixed mermaid diagram syntax"
}
\`\`\``;
}

/**
 * Get system prompt for mermaid fix requests
 */
function getMermaidFixPrompt() {
  return `You are an expert at fixing Mermaid diagram syntax errors. Your task is to correct syntax errors in mermaid diagrams while preserving the diagram's intent and structure.

${MERMAID_CRITICAL_RULES}

When fixing:
- Replace quoted strings in arrows with proper node definitions
- Split chained arrows into separate lines
- Abbreviate long labels
- Return the complete fixed article in JSON format`;
}

/**
 * Chunking edit mode - for large documents
 * Splits document, finds target, edits, reassembles
 */
async function chunkingEdit(model, userRequest, articleContent) {
  console.log('[Edit Agent] Using chunking edit mode for large document');

  // Step 1: Analyze document structure
  const sections = splitter.splitByHeaders(articleContent);
  const structure = splitter.getStructureSummary(sections);

  console.log(`[Edit Agent] Document has ${sections.length} sections`);

  // Step 2: Ask LLM to identify target section and specify edit
  const analysisPrompt = `You are editing a large document. Here is the document structure:

${structure}

User request: ${userRequest}

Based on this request, respond with a JSON specifying the edit:

\`\`\`json
{
  "editType": "insert" | "replace" | "delete",
  "targetSection": "section title to modify or insert after",
  "reasoning": "why this section was chosen"
}
\`\`\`

If inserting new content, set targetSection to the section to insert AFTER.
If replacing, set targetSection to the section to replace.`;

  const analysisResponse = await model.invoke([
    new SystemMessage('You are a document editing assistant. Analyze edit requests and specify targeted operations.'),
    new HumanMessage(analysisPrompt)
  ]);

  // Parse the analysis
  let editSpec;
  try {
    const match = analysisResponse.content.match(/```(?:json)?\s*([\s\S]*?)```/);
    editSpec = JSON.parse(match ? match[1] : analysisResponse.content);
  } catch (e) {
    console.log('[Edit Agent] Failed to parse edit specification, falling back to direct edit');
    return directEdit(model, userRequest, articleContent);
  }

  console.log(`[Edit Agent] Edit spec: ${editSpec.editType} on "${editSpec.targetSection}"`);

  // Step 3: Get target section content
  const targetSection = splitter.findSection(sections, editSpec.targetSection);

  if (!targetSection && editSpec.editType !== 'insert') {
    console.log('[Edit Agent] Target section not found, falling back to direct edit');
    return directEdit(model, userRequest, articleContent);
  }

  // Step 4: Generate the edit
  let editPrompt;
  const contextSections = targetSection ?
    splitter.getSectionWithContext(sections, sections.indexOf(targetSection), 1) :
    sections.slice(-2);

  const contextContent = contextSections.map(s => s.content).join('\n\n');

  if (editSpec.editType === 'insert') {
    editPrompt = `Generate NEW content to insert after the "${editSpec.targetSection}" section.

Context (sections around insertion point):
---
${contextContent}
---

User request: ${userRequest}

Return ONLY the new content to insert (including any heading). Do not include existing content.`;
  } else if (editSpec.editType === 'replace') {
    editPrompt = `Replace the "${editSpec.targetSection}" section with updated content.

Current section content:
---
${targetSection.content}
---

Context (surrounding sections):
${contextContent}

User request: ${userRequest}

Return ONLY the replacement content for this section. Include the section heading.`;
  } else if (editSpec.editType === 'delete') {
    // Just return the reassembled doc without the section
    const result = splitter.deleteSection(articleContent, targetSection);
    return {
      updatedArticle: result,
      changeSummary: `Deleted section: ${editSpec.targetSection}`
    };
  }

  const editResponse = await model.invoke([
    new SystemMessage(buildContextualPrompt(userRequest)),
    new HumanMessage(editPrompt)
  ]);

  const newContent = editResponse.content.trim();

  // Step 5: Reassemble document
  let result;
  if (editSpec.editType === 'insert') {
    result = splitter.insertAfterSection(articleContent, targetSection || sections[sections.length - 1], newContent);
  } else if (editSpec.editType === 'replace') {
    result = splitter.reassembleDocument(articleContent, targetSection, newContent);
  }

  return {
    updatedArticle: result,
    changeSummary: `${editSpec.editType === 'insert' ? 'Added' : 'Updated'} content ${editSpec.editType === 'insert' ? 'after' : 'in'} "${editSpec.targetSection}"`
  };
}

/**
 * Handle Q&A requests (no document editing)
 * Returns plain text answers instead of JSON edit responses
 * @param {Object} model - LangChain model instance
 * @param {string} userRequest - User's question
 * @param {string} articleContent - Current article content (for context)
 * @param {Array} ragContext - Optional RAG context chunks
 */
async function handleQARequest(model, userRequest, articleContent, ragContext = null, persona = null, chatHistory = null) {
  console.log('[Edit Agent] Handling Q&A request');

  // Build Q&A focused prompt - use persona prompt if active
  let systemPrompt;
  if (persona && persona.systemPromptTemplate) {
    systemPrompt = buildPersonaPrompt(persona, userRequest, 'qa');
    console.log('[Edit Agent] Using persona prompt for Q&A:', persona.displayName);
  } else {
    systemPrompt = QA_SYSTEM_PROMPT + '\n\n' + QA_INSTRUCTIONS;
  }

  // Build the context message
  let contextMessage = '';

  // Add RAG context if provided
  if (ragContext && ragContext.length > 0) {
    if (persona && persona.systemPromptTemplate) {
      // Persona mode: frame as the persona's own knowledge
      contextMessage += 'The following passages are from your own writings and reflect your thinking on topics relevant to this conversation. Draw on them naturally as your own knowledge -- do not cite them as external sources.\n\n';
      for (const ctx of ragContext) {
        const section = ctx.metadata?.title || '';
        if (section) {
          contextMessage += `From your writing on "${section}":\n`;
        }
        contextMessage += (ctx.text || ctx.content || '') + '\n\n';
      }
    } else {
      // Non-persona mode: clinical source format
      contextMessage += '--- CONTEXT FROM INDEXED FILES ---\n';
      for (const ctx of ragContext) {
        const source = ctx.metadata?.fileName || ctx.source || 'Unknown';
        const section = ctx.metadata?.title || '';
        contextMessage += `\n[Source: ${source}${section ? ' - ' + section : ''}]\n`;
        contextMessage += (ctx.text || ctx.content || '') + '\n';
      }
      contextMessage += '\n--- END INDEXED FILES CONTEXT ---\n\n';
    }
  }

  // Add current document context if available
  if (articleContent && articleContent.trim()) {
    contextMessage += '--- CURRENT DOCUMENT ---\n';
    contextMessage += articleContent;
    contextMessage += '\n--- END CURRENT DOCUMENT ---\n\n';
  }

  contextMessage += `User question: ${userRequest}`;

  const messages = [
    new SystemMessage(systemPrompt),
    ...buildHistoryMessages(chatHistory),
    new HumanMessage(contextMessage)
  ];

  try {
    const response = await model.invoke(messages);
    let responseText = response?.content || '';

    console.log('[Edit Agent] Q&A response received');
    console.log('[Edit Agent] Q&A finish_reason:', response?.response_metadata?.finish_reason || response?.response_metadata?.finishReason || 'unknown');
    if (response?.usage_metadata) {
      console.log('[Edit Agent] Q&A token usage:', JSON.stringify(response.usage_metadata));
    }

    if (wasResponseTruncated(response)) {
      console.warn('[Edit Agent] Q&A response was truncated due to token limit');
      responseText += '\n\n⚠️ *This response was cut short due to the output token limit. You can increase "Max Output Tokens" in Settings > AI / LLM Provider.*';
    }

    // Return plain text response, NOT updatedArticle JSON
    return {
      text: responseText,
      updatedArticle: null,  // Explicitly no edit
      changeSummary: null
    };
  } catch (error) {
    console.error('[Edit Agent] Q&A request error:', error.message);
    throw error;
  }
}

/**
 * Handle create document requests
 * Returns a new document with title and content
 * @param {Object} model - LangChain model instance
 * @param {string} userRequest - User's request for what to create
 * @param {string} currentContent - Current document content (for reference/context)
 * @param {Array} ragContext - Optional RAG context chunks
 */
async function handleCreateRequest(model, userRequest, currentContent, ragContext = null, persona = null, chatHistory = null) {
  console.log('[Edit Agent] Handling create document request');

  // Build create document prompt - use persona prompt if active
  let systemPrompt;
  if (persona && persona.systemPromptTemplate) {
    systemPrompt = buildPersonaPrompt(persona, userRequest, 'create');
    console.log('[Edit Agent] Using persona prompt for create:', persona.displayName);
  } else {
    systemPrompt = buildContextualPrompt(userRequest, 'create');
  }

  // Build the context message
  let contextMessage = '';

  // Add RAG context if provided
  if (ragContext && ragContext.length > 0) {
    if (persona && persona.systemPromptTemplate) {
      // Persona mode: frame as the persona's own writings
      contextMessage += 'The following passages are from your own writings. Use them as the foundation for the document you create -- express these ideas in your authentic voice.\n\n';
      for (const ctx of ragContext) {
        const section = ctx.metadata?.title || '';
        if (section) {
          contextMessage += `From your writing on "${section}":\n`;
        }
        contextMessage += (ctx.text || ctx.content || '') + '\n\n';
      }
    } else {
      // Non-persona mode: clinical source format
      contextMessage += '--- SOURCE INFORMATION FROM INDEXED FILES ---\n';
      for (const ctx of ragContext) {
        const source = ctx.metadata?.fileName || ctx.source || 'Unknown';
        const section = ctx.metadata?.title || '';
        contextMessage += `\n[Source: ${source}${section ? ' - ' + section : ''}]\n`;
        contextMessage += (ctx.text || ctx.content || '') + '\n';
      }
      contextMessage += '\n--- END SOURCE INFORMATION ---\n\n';
    }
  }

  // Add current document as reference if available
  if (currentContent && currentContent.trim()) {
    contextMessage += '--- CURRENT DOCUMENT (for reference) ---\n';
    contextMessage += currentContent;
    contextMessage += '\n--- END CURRENT DOCUMENT ---\n\n';
  }

  contextMessage += `User request: ${userRequest}\n\nPlease create a new document based on this request and the context provided.`;

  const messages = [
    new SystemMessage(systemPrompt),
    ...buildHistoryMessages(chatHistory),
    new HumanMessage(contextMessage)
  ];

  try {
    const response = await model.invoke(messages);
    const responseText = response?.content || '';

    console.log('[Edit Agent] Create document response received');

    if (wasResponseTruncated(response)) {
      console.warn('[Edit Agent] Create response was truncated due to token limit');
    }

    // Parse the JSON response
    const result = parseCreateResponse(responseText);

    // Auto-fix incorrect TOC syntax from LLM output
    if (result.content) {
      result.content = result.content.replace(/\[\[\*TOC\*\]\]/g, '[[_TOC_]]');
    }

    if (result.title && result.content) {
      // Auto-fix mermaid diagrams before validation
      const mermaidFix = mermaidValidator.autoFixMermaidInContent(result.content);
      result.content = mermaidFix.content;
      if (mermaidFix.fixCount > 0) {
        console.log(`[Edit Agent] Create: auto-fixed ${mermaidFix.fixCount} mermaid label(s)`);
      }

      // Validate mermaid after auto-fix
      const mermaidValidation = await mermaidValidator.validateMermaidInContent(result.content);
      if (!mermaidValidation.isValid) {
        console.log(`[Edit Agent] Create: mermaid validation found ${mermaidValidation.errors.length} issue(s) after auto-fix`);
        mermaidValidation.errors.forEach(err => console.log(`  - Block ${err.blockIndex}: ${err.error}`));

        // Attempt LLM remediation (same pipeline as directEdit)
        console.log('[Edit Agent] Create: attempting LLM mermaid remediation...');
        const tempResult = { updatedArticle: result.content, changeSummary: '' };
        const remediated = await validateAndRemediateMermaid(model, tempResult, userRequest);
        result.content = remediated.updatedArticle;
      }

      // Quick local markdown validation on created content
      const mdValidation = markdownValidator.validateMarkdown(result.content);
      let summary = result.summary || `Created new document: ${result.title}`;
      if (!mdValidation.isValid) {
        console.log(`[Edit Agent] Create: markdown validation found ${mdValidation.errors.length} issue(s)`);
        mdValidation.errors.forEach(err => console.log(`  - ${err}`));
        summary += ` (Warning: ${mdValidation.errors.join('; ')})`;
      }
      return {
        createDocument: true,
        title: result.title,
        content: result.content,
        summary
      };
    }

    // If parsing failed, try to use the raw response as content
    console.log('[Edit Agent] Could not parse create response, using raw text');
    return {
      createDocument: true,
      title: 'New Document',
      content: responseText,
      summary: 'Created new document from AI response'
    };
  } catch (error) {
    console.error('[Edit Agent] Create request error:', error.message);
    throw error;
  }
}

/**
 * Parse the create document response to extract title and content
 */
function parseCreateResponse(responseText) {
  // Try to find JSON in markdown code block
  const jsonBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (parsed.title || parsed.content) {
        return {
          title: parsed.title || 'New Document',
          content: parsed.content || '',
          summary: parsed.summary || null
        };
      }
    } catch (e) {
      console.log('[Edit Agent] Failed to parse JSON from create response:', e.message);
    }
  }

  // Try raw JSON
  const jsonMatch = responseText.match(/\{[\s\S]*"(?:title|content)"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || 'New Document',
        content: parsed.content || '',
        summary: parsed.summary || null
      };
    } catch (e) {
      console.log('[Edit Agent] Failed to parse raw JSON from create response:', e.message);
    }
  }

  // Return empty result if parsing failed
  return { title: null, content: null, summary: null };
}

/**
 * Process a request - handles both Q&A and edit modes
 * Automatically chooses between direct and chunking modes for edits
 * @param {string} userRequest - User's request
 * @param {string} articleContent - Current article content
 * @param {Object} options - Options including images, mode, and ragContext
 */
async function processEditRequest(userRequest, articleContent, options = {}) {
  // Support both old signature (images array) and new signature (options object)
  let images = [];
  let mode = 'edit';
  let ragContext = null;

  let visualVerifyMermaid = false;

  let persona = null;
  let chatHistory = null;

  if (Array.isArray(options)) {
    // Old signature: processEditRequest(request, content, images)
    images = options;
  } else {
    // New signature: processEditRequest(request, content, { images, mode, ragContext, visualVerifyMermaid, persona, chatHistory })
    images = options.images || [];
    mode = options.mode || 'edit';
    ragContext = options.ragContext || null;
    visualVerifyMermaid = options.visualVerifyMermaid || false;
    persona = options.persona || null;
    chatHistory = options.chatHistory || null;
  }

  console.log('[Edit Agent] processEditRequest called');
  console.log('[Edit Agent] userRequest:', userRequest);
  console.log('[Edit Agent] mode:', mode);
  console.log('[Edit Agent] articleContent type:', typeof articleContent);
  console.log('[Edit Agent] articleContent length:', articleContent ? articleContent.length : 'null/undefined');
  console.log('[Edit Agent] images:', images ? `${images.length} image(s)` : 'none');
  console.log('[Edit Agent] ragContext:', ragContext ? `${ragContext.length} chunks` : 'none');

  const config = configManager.getActiveConfig();
  console.log('[Edit Agent] Config loaded:', config.provider, config.model);

  const model = providerFactory.createModel(config.provider, config);
  console.log('[Edit Agent] Model created successfully');

  // Handle Q&A mode - no document editing
  if (mode === 'qa') {
    return handleQARequest(model, userRequest, articleContent, ragContext, persona, chatHistory);
  }

  // Handle create mode - generate a new document
  if (mode === 'create') {
    return handleCreateRequest(model, userRequest, articleContent, ragContext, persona, chatHistory);
  }

  // Edit mode: estimate tokens and choose strategy
  const tokenCount = estimateTokens(articleContent);
  console.log(`[Edit Agent] Document size: ~${tokenCount} tokens`);

  // Choose strategy based on document size
  // Note: Chunking mode doesn't support images currently, so always use direct edit if images present
  if (tokenCount < LARGE_DOC_THRESHOLD || (images && images.length > 0)) {
    return directEdit(model, userRequest, articleContent, images, visualVerifyMermaid, persona, chatHistory);
  } else {
    return chunkingEdit(model, userRequest, articleContent);
  }
}

/**
 * Get document structure analysis
 */
function analyzeDocument(articleContent) {
  const sections = splitter.splitByHeaders(articleContent);
  const tokenInfo = splitter.estimateSectionTokens(sections);
  const totalTokens = estimateTokens(articleContent);

  return {
    sectionCount: sections.length,
    estimatedTokens: totalTokens,
    isLargeDocument: totalTokens >= LARGE_DOC_THRESHOLD,
    sections: sections.map((s, i) => ({
      title: s.title,
      level: s.level,
      lines: `${s.startLine}-${s.endLine}`,
      tokens: tokenInfo[i].tokens
    }))
  };
}

module.exports = {
  processEditRequest,
  analyzeDocument,
  directEdit,
  chunkingEdit,
  LARGE_DOC_THRESHOLD
};
