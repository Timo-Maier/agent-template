const express = require('express');
const pinoHttp = require('pino-http');
const logger = require('./lib/logger');
const { DefaultRequestHandler, InMemoryTaskStore } = require('@a2a-js/sdk/server');
const { agentCardHandler, jsonRpcHandler } = require('@a2a-js/sdk/server/express');
const { setupAuth, xsuaaUserBuilder } = require('./middleware/auth');
const { buildAgentCard } = require('../agent/card');
const { randomUUID } = require('node:crypto');

function createApp(executor) {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // express.json() must come before auth so body is available to all middleware.
  app.use(express.json({ limit: '1mb' }));
  setupAuth(app);

  const agentCard = buildAgentCard();

  // The A2A TaskHandler bridges the SDK's request lifecycle to our executor.
  // It implements the agentExecutor interface: execute(requestContext, eventBus).
  const a2aExecutor = {
    async execute(requestContext, eventBus) {
      const userMessage = requestContext.userMessage;
      const textPart = userMessage?.parts?.find((p) => p.kind === 'text');
      const inputText = textPart?.text || '';

      const taskId = requestContext.taskId;
      const contextId = requestContext.contextId;

      try {
        await eventBus.publish({
          kind: 'task',
          id: taskId,
          contextId,
          status: { state: 'submitted', timestamp: new Date().toISOString() },
          history: [userMessage],
        });

        await eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: { state: 'working', timestamp: new Date().toISOString() },
          final: false,
        });

        let finalContent = '';
        for await (const event of executor.stream({
          messages: [{ role: 'user', content: inputText }],
          contextId: contextId,
          userJwt: requestContext.context?._user?.jwt || '',
        })) {
          finalContent = event.content || finalContent;
          if (!event.done && event.raw?.messages?.at(-1)?.getType?.() === 'ai') {
            await eventBus.publish({
              kind: 'status-update',
              taskId,
              contextId,
              status: {
                state: 'working',
                message: {
                  kind: 'message',
                  role: 'agent',
                  messageId: randomUUID(),
                  parts: [{ kind: 'text', text: event.content }],
                  taskId,
                  contextId,
                },
                timestamp: new Date().toISOString(),
              },
              final: false,
            });
          }
        }

        await eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'completed',
            message: {
              kind: 'message',
              role: 'agent',
              messageId: randomUUID(),
              parts: [{ kind: 'text', text: finalContent }],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
        });
      } catch (err) {
        await eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'failed',
            message: {
              kind: 'message',
              role: 'agent',
              messageId: randomUUID(),
              parts: [{ kind: 'text', text: `Error: ${err.message}` }],
              taskId,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
        });
      }
    },
  };

  const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), a2aExecutor);

  // ── Public route: agent card (no auth required) ────────────────────────────
  app.use('/.well-known/agent.json', agentCardHandler({ agentCardProvider: requestHandler }));

  // ── Protected routes: all A2A task endpoints ───────────────────────────────
  app.use(jsonRpcHandler({ requestHandler, userBuilder: xsuaaUserBuilder }));

  return app;
}

module.exports = { createApp };
