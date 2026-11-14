const validateEnvironment = require('../config/validateEnvironment');

describe('production environment validation', () => {
  const keys = [
    'NODE_ENV', 'MONGODB_URI', 'ACCESS_TOKEN_SECRET', 'CORS_ORIGINS', 'CLIENT_URL', 'PASSWORD_RESET_URL', 'REQUIRE_EMAIL_VERIFICATION',
    'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD',
    'COOKIE_SECURE', 'COOKIE_SAME_SITE', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY',
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'production', MONGODB_URI: 'mongodb://example.test/teamflow', ACCESS_TOKEN_SECRET: 'a'.repeat(48),
      CORS_ORIGINS: 'https://teamflow.example', CLIENT_URL: 'https://teamflow.example', PASSWORD_RESET_URL: 'https://teamflow.example/reset-password',
      RESEND_API_KEY: 're_test_secret', RESEND_FROM_EMAIL: 'TeamFlow <no-reply@example.test>',
      COOKIE_SECURE: 'true', COOKIE_SAME_SITE: 'none',
      TURNSTILE_SITE_KEY: 'real-site-key', TURNSTILE_SECRET_KEY: 'real-secret-key', REQUIRE_EMAIL_VERIFICATION: 'true',
    });
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
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

  it('requires Resend credentials and sender configuration', () => {
    delete process.env.RESEND_API_KEY;
    expectConfigurationError('ENVIRONMENT_NOT_CONFIGURED');
  });

  it('requires a Resend sender address', () => {
    delete process.env.RESEND_FROM_EMAIL;
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

  it('rejects non-HTTPS production frontend origins', () => {
    process.env.CLIENT_URL = 'http://teamflow.example';
    expectConfigurationError('INVALID_PRODUCTION_URL');
  });

  it('requires the deployed client origin to be allowed by CORS', () => {
    process.env.CORS_ORIGINS = 'https://another-client.example';
    expectConfigurationError('CLIENT_ORIGIN_NOT_ALLOWED');
  });

  it('requires password recovery to target the deployed frontend reset route', () => {
    process.env.PASSWORD_RESET_URL = 'https://another-client.example/reset-password';
    expectConfigurationError('INVALID_PASSWORD_RESET_URL');
  });
});
