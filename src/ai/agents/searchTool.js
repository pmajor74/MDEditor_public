/**
 * Search Tool
 *
 * LangChain tool for finding sections in a document
 */

const { tool } = require('@langchain/core/tools');
const { z } = require('zod');
const splitter = require('../splitters/markdownSplitter');

/**
 * Create the search tool
 */
const searchTool = tool(
  async ({ markdown, query }) => {
    try {
      const sections = splitter.splitByHeaders(markdown);
      const matches = splitter.findSections(sections, query);

      if (matches.length === 0) {
        return JSON.stringify({
          success: true,
          found: false,
          message: `No sections found matching "${query}"`,
          availableSections: sections.map(s => s.title)
        });
      }

      return JSON.stringify({
        success: true,
        found: true,
        matchCount: matches.length,
        matches: matches.map(m => ({
          title: m.title,
          level: m.level,
          fullPath: m.fullPath,
          startLine: m.startLine,
          endLine: m.endLine,
          contentPreview: m.content.substring(0, 200) + (m.content.length > 200 ? '...' : '')
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
    name: 'search_sections',
    description: 'Search for sections in a markdown document by title or content. Returns matching sections with their location.',
    schema: z.object({
      markdown: z.string().describe('The markdown document content'),
      query: z.string().describe('Search query (section title or content to find)')
    })
  }
);

/**
 * Create a tool to get a specific section by title
 */
const getSectionTool = tool(
  async ({ markdown, sectionTitle }) => {
    try {
      const sections = splitter.splitByHeaders(markdown);
      const section = splitter.findSection(sections, sectionTitle);

      if (!section) {
        return JSON.stringify({
          success: false,
          error: `Section "${sectionTitle}" not found`,
          availableSections: sections.map(s => s.title)
        });
      }

      // Get section index for context
      const sectionIndex = sections.findIndex(s => s === section);
      const contextSections = splitter.getSectionWithContext(sections, sectionIndex, 1);

      return JSON.stringify({
        success: true,
        section: {
          title: section.title,
          level: section.level,
          fullPath: section.fullPath,
          startLine: section.startLine,
          endLine: section.endLine,
          content: section.content
        },
        context: {
          previous: sectionIndex > 0 ? sections[sectionIndex - 1]?.title : null,
          next: sectionIndex < sections.length - 1 ? sections[sectionIndex + 1]?.title : null
        }
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  },
  {
    name: 'get_section',
    description: 'Get a specific section from a markdown document by title. Returns the full section content with context.',
    schema: z.object({
      markdown: z.string().describe('The markdown document content'),
      sectionTitle: z.string().describe('The title of the section to retrieve')
    })
  }
);

module.exports = { searchTool, getSectionTool };
