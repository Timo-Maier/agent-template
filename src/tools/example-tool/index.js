'use strict';

const { handleExampleTool } = require('./handler');

module.exports = {
  tool: {
    name: 'example_tool',
    description:
      'Returns a greeting for the provided name. Use this tool when asked to greet someone.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the person to greet.',
        },
      },
      required: ['name'],
    },
  },
  handler: handleExampleTool,
};
