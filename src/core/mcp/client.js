const { MultiServerMCPClient } = require('@langchain/mcp-adapters');
const { getDestination } = require('@sap-cloud-sdk/connectivity');
const { mcpServers } = require('../../mcp/servers');
const logger = require('../lib/logger');

async function resolveDestination(destinationName, jwt) {
  const dest = await getDestination({ destinationName, jwt });
  if (!dest?.url) {
    throw new Error(`Destination '${destinationName}' resolved but has no URL`);
  }

  const headers = {};
  if (dest.authTokens && dest.authTokens.length > 0) {
    const token = dest.authTokens[0];
    headers.Authorization = `${token.type} ${token.value}`;
  }

  return { url: dest.url, headers };
}

/**
 * Creates MCP tools for the current request using the provided user JWT.
 * Returns { tools, client } — caller must invoke client.close() when done.
 */
async function createMcpTools(jwt) {
  if (mcpServers.length === 0) {
    return { tools: [], client: null };
  }

  const hasBtpEnv = !!process.env.VCAP_SERVICES;
  if (!hasBtpEnv) {
    logger.warn(
      'No VCAP_SERVICES found — skipping MCP server connections in local dev mode. MCP tools will not be available.',
    );
    return { tools: [], client: null };
  }

  const serverConfigs = {};

  for (const server of mcpServers) {
    try {
      const { url, headers } = await resolveDestination(server.destinationName, jwt);
      const fullUrl = server.path ? `${url.replace(/\/$/, '')}${server.path}` : url;
      serverConfigs[server.name] = { transport: 'http', url: fullUrl, headers };
      logger.info({ server: server.name, url }, 'Resolved MCP destination');
    } catch (err) {
      logger.warn(
        { server: server.name, destination: server.destinationName, err },
        'Could not resolve MCP destination, skipping',
      );
    }
  }

  if (Object.keys(serverConfigs).length === 0) {
    logger.warn('No MCP servers could be connected. Continuing without MCP tools.');
    return { tools: [], client: null };
  }

  const client = new MultiServerMCPClient({
    mcpServers: serverConfigs,
    onConnectionError: ({ serverName, error }) => {
      logger.warn(
        { server: serverName, err: error, cause: error?.cause },
        'MCP server connection failed',
      );
    },
  });

  await client.initializeConnections();

  const tools = await client.getTools();
  logger.info(
    { toolCount: tools.length, serverCount: Object.keys(serverConfigs).length },
    'MCP tools loaded',
  );
  return { tools, client };
}

module.exports = { createMcpTools };
