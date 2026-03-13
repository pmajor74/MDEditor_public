/**
 * Query Intent Classifier
 *
 * Pattern-based classification (no LLM needed) to determine the best
 * retrieval strategy for a user query.
 */

/**
 * @typedef {'api_lookup' | 'architecture' | 'data_flow' | 'listing' | 'documentation' | 'general'} QueryIntent
 */

/**
 * Classify a query's intent for optimal retrieval strategy
 * @param {string} query - User's query
 * @returns {{ intent: QueryIntent, confidence: number, matchedPattern: string }}
 */
function classifyQuery(query) {
  if (!query || typeof query !== 'string') {
    return { intent: 'general', confidence: 0, matchedPattern: null };
  }

  const normalized = query.toLowerCase().trim();

  // Check each intent category in priority order
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    for (const { regex, label, weight } of patterns) {
      if (regex.test(normalized)) {
        return {
          intent,
          confidence: weight || 0.8,
          matchedPattern: label
        };
      }
    }
  }

  return { intent: 'general', confidence: 0.5, matchedPattern: null };
}

// ============================================
// Intent Pattern Definitions
// ============================================

const INTENT_PATTERNS = {
  documentation: [
    { regex: /(?:write|generate|create)\s+(?:developer\s+)?(?:documentation|docs)/, label: 'write_docs', weight: 0.95 },
    { regex: /(?:document|create\s+a?\s*guide\s+for)\s+(?:this|the)\s+(?:codebase|project|code)/, label: 'document_codebase', weight: 0.95 },
    { regex: /(?:generate|write)\s+(?:a\s+)?(?:developer\s+guide|technical\s+docs)/, label: 'dev_guide', weight: 0.95 },
    { regex: /(?:create|produce)\s+(?:api\s+)?(?:reference|documentation)/, label: 'api_docs', weight: 0.9 },
    { regex: /(?:write|make)\s+(?:a\s+)?readme/, label: 'readme', weight: 0.85 }
  ],

  api_lookup: [
    { regex: /(?:what|how)\s+(?:does|do)\s+(\w+)\s+(?:do|work|function|method)/, label: 'what_does_function', weight: 0.9 },
    { regex: /(?:explain|describe)\s+(?:the\s+)?(\w+)\s+(?:function|method|class|api)/, label: 'explain_function', weight: 0.9 },
    { regex: /(?:signature|parameters?|params|arguments?|return\s*type)\s+(?:of|for)\s+/, label: 'signature_lookup', weight: 0.9 },
    { regex: /(?:what|which)\s+(?:parameters?|args?)\s+(?:does|do)/, label: 'param_query', weight: 0.85 },
    { regex: /how\s+(?:to|do\s+(?:I|you))\s+(?:call|use|invoke)\s+/, label: 'how_to_call', weight: 0.85 },
    { regex: /(?:what|where)\s+(?:is|are)\s+(?:the\s+)?(?:function|method|class|interface)\s+/, label: 'locate_function', weight: 0.8 }
  ],

  architecture: [
    { regex: /(?:how|what)\s+(?:is|are)\s+(?:the\s+)?(?:architecture|structure|organized|laid\s*out)/, label: 'architecture_query', weight: 0.9 },
    { regex: /(?:explain|describe|show)\s+(?:the\s+)?(?:architecture|project\s+structure|codebase\s+structure)/, label: 'explain_architecture', weight: 0.9 },
    { regex: /(?:what|which)\s+(?:modules?|layers?|components?)\s+(?:are|exist|does)/, label: 'module_query', weight: 0.85 },
    { regex: /(?:how)\s+(?:is|are)\s+(?:the\s+)?(?:\w+\s+)?(?:code|project|app|system|codebase)\s+(?:organized|structured)/, label: 'how_organized', weight: 0.85 },
    { regex: /(?:overview|summary)\s+(?:of\s+)?(?:the\s+)?(?:codebase|project|system)/, label: 'overview_query', weight: 0.8 },
    { regex: /(?:what|which)\s+(?:tech|technology|framework|tool)\s+(?:stack|is\s+used)/, label: 'tech_stack', weight: 0.8 }
  ],

  data_flow: [
    { regex: /(?:how)\s+(?:does|do)\s+(?:a\s+)?(?:request|data|message|event)\s+(?:flow|travel|pass|get\s+(?:from|to))/, label: 'data_flow', weight: 0.9 },
    { regex: /(?:trace|follow)\s+(?:the\s+)?(?:flow|path|chain)\s+(?:of|from)/, label: 'trace_flow', weight: 0.9 },
    { regex: /(?:what|which)\s+(?:calls?|invokes?|triggers?|uses?)\s+/, label: 'call_chain', weight: 0.8 },
    { regex: /(?:what)\s+(?:depends?\s+on|is\s+(?:imported|used)\s+by)\s+/, label: 'dependants', weight: 0.85 },
    { regex: /(?:what|which)\s+(?:files?\s+)?(?:import|require|use)\s+/, label: 'dependencies', weight: 0.8 }
  ],

  listing: [
    { regex: /(?:list|show|what\s+are)\s+(?:all\s+)?(?:exported?\s+)?(?:functions?|methods?|classes?|interfaces?)/, label: 'list_functions', weight: 0.9 },
    { regex: /(?:list|show|what\s+are)\s+(?:all\s+)?(?:modules?|components?|files?)/, label: 'list_modules', weight: 0.85 },
    { regex: /(?:how\s+many)\s+(?:functions?|methods?|files?|modules?|exports?)/, label: 'count_query', weight: 0.8 },
    { regex: /(?:all|every)\s+(?:exported?\s+)?(?:functions?|methods?|apis?)\s+(?:in|from)/, label: 'all_exports', weight: 0.85 }
  ]
};

/**
 * Check if a query is a documentation generation request
 * @param {string} query - User's query
 * @returns {boolean}
 */
function isDocumentationRequest(query) {
  const result = classifyQuery(query);
  return result.intent === 'documentation';
}

module.exports = {
  classifyQuery,
  isDocumentationRequest
};
