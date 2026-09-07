const pino = require('pino');

function sanitizeError(err) {
  const base = pino.stdSerializers.err(err);

  if (!err.isAxiosError) return base;

  return {
    ...base,
    status: err.status,
    config: {
      method: err.config?.method,
      url: err.config?.url,
      baseURL: err.config?.baseURL,
    },
    response: err.response
      ? {
          status: err.response.status,
          statusText: err.response.statusText,
          data: err.response.data,
        }
      : undefined,
  };
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['req.headers.authorization'],
  serializers: { err: sanitizeError },
});

module.exports = logger;
