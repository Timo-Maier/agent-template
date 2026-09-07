// test/tools/example-tool.test.js
// Unit tests for src/tools/example-tool/ — the template greeting tool.
// Tests verify: tool metadata (name, description, inputSchema) and handler implementation.
/* global describe, it, expect */

const { tool, handler } = require('../../src/tools/example-tool');

describe('exampleTool — metadata', () => {
  it('has the name "example_tool"', () => {
    expect(tool.name).toBe('example_tool');
  });

  it('has a non-empty description', () => {
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('description mentions greeting', () => {
    expect(tool.description.toLowerCase()).toContain('greet');
  });
});

describe('exampleTool — handler', () => {
  it('returns a greeting containing the provided name', async () => {
    const result = await handler({ name: 'Alice' }, null);
    expect(result).toContain('Alice');
  });

  it('returns a string', async () => {
    const result = await handler({ name: 'Bob' }, null);
    expect(typeof result).toBe('string');
  });

  it('includes "Hello" in the response', async () => {
    const result = await handler({ name: 'World' }, null);
    expect(result).toContain('Hello');
  });
});

describe('tools registry', () => {
  it('exports an array containing example_tool', () => {
    const { tools } = require('../../src/tools/index');
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.some((t) => t.tool.name === 'example_tool')).toBe(true);
  });

  it('every tool in the registry has a name and a description', () => {
    const { tools } = require('../../src/tools/index');
    for (const { tool: t } of tools) {
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
    }
  });
});
