const AppError = require('../utils/AppError');

function validateEnvironment() {
  if (process.env.NODE_ENV !== 'production') return;
  const required = ['MONGODB_URI', 'ACCESS_TOKEN_SECRET', 'CORS_ORIGINS', 'CLIENT_URL', 'PASSWORD_RESET_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new AppError(`Missing production environment variables: ${missing.join(', ')}`, 500, 'ENVIRONMENT_NOT_CONFIGURED');
  if (process.env.ACCESS_TOKEN_SECRET.length < 32) throw new AppError('ACCESS_TOKEN_SECRET must contain at least 32 characters in production.', 500, 'WEAK_ACCESS_TOKEN_SECRET');
  if (process.env.COOKIE_SECURE !== 'true') throw new AppError('COOKIE_SECURE=true is required in production.', 500, 'INSECURE_COOKIE_CONFIGURATION');
  if (process.env.COOKIE_SAME_SITE !== 'none') throw new AppError('COOKIE_SAME_SITE=none is required for the Vercel and Render deployment origins.', 500, 'INCOMPATIBLE_COOKIE_CONFIGURATION');
  if (process.env.TURNSTILE_SITE_KEY === '1x00000000000000000000AA' || process.env.TURNSTILE_SECRET_KEY === '1x0000000000000000000000000000000AA') {
    throw new AppError('Use production Cloudflare Turnstile keys; test keys are not allowed in production.', 500, 'TEST_CAPTCHA_KEYS_IN_PRODUCTION');
  }
}

module.exports = validateEnvironment;
