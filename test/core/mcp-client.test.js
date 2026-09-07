// test/core/mcp-client.test.js
// Unit tests for src/core/mcp/client.js — createMcpTools and resolveDestination.
// proxyquire stubs @sap-cloud-sdk/connectivity and @langchain/mcp-adapters so
// no real BTP destination lookups or MCP connections are made.
// Note: specific MCP server integrations (remote destinations) are not tested
// because they require live BTP service bindings unavailable in CI.
/* global describe, it, expect, vi, beforeEach, afterEach */

const proxyquire = require('proxyquire').noPreserveCache();

const getDestinationMock = vi.fn();

function makeMcpClient() {
  const initializeConnectionsMock = vi.fn();
  const getToolsMock = vi.fn();
  class MultiServerMCPClient {
    constructor(cfg) {
      this.cfg = cfg;
    }
    initializeConnections() {
      return initializeConnectionsMock();
    }
    getTools() {
      return getToolsMock();
    }
    close() {
      return Promise.resolve();
    }
  }
  return { MultiServerMCPClient, initializeConnectionsMock, getToolsMock };
}

// ─── createMcpTools — no servers configured ─────────────────────────────────

describe('createMcpTools — no servers configured', () => {
  it('returns empty tools and null client immediately when mcpServers is empty', async () => {
    const { createMcpTools } = proxyquire('../../src/core/mcp/client', {
      '@sap-cloud-sdk/connectivity': { getDestination: getDestinationMock, '@noCallThru': true },
      '../../mcp/servers': { mcpServers: [] },
    });
    const { tools, client } = await createMcpTools();
    expect(tools).toEqual([]);
    expect(client).toBeNull();
  });
});

// ─── createMcpTools — local dev guard ───────────────────────────────────────

describe('createMcpTools — local dev guard', () => {
  let originalVcap;
  beforeEach(() => {
    originalVcap = process.env.VCAP_SERVICES;
    delete process.env.VCAP_SERVICES;
  });
  afterEach(() => {
    if (originalVcap !== undefined) process.env.VCAP_SERVICES = originalVcap;
    else delete process.env.VCAP_SERVICES;
  });

  it('returns empty tools when VCAP_SERVICES is absent (local dev)', async () => {
    const { createMcpTools } = proxyquire('../../src/core/mcp/client', {
      '@sap-cloud-sdk/connectivity': { getDestination: getDestinationMock, '@noCallThru': true },
      '../../mcp/servers': { mcpServers: [{ name: 'srv', destinationName: 'DEST' }] },
    });
    const { tools } = await createMcpTools();
    expect(tools).toEqual([]);
  });

  it('does not call getDestination in local dev mode', async () => {
    getDestinationMock.mockReset();
    const { createMcpTools } = proxyquire('../../src/core/mcp/client', {
      '@sap-cloud-sdk/connectivity': { getDestination: getDestinationMock, '@noCallThru': true },
      '../../mcp/servers': { mcpServers: [{ name: 'srv', destinationName: 'DEST' }] },
    });
    await createMcpTools();
    expect(getDestinationMock).not.toHaveBeenCalled();
  });
});

// ─── createMcpTools — destination resolution failure ────────────────────────

describe('createMcpTools — destination resolution failure', () => {
  let originalVcap;
  beforeEach(() => {
    originalVcap = process.env.VCAP_SERVICES;
    process.env.VCAP_SERVICES = '{}';
  });
  afterEach(() => {
    if (originalVcap !== undefined) process.env.VCAP_SERVICES = originalVcap;
    else delete process.env.VCAP_SERVICES;
  });

  it('returns empty tools when all destination resolutions fail', async () => {
    getDestinationMock.mockRejectedValue(new Error('Destination not found'));
    const { createMcpTools } = proxyquire('../../src/core/mcp/client', {
      '@sap-cloud-sdk/connectivity': { getDestination: getDestinationMock, '@noCallThru': true },
      '../../mcp/servers': { mcpServers: [{ name: 'srv', destinationName: 'BAD_DEST' }] },
    });
    const { tools } = await createMcpTools();
    expect(tools).toEqual([]);
  });

  it('returns empty tools when destination resolves but has no URL', async () => {
    getDestinationMock.mockResolvedValue({ url: null });
    const { createMcpTools } = proxyquire('../../src/core/mcp/client', {
      '@sap-cloud-sdk/connectivity': { getDestination: getDestinationMock, '@noCallThru': true },
      '../../mcp/servers': { mcpServers: [{ name: 'srv', destinationName: 'NO_URL' }] },
    });
    const { tools } = await createMcpTools();
    expect(tools).toEqual([]);
  });
});

// ─── createMcpTools — MCP connection initialisation failure ─────────────────

