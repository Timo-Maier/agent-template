// ─── MCP Server Registry ──────────────────────────────────────────────────────
//
// Register remote MCP servers here. Each entry maps a BTP Destination Service
// destination to a remote HTTP MCP server.
//
// To add an MCP server:
//   1. Create a destination in BTP Cockpit pointing to the
//      MCP server URL (with authentication if needed)
//   2. Add an entry to the array below:
//        { name: 'my-server', destinationName: 'MY_MCP_DEST' }
//   That's it — tools from the server are merged into the agent automatically.

const mcpServers = [
  // Example:
  { name: 'customer-projects-mcp', destinationName: 'Customer-Projects-MCP', path: '/mcp' },
];

module.exports = { mcpServers };
