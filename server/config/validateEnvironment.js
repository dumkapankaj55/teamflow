const AppError = require('../utils/AppError');

function parseProductionUrl(value, key) {
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    throw new AppError(`${key} must be a valid HTTPS URL.`, 500, 'INVALID_PRODUCTION_URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new AppError(`${key} must be a valid HTTPS URL without embedded credentials.`, 500, 'INVALID_PRODUCTION_URL');
  }
  return url;
}

function validateEnvironment() {
  if (process.env.NODE_ENV !== 'production') return;
  const required = ['MONGODB_URI', 'ACCESS_TOKEN_SECRET', 'CORS_ORIGINS', 'CLIENT_URL', 'PASSWORD_RESET_URL', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'REQUIRE_EMAIL_VERIFICATION'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new AppError(`Missing production environment variables: ${missing.join(', ')}`, 500, 'ENVIRONMENT_NOT_CONFIGURED');
  if (process.env.ACCESS_TOKEN_SECRET.length < 32) throw new AppError('ACCESS_TOKEN_SECRET must contain at least 32 characters in production.', 500, 'WEAK_ACCESS_TOKEN_SECRET');
  const clientUrl = parseProductionUrl(process.env.CLIENT_URL, 'CLIENT_URL');
  if (clientUrl.origin !== process.env.CLIENT_URL || clientUrl.pathname !== '/' || clientUrl.search || clientUrl.hash) {
    throw new AppError('CLIENT_URL must be the exact HTTPS frontend origin without a trailing slash, path, query, or fragment.', 500, 'INVALID_CLIENT_URL');
  }
  const allowedOrigins = process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!allowedOrigins.length || allowedOrigins.some((origin) => parseProductionUrl(origin, 'CORS_ORIGINS').origin !== origin)) {
    throw new AppError('CORS_ORIGINS must contain comma-separated HTTPS origins without paths or trailing slashes.', 500, 'INVALID_CORS_ORIGINS');
  }
  if (!allowedOrigins.includes(clientUrl.origin)) {
    throw new AppError('CORS_ORIGINS must include the CLIENT_URL origin.', 500, 'CLIENT_ORIGIN_NOT_ALLOWED');
  }
  const resetUrl = parseProductionUrl(process.env.PASSWORD_RESET_URL, 'PASSWORD_RESET_URL');
  if (resetUrl.origin !== clientUrl.origin || resetUrl.search || resetUrl.hash || resetUrl.pathname.replace(/\/+$/, '') !== '/reset-password') {
    throw new AppError('PASSWORD_RESET_URL must be the frontend HTTPS /reset-password URL without a query or fragment.', 500, 'INVALID_PASSWORD_RESET_URL');
  }
  if (process.env.REQUIRE_EMAIL_VERIFICATION !== 'true') throw new AppError('REQUIRE_EMAIL_VERIFICATION=true is required in production.', 500, 'EMAIL_VERIFICATION_REQUIRED');
  if (process.env.COOKIE_SECURE !== 'true') throw new AppError('COOKIE_SECURE=true is required in production.', 500, 'INSECURE_COOKIE_CONFIGURATION');
  if (process.env.COOKIE_SAME_SITE !== 'none') throw new AppError('COOKIE_SAME_SITE=none is required for the Vercel and Render deployment origins.', 500, 'INCOMPATIBLE_COOKIE_CONFIGURATION');
  if (process.env.TURNSTILE_SITE_KEY === '1x00000000000000000000AA' || process.env.TURNSTILE_SECRET_KEY === '1x0000000000000000000000000000000AA') {
    throw new AppError('Use production Cloudflare Turnstile keys; test keys are not allowed in production.', 500, 'TEST_CAPTCHA_KEYS_IN_PRODUCTION');
  }
}

module.exports = validateEnvironment;
