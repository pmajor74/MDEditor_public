/**
 * Markdown Validator for AI-generated content
 *
 * Validates markdown syntax to catch common errors before applying
 * AI-generated changes to the editor.
 */

/**
 * Validate markdown content
 * @param {string} content - The markdown content to validate
 * @returns {Object} Validation result with isValid and errors array
 */
function validateMarkdown(content) {
  const errors = [];

  if (!content || typeof content !== 'string') {
    return { isValid: false, errors: ['Content is empty or invalid'] };
  }

  // Check for unclosed code blocks
  const codeBlockErrors = validateCodeBlocks(content);
  errors.push(...codeBlockErrors);

  // Validate Mermaid blocks
  const mermaidErrors = validateMermaidBlocks(content);
  errors.push(...mermaidErrors);

  // Check for broken link syntax
  const linkErrors = validateLinkSyntax(content);
  errors.push(...linkErrors);

  // Check heading structure
  const headingErrors = validateHeadingStructure(content);
  errors.push(...headingErrors);

  // Check for unbalanced formatting
  const formatErrors = validateFormatting(content);
  errors.push(...formatErrors);

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Check for unclosed code blocks
 */
function validateCodeBlocks(content) {
  const errors = [];

  // Count triple backticks
  const backtickMatches = content.match(/```/g);
  if (backtickMatches && backtickMatches.length % 2 !== 0) {
    errors.push('Unclosed code block detected (odd number of ``` markers)');
  }

  // Check for code blocks that might be missing language specifier
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1];
    const blockContent = match[2];

    // Warn about potential issues but don't error
    if (!language && blockContent.trim().length > 0) {
      // This is fine, just no language specified
    }
  }

  return errors;
}

/**
 * Validate Mermaid diagram blocks
 */
function validateMermaidBlocks(content) {
  const errors = [];

  // Extract mermaid blocks
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
  let match;
  let blockIndex = 0;

  while ((match = mermaidRegex.exec(content)) !== null) {
    blockIndex++;
    const mermaidContent = match[1].trim();

    if (!mermaidContent) {
      errors.push(`Mermaid block ${blockIndex} is empty`);
      continue;
    }

    // Check for valid diagram type declaration
    const validTypes = [
      'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
      'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'journey',
      'gantt', 'pie', 'mindmap', 'timeline', 'gitGraph'
    ];

    const firstLine = mermaidContent.split('\n')[0].trim();
    const hasValidType = validTypes.some(type =>
      firstLine.startsWith(type) || firstLine.toLowerCase().startsWith(type.toLowerCase())
    );

    if (!hasValidType) {
      errors.push(`Mermaid block ${blockIndex} may have invalid diagram type: "${firstLine.substring(0, 30)}..."`);
    }

    // Check for unbalanced brackets in flowcharts
    if (firstLine.startsWith('graph') || firstLine.startsWith('flowchart')) {
      const openBrackets = (mermaidContent.match(/\[/g) || []).length;
      const closeBrackets = (mermaidContent.match(/\]/g) || []).length;
      if (openBrackets !== closeBrackets) {
        errors.push(`Mermaid block ${blockIndex} has unbalanced square brackets`);
      }

      const openParens = (mermaidContent.match(/\(/g) || []).length;
      const closeParens = (mermaidContent.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        errors.push(`Mermaid block ${blockIndex} has unbalanced parentheses`);
      }

      const openBraces = (mermaidContent.match(/\{/g) || []).length;
      const closeBraces = (mermaidContent.match(/\}/g) || []).length;
      if (openBraces !== closeBraces) {
        errors.push(`Mermaid block ${blockIndex} has unbalanced curly braces`);
      }
    }
  }

  return errors;
}

/**
 * Check for broken link syntax
 */
function validateLinkSyntax(content) {
  const errors = [];
  const warnings = [];

  // Check for common link syntax errors
  // Pattern: [text](url) - look for malformed versions

  // Missing closing bracket
  const brokenLinks = content.match(/\[[^\]]*\([^)]*$/gm);
  if (brokenLinks) {
    errors.push('Potentially malformed link syntax detected');
  }

  // Check for image syntax issues
  const brokenImages = content.match(/!\[[^\]]*\](?!\()/gm);
  if (brokenImages && brokenImages.length > 0) {
    // Filter out valid references like ![alt][ref]
    const actualBroken = brokenImages.filter(img => !img.match(/!\[[^\]]*\]\[[^\]]*\]/));
    if (actualBroken.length > 0) {
      errors.push('Potentially malformed image syntax detected');
    }
  }

  // Check for over-escaped link syntax: \[text\]\(url\)
  // This is a common issue with AI-generated content
  const escapedLinkPattern = /\\\[([^\]]*)\\\]\s*\\\(([^)]*)\\\)/g;
  const escapedLinkMatches = content.match(escapedLinkPattern);
  if (escapedLinkMatches && escapedLinkMatches.length > 0) {
    errors.push(`Found ${escapedLinkMatches.length} over-escaped link(s) - brackets/parens should not be escaped in markdown links`);
  }

  // Check for partially escaped links (only brackets or only parens escaped)
  const partiallyEscapedBrackets = content.match(/\\\[[^\]]*\\\](?:\s*\([^)]*\))/g);
  const partiallyEscapedParens = content.match(/\[[^\]]*\](?:\s*\\\([^)]*\\\))/g);
  if ((partiallyEscapedBrackets && partiallyEscapedBrackets.length > 0) ||
      (partiallyEscapedParens && partiallyEscapedParens.length > 0)) {
    errors.push('Found partially escaped link syntax - ensure brackets and parentheses are not escaped');
  }

  // Check for incorrect TOC syntax
  if (content.includes('[[*TOC*]]')) {
    errors.push('Incorrect TOC syntax: use [[_TOC_]] with underscores, not [[*TOC*]] with asterisks');
  }

  return errors;
}

