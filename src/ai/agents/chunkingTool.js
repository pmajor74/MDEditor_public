/**
 * Chunking Tool
 *
 * LangChain tool for splitting documents into sections
 */

const { tool } = require('@langchain/core/tools');
const { z } = require('zod');
const splitter = require('../splitters/markdownSplitter');

/**
 * Create the chunking tool
 */
const chunkingTool = tool(
  async ({ markdown }) => {
    try {
      const sections = splitter.splitByHeaders(markdown);
      const summary = splitter.getStructureSummary(sections);
      const tokenInfo = splitter.estimateSectionTokens(sections);

      return JSON.stringify({
        success: true,
        sectionCount: sections.length,
        structure: summary,
        sections: sections.map((s, i) => ({
          index: i,
          title: s.title,
          level: s.level,
          startLine: s.startLine,
          endLine: s.endLine,
          estimatedTokens: tokenInfo[i].tokens
        }))
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  },
  {
    name: 'chunk_document',
    description: 'Split a markdown document into sections by headers. Returns section structure with line numbers and token estimates.',
    schema: z.object({
      markdown: z.string().describe('The markdown document content to split')
    })
  }
);

module.exports = { chunkingTool };
