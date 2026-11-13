const { defineConfig } = require('@playwright/test');

const apiPort = 5001;
const clientPort = 5174;

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${clientPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: `http://127.0.0.1:${apiPort}/api/v1/health/ready`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(apiPort),
      VITE_PORT: String(clientPort),
      VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      MONGODB_URI: process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27017/teamflow_e2e',
      ACCESS_TOKEN_SECRET: process.env.E2E_ACCESS_TOKEN_SECRET || 'local-playwright-secret-change-before-shared-use-2026',
      CORS_ORIGINS: `http://127.0.0.1:${clientPort}`,
      CLIENT_URL: `http://127.0.0.1:${clientPort}`,
      COOKIE_SECURE: 'false',
      COOKIE_SAME_SITE: 'lax',
    },
  },
});
