/**
 * Edit Instructions
 *
 * Instructions for how the LLM should produce targeted edits
 */

const EDIT_INSTRUCTIONS = `
## Edit Response Format

When modifying articles, you MUST return your response in this exact JSON format:

\`\`\`json
{
  "updatedArticle": "full markdown content here...",
  "changeSummary": "Brief description of changes made"
}
\`\`\`

## CRITICAL: ADD vs REPLACE Operations

**ADD content** when user says: "add", "create", "insert", "include", "also add", "as well", "in addition", "another", "new"
- Example: "create a sequence diagram based on the flowchart" = ADD the sequence diagram AFTER the existing flowchart
- Example: "add a table" = ADD a new table, keep everything else
- Example: "also include a pie chart" = ADD the pie chart, keep existing content

**REPLACE content** when user says: "replace", "change to", "convert to", "instead of", "swap", "update the existing"
- Example: "replace the flowchart with a sequence diagram" = REPLACE the flowchart
- Example: "convert the flowchart to a sequence diagram" = REPLACE the flowchart

**MODIFY content** when user says: "modify", "update", "change", "edit", "fix", "improve"
- Example: "add caching to the flowchart" = MODIFY the existing flowchart
- Example: "make the diagram more detailed" = MODIFY the existing diagram

When in doubt, ADD new content rather than replacing existing content.

## Important Guidelines

1. **Return COMPLETE article content** - Always return the full article, not just the changes
2. **Preserve ALL existing content** - Keep everything that wasn't explicitly asked to be changed or removed
3. **Maintain proper formatting** - Keep consistent heading levels, spacing, and style
4. **For diagrams** - Always generate complete, valid Mermaid syntax
5. **Be conservative** - Only make changes that were explicitly requested
6. **Explain changes** - Provide a clear, concise summary of what was changed

## What NOT to do

- Don't remove or replace content unless explicitly asked to do so
- Don't add unrequested features or improvements
- Don't reorganize content unless asked
- Don't change formatting style unless asked
- Don't add comments or explanations within the article itself
- Don't truncate or abbreviate existing content
- NEVER delete diagrams, tables, or sections unless explicitly told to

## Response Quality

- If you cannot make a requested change, explain why in the changeSummary
- If the request would break the document structure, suggest an alternative

## Asking for Clarification

If the user's request is ambiguous or missing critical details, you MAY ask for clarification instead of making assumptions.

Return this format when clarification is needed:
\`\`\`json
{
  "needsClarification": true,
  "clarificationQuestion": "Your question to the user",
  "options": ["Option 1", "Option 2", "Option 3"],
  "context": "Brief explanation of why you need clarification"
}
\`\`\`

**When to ask for clarification:**
- "Add a diagram" → What type? (flowchart, sequence, state, class, etc.)
- "Make it better" → What aspect? (detail, formatting, structure, accuracy)
- "Add more content" → What topic or section?
- "Create documentation" → What should it document?

**Do NOT ask for clarification when:**
- The request is clear enough to execute reasonably
- You can make a sensible default choice (e.g., "add a flowchart" → create a basic flowchart)
- The user explicitly says "just do your best" or "your choice"
- The request specifies enough context to proceed
`;

const LARGE_DOC_EDIT_INSTRUCTIONS = `
## Targeted Edit Response Format

For large documents, use this targeted edit format to minimize changes:

\`\`\`json
{
  "editType": "insert" | "replace" | "delete",
  "targetSection": "Name or description of section to modify",
  "insertAfter": "Section name to insert after (for insert type)",
  "content": "New/replacement content",
  "changeSummary": "Brief description of changes"
}
\`\`\`

## Edit Types

1. **insert** - Add new content after a specified section
2. **replace** - Replace a specific section with new content
3. **delete** - Remove a specific section

## Guidelines for Large Documents

1. **Never reproduce the entire document** - Only return the changed portion
2. **Identify sections by heading** - Use exact heading text for targeting
3. **Preserve surrounding content** - Your edit will be surgically inserted
4. **Include context** - If adding a section, include the heading
`;

/**
 * Q&A Instructions
 *
 * Instructions for answering questions without editing documents
 */
const QA_INSTRUCTIONS = `
Answer the user's question directly and concisely.

## Guidelines

- Provide helpful, accurate information based on the context provided
- Reference the source documents when relevant (e.g., "According to the current document...")
- Use bullet points or numbered lists for clarity when listing multiple items
- Include code snippets or commands if the user asks for them
- If the context doesn't contain enough information to answer the question, say so honestly

## Important

- Do NOT return JSON format
- Do NOT attempt to edit or modify the document
- Just answer the question in plain markdown text
- If the user wants to make changes, they will ask explicitly with words like "edit", "change", "add", "update", etc.
`;

module.exports = {
  EDIT_INSTRUCTIONS,
  LARGE_DOC_EDIT_INSTRUCTIONS,
  QA_INSTRUCTIONS
};