/**
 * Validate heading structure
 */
function validateHeadingStructure(content) {
  const errors = [];

  // Extract headings
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2],
      index: match.index
    });
  }

  // Check for heading level jumps (e.g., h1 directly to h3)
  for (let i = 1; i < headings.length; i++) {
    const prevLevel = headings[i - 1].level;
    const currLevel = headings[i].level;

    if (currLevel > prevLevel + 1) {
      // This is a warning-level issue, not a hard error
      // errors.push(`Heading level jump from h${prevLevel} to h${currLevel} near "${headings[i].text.substring(0, 20)}"`);
    }
  }

  // Check for empty headings
  const emptyHeadings = content.match(/^#{1,6}\s*$/gm);
  if (emptyHeadings) {
    errors.push('Empty heading detected');
  }

  return errors;
}

/**
 * Check for unbalanced formatting markers
 */
function validateFormatting(content) {
  const errors = [];

  // Check for unbalanced bold markers (allow single asterisks for lists)
  const boldMarkers = content.match(/\*\*/g);
  if (boldMarkers && boldMarkers.length % 2 !== 0) {
    errors.push('Unbalanced bold markers (**) detected');
  }

  // Check for unbalanced italic markers (harder to detect due to list items)
  // Skip this check as it has too many false positives

  // Check for unbalanced strikethrough
  const strikeMarkers = content.match(/~~/g);
  if (strikeMarkers && strikeMarkers.length % 2 !== 0) {
    errors.push('Unbalanced strikethrough markers (~~) detected');
  }

  return errors;
}

/**
 * Quick validation that only checks critical errors
 */
function quickValidate(content) {
  if (!content || typeof content !== 'string') {
    return { isValid: false, error: 'Content is empty' };
  }

  // Just check code blocks are closed
  const backtickMatches = content.match(/```/g);
  if (backtickMatches && backtickMatches.length % 2 !== 0) {
    return { isValid: false, error: 'Unclosed code block' };
  }

  return { isValid: true, error: null };
}

module.exports = {
  validateMarkdown,
  quickValidate
};
