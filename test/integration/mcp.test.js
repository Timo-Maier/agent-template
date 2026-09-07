// test/integration/mcp.test.js
// General MCP protocol sanity tests — verifies that the A2A server mounts the
// A2A JSON-RPC endpoint and that the agent card is served correctly.
// Specific MCP server integrations (remote BTP destinations) are not tested here
// because they require live service bindings that are unavailable in CI.
/* global describe, it, expect */

const proxyquire = require('proxyquire').noPreserveCache();
const request = require('supertest');
const { xsenvFactory, xssecFactory } = require('../helpers/auth-stub');

const { createApp } = proxyquire('../../src/core/server', {
  '@sap/xsenv': xsenvFactory(),
  '@sap/xssec': xssecFactory(),
});

const fakeExecutor = {
  getTools: () => [
    { name: 'example_tool', description: 'Returns a greeting for the provided name.' },
  ],
  stream: async function* () { yield { done: true, content: '' }; },
};

const app = createApp(fakeExecutor);

describe('A2A server — agent card', () => {
  it('exposes /.well-known/agent.json with a skills array', async () => {
    const res = await request(app).get('/.well-known/agent.json').expect(200);
    expect(Array.isArray(res.body.skills)).toBe(true);
  });

  it('agent card skills is a non-empty array', async () => {
    const res = await request(app).get('/.well-known/agent.json').expect(200);
    expect(Array.isArray(res.body.skills)).toBe(true);
    expect(res.body.skills.length).toBeGreaterThan(0);
  });

  it('agent card version is 1.0.0', async () => {
    const res = await request(app).get('/.well-known/agent.json').expect(200);
    expect(res.body.version).toBe('1.0.0');
  });
});

describe('A2A server — JSON-RPC endpoint', () => {
  it('returns 401 for unauthenticated POST /', async () => {
    const { createApp: createAppWithFailAuth } = proxyquire('../../src/core/server', {
      '@sap/xsenv': xsenvFactory(),
      '@sap/xssec': require('../helpers/auth-stub').xssecFailFactory(),
    });
    const restrictedApp = createAppWithFailAuth(fakeExecutor);
    await request(restrictedApp)
      .post('/')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'message/send', params: {} })
      .expect(401);
  });
});
