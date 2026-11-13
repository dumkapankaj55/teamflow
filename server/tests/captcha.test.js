const { verifyCaptcha } = require('../services/captchaService');

describe('Cloudflare Turnstile verification', () => {
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => { process.env.TURNSTILE_SECRET_KEY = 'unit-test-secret'; });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
  });

  it('requires a challenge token', async () => {
    await expect(verifyCaptcha('', '127.0.0.1')).rejects.toMatchObject({ code: 'CAPTCHA_REQUIRED' });
  });

  it('validates the token with Siteverify and the password reset action', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, action: 'password_reset' }) });

    await expect(verifyCaptcha('turnstile-token', '127.0.0.1')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('https://challenges.cloudflare.com/turnstile/v0/siteverify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ secret: 'unit-test-secret', response: 'turnstile-token', remoteip: '127.0.0.1' }),
    }));
  });

  it('rejects failed challenges and action mismatches', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, action: 'login' }) });

    await expect(verifyCaptcha('bad-token')).rejects.toMatchObject({ code: 'CAPTCHA_FAILED' });
    await expect(verifyCaptcha('wrong-action-token')).rejects.toMatchObject({ code: 'CAPTCHA_FAILED' });
  });

  it('returns a service error when Siteverify cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network failure'));

    await expect(verifyCaptcha('turnstile-token')).rejects.toMatchObject({
      statusCode: 503,
      code: 'CAPTCHA_UNAVAILABLE',
      message: 'CAPTCHA verification is temporarily unavailable. Please try again.',
    });
  });
});
