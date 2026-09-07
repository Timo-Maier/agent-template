// Define the agent's business capabilities here.
// Each skill describes WHAT the agent can do, not how it's implemented internally.
const SKILLS = [
  {
    id: 'skill-id',
    name: 'Skill Name',
    description: 'Skill Description',
  },
];

function buildAgentCard() {

  return {
    name: 'BTP Node.js Agent',
    description: 'An AI agent running on SAP BTP, powered by AI Core via the SAP AI SDK.',
    version: '1.0.0',
    url: process.env.AGENT_URL || `http://localhost:${process.env.PORT || 4004}`,
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    skills: SKILLS,
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
  };
}

module.exports = { buildAgentCard };
