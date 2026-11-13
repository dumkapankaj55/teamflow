const js = require('@eslint/js');

const commonGlobals = {
  Buffer: 'readonly',
  console: 'readonly',
  process: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
};

const browserGlobals = {
  ...commonGlobals,
  window: 'readonly',
  document: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  FormData: 'readonly',
  crypto: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  HTMLElement: 'readonly',
  Node: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  confirm: 'readonly',
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  jest: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
  fail: 'readonly',
};

const rules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
};

module.exports = [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'playwright-report/**', 'test-results/**'] },
  {
    ...js.configs.recommended,
    rules,
    files: ['server/**/*.js', 'eslint.config.js', 'playwright.config.js', 'e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...commonGlobals,
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        global: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        afterAll: 'readonly',
        fail: 'readonly',
      },
    },
  },
  {
    ...js.configs.recommended,
    rules,
    files: ['client/src/**/*.{js,jsx}', 'client/vite.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
  },
  {
    ...js.configs.recommended,
    rules,
    files: ['*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...commonGlobals, require: 'readonly', module: 'readonly', __dirname: 'readonly' },
    },
  },
];
