'use strict';

async function handleExampleTool({ name }, _userJwt) {
  return `Hello, ${name}! This is an example tool — replace me in src/tools/example-tool/.`;
}

module.exports = { handleExampleTool };
