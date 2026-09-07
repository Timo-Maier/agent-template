// ─── Agent Executor ────────────────────────────────────────────────────────────
//
// This file is the SWAP POINT for the agent execution strategy.
//
// DEFAULT: LangGraph prebuilt ReAct agent (createReactAgent).
//   The graph receives the OrchestrationChatModel and the merged tool list,
//   then handles the think → tool-call → observe loop automatically.
//
// TO REPLACE with a plain tool loop (no LangGraph):
//   1. Remove the LangGraph imports and `graph` initialization below
//   2. Implement `run()` and `stream()` using your own loop logic
//   3. The rest of the codebase (core/server.js, A2A handlers) never changes —
//      they only call `executor.run()` and `executor.stream()`.
//
// The contract this module must honour:
//   run(input)    → Promise<string>              (final answer)
//   stream(input) → AsyncGenerator<object>       (intermediate events, then final)
//   getTools()    → Array<ToolInterface>          (returns custom tools only)
// ──────────────────────────────────────────────────────────────────────────────

const { createReactAgent } = require('@langchain/langgraph/prebuilt');
const { HumanMessage, AIMessage, ToolMessage } = require('@langchain/core/messages');
const { LRUCache } = require('lru-cache');
const { llm } = require('../core/llm');
const { tools: toolEntries } = require('../tools');
const { buildLangChainTools } = require('../core/tools');
const { createMcpTools } = require('../core/mcp/client');
const { SYSTEM_PROMPT } = require('./prompt');
const logger = require('../core/lib/logger');

// Conversation history keyed by contextId. Capped at 500 entries with a 1-hour
// TTL to prevent unbounded memory growth on long-running deployments.
const contextHistory = new LRUCache({ max: 500, ttl: 1000 * 60 * 60 });

function contentToString(content) {
  if (typeof content === 'string') return content;
  logger.warn({ content }, 'Non-string message content received, stringifying');
  return JSON.stringify(content);
}

function extractLlmError(err) {
  // SAP AI SDK / axios errors carry the upstream response body in err.response
  const status = err.response?.status ?? err.status ?? err.statusCode;
  const body = err.response?.data ?? err.body ?? err.responseBody;
  return { status, body };
}

function buildMessages(rawMessages, contextId) {
  const newMessages = (rawMessages || []).map((m) =>
    m instanceof HumanMessage ? m : new HumanMessage({ content: m.content || m }),
  );
  const history = contextId != null ? contextHistory.get(contextId) || [] : [];
  return [...history, ...newMessages];
}

// Logs each new message that appeared since the previous stream event.
function logNewMessages(prev, next, contextId) {
  const newMsgs = next.slice(prev.length);
  for (const msg of newMsgs) {
    if (msg instanceof AIMessage) {
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          logger.info({ contextId, tool: tc.name, args: tc.args, callId: tc.id }, 'agent: tool call');
        }
      } else {
        const usage = msg.usage_metadata ?? msg.response_metadata?.usage;
        logger.info({ contextId, content: contentToString(msg.content), usage }, 'agent: response');
      }
    } else if (msg instanceof ToolMessage) {
      logger.info({ contextId, tool: msg.name, callId: msg.tool_call_id, status: msg.status }, 'agent: tool result');
      logger.debug({ contextId, tool: msg.name, callId: msg.tool_call_id, status: msg.status, content: contentToString(msg.content) }, 'agent: tool result content');
    }
  }
}

async function run(input) {
  const { messages: rawMessages, contextId, userJwt } = input;
  const messages = buildMessages(rawMessages, contextId);

  logger.info({ contextId, turns: messages.length }, 'agent: run started');

  const { tools: mcpTools, client } = await createMcpTools(userJwt);
  const customTools = buildLangChainTools(toolEntries, userJwt);
  const graph = createReactAgent({ llm, tools: [...customTools, ...mcpTools], prompt: SYSTEM_PROMPT });

  try {
    const result = await graph.invoke({ messages });
    const last = result.messages[result.messages.length - 1];

    logNewMessages(messages, result.messages, contextId);

    if (contextId != null) contextHistory.set(contextId, result.messages);

    return contentToString(last.content);
  }  catch (err) {
    const { status, body } = extractLlmError(err);
    logger.error({ contextId, status, body, err }, 'agent: LLM call failed');
    throw err;
  } finally {
    await client?.close?.();
  }
}

async function* stream(input) {
  const { messages: rawMessages, contextId, userJwt } = input;
  const messages = buildMessages(rawMessages, contextId);

  logger.info({ contextId, turns: messages.length }, 'agent: stream started');

  const { tools: mcpTools, client } = await createMcpTools(userJwt);
  const customTools = buildLangChainTools(toolEntries, userJwt);
  const graph = createReactAgent({ llm, tools: [...customTools, ...mcpTools], prompt: SYSTEM_PROMPT });
  let finalContent = '';
  let finalMessages = messages;
  let prevMessages = messages;

  try {
    for await (const event of await graph.stream({ messages }, { streamMode: 'values' })) {
      const currentMessages = event.messages ?? [];
      logNewMessages(prevMessages, currentMessages, contextId);
      prevMessages = currentMessages;

      const lastMsg = currentMessages[currentMessages.length - 1];
      if (lastMsg) {
        finalContent = contentToString(lastMsg.content);
        finalMessages = currentMessages;
        yield { type: 'step', content: finalContent, raw: event };
      }
    }

    if (contextId != null) contextHistory.set(contextId, finalMessages);
  } catch (err) {
    const { status, body } = extractLlmError(err);
    logger.error({ contextId, status, body, err }, 'agent: LLM call failed');
    throw err;
  } finally {
    await client?.close?.();
  }

  yield { type: 'final', done: true, content: finalContent };
}

module.exports = { run, stream, getTools: () => buildLangChainTools(toolEntries) };
