require('@sap/xsenv').loadEnv();

const logger = require('./core/lib/logger');
const executor = require('./agent/executor');
const { createApp } = require('./core/server');

const PORT = process.env.PORT || 4004;

async function start() {
  try {

    const app = createApp(executor);

    app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Agent listening');
      logger.info(
        { url: `http://localhost:${PORT}/.well-known/agent.json` },
        'Agent card available',
      );
    });
  } catch (err) {
    logger.error({ err }, 'Fatal startup error');
    process.exit(1);
  }
}

start();
