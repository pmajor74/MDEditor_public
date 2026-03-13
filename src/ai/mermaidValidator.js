/**
 * Mermaid Diagram Validator
 *
 * Validates mermaid diagram syntax using pattern-based validation.
 * Returns detailed error messages that can be fed back to the LLM for correction.
 *
 * Note: We use pattern-based validation instead of mermaid.parse() because
 * mermaid is designed for browser environments and doesn't work reliably
 * in Electron's main process.
 */

/**
 * Extract all mermaid code blocks from markdown content
 * @param {string} content - Markdown content
 * @returns {Array} Array of {code, startIndex, endIndex} objects
 */
function extractMermaidBlocks(content) {
  const blocks = [];
  const regex = /```mermaid\r?\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      code: match[1].trim(),
      fullMatch: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }

  return blocks;
}

/**
 * Validate a single mermaid diagram using pattern-based rules
 * @param {string} code - Mermaid diagram code (without the code fence)
 * @returns {Object} {isValid: boolean, error: string|null, details: string|null}
 */
async function validateMermaidSyntax(code) {
  if (!code || code.trim().length === 0) {
    return { isValid: false, error: 'Empty mermaid diagram', details: null };
  }

  // Use comprehensive pattern-based validation
  return comprehensiveValidation(code);
}

/**
 * Comprehensive pattern-based mermaid validation
 */
function comprehensiveValidation(code) {
  const lines = code.split('\n');
  const firstLine = lines[0].trim();

  // Check for valid diagram type
  const validTypes = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
    'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'journey',
    'gantt', 'pie', 'mindmap', 'timeline', 'gitGraph', 'C4Context',
    'quadrantChart', 'sankey', 'xychart', 'block'
  ];

  const diagramTypeMatch = firstLine.match(/^(\w+[\w-]*)/);
  const diagramType = diagramTypeMatch ? diagramTypeMatch[1] : null;

  if (!diagramType || !validTypes.some(t => diagramType.toLowerCase().startsWith(t.toLowerCase()))) {
    return {
      isValid: false,
      error: `Invalid or missing diagram type. First line should start with: ${validTypes.slice(0, 5).join(', ')}, etc.`,
      details: `Found: "${firstLine.substring(0, 50)}"`
    };
  }

  // Type-specific validation
  if (diagramType === 'flowchart' || diagramType === 'graph') {
    return validateFlowchart(code, lines);
  } else if (diagramType === 'sequenceDiagram') {
    return validateSequenceDiagram(code, lines);
  } else if (diagramType === 'erDiagram') {
    return validateERDiagram(code, lines);
  }

  // Generic validation for other types
  return validateGeneric(code, lines);
}

/**
 * Find node labels that span multiple lines (common LLM error)
 * Returns array of {line, preview} objects
 */
function findMultiLineLabels(code) {
  const results = [];
  const lines = code.split('\n');

  // Track open brackets across lines
  let inLabel = false;
  let labelStart = -1;
  let bracketType = '';
  let labelContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inLabel) {
      // Check for opening brackets: [ ( {
      // But ignore subgraph lines and comments
      if (line.includes('subgraph') || line.trim().startsWith('%%')) continue;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '[' || char === '(' || char === '{') {
          // Find if there's a matching close on this line
          const closeChar = char === '[' ? ']' : char === '(' ? ')' : '}';
          const restOfLine = line.substring(j + 1);

          // Handle quoted labels like ["text"]
          if (restOfLine.startsWith('"')) {
            const quoteEnd = restOfLine.indexOf('"]');
            if (quoteEnd === -1 && !restOfLine.includes(closeChar)) {
              // Quoted label not closed on this line
              inLabel = true;
              labelStart = i + 1;
              bracketType = char;
              labelContent = restOfLine.substring(0, 30);
              break;
            }
          } else if (!restOfLine.includes(closeChar)) {
            // Regular label not closed on this line
            inLabel = true;
            labelStart = i + 1;
            bracketType = char;
            labelContent = restOfLine.substring(0, 30);
            break;
          }
        }
      }
    } else {
      // We're in a multi-line label - this is an error
      const closeChar = bracketType === '[' ? ']' : bracketType === '(' ? ')' : '}';
      results.push({
        line: labelStart,
        preview: labelContent + '...(continues to line ' + (i + 1) + ')'
      });
      inLabel = false;

      // Check if this line closes it
      if (line.includes(closeChar)) {
        inLabel = false;
      }
    }
  }

  // If still in a label at end of code, that's an error too
  if (inLabel) {
    results.push({
      line: labelStart,
      preview: labelContent + '...(never closed)'
    });
  }

  return results;
}

/**
 * Validate flowchart/graph diagrams
 */
function validateFlowchart(code, lines) {
  const errors = [];

  // CRITICAL: Check for statements on the same line as diagram declaration
  const firstLine = lines[0].trim();
  if (firstLine.includes('-->') || firstLine.includes('---') || firstLine.match(/\w+\[/)) {
    errors.push(`Line 1: Diagram declaration has nodes/arrows on same line. Put "flowchart TD" on its own line, then nodes/arrows on subsequent lines.`);
  }

  // CRITICAL: Check for quoted strings used directly in arrows (very common LLM error)
  // Pattern: --> "some text" or --> 'some text'
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check for arrows pointing directly to quoted strings
    if (line.match(/-->\s*["'][^"']+["']/) || line.match(/---\s*["'][^"']+["']/)) {
      errors.push(`Line ${i + 1}: Cannot use quoted string directly as arrow target. Use node ID with label instead: nodeId["Label"] not --> "Label"`);
    }
    // Check for arrows pointing FROM quoted strings
    if (line.match(/["'][^"']+["']\s*-->/)) {
      errors.push(`Line ${i + 1}: Cannot use quoted string directly as arrow source. Define a node first: nodeId["Label"] --> ...`);
    }
  }

  // CRITICAL: Check for multi-line node labels (newlines inside brackets)
  // This is a very common LLM error that causes parse failures
  const multiLineLabels = findMultiLineLabels(code);
  if (multiLineLabels.length > 0) {
    for (const match of multiLineLabels) {
      errors.push(`Node label spans multiple lines (line ~${match.line}): "${match.preview}". Labels must be on a single line.`);
    }
  }

  // Check for unclosed labels that span to next line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check for opening bracket without closing on same line
    const openBrackets = (line.match(/\[(?![^\]]*\])/g) || []).length;
    const openParens = (line.match(/\((?![^)]*\))/g) || []).length;
    if (openBrackets > 0 && !line.includes(']')) {
      errors.push(`Line ${i + 1}: Unclosed square bracket - label must be on single line`);
    }
    if (openParens > 0 && !line.includes(')') && !line.includes('subgraph')) {
      errors.push(`Line ${i + 1}: Unclosed parenthesis - label must be on single line`);
    }
  }

  // Check bracket balance
  const openSquare = (code.match(/\[/g) || []).length;
  const closeSquare = (code.match(/\]/g) || []).length;
  if (openSquare !== closeSquare) {
    errors.push(`Unbalanced square brackets: ${openSquare} opening, ${closeSquare} closing`);
  }

  const openParen = (code.match(/\(/g) || []).length;
  const closeParen = (code.match(/\)/g) || []).length;
  if (openParen !== closeParen) {
    errors.push(`Unbalanced parentheses: ${openParen} opening, ${closeParen} closing`);
  }

  const openBrace = (code.match(/\{/g) || []).length;
  const closeBrace = (code.match(/\}/g) || []).length;
  // Account for subgraph end statements
  const subgraphEnds = (code.match(/^\s*end\s*$/gm) || []).length;
  if (openBrace !== closeBrace + subgraphEnds && openBrace !== closeBrace) {
    errors.push(`Unbalanced curly braces: ${openBrace} opening, ${closeBrace} closing`);
  }

  // Check for problematic node IDs (starting with numbers, containing hyphens/spaces)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%%') || line === 'end') continue;

    // Match node definitions: nodeId[label] or nodeId(label) or nodeId{label}
    const nodeDefMatch = line.match(/^(\S+?)[\[\(\{>]/);
    if (nodeDefMatch) {
      const nodeId = nodeDefMatch[1];

      // Check if node ID starts with a number
      if (/^\d/.test(nodeId)) {
        errors.push(`Line ${i + 1}: Node ID "${nodeId}" starts with a number. Use a letter prefix like "n${nodeId}"`);
      }

      // Check for hyphens in node IDs (but not in subgraph names)
      if (nodeId.includes('-') && !line.includes('subgraph')) {
        errors.push(`Line ${i + 1}: Node ID "${nodeId}" contains hyphen. Use underscores instead: "${nodeId.replace(/-/g, '_')}"`);
      }
    }

    // Check for unquoted labels with special characters
    const labelMatch = line.match(/\[([^\]"]+)\]/);
    if (labelMatch) {
      const label = labelMatch[1];
      // Check for problematic characters that need quoting
      if (/[\(\):]/.test(label) && !label.startsWith('"')) {
        errors.push(`Line ${i + 1}: Label "${label.substring(0, 30)}" contains special characters. Use quotes: ["${label}"]`);
      }
    }

    // Check for embedded quotes inside diamond/curly brace labels
    // e.g., {Does name start with "DV-"?} — inner quotes break mermaid parser
    const diamondMatch = line.match(/\{([^}]+)\}/);
    if (diamondMatch) {
      const label = diamondMatch[1];
      // If label starts with " and ends with " it's properly quoted — skip
      const isProperlyQuoted = label.startsWith('"') && label.endsWith('"');
      if (!isProperlyQuoted && label.includes('"')) {
        errors.push(`Line ${i + 1}: Diamond label contains embedded quotes which break rendering. Remove inner quotes or use single quotes: {Does name start with 'DV-'?}`);
      }
    }

    // Check for chained arrows on single line (problematic pattern)
    const arrowCount = (line.match(/-->/g) || []).length;
    if (arrowCount > 1 && !line.includes('|')) {
      errors.push(`Line ${i + 1}: Multiple arrows on one line. Split into separate lines for clarity.`);
    }

    // Check for spaces in node IDs (common error)
    const spaceNodeMatch = line.match(/(\w+\s+\w+)[\[\(\{]/);
    if (spaceNodeMatch && !line.includes('subgraph')) {
      errors.push(`Line ${i + 1}: Possible space in node ID "${spaceNodeMatch[1]}". Node IDs cannot contain spaces.`);
    }
  }

  // Check subgraph balance
  const subgraphOpens = (code.match(/subgraph\s/g) || []).length;
  const subgraphCloses = (code.match(/^\s*end\s*$/gm) || []).length;
  if (subgraphOpens !== subgraphCloses) {
    errors.push(`Unbalanced subgraphs: ${subgraphOpens} 'subgraph' but ${subgraphCloses} 'end'`);
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      error: errors[0],
      details: errors.length > 1 ? `Additional issues: ${errors.slice(1).join('; ')}` : null
    };
  }

  return { isValid: true, error: null, details: null };
}

/**
 * Validate sequence diagrams
 */
function validateSequenceDiagram(code, lines) {
  const errors = [];

  // Check for valid participant declarations
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%%')) continue;

    // Check arrow syntax
    if (line.includes('->>') || line.includes('-->>') || line.includes('-x') || line.includes('-)')) {
      // Valid arrow patterns
      const validArrowPattern = /^[\w\s]+(->>|-->>|-\)|--\)|-x|--x)[\w\s]+:/;
      if (!validArrowPattern.test(line) && !line.startsWith('Note') && !line.startsWith('loop') &&
          !line.startsWith('alt') && !line.startsWith('opt') && !line.startsWith('par') &&
          !line.startsWith('end') && !line.startsWith('else') && !line.startsWith('and')) {
        // Only flag if it looks like an arrow but doesn't match
        if (line.includes('-') && line.includes('>')) {
          errors.push(`Line ${i + 1}: Possible invalid arrow syntax in "${line.substring(0, 40)}"`);
        }
      }
    }
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      error: errors[0],
      details: errors.length > 1 ? `Additional issues: ${errors.slice(1).join('; ')}` : null
    };
  }

  return { isValid: true, error: null, details: null };
}

/**
 * Validate ER diagrams
 */
function validateERDiagram(code, lines) {
  const errors = [];

  // Check for valid relationship syntax
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%%')) continue;

    // Check for entity definitions with attributes
    if (line.includes('{')) {
      const braceBalance = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      // This is okay if we're opening a block
    }

    // Check relationship syntax
    if (line.includes('||') || line.includes('o{') || line.includes('}o') || line.includes('}|')) {
      // Valid ER relationship patterns
      if (!/\w+\s*(\|\||\|o|o\||\}o|o\{|\|\{|\}\|)--(\|\||\|o|o\||\}o|o\{|\|\{|\}\|)\s*\w+/.test(line) &&
          !line.includes(':')) {
        // Be lenient - only flag obvious issues
      }
    }
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      error: errors[0],
      details: errors.length > 1 ? `Additional issues: ${errors.slice(1).join('; ')}` : null
    };
  }

  return { isValid: true, error: null, details: null };
}

/**
 * Generic validation for other diagram types
 */
function validateGeneric(code, lines) {
  // Basic structure validation
  if (lines.length < 2) {
    return {
      isValid: false,
      error: 'Diagram appears incomplete (only header line)',
      details: null
    };
  }

  return { isValid: true, error: null, details: null };
}

/**
 * Validate all mermaid blocks in markdown content
 * @param {string} content - Full markdown content
 * @returns {Object} {isValid: boolean, errors: Array<{blockIndex, code, error, details}>}
 */
async function validateMermaidInContent(content) {
  const blocks = extractMermaidBlocks(content);

  if (blocks.length === 0) {
    return { isValid: true, errors: [], hasBlocks: false };
  }

  const errors = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const result = await validateMermaidSyntax(block.code);

    if (!result.isValid) {
      errors.push({
        blockIndex: i + 1,
        code: block.code.substring(0, 100) + (block.code.length > 100 ? '...' : ''),
        error: result.error,
        details: result.details
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    hasBlocks: true,
    blockCount: blocks.length
  };
}

/**
 * Format validation errors for display to LLM for remediation
 * @param {Array} errors - Array of error objects from validateMermaidInContent
 * @returns {string} Formatted error message
 */
function formatErrorsForLLM(errors) {
  if (!errors || errors.length === 0) return '';

  const formatted = errors.map(err => {
    let msg = `Mermaid Block ${err.blockIndex} Error: ${err.error}`;
    if (err.details) {
      msg += `\nDetails: ${err.details}`;
    }
    if (err.code) {
      msg += `\nCode snippet: ${err.code}`;
    }
    return msg;
  }).join('\n\n');

  return `The mermaid diagram(s) have syntax errors that must be fixed:\n\n${formatted}`;
}

/**
 * Auto-fix unquoted labels with special characters in flowchart/graph mermaid code.
 * Fixes patterns like `[Label (x)]` → `["Label (x)"]` and `{Label (x)}` → `{"Label (x)"}`
 * @param {string} mermaidCode - Raw mermaid diagram code (without fences)
 * @returns {Object} {code: string, fixCount: number}
 */
function autoFixFlowchartLabels(mermaidCode) {
  const lines = mermaidCode.split('\n');
  const firstLine = lines[0].trim();

  // Only apply to flowchart/graph diagrams
  if (!/^(flowchart|graph)\s/i.test(firstLine)) {
    return { code: mermaidCode, fixCount: 0 };
  }

  let fixCount = 0;
  const fixedLines = lines.map((line, idx) => {
    // Skip first line (diagram declaration), comments, subgraph lines, 'end' lines
    if (idx === 0) return line;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith('subgraph') || trimmed === 'end') {
      return line;
    }

    // Fix unquoted labels in square brackets: nodeId[Label (x)] → nodeId["Label (x)"]
    // Match [...] but skip already-quoted ["..."] and skip edge labels |...|
    let fixed = line.replace(/\[([^\]"]+)\]/g, (match, label) => {
      // Skip if this looks like a link label |text|
      if (match === `[${label}]` && /[\(\):,\/]/.test(label)) {
        fixCount++;
        return `["${label}"]`;
      }
      return match;
    });

    // Fix diamond labels with embedded quotes: {text with "quotes"} → {"text with 'quotes'"}
    fixed = fixed.replace(/\{([^}]*"[^}]*)\}/g, (match, label) => {
      // Skip already properly quoted: {"label"}
      if (label.startsWith('"') && label.endsWith('"')) return match;
      fixCount++;
      // Replace inner double quotes with single quotes, then wrap in proper mermaid quotes
      const cleaned = label.replace(/"/g, "'");
      return `{"${cleaned}"}`;
    });

    // Fix unquoted labels in curly braces: nodeId{Label (x)} → nodeId{"Label (x)"}
    // Only fix if contains special chars — plain text in {} is fine (diamond shape)
    fixed = fixed.replace(/\{([^}"]+)\}/g, (match, label) => {
      if (/[\(\):,\/]/.test(label)) {
        fixCount++;
        return `{"${label}"}`;
      }
      return match;
    });

    return fixed;
  });

  return { code: fixedLines.join('\n'), fixCount };
}

/**
 * Auto-fix mermaid diagrams in markdown content.
 * Extracts mermaid blocks, applies label quoting fixes, and reassembles.
 * @param {string} content - Full markdown content
 * @returns {Object} {content: string, fixCount: number}
 */
function autoFixMermaidInContent(content) {
  if (!content) return { content, fixCount: 0 };

  let totalFixes = 0;
  // Replace each mermaid block with its fixed version
  const fixedContent = content.replace(/```mermaid\r?\n([\s\S]*?)```/g, (fullMatch, code) => {
    const { code: fixedCode, fixCount } = autoFixFlowchartLabels(code.trim());
    totalFixes += fixCount;
    // Preserve original line ending style
    const lineEnding = fullMatch.startsWith('```mermaid\r\n') ? '\r\n' : '\n';
    return '```mermaid' + lineEnding + fixedCode + lineEnding + '```';
  });

  if (totalFixes > 0) {
    console.log(`[Mermaid Validator] Auto-fixed ${totalFixes} unquoted label(s) with special characters`);
  }

  return { content: fixedContent, fixCount: totalFixes };
}

/**
 * Convenience: auto-fix then validate mermaid in content.
 * @param {string} content - Full markdown content
 * @returns {Promise<Object>} {content, fixCount, validation}
 */
async function autoFixAndValidate(content) {
  const fixResult = autoFixMermaidInContent(content);
  const validation = await validateMermaidInContent(fixResult.content);
  return {
    content: fixResult.content,
    fixCount: fixResult.fixCount,
    validation
  };
}

module.exports = {
  validateMermaidSyntax,
  validateMermaidInContent,
  extractMermaidBlocks,
  formatErrorsForLLM,
  autoFixFlowchartLabels,
  autoFixMermaidInContent,
  autoFixAndValidate
};
