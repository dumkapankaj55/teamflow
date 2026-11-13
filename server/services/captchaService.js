const AppError = require('../utils/AppError');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

async function verifyCaptcha(token, remoteIp) {
  if (!token) throw new AppError('Complete the CAPTCHA check and try again.', 400, 'CAPTCHA_REQUIRED');
  if (process.env.NODE_ENV === 'test' && !process.env.TURNSTILE_SECRET_KEY) return true;
  const secret = process.env.TURNSTILE_SECRET_KEY || (process.env.NODE_ENV === 'production' ? '' : TEST_SECRET_KEY);
  if (!secret) throw new AppError('CAPTCHA verification is not configured.', 503, 'CAPTCHA_UNAVAILABLE');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Siteverify returned HTTP ${response.status}`);
    const result = await response.json();
    if (!result.success || (result.action && result.action !== 'password_reset') || (process.env.NODE_ENV === 'production' && result.action !== 'password_reset')) {
      throw new AppError('CAPTCHA verification failed. Please try again.', 400, 'CAPTCHA_FAILED');
    }
    return true;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('CAPTCHA verification is temporarily unavailable. Please try again.', 503, 'CAPTCHA_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { verifyCaptcha };
