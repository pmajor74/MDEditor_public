/**
 * Reassemble Tool
 *
 * LangChain tool for reassembling documents after edits
 */

const { tool } = require('@langchain/core/tools');
const { z } = require('zod');
const splitter = require('../splitters/markdownSplitter');

/**
 * Create the reassemble tool
 */
const reassembleTool = tool(
  async ({ originalMarkdown, editType, targetSectionTitle, newContent }) => {
    try {
      const sections = splitter.splitByHeaders(originalMarkdown);
      const targetSection = splitter.findSection(sections, targetSectionTitle);

      if (!targetSection && editType !== 'append') {
        return JSON.stringify({
          success: false,
          error: `Target section "${targetSectionTitle}" not found`,
          availableSections: sections.map(s => s.title)
        });
      }

      let result;

      switch (editType) {
        case 'replace':
          result = splitter.reassembleDocument(originalMarkdown, targetSection, newContent);
          break;

        case 'insert_after':
          result = splitter.insertAfterSection(originalMarkdown, targetSection, newContent);
          break;

        case 'delete':
          result = splitter.deleteSection(originalMarkdown, targetSection);
          break;

        case 'append':
          // Append to end of document
          result = originalMarkdown.trim() + '\n\n' + newContent;
          break;

        default:
          return JSON.stringify({
            success: false,
            error: `Unknown edit type: ${editType}`
          });
      }

      return JSON.stringify({
        success: true,
        editType,
        targetSection: targetSectionTitle,
        resultLength: result.length,
        result
      });

    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  },
  {
    name: 'reassemble_document',
    description: 'Reassemble a document after making a targeted edit. Applies the edit and returns the complete updated document.',
    schema: z.object({
      originalMarkdown: z.string().describe('The original markdown document'),
      editType: z.enum(['replace', 'insert_after', 'delete', 'append']).describe('Type of edit to apply'),
      targetSectionTitle: z.string().describe('Title of the section to modify (not needed for append)'),
      newContent: z.string().optional().describe('New content for replace/insert operations')
    })
  }
);

module.exports = { reassembleTool };
