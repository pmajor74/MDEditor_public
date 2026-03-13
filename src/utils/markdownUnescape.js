/**
 * markdownUnescape.js
 *
 * Removes unnecessary backslash escapes added by Toast UI Editor's common_escape()
 * during WYSIWYG-to-Markdown conversion. Preserves escapes that are actually needed
 * for markdown syntax.
 */

/**
 * Check if a line is inside a table (contains unescaped pipes as cell delimiters).
 * A table row typically looks like: | cell | cell | or starts/ends with |
 */
function isTableRow(line) {
  // Match lines that have unescaped pipe characters acting as cell separators
  // Also match separator rows like |---|---|
  return /(?:^|\s)\|/.test(line) || /\|(?:\s|$)/.test(line);
}

/**
 * Remove unnecessary backslash escapes from markdown text.
 * Called via Toast UI's beforeConvertWysiwygToMarkdown event.
 *
 * @param {string} markdown - The markdown string with over-escaped characters
 * @returns {string} - Cleaned markdown with only necessary escapes
 */
export function unescapeMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') return markdown;

  const lines = markdown.split('\n');
  let inFencedCodeBlock = false;
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track fenced code blocks (``` or ~~~) — don't touch content inside them
    if (/^(`{3,}|~{3,})/.test(line.trimStart())) {
      if (!inFencedCodeBlock) {
        inFencedCodeBlock = true;
        result.push(line);
        continue;
      } else {
        inFencedCodeBlock = false;
        result.push(line);
        continue;
      }
    }

    if (inFencedCodeBlock) {
      result.push(line);
      continue;
    }

    let cleaned = line;

    // \, → , — Always safe (comma was only caught by the regex range bug)
    cleaned = cleaned.replace(/\\,/g, ',');

    // \{ → {, \} → } — Always safe (not standard markdown syntax characters)
    cleaned = cleaned.replace(/\\([{}])/g, '$1');

    // \. → . — Safe EXCEPT when it would form an ordered list marker (e.g., "1." at start of line)
    cleaned = cleaned.replace(/\\\.(?!(?<=^\d+\\\.))/g, '.');
    // More precise: unescape \. unless preceded by digits at start of line
    cleaned = unescapeDotSafe(cleaned);

    // \- → - — Safe EXCEPT at start of line (list item / thematic break)
    cleaned = cleaned.replace(/(?<!^[ \t]*)\\-/gm, '-');
    // Handle start-of-line case separately
    cleaned = unescapeAtNonLineStart(cleaned, '-');

    // \+ → + — Safe EXCEPT at start of line (list item)
    cleaned = unescapeAtNonLineStart(cleaned, '+');

    // \> → > — Safe EXCEPT at start of line (blockquote)
    cleaned = unescapeAtNonLineStart(cleaned, '>');

    // \# → # — Safe EXCEPT at start of line (heading)
    cleaned = unescapeAtNonLineStart(cleaned, '#');

    // \! → ! — Safe EXCEPT before [ (image syntax ![ )
    cleaned = cleaned.replace(/\\!(?!\[)/g, '!');

    // \( → ( — Safe EXCEPT after ] (link syntax ](url))
    cleaned = cleaned.replace(/(?<!\])\\(\()/g, '(');

    // \) → ) — Safe EXCEPT when inside a link destination (after ](
    cleaned = unescapeParenSafe(cleaned);

    // \| → | — Safe EXCEPT inside table rows
    if (!isTableRow(cleaned)) {
      cleaned = cleaned.replace(/\\\|/g, '|');
    }

    // \_ → _ — Safe when between alphanumeric chars (word-internal like field_name)
    cleaned = cleaned.replace(/(\w)\\_(\w)/g, '$1_$2');

    result.push(cleaned);
  }

  return result.join('\n');
}

/**
 * Unescape \. except when it forms an ordered list marker at the start of a line.
 * e.g., "1\." at start of line should remain escaped, but "file\.txt" should unescape.
 */
function unescapeDotSafe(line) {
  // If line starts with digits followed by \. it's a list marker — keep escaped
  if (/^\s*\d+\\\./.test(line)) {
    // Only unescape dots that are NOT part of the list marker
    const match = line.match(/^(\s*\d+\\\.)(.*)$/);
    if (match) {
      return match[1] + match[2].replace(/\\\./g, '.');
    }
  }
  return line.replace(/\\\./g, '.');
}

/**
 * Unescape a character except when it appears at the start of a line
 * (possibly preceded by whitespace).
 */
function unescapeAtNonLineStart(line, char) {
  const escaped = '\\' + char;
  if (!line.includes(escaped)) return line;

  // Check if the first occurrence is at line start (with optional leading whitespace)
  const leadingMatch = line.match(/^(\s*)\\/);
  if (leadingMatch && line.charAt(leadingMatch[0].length) === char) {
    // The first escaped char is at line start — keep it, unescape the rest
    const prefix = line.substring(0, leadingMatch[0].length + 1);
    const rest = line.substring(leadingMatch[0].length + 1);
    return prefix + rest.replace(new RegExp('\\\\' + escapeRegex(char), 'g'), char);
  }

  // No line-start occurrence, unescape all
  return line.replace(new RegExp('\\\\' + escapeRegex(char), 'g'), char);
}

/**
 * Unescape \) except when it appears to be inside a link destination.
 * Simple heuristic: if the line contains ]( before the \), keep it escaped.
 */
function unescapeParenSafe(line) {
  if (!line.includes('\\)')) return line;

  // Find all ]( positions to identify link destinations
  const linkStarts = [];
  let searchFrom = 0;
  while (true) {
    const idx = line.indexOf('](', searchFrom);
    if (idx === -1) break;
    linkStarts.push(idx + 2); // position after ](
    searchFrom = idx + 1;
  }

  if (linkStarts.length === 0) {
    // No link destinations, safe to unescape all
    return line.replace(/\\\)/g, ')');
  }

  // Has link destinations — be conservative and keep \) escaped
  return line;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
