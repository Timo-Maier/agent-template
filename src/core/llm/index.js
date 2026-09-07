const { OrchestrationClient } = require('@sap-ai-sdk/langchain');
const { AICORE_RESOURCE_GROUP, AICORE_MODEL_NAME, LLM_MODE } = require('../../constants');
const logger = require('../lib/logger');

// ── LLM connectivity ───────────────────────────────────────────────────────────
//
// Controlled by LLM_MODE in src/constants.js:
//
//   'binding'      Reaches AI Core directly via the VCAP_SERVICES aicore
//                  binding (default-env.json locally).
//
//   '<dest-name>'  Any other value is used as a BTP Destination name,
//                  e.g. 'my-aicore' → destinationname: 'my-aicore'.
//
// ──────────────────────────────────────────────────────────────────────────────

const orchestrationConfig = {
  promptTemplating: {
    model: {
      name: AICORE_MODEL_NAME,
      params: {},
    },
  },
  // To enable content filtering, grounding, or prompt templates, add config here.
  // See: https://www.npmjs.com/package/@sap-ai-sdk/langchain
};

const deploymentConfig = { resourceGroup: AICORE_RESOURCE_GROUP };

let llm;

if (LLM_MODE === 'binding') {
  llm = new OrchestrationClient(orchestrationConfig, { maxRetries: 0 }, deploymentConfig);
  logger.info({ mode: 'binding', resourceGroup: AICORE_RESOURCE_GROUP, model: AICORE_MODEL_NAME }, 'LLM initialised');
} else {
  llm = new OrchestrationClient(orchestrationConfig, { maxRetries: 0 }, deploymentConfig, { destinationName: LLM_MODE });
  logger.info({ mode: 'destination', destination: LLM_MODE, resourceGroup: AICORE_RESOURCE_GROUP, model: AICORE_MODEL_NAME }, 'LLM initialised');
}

module.exports = { llm };
