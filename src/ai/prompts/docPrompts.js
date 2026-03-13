/**
 * Documentation Generation Prompts
 *
 * Prompt templates for the multi-step documentation agent.
 */

const { MERMAID_CRITICAL_RULES } = require('./mermaidContext');

/**
 * Plan prompt: Given code graph summary, create documentation outline
 */
const DOC_PLAN_PROMPT = `You are a senior technical writer creating developer documentation for a codebase.

Based on the following code analysis, create a documentation outline as a JSON array of sections.

## Code Analysis

{codeGraphSummary}

## Instructions

Create a documentation outline with 5-10 sections. Each section should have:
- \`title\`: Section heading
- \`scope\`: What this section should cover (1-2 sentences)
- \`type\`: One of "overview", "architecture", "api_reference", "module_guide", "setup", "patterns", "data_flow"

Return ONLY a JSON array, no other text:
[
  { "title": "...", "scope": "...", "type": "..." },
  ...
]`;

/**
 * Section prompt: Write a single documentation section
 */
const DOC_SECTION_PROMPT = `You are a senior technical writer. Write the following documentation section.

## Section
Title: {title}
Scope: {scope}
Type: {type}

## Code Context
{context}

## Instructions
- Write clear, professional developer documentation in Markdown
- Include code examples where relevant
- Reference specific files and line numbers when discussing implementations
- Use proper Markdown headings (## for the section title, ### for subsections)
- Keep it focused and concise — this is one section of a larger document
- Do NOT include a title prefix like "## Section:" — just use the section title as the heading
- If Mermaid diagrams are provided, include them in fenced code blocks
- Do NOT wrap the entire output in a markdown code fence

${MERMAID_CRITICAL_RULES}`;

/**
 * Reduce prompt: Combine all sections into a coherent document
 */
const DOC_REDUCE_PROMPT = `You are a senior technical writer. Combine the following documentation sections into a single coherent developer documentation document.

## Sections

{sections}

## Instructions
- Add a title (# heading) and brief introduction
- Ensure smooth transitions between sections
- Fix any cross-references between sections
- Remove duplicate information
- Add a Table of Contents after the introduction
- Do NOT change the content significantly — focus on cohesion and flow
- Do NOT wrap the output in a markdown code fence
- Keep all Mermaid diagrams intact
- The output should be a complete, professional Markdown document

${MERMAID_CRITICAL_RULES}`;

/**
 * Architecture section prompt with dependency relationships
 */
const ARCHITECTURE_PROMPT = `You are a senior technical writer. Write an architecture overview section.

## Architecture Data

### Module Structure
{modules}

### Dependency Graph
{dependencies}

### Entry Points
{entryPoints}

### Tech Stack
{techStack}

{mermaidDiagram}

## Instructions
- Describe the high-level architecture and how components connect
- Explain the layer structure and separation of concerns
- Mention key entry points and how the application starts
- Reference the Mermaid diagram if one is provided
- Include the Mermaid diagram in the output inside a fenced code block
- Keep it clear and concise — aim for 300-500 words`;

/**
 * API Reference prompt for function signatures
 */
const API_REFERENCE_PROMPT = `You are a senior technical writer. Write an API reference section.

## Functions/Methods

{signatures}

## Instructions
- Group functions by file/module
- For each function, document:
  - Purpose (from JSDoc/docstring if available)
  - Parameters with types
  - Return type
  - Example usage if the signature suggests a clear pattern
- Use a consistent format throughout
- Use code formatting for function names, parameters, and types
- Keep descriptions concise — one sentence per function unless it's complex`;

module.exports = {
  DOC_PLAN_PROMPT,
  DOC_SECTION_PROMPT,
  DOC_REDUCE_PROMPT,
  ARCHITECTURE_PROMPT,
  API_REFERENCE_PROMPT
};
