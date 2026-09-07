# BTP Node.js Agent Template

A production-ready Node.js template for building [A2A-compatible](https://google.github.io/A2A/) AI agents on SAP BTP.

**What's included:**
- A2A protocol server (agent card, `message/send`, `message/stream`)
- XSUAA JWT authentication via `@sap/xssec`
- LLM calls via `@sap-ai-sdk/langchain` → AI Core Orchestration Client
- LangGraph ReAct agent loop (swappable — see below)
- Remote MCP server connectivity over HTTP, authenticated via BTP Destination Service
- CF deployment artifacts: `manifest.yml`, `xs-security.json`

---

## Prerequisites

- Node.js 20+
- [CF CLI](https://docs.cloudfoundry.org/cf-cli/install-go-cli.html)
- SAP BTP subaccount with:
  - **XSUAA** service (application plan)
  - **AI Core** service instance (with a deployed model scenario)
  - **Destination Service** (only needed if connecting MCP servers)

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your values
cp .env.example .env
# Edit .env — at minimum set XSUAA_URL, XSUAA_CLIENTID, XSUAA_CLIENTSECRET,
# and AICORE_SERVICE_KEY (your AI Core service key JSON as a single-line string)

# 3. Start the agent
npm start
# → Agent listening on port 3000
# → Agent card: http://localhost:3000/.well-known/agent.json
```

> **Note on local AI Core auth:** The SAP AI SDK reads service bindings from `VCAP_SERVICES` on CF. Locally, set `AICORE_SERVICE_KEY` to the contents of your AI Core service key JSON (single line).

---

## Adding a Custom Tool

1. Create `src/tools/my-tool.js`:

   ```js
   const { DynamicTool } = require('@langchain/core/tools');

   const myTool = new DynamicTool({
     name: 'my_tool',
     description: 'Describe what this tool does and when to use it.',
     func: async (input) => {
       // your implementation
       return `Result for: ${input}`;
     },
   });

   module.exports = { myTool };
   ```

2. Add it to `src/tools/index.js`:

   ```js
   const { myTool } = require('./my-tool');

   const tools = [
     exampleTool,
     myTool,  // ← add here
   ];
   ```

That's it — the tool is available to the agent and appears in the agent card.

---

## Adding an MCP Server

1. Create a BTP Destination pointing to your remote MCP server URL (with auth if needed).

2. Add one line to `src/mcp/servers.js`:

   ```js
   const mcpServers = [
     { name: 'my-tool-server', destinationName: 'MY_MCP_SERVER_DEST' },
   ];
   ```

The MCP server's tools are merged with custom tools automatically at startup.

---

## Swapping the Agent Executor

The agent logic lives entirely in `src/agent/executor.js`. If you want to replace LangGraph with a plain tool-call loop (or any other approach), edit that file only — the A2A server and all other code never changes.

The contract the executor must export:
- `init()` — async startup (tool loading, graph/loop creation)
- `run(input)` → `Promise<string>` — execute and return final answer
- `stream(input)` → `AsyncGenerator` — yield intermediate events, then `{ done: true, content }`
- `getTools()` → `Array` — used to build the agent card

---

## Deploying to Cloud Foundry

```bash
# 1. Create required BTP services
cf create-service xsuaa application btp-nodejs-agent-xsuaa -c xs-security.json
cf create-service aicore standard btp-nodejs-agent-aicore
cf create-service destination lite btp-nodejs-agent-destination  # optional, for MCP

# 2. Push the app
cf push

# 3. Set AI Core env vars if not using defaults
cf set-env btp-nodejs-agent AICORE_RESOURCE_GROUP my-resource-group
cf set-env btp-nodejs-agent AICORE_MODEL_NAME gpt-4o
cf restage btp-nodejs-agent
```

> The `manifest.yml` references service names `btp-nodejs-agent-xsuaa`, `btp-nodejs-agent-aicore`, and `btp-nodejs-agent-destination`. Rename them in `manifest.yml` if your service instances have different names.
