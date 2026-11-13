require('dotenv').config();

const app = require('./app');
const connectDatabase = require('./config/database');
const validateEnvironment = require('./config/validateEnvironment');
const http = require('http');
const { initializeSocket, closeSocket } = require('./services/socketService');
const { logger } = require('./config/logger');

const port = Number(process.env.PORT) || 5000;
try { validateEnvironment(); } catch (error) {
  logger.error({ code: error.code }, error.message);
  process.exit(1);
}
connectDatabase()
  .then(() => {
    const server = http.createServer(app);
    initializeSocket(server);
    server.listen(port, () => logger.info({ port }, 'TeamFlow API listening'));
    const shutdown = async () => {
      await closeSocket();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  })
  .catch((error) => {
    logger.error({ errorName: error.name, errorCode: error.code }, 'TeamFlow could not connect to MongoDB');
    process.exit(1);
  });
