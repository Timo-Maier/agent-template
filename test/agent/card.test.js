// test/agent/card.test.js
// Unit tests for src/agent/card.js — the A2A agent card builder.
/* global describe, it, expect */

const { buildAgentCard } = require('../../src/agent/card');

describe('buildAgentCard', () => {
  it('returns an object with name, description, and version', () => {
    const card = buildAgentCard();
    expect(card.name).toBe('BTP Node.js Agent');
    expect(card.description).toContain('SAP BTP');
    expect(card.version).toBe('1.0.0');
  });

  it('sets capabilities.streaming to true', () => {
    const card = buildAgentCard();
    expect(card.capabilities.streaming).toBe(true);
  });

  it('sets capabilities.pushNotifications to false', () => {
    const card = buildAgentCard();
    expect(card.capabilities.pushNotifications).toBe(false);
  });

  it('sets defaultInputModes and defaultOutputModes to text/plain', () => {
    const card = buildAgentCard();
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
  });

  it('returns the hardcoded skills array', () => {
    const card = buildAgentCard();
    expect(Array.isArray(card.skills)).toBe(true);
    expect(card.skills.length).toBeGreaterThan(0);
  });

  it('uses AGENT_URL env var when set', () => {
    process.env.AGENT_URL = 'https://my-agent.cfapps.eu10.hana.ondemand.com';
    const card = buildAgentCard();
    expect(card.url).toBe('https://my-agent.cfapps.eu10.hana.ondemand.com');
    delete process.env.AGENT_URL;
  });

  it('falls back to localhost URL when AGENT_URL is not set', () => {
    delete process.env.AGENT_URL;
    const card = buildAgentCard();
    expect(card.url).toMatch(/^http:\/\/localhost:/);
  });
});