describe('createMcpTools — MCP connection initialisation failure', () => {
  let originalVcap;
  beforeEach(() => {
    originalVcap = process.env.VCAP_SERVICES;
    process.env.VCAP_SERVICES = '{}';
  });
  afterEach(() => {
    if (originalVcap !== undefined) process.env.VCAP_SERVICES = originalVcap;
    else delete process.env.VCAP_SERVICES;
  });

  it('throws when MCP client initializeConnections throws', async () => {
    getDestinationMock.mockResolvedValue({ url: 'https://mcp.example.com', authTokens: [] });
    const { MultiServerMCPClient, initializeConnectionsMock } = makeMcpClient();
    initializeConnectionsMock.mockRejectedValue(new Error('Connection refused'));

    const { createMcpTools } = proxyquire('../../src/core/mcp/client', {
      '@sap-cloud-sdk/connectivity': { getDestination: getDestinationMock, '@noCallThru': true },
      '@langchain/mcp-adapters': { MultiServerMCPClient, '@noCallThru': true },
      '../../mcp/servers': { mcpServers: [{ name: 'srv', destinationName: 'DEST' }] },
    });
    await expect(createMcpTools()).rejects.toThrow('Connection refused');
  });
});

// ─── createMcpTools — successful path ───────────────────────────────────────

describe('createMcpTools — successful connection', () => {
  let originalVcap;
  beforeEach(() => {
    originalVcap = process.env.VCAP_SERVICES;
    process.env.VCAP_SERVICES = '{}';
    getDestinationMock.mockReset();
  });
  afterEach(() => {
    if (originalVcap !== undefined) process.env.VCAP_SERVICES = originalVcap;
    else delete process.env.VCAP_SERVICES;
  });

  it('returns the tools provided by the MCP client', async () => {
    getDestinationMock.mockResolvedValue({ url: 'https://mcp.example.com', authTokens: [] });
    const mcpTool = { name: 'remote_tool', description: 'A remote tool' };
    const { MultiServerMCPClient, initializeConnectionsMock, getToolsMock } = makeMcpClient();
    initializeConnectionsMock.mockResolvedValue(undefined);
    getToolsMock.mockResolvedValue([mcpTool]);

    const { createMcpTools } = proxyquire('../../src/core/mcp/client', {
      '@sap-cloud-sdk/connectivity': { getDestination: getDestinationMock, '@noCallThru': true },
      '@langchain/mcp-adapters': { MultiServerMCPClient, '@noCallThru': true },
      '../../mcp/servers': { mcpServers: [{ name: 'srv', destinationName: 'DEST' }] },
    });
    const { tools } = await createMcpTools();
    expect(tools).toEqual([mcpTool]);
  });

  it('uses Bearer auth header when destination has authTokens', async () => {
    getDestinationMock.mockResolvedValue({
      url: 'https://mcp.example.com',
      authTokens: [{ type: 'Bearer', value: 'secret-token' }],
    });
    let capturedConfig;
    class CapturingMCPClient {
      constructor(cfg) { capturedConfig = cfg; }
      initializeConnections() { return Promise.resolve(); }
      getTools() { return Promise.resolve([]); }
      close() { return Promise.resolve(); }
    }

    const { createMcpTools } = proxyquire('../../src/core/mcp/client', {
      '@sap-cloud-sdk/connectivity': { getDestination: getDestinationMock, '@noCallThru': true },
      '@langchain/mcp-adapters': { MultiServerMCPClient: CapturingMCPClient, '@noCallThru': true },
      '../../mcp/servers': { mcpServers: [{ name: 'srv', destinationName: 'DEST' }] },
    });
    await createMcpTools();
    expect(capturedConfig.mcpServers.srv.headers.Authorization).toBe('Bearer secret-token');
  });

  it('configures HTTP transport for each resolved server', async () => {
    getDestinationMock.mockResolvedValue({ url: 'https://mcp.example.com', authTokens: [] });
    let capturedConfig;
    class CapturingMCPClient {
      constructor(cfg) { capturedConfig = cfg; }
      initializeConnections() { return Promise.resolve(); }
      getTools() { return Promise.resolve([]); }
      close() { return Promise.resolve(); }
    }

    const { createMcpTools } = proxyquire('../../src/core/mcp/client', {
      '@sap-cloud-sdk/connectivity': { getDestination: getDestinationMock, '@noCallThru': true },
      '@langchain/mcp-adapters': { MultiServerMCPClient: CapturingMCPClient, '@noCallThru': true },
      '../../mcp/servers': { mcpServers: [{ name: 'srv', destinationName: 'DEST' }] },
    });
    await createMcpTools();
    expect(capturedConfig.mcpServers.srv.transport).toBe('http');
    expect(capturedConfig.mcpServers.srv.url).toBe('https://mcp.example.com');
  });
});
