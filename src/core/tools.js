'use strict';

const { DynamicStructuredTool } = require('@langchain/core/tools');
const { z } = require('zod');
const logger = require('../core/lib/logger');

// Mirrors the JSON Schema → Zod conversion used in the MCP server template.
function jsonSchemaToZod(def) {
  if (!def || typeof def !== 'object') return z.unknown();

  const { type, description, properties, required: innerRequired, items } = def;
  let zodType;

  switch (type) {
    case 'string':
      zodType = z.string();
      break;
    case 'number':
      zodType = z.number();
      break;
    case 'boolean':
      zodType = z.boolean();
      break;
    case 'array': {
      const itemZod = items ? jsonSchemaToZod(items) : z.unknown();
      zodType = z.array(itemZod);
      break;
    }
    case 'object': {
      const innerProps = properties ?? {};
      const reqArr = Array.isArray(innerRequired) ? innerRequired : [];
      const innerShape = {};
      for (const [k, propDef] of Object.entries(innerProps)) {
        const mapped = jsonSchemaToZod(propDef);
        // eslint-disable-next-line security/detect-object-injection -- k comes from Object.entries() on a trusted schema
        innerShape[k] = reqArr.includes(k) ? mapped : mapped.optional();
      }
      zodType = Object.keys(innerShape).length > 0
        ? z.object(innerShape)
        : z.record(z.string(), z.unknown());
      break;
    }
    default:
      zodType = z.unknown();
  }

  if (description) zodType = zodType.describe(description);
  return zodType;
}

/**
 * Converts tool registry entries ({ tool, handler }) into LangChain
 * DynamicStructuredTool instances. The userJwt is captured in closure
 * so handlers can perform principal propagation, matching the MCP template pattern.
 */
function buildLangChainTools(toolEntries, userJwt) {
  return toolEntries.map(({ tool, handler }) => {
    const props = tool.inputSchema?.properties ?? {};
    const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];

    const shape = {};
    for (const [key, def] of Object.entries(props)) {
      const zodType = jsonSchemaToZod(def);
      // eslint-disable-next-line security/detect-object-injection -- key from Object.entries() on trusted schema
      shape[key] = required.includes(key) ? zodType : zodType.optional();
    }

    const schema = Object.keys(shape).length > 0
      ? z.object(shape)
      : z.object({});

    return new DynamicStructuredTool({
      name: tool.name,
      description: tool.description ?? '',
      schema,
      func: async (args) => {
        try {
          return await handler(args, userJwt);
        } catch (err) {
          logger.error({ err, tool: tool.name }, '[tools] Handler error');
          return `Error: ${err.message}`;
        }
      },
    });
  });
}

module.exports = { buildLangChainTools };
