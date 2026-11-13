jest.mock('stripe', () => jest.fn());
jest.mock('../models/Subscription', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../models/StripeEvent', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../models/BillingPayment', () => ({
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../models/Membership', () => ({}));
jest.mock('../models/Invitation', () => ({}));
jest.mock('../models/Project', () => ({}));
jest.mock('../models/Organization', () => ({
  exists: jest.fn(),
}));
jest.mock('../services/mailerService', () => ({
  isConfigured: jest.fn(),
  sendEmail: jest.fn(),
}));

const Stripe = require('stripe');
const Subscription = require('../models/Subscription');
const StripeEvent = require('../models/StripeEvent');
const BillingPayment = require('../models/BillingPayment');
const Organization = require('../models/Organization');
const mailerService = require('../services/mailerService');
const billingService = require('../services/billingService');

const organizationId = '64b000000000000000000001';
const stripeApi = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn(), retrieve: jest.fn(), expire: jest.fn() } },
  subscriptions: { cancel: jest.fn(), update: jest.fn(), retrieve: jest.fn() },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
};

function findOneResult(value) {
  const query = { lean: jest.fn().mockResolvedValue(value) };
  query.select = jest.fn(() => query);
  return query;
}

describe('billing service Stripe integration', () => {
  const environmentKeys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_ENTERPRISE', 'CLIENT_URL', 'SALES_EMAIL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'];
  const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: 'sk_test_local_only',
      STRIPE_WEBHOOK_SECRET: 'whsec_local_only',
      STRIPE_PRICE_PRO: 'price_pro',
      STRIPE_PRICE_ENTERPRISE: 'price_enterprise',
      CLIENT_URL: 'https://teamflow.example.test',
      SALES_EMAIL: 'sales@example.test',
      SMTP_HOST: 'smtp.example.test',
      SMTP_USER: 'teamflow',
      SMTP_PASSWORD: 'local-test-password',
    });
    Stripe.mockImplementation(() => stripeApi);
    Subscription.findOne.mockReturnValue(findOneResult(null));
    Subscription.create.mockResolvedValue({ organization: organizationId, plan: 'FREE', status: 'free', toObject() { return this; } });
    Subscription.findOneAndUpdate.mockResolvedValue({ organization: organizationId });
    Subscription.updateOne.mockResolvedValue({ matchedCount: 1 });
    Organization.exists.mockResolvedValue({ _id: organizationId });
    stripeApi.customers.create.mockResolvedValue({ id: 'cus_teamflow_test' });
    stripeApi.checkout.sessions.create.mockResolvedValue({
      id: 'cs_teamflow_test',
      url: 'https://checkout.stripe.test/session',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
  });

  afterAll(() => {
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });

  it('creates a hosted Pro checkout without activating a subscription in MongoDB', async () => {
    const result = await billingService.createCheckoutSession({
      organizationId,
      user: { email: 'admin@example.test', name: 'Workspace Admin' },
      plan: 'PRO',
    });

    expect(result.url).toBe('https://checkout.stripe.test/session');
    expect(stripeApi.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'subscription',
      line_items: [{ price: 'price_pro', quantity: 1 }],
      success_url: 'https://teamflow.example.test/billing?checkout=success',
      cancel_url: 'https://teamflow.example.test/billing?checkout=cancelled',
    }), expect.objectContaining({ idempotencyKey: expect.stringMatching(/^teamflow-checkout-pending:/) }));
    expect(Subscription.updateOne).toHaveBeenCalledWith(
      { organization: organizationId, checkoutSessionId: expect.stringMatching(/^pending:/) },
      expect.objectContaining({ $set: expect.objectContaining({ checkoutSessionId: 'cs_teamflow_test' }) }),
    );
    expect(Subscription.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ organization: organizationId }),
      expect.objectContaining({ $set: expect.objectContaining({ checkoutSessionId: expect.stringMatching(/^pending:/) }) }),
      { new: true },
    );
  });

  it('reuses an open checkout rather than creating duplicate Stripe sessions', async () => {
    Subscription.findOne.mockReturnValue(findOneResult({
      organization: organizationId,
      plan: 'FREE',
      status: 'free',
      checkoutSessionId: 'cs_existing',
      checkoutExpiresAt: new Date(Date.now() + 60_000),
    }));
    stripeApi.checkout.sessions.retrieve.mockResolvedValue({ status: 'open', url: 'https://checkout.stripe.test/existing' });

    const result = await billingService.createCheckoutSession({
      organizationId,
      user: { email: 'admin@example.test', name: 'Workspace Admin' },
      plan: 'PRO',
    });

    expect(result.url).toBe('https://checkout.stripe.test/existing');
    expect(stripeApi.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects a second checkout while a paid subscription is active', async () => {
    Subscription.findOne.mockReturnValue(findOneResult({
      organization: organizationId,
      plan: 'PRO',
      status: 'active',
      stripeSubscriptionId: 'sub_active',
      currentPeriodEnd: new Date(Date.now() + 60_000),
    }));

    await expect(billingService.createCheckoutSession({
      organizationId,
      user: { email: 'admin@example.test', name: 'Workspace Admin' },
      plan: 'PRO',
    })).rejects.toMatchObject({ code: 'BILLING_SUBSCRIPTION_EXISTS', statusCode: 409 });

    expect(stripeApi.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('retries an interrupted checkout with the same Stripe idempotency key', async () => {
    const checkoutLock = `pending:${'a'.repeat(36)}`;
    Subscription.findOne.mockReturnValue(findOneResult({
      organization: organizationId,
      plan: 'FREE',
      status: 'free',
      checkoutSessionId: checkoutLock,
      checkoutExpiresAt: new Date(Date.now() + 60_000),
    }));

    await billingService.createCheckoutSession({
      organizationId,
      user: { email: 'admin@example.test', name: 'Workspace Admin' },
      plan: 'PRO',
    });

    expect(stripeApi.checkout.sessions.create).toHaveBeenCalledWith(
      expect.any(Object),
      { idempotencyKey: `teamflow-checkout-${checkoutLock}` },
    );
    expect(Subscription.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('schedules a paid subscription downgrade instead of granting Free immediately', async () => {
    const end = Math.floor(Date.now() / 1000) + 86400;
    Subscription.findOne.mockReturnValue(findOneResult({
      organization: organizationId,
      plan: 'PRO',
      status: 'active',
      stripeSubscriptionId: 'sub_teamflow_test',
      currentPeriodEnd: new Date(end * 1000),
      cancelAtPeriodEnd: false,
    }));
    stripeApi.subscriptions.update.mockResolvedValue({
      id: 'sub_teamflow_test',
      customer: 'cus_teamflow_test',
      status: 'active',
      cancel_at_period_end: true,
      current_period_end: end,
      metadata: { organizationId },
      items: { data: [{ price: { id: 'price_pro' } }] },
    });

    const result = await billingService.selectFreePlan(organizationId);

    expect(stripeApi.subscriptions.update).toHaveBeenCalledWith('sub_teamflow_test', { cancel_at_period_end: true });
    expect(result.cancelAtPeriodEnd).toBe(true);
    expect(Subscription.findOneAndUpdate).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      $set: expect.objectContaining({ plan: 'PRO', cancelAtPeriodEnd: true }),
    }), expect.any(Object));
    expect(Subscription.updateOne).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ $set: expect.objectContaining({ plan: 'FREE' }) }));
  });

  it('cancels an incomplete Stripe subscription before selecting Free', async () => {
    Subscription.findOne.mockReturnValue(findOneResult({
      organization: organizationId,
      plan: 'PRO',
      status: 'incomplete',
      stripeCustomerId: 'cus_teamflow_test',
      stripeSubscriptionId: 'sub_incomplete',
    }));
    stripeApi.subscriptions.cancel.mockResolvedValue({
      id: 'sub_incomplete',
      customer: 'cus_teamflow_test',
      status: 'canceled',
      metadata: { organizationId },
      items: { data: [{ price: { id: 'price_pro' } }] },
    });

    const result = await billingService.selectFreePlan(organizationId);

    expect(stripeApi.subscriptions.cancel).toHaveBeenCalledWith('sub_incomplete');
    expect(result).toEqual({ plan: 'FREE', status: 'canceled', cancelAtPeriodEnd: false });
    expect(Subscription.findOneAndUpdate).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      $set: expect.objectContaining({ plan: 'FREE', status: 'canceled' }),
    }), expect.any(Object));
    expect(Subscription.updateOne).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ $set: expect.objectContaining({ status: 'free' }) }));
  });

  it('persists verified invoice failure and marks the matching workspace past due', async () => {
    StripeEvent.create.mockResolvedValue({ eventId: 'evt_payment_failed' });
    Subscription.findOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ organization: organizationId, stripeSubscriptionId: 'sub_teamflow_test' }) }),
    });
    const event = {
      id: 'evt_payment_failed',
      type: 'invoice.payment_failed',
      data: { object: {
        id: 'in_teamflow_test',
        customer: 'cus_teamflow_test',
        subscription: 'sub_teamflow_test',
        number: 'TF-100',
        currency: 'usd',
        amount_due: 4900,
        amount_paid: 0,
        created: 1_800_000_000,
      } },
    };

    await expect(billingService.processStripeEvent(event)).resolves.toEqual({ duplicate: false });

    expect(BillingPayment.findOneAndUpdate).toHaveBeenCalledWith(
      { stripeInvoiceId: 'in_teamflow_test' },
      expect.objectContaining({ $set: expect.objectContaining({ organization: organizationId, status: 'payment_failed', amountDue: 4900 }) }),
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    expect(Subscription.updateOne).toHaveBeenCalledWith(
      { organization: organizationId, stripeSubscriptionId: 'sub_teamflow_test' },
      { $set: { status: 'past_due' } },
    );
  });

  it('does not activate a plan when Stripe reports an expired checkout', async () => {
    StripeEvent.create.mockResolvedValue({ eventId: 'evt_checkout_expired' });

    await expect(billingService.processStripeEvent({
      id: 'evt_checkout_expired',
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_expired' } },
    })).resolves.toEqual({ duplicate: false });

    expect(Subscription.updateOne).toHaveBeenCalledWith(
      { checkoutSessionId: 'cs_expired' },
      { $unset: { checkoutSessionId: 1, checkoutExpiresAt: 1 } },
    );
    expect(Subscription.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('activates Pro only from a Stripe-confirmed checkout subscription', async () => {
    StripeEvent.create.mockResolvedValue({ eventId: 'evt_checkout_completed' });
    stripeApi.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_teamflow_test',
      customer: 'cus_teamflow_test',
      status: 'active',
      current_period_start: 1_800_000_000,
      current_period_end: 1_802_592_000,
      cancel_at_period_end: false,
      metadata: { organizationId },
      items: { data: [{ price: { id: 'price_pro' } }] },
    });
    const event = {
      id: 'evt_checkout_completed',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_teamflow_test', mode: 'subscription', subscription: 'sub_teamflow_test', metadata: { organizationId } } },
    };

    await expect(billingService.processStripeEvent(event)).resolves.toEqual({ duplicate: false });

    expect(stripeApi.subscriptions.retrieve).toHaveBeenCalledWith('sub_teamflow_test');
    expect(Subscription.findOneAndUpdate).toHaveBeenCalledWith(
      { organization: organizationId },
      expect.objectContaining({ $set: expect.objectContaining({ plan: 'PRO', status: 'active', stripeSubscriptionId: 'sub_teamflow_test' }) }),
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });

  it('returns a canceled subscription to Free only after Stripe reports it canceled', async () => {
    StripeEvent.create.mockResolvedValue({ eventId: 'evt_subscription_deleted' });
    const event = {
      id: 'evt_subscription_deleted',
      type: 'customer.subscription.deleted',
      data: { object: {
        id: 'sub_teamflow_test',
        customer: 'cus_teamflow_test',
        status: 'canceled',
        metadata: { organizationId },
        items: { data: [{ price: { id: 'price_pro' } }] },
      } },
    };

    await expect(billingService.processStripeEvent(event)).resolves.toEqual({ duplicate: false });

    expect(Subscription.findOneAndUpdate).toHaveBeenCalledWith(
      { organization: organizationId },
      expect.objectContaining({ $set: expect.objectContaining({ plan: 'FREE', status: 'canceled' }) }),
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });

  it('sends an Enterprise enquiry to the configured sales email', async () => {
    mailerService.isConfigured.mockReturnValue(true);
    mailerService.sendEmail.mockResolvedValue(true);

    await expect(billingService.sendEnterpriseEnquiry({
      organization: { _id: organizationId, name: 'Northstar' },
      user: { email: 'admin@example.test', name: 'Workspace Admin' },
      message: 'We need centralized workspace administration.',
    })).resolves.toEqual({ sent: true });

    expect(mailerService.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'sales@example.test',
      subject: 'TeamFlow Enterprise plan enquiry',
      text: expect.stringContaining('We need centralized workspace administration.'),
    }));
  });

  it('verifies webhook signatures against the configured signing secret', () => {
    const rawBody = Buffer.from('{"id":"evt_signed"}');
    const event = { id: 'evt_signed' };
    stripeApi.webhooks.constructEvent.mockReturnValue(event);

    expect(billingService.verifyWebhook(rawBody, 'signature')).toBe(event);
    expect(stripeApi.webhooks.constructEvent).toHaveBeenCalledWith(rawBody, 'signature', 'whsec_local_only');
  });

  it('rejects invalid webhook signatures', () => {
    stripeApi.webhooks.constructEvent.mockImplementation(() => { throw new Error('invalid signature'); });

    expect(() => billingService.verifyWebhook(Buffer.from('{}'), 'invalid'))
      .toThrow(expect.objectContaining({ code: 'INVALID_WEBHOOK_SIGNATURE', statusCode: 400 }));
  });
});
