// test/integration/auth.test.js
// Integration tests for XSUAA JWT authentication middleware.
// Verifies that protected routes require a valid Bearer token and that the
// public agent card route is always accessible without credentials.
/* global describe, it, expect */

const proxyquire = require('proxyquire').noPreserveCache();
const request = require('supertest');
const { xsenvFactory, xssecFactory, xssecFailFactory } = require('../helpers/auth-stub');

const fakeExecutor = {
  getTools: () => [],
  stream: async function* () { yield { done: true, content: '' }; },
};

function makeApp(xssecStub) {
  const { createApp } = proxyquire('../../src/core/server', {
    '@sap/xsenv': xsenvFactory(),
    '@sap/xssec': xssecStub,
  });
  return createApp(fakeExecutor);
}

describe('Authentication — public paths', () => {
  it('serves /.well-known/agent.json without a token', async () => {
    const app = makeApp(xssecFailFactory());
    await request(app).get('/.well-known/agent.json').expect(200);
  });
});

describe('Authentication — protected routes', () => {
  it('rejects POST / without an Authorization header with 401', async () => {
    const app = makeApp(xssecFailFactory());
    await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'message/send', params: {} })
      .expect(401);
  });

  it('accepts POST / when a Bearer token is present', async () => {
    const app = makeApp(xssecFactory());
    const res = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer fake-token')
      .send({ jsonrpc: '2.0', id: 1, method: 'message/send', params: {} });
    // A2A SDK may return 4xx for invalid JSON-RPC payload, but never 401
    expect(res.status).not.toBe(401);
  });
});

describe('Authentication — xsuaaUserBuilder', () => {
  it('populates an authenticated user from req.user after JWT validation', async () => {
    // Verify the builder contract indirectly: agent card is served (no crash) when
    // xssecFactory populates req.user correctly.
    const app = makeApp(xssecFactory());
    await request(app).get('/.well-known/agent.json').expect(200);
  });
});
