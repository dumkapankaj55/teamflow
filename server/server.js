require('dotenv').config();

const app = require('./app');
const connectDatabase = require('./config/database');
const validateEnvironment = require('./config/validateEnvironment');

const port = Number(process.env.PORT) || 5000;
try { validateEnvironment(); } catch (error) {
  console.error(error.message);
  process.exit(1);
}
connectDatabase()
  .then(() => app.listen(port, () => console.log(`TeamFlow API listening on port ${port}`)))
  .catch((error) => {
    console.error(`TeamFlow could not connect to MongoDB: ${error.message}`);
    process.exit(1);
  });
