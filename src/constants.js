const AICORE_RESOURCE_GROUP = 'default';
const AICORE_MODEL_NAME = 'anthropic--claude-4.6-sonnet';

// ── LLM connectivity mode ──────────────────────────────────────────────────────
// 'binding'        — reach AI Core directly via the VCAP_SERVICES aicore binding
// '<dest-name>'    — reach AI Core via a BTP Destination with that name
const LLM_MODE = 'binding';

module.exports = { AICORE_RESOURCE_GROUP, AICORE_MODEL_NAME, LLM_MODE };
