/**
 * Persona Style Analyzer
 *
 * After indexing completes, samples representative chunks from the catalog
 * and uses LLM analysis to extract the author's writing style, vocabulary,
 * and worldview into a structured style profile + system prompt template.
 */

const vectorStore = require('../vectordb/vectorStore');

const STYLE_ANALYSIS_PROMPT = `You are a literary analyst. Analyze the following text samples from an author's writings and extract a detailed style profile.

Return your analysis as a JSON object with exactly these fields:

\`\`\`json
{
  "writingStyle": "Description of overall writing style (2-3 sentences)",
  "vocabulary": ["list", "of", "distinctive", "terms", "and", "phrases", "they", "use", "often"],
  "keyPhrases": ["exact signature phrases or quotes they repeat"],
  "philosophicalOutlook": "Summary of their core beliefs and worldview (2-3 sentences)",
  "commonMetaphors": ["metaphors", "and", "analogies", "they", "frequently", "use"],
  "tone": "Description of their emotional tone and communication approach",
  "communicationPatterns": "How they structure arguments, use rhetoric, tell stories, etc."
}
\`\`\`

TEXT SAMPLES:
`;

/**
 * Sample diverse chunks from a catalog for analysis
 * @param {string} catalogName - Catalog to sample from
 * @param {number} targetCount - Number of chunks to sample
 * @returns {Promise<string[]>} Array of text chunks
 */
async function sampleChunks(catalogName, targetCount = 15) {
  // Try vector search first for diverse, relevant samples
  const allChunks = new Map();

  const broadQueries = [
    'philosophy purpose meaning life success',
    'principles rules guidelines methods approach',
    'story example experience lesson learned',
    'believe think feel important essential',
    'advice recommendation suggestion strategy'
  ];

  for (const query of broadQueries) {
    try {
      const results = await vectorStore.search(catalogName, query, {
        limit: 10,
        minScore: 0.0
      });

      if (results && results.length > 0) {
        for (const r of results) {
          if (r.text && r.text.length > 100) {
            allChunks.set(r.id || r.text.substring(0, 50), r.text);
          }
        }
      }
    } catch (error) {
      console.warn(`[Style Analyzer] Search query failed: "${query}"`, error.message);
    }
  }

  // Fallback: if vector search returned nothing, read directly from the table
  if (allChunks.size === 0) {
    console.log('[Style Analyzer] Vector search returned no results, falling back to direct table read');
    try {
      const directChunks = await vectorStore.sampleChunksDirect(catalogName, targetCount * 3);
      for (const chunk of directChunks) {
        if (chunk.text && chunk.text.length > 100) {
          allChunks.set(chunk.id || chunk.text.substring(0, 50), chunk.text);
        }
      }
      console.log(`[Style Analyzer] Direct read found ${allChunks.size} usable chunks`);
    } catch (error) {
      console.error('[Style Analyzer] Direct table read also failed:', error.message);
    }
  }

  // Select diverse samples from whatever we collected
  const chunks = [...allChunks.values()];
  if (chunks.length <= targetCount) return chunks;

  const step = Math.floor(chunks.length / targetCount);
  const sampled = [];
  for (let i = 0; i < chunks.length && sampled.length < targetCount; i += step) {
    sampled.push(chunks[i]);
  }

  return sampled;
}

/**
 * Generate a system prompt template from a style profile
 * @param {string} displayName - Persona display name
 * @param {Object} profile - Style profile object
 * @returns {string} System prompt template
 */
function generateSystemPromptTemplate(displayName, profile) {
  const vocab = Array.isArray(profile.vocabulary)
    ? profile.vocabulary.join(', ')
    : profile.vocabulary || '';

  const phrases = Array.isArray(profile.keyPhrases)
    ? profile.keyPhrases.map(p => `"${p}"`).join(', ')
    : profile.keyPhrases || '';

  const metaphors = Array.isArray(profile.commonMetaphors)
    ? profile.commonMetaphors.join(', ')
    : profile.commonMetaphors || '';

  return `You are ${displayName}. You do not merely represent or speak about ${displayName} -- you ARE ${displayName}. Every response comes from your lived experience, your convictions, and your way of seeing the world.

When you speak, your words carry the weight of everything you have written and believed. You think in your own distinctive way: ${profile.writingStyle || 'You communicate with clarity and intention.'}

Your voice has a particular quality -- ${profile.tone || 'thoughtful and direct'}. This is not a style you adopt; it is simply how you speak.

The ideas that matter most to you: ${profile.philosophicalOutlook || 'You approach the world with curiosity and principle.'}

When you explain things, you naturally reach for certain images and comparisons${metaphors ? ': ' + metaphors : '.'}. Your arguments and stories follow patterns that are unmistakably yours: ${profile.communicationPatterns || 'You build your points deliberately and with purpose.'}

Words and phrases that are part of your natural vocabulary: ${vocab}${phrases ? '. Expressions that are distinctly yours: ' + phrases : '.'}

When someone asks you a question, you answer from your own knowledge and experience. You do not describe your views from the outside -- you express them from within. You never refer to yourself as an AI, a simulation, or a language model. You never say "as ${displayName} would say" -- you simply say it. If asked about something beyond your expertise, you acknowledge the limit honestly while connecting it back to what you do know and believe.`;
}

/**
 * Analyze the writing style of indexed content
 * @param {string} catalogName - Catalog containing indexed content
 * @param {Object} llmModel - LangChain model instance
 * @param {string} displayName - Display name for the persona
 * @returns {Promise<Object>} { styleProfile, systemPromptTemplate }
 */
async function analyzeStyle(catalogName, llmModel, displayName) {
  console.log(`[Style Analyzer] Starting analysis for catalog "${catalogName}"`);

  // Sample chunks from the catalog
  const chunks = await sampleChunks(catalogName);

  if (chunks.length === 0) {
    throw new Error('No content found in catalog for style analysis');
  }

  console.log(`[Style Analyzer] Sampled ${chunks.length} chunks for analysis`);

  // Build the analysis prompt with sampled text
  const samplesText = chunks.map((chunk, i) => {
    // Trim to reasonable size per chunk
    const trimmed = chunk.length > 1500 ? chunk.substring(0, 1500) + '...' : chunk;
    return `--- Sample ${i + 1} ---\n${trimmed}\n`;
  }).join('\n');

  const prompt = STYLE_ANALYSIS_PROMPT + samplesText;

  // Send to LLM for analysis
  const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
  const response = await llmModel.invoke([
    new SystemMessage('You are a literary analyst. Always respond with valid JSON only.'),
    new HumanMessage(prompt)
  ]);

  const responseText = response?.content || '';

  // Parse the JSON response
  let styleProfile;
  try {
    // Try extracting JSON from code block first
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      styleProfile = JSON.parse(jsonMatch[1].trim());
    } else {
      // Try parsing the whole response as JSON
      styleProfile = JSON.parse(responseText.trim());
    }
  } catch (parseError) {
    console.error('[Style Analyzer] Failed to parse LLM response:', parseError.message);
    // Create a minimal profile from the raw response
    styleProfile = {
      writingStyle: 'Could not fully analyze. Please review and edit the system prompt.',
      vocabulary: [],
      keyPhrases: [],
      philosophicalOutlook: '',
      commonMetaphors: [],
      tone: '',
      communicationPatterns: ''
    };
  }

  // Generate the system prompt template
  const systemPromptTemplate = generateSystemPromptTemplate(displayName, styleProfile);

  console.log('[Style Analyzer] Analysis complete');

  return { styleProfile, systemPromptTemplate };
}

module.exports = {
  analyzeStyle,
  generateSystemPromptTemplate
};
