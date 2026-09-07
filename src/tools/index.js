'use strict';

// ─── Tool Registry ────────────────────────────────────────────────────────────
//
// To add a custom tool:
//   1. Create src/tools/my-tool/ with index.js ({ tool, handler }) and handler.js
//   2. require() it below and add it to the `tools` array
//
// Each entry must export: { tool: { name, description, inputSchema }, handler }
// The wrapper in src/core/tools.js converts these to LangChain DynamicStructuredTools.

const tools = [
  require('./example-tool'),

  // require('./your-new-tool'),
];

module.exports = { tools };
