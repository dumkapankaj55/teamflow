jest.mock('resend', () => ({ Resend: jest.fn() }));

const { Resend } = require('resend');
const mailerService = require('../services/mailerService');

describe('Resend mailer service', () => {
  const keys = ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'];
  const originalEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  let send;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test_secret';
    process.env.RESEND_FROM_EMAIL = 'TeamFlow <no-reply@example.test>';
    send = jest.fn().mockResolvedValue({ data: { id: 'email_test_id' }, error: null });
    Resend.mockImplementation(() => ({ emails: { send } }));
  });

  afterAll(() => {
    for (const key of keys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });

  it('sends email content through Resend using the configured sender', async () => {
    await expect(mailerService.sendEmail({
      to: 'member@example.test',
      subject: 'Verify your TeamFlow email',
      text: 'Verify your email.',
      html: '<p>Verify your email.</p>',
      replyTo: 'admin@example.test',
    })).resolves.toBe(true);

    expect(Resend).toHaveBeenCalledWith('re_test_secret');
    expect(send).toHaveBeenCalledWith({
      from: 'TeamFlow <no-reply@example.test>',
      to: 'member@example.test',
      subject: 'Verify your TeamFlow email',
      text: 'Verify your email.',
      html: '<p>Verify your email.</p>',
      replyTo: 'admin@example.test',
    });
  });

  it('returns false when Resend configuration is incomplete', async () => {
    delete process.env.RESEND_FROM_EMAIL;

    await expect(mailerService.sendEmail({ to: 'member@example.test', subject: 'Test', text: 'Test' })).resolves.toBe(false);
    expect(Resend).not.toHaveBeenCalled();
  });

  it('returns a safe delivery error when Resend rejects the request', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'private provider detail' } });

    await expect(mailerService.sendEmail({ to: 'member@example.test', subject: 'Test', text: 'Test' }))
      .rejects.toMatchObject({
        message: 'Email delivery failed. Please try again later.',
        code: 'EMAIL_DELIVERY_UNAVAILABLE',
        statusCode: 503,
      });
  });

  it('returns a safe delivery error when the Resend request throws', async () => {
    send.mockRejectedValue(new Error('private network detail containing re_test_secret'));

    await expect(mailerService.sendEmail({ to: 'member@example.test', subject: 'Test', text: 'Test' }))
      .rejects.toMatchObject({
        message: 'Email delivery failed. Please try again later.',
        code: 'EMAIL_DELIVERY_UNAVAILABLE',
        statusCode: 503,
      });
  });
});
