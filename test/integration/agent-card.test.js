// test/integration/agent-card.test.js
// Integration tests for GET /.well-known/agent.json — the public A2A agent card.
// This route is unprotected so no Authorization header is needed.
// proxyquire stubs @sap/xsenv and @sap/xssec to avoid real XSUAA credentials.
/* global describe, it, expect */

const proxyquire = require('proxyquire').noPreserveCache();
const request = require('supertest');
const { xsenvFactory, xssecFactory } = require('../helpers/auth-stub');

const { createApp } = proxyquire('../../src/core/server', {
  '@sap/xsenv': xsenvFactory(),
  '@sap/xssec': xssecFactory(),
});

const fakeExecutor = {
  getTools: () => [{ name: 'example_tool', description: 'A greeting tool' }],
  stream: async function* () { yield { done: true, content: '' }; },
};

const app = createApp(fakeExecutor);

describe('GET /.well-known/agent.json', () => {
  it('returns 200 without any Authorization header', async () => {
    await request(app).get('/.well-known/agent.json').expect(200);
  });

  it('returns JSON content type', async () => {
    await request(app)
      .get('/.well-known/agent.json')
      .expect('Content-Type', /application\/json/);
  });

  it('includes the agent name in the response body', async () => {
    const res = await request(app).get('/.well-known/agent.json').expect(200);
    expect(res.body.name).toBe('BTP Node.js Agent');
  });

  it('includes capabilities with streaming true', async () => {
    const res = await request(app).get('/.well-known/agent.json').expect(200);
    expect(res.body.capabilities.streaming).toBe(true);
  });

  it('returns a non-empty skills array', async () => {
    const res = await request(app).get('/.well-known/agent.json').expect(200);
    expect(Array.isArray(res.body.skills)).toBe(true);
    expect(res.body.skills.length).toBeGreaterThan(0);
  });
});
