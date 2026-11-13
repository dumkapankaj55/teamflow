const Sentry = require('@sentry/node');

const enabled = Boolean(process.env.SENTRY_DSN);
if (enabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
        if (event.request.url) event.request.url = event.request.url.split('?')[0];
      }
      delete event.user;
      return event;
    },
  });
}

function captureError(error) {
  if (enabled && (!error?.statusCode || error.statusCode >= 500)) Sentry.captureException(error);
}

module.exports = { captureError };
