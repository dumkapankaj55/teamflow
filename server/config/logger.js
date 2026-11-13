const crypto = require('crypto');
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', 'password', 'token', 'refreshToken'],
    censor: '[REDACTED]',
  },
  base: { service: 'teamflow-api' },
});

function requestIdMiddleware() {
  const pinoHttp = require('pino-http');
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && /^[a-f0-9-]{36}$/i.test(incoming) ? incoming : crypto.randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    serializers: {
      req(req) {
        const path = String(req.url || '/').split('?')[0];
        const safePath = path.replace(/^(\/api\/v1\/invitations\/)[^/]+(\/accept)$/, '$1[REDACTED]$2');
        return { id: req.id, method: req.method, url: safePath };
      },
      res(res) { return { statusCode: res.statusCode }; },
    },
    customProps(req) { return { requestId: req.id }; },
  });
}

module.exports = { logger, requestIdMiddleware };
