const validateEnvironment = require('../config/validateEnvironment');

describe('production environment validation', () => {
  const keys = [
    'NODE_ENV', 'MONGODB_URI', 'ACCESS_TOKEN_SECRET', 'CORS_ORIGINS', 'CLIENT_URL', 'PASSWORD_RESET_URL',
    'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'COOKIE_SECURE', 'COOKIE_SAME_SITE', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY',
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'production', MONGODB_URI: 'mongodb://example.test/teamflow', ACCESS_TOKEN_SECRET: 'a'.repeat(48),
      CORS_ORIGINS: 'https://teamflow.example', CLIENT_URL: 'https://teamflow.example', PASSWORD_RESET_URL: 'https://teamflow.example/reset-password',
      SMTP_HOST: 'smtp.example.test', SMTP_USER: 'teamflow', SMTP_PASSWORD: 'smtp-secret', COOKIE_SECURE: 'true', COOKIE_SAME_SITE: 'none',
      TURNSTILE_SITE_KEY: 'real-site-key', TURNSTILE_SECRET_KEY: 'real-secret-key',
    });
  });

  afterAll(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  function expectConfigurationError(code) {
    try {
      validateEnvironment();
    } catch (error) {
      expect(error.code).toBe(code);
      return;
    }
    throw new Error(`Expected environment validation to fail with ${code}.`);
  }

  it('requires production Turnstile keys', () => {
    delete process.env.TURNSTILE_SITE_KEY;
    expectConfigurationError('ENVIRONMENT_NOT_CONFIGURED');
  });

  it('rejects Cloudflare test keys in production', () => {
    process.env.TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    expectConfigurationError('TEST_CAPTCHA_KEYS_IN_PRODUCTION');
  });

  it('accepts configured production values', () => {
    expect(validateEnvironment()).toBeUndefined();
  });
});
