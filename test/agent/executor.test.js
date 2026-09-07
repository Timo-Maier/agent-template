// test/agent/executor.test.js
// Unit tests for src/agent/executor.js — run, stream, getTools.
// proxyquire stubs @langchain/langgraph/prebuilt, @langchain/core/messages,
// and src/core/mcp/client so no real AI calls are made.
/* global describe, it, expect, vi, beforeEach */

const proxyquire = require('proxyquire').noPreserveCache();

// ── Shared mocks ──────────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
const mockStream = vi.fn();
const mockGraph = { invoke: mockInvoke, stream: mockStream };
const createReactAgentMock = vi.fn(() => mockGraph);

const createMcpToolsMock = vi.fn();

const executor = proxyquire('../../src/agent/executor', {
  '@langchain/langgraph/prebuilt': {
    createReactAgent: createReactAgentMock,
    '@noCallThru': true,
  },
  '../core/mcp/client': {
    createMcpTools: createMcpToolsMock,
    '@noCallThru': true,
  },
  '../core/llm': { llm: {}, '@noCallThru': true },
});

beforeEach(() => {
  mockInvoke.mockReset();
  mockStream.mockReset();
  createMcpToolsMock.mockReset();
  createReactAgentMock.mockClear();
  // Default: createMcpTools returns empty tools and a no-op client
  createMcpToolsMock.mockResolvedValue({ tools: [], client: null });
});

// ─── getTools ─────────────────────────────────────────────────────────────────

describe('executor.getTools', () => {
  it('returns an array', () => {
    expect(Array.isArray(executor.getTools())).toBe(true);
  });

  it('includes the example_tool from the custom tools registry', () => {
    const tools = executor.getTools();
    expect(tools.some((t) => t.name === 'example_tool')).toBe(true);
  });
});

// ─── run ──────────────────────────────────────────────────────────────────────

describe('executor.run', () => {
  it('calls createMcpTools during run', async () => {
    const { AIMessage } = require('@langchain/core/messages');
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage({ content: 'The answer is 42.' })],
    });
    await executor.run({ messages: [{ content: 'What is the answer?' }] });
    expect(createMcpToolsMock).toHaveBeenCalledOnce();
  });

  it('invokes the graph and returns the final AI message content', async () => {
    const { AIMessage } = require('@langchain/core/messages');
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage({ content: 'The answer is 42.' })],
    });
    const result = await executor.run({ messages: [{ content: 'What is the answer?' }] });
    expect(result).toBe('The answer is 42.');
  });

  it('passes messages to the graph', async () => {
    const { AIMessage } = require('@langchain/core/messages');
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage({ content: 'Hello!' })],
    });
    await executor.run({ messages: [{ content: 'Hi' }] });
    const [{ messages }] = mockInvoke.mock.calls[0];
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('wraps plain message objects as HumanMessage', async () => {
    const { AIMessage, HumanMessage } = require('@langchain/core/messages');
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage({ content: 'ok' })],
    });
    await executor.run({ messages: [{ content: 'hello' }] });
    const [{ messages }] = mockInvoke.mock.calls[0];
    expect(messages[0]).toBeInstanceOf(HumanMessage);
  });

  it('passes HumanMessage instances through unchanged', async () => {
    const { AIMessage, HumanMessage } = require('@langchain/core/messages');
    const msg = new HumanMessage({ content: 'hi' });
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage({ content: 'ok' })],
    });
    await executor.run({ messages: [msg] });
    const [{ messages }] = mockInvoke.mock.calls[0];
    expect(messages[0]).toBe(msg);
  });

  it('stringifies non-string content in the final message', async () => {
    const { AIMessage } = require('@langchain/core/messages');
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage({ content: [{ type: 'text', text: 'hi' }] })],
    });
    const result = await executor.run({ messages: [{ content: 'q' }] });
    expect(typeof result).toBe('string');
  });

  it('merges MCP tools with custom tools when building the graph', async () => {
    const { AIMessage } = require('@langchain/core/messages');
    const mcpTool = { name: 'mcp_tool', description: 'from MCP' };
    createMcpToolsMock.mockResolvedValue({ tools: [mcpTool], client: null });
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage({ content: 'ok' })],
    });
    await executor.run({ messages: [{ content: 'hi' }] });
    const [{ tools }] = createReactAgentMock.mock.calls[0];
    expect(tools.some((t) => t.name === 'mcp_tool')).toBe(true);
  });

  it('closes the MCP client after run completes', async () => {
    const { AIMessage } = require('@langchain/core/messages');
    const mockClose = vi.fn().mockResolvedValue(undefined);
    createMcpToolsMock.mockResolvedValue({ tools: [], client: { close: mockClose } });
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage({ content: 'ok' })],
    });
    await executor.run({ messages: [{ content: 'hi' }] });
    expect(mockClose).toHaveBeenCalledOnce();
  });
});

// ─── stream ───────────────────────────────────────────────────────────────────

describe('executor.stream', () => {
  it('yields step events for each graph event', async () => {
    const { AIMessage } = require('@langchain/core/messages');
    async function* fakeStream() {
      yield { messages: [new AIMessage({ content: 'thinking...' })] };
      yield { messages: [new AIMessage({ content: 'done' })] };
    }
    mockStream.mockResolvedValue(fakeStream());

    const events = [];
    for await (const event of executor.stream({ messages: [{ content: 'go' }] })) {
      events.push(event);
    }
    const stepEvents = events.filter((e) => e.type === 'step');
    expect(stepEvents.length).toBeGreaterThan(0);
  });

  it('yields a final done event as the last item', async () => {
    const { AIMessage } = require('@langchain/core/messages');
    async function* fakeStream() {
      yield { messages: [new AIMessage({ content: 'answer' })] };
    }
    mockStream.mockResolvedValue(fakeStream());

    const events = [];
    for await (const event of executor.stream({ messages: [{ content: 'q' }] })) {
      events.push(event);
    }
    const last = events[events.length - 1];
    expect(last.done).toBe(true);
    expect(last.type).toBe('final');
  });

  it('carries the last AI message content in the final event', async () => {
    const { AIMessage } = require('@langchain/core/messages');
    async function* fakeStream() {
      yield { messages: [new AIMessage({ content: 'final answer' })] };
    }
    mockStream.mockResolvedValue(fakeStream());

    const events = [];
    for await (const event of executor.stream({ messages: [{ content: 'q' }] })) {
      events.push(event);
    }
    const finalEvent = events.find((e) => e.done);
    expect(finalEvent.content).toBe('final answer');
  });

  it('streams graph with streamMode values', async () => {
    const { AIMessage } = require('@langchain/core/messages');
    async function* fakeStream() {
      yield { messages: [new AIMessage({ content: 'x' })] };
    }
    mockStream.mockResolvedValue(fakeStream());

    for await (const _ of executor.stream({ messages: [{ content: 'q' }] })) {
      // consume
    }
    const [, opts] = mockStream.mock.calls[0];
    expect(opts.streamMode).toBe('values');
  });
});
