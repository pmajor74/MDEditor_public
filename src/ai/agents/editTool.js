/**
 * Edit Tool
 *
 * LangChain tool for generating targeted edits
 */

const { tool } = require('@langchain/core/tools');
const { z } = require('zod');

/**
 * Create the edit tool for generating new content
 */
const generateContentTool = tool(
  async ({ instruction, context, format }) => {
    // This tool is used by the agent to structure edit requests
    // The actual generation is done by the LLM itself
    return JSON.stringify({
      success: true,
      message: 'Content generation request structured',
      instruction,
      context,
      format,
      note: 'The LLM should now generate the content based on this specification'
    });
  },
  {
    name: 'generate_content',
    description: 'Generate new content based on an instruction. Use this to structure a content generation request.',
    schema: z.object({
      instruction: z.string().describe('What content to generate'),
      context: z.string().optional().describe('Surrounding content for context'),
      format: z.enum(['heading', 'paragraph', 'list', 'table', 'code', 'diagram']).describe('Expected format of output')
    })
  }
);

/**
 * Edit specification tool - structures an edit operation
 */
const specifyEditTool = tool(
  async ({ editType, targetSection, newContent, insertAfter }) => {
    const edit = {
      type: editType,
      target: targetSection,
      content: newContent
    };

    if (editType === 'insert' && insertAfter) {
      edit.insertAfter = insertAfter;
    }

    return JSON.stringify({
      success: true,
      edit,
      message: `Edit specified: ${editType} operation on "${targetSection}"`
    });
  },
  {
    name: 'specify_edit',
    description: 'Specify a targeted edit operation for a large document. Use this to define what change to make.',
    schema: z.object({
      editType: z.enum(['insert', 'replace', 'delete']).describe('Type of edit operation'),
      targetSection: z.string().describe('The section to modify (for replace/delete) or reference point (for insert)'),
      newContent: z.string().optional().describe('New content to insert or replace with'),
      insertAfter: z.string().optional().describe('Section name to insert after (for insert operations)')
    })
  }
);

module.exports = { generateContentTool, specifyEditTool };
