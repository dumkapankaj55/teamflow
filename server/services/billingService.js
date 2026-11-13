const Stripe = require('stripe');
const AppError = require('../utils/AppError');
const plans = require('../config/plans');
const Subscription = require('../models/Subscription');
const StripeEvent = require('../models/StripeEvent');
const Membership = require('../models/Membership');
const Invitation = require('../models/Invitation');
const Project = require('../models/Project');
const Organization = require('../models/Organization');

let stripeClient;
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new AppError('Billing is not configured. Add Stripe test keys to the server environment.', 503, 'BILLING_NOT_CONFIGURED');
  if (!stripeClient) stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

function priceForPlan(plan) {
  return plan === 'PRO' ? process.env.STRIPE_PRICE_PRO : plan === 'ENTERPRISE' ? process.env.STRIPE_PRICE_ENTERPRISE : null;
}

function effectivePlan(subscription) {
  if (!subscription) return plans.FREE;
  const entitled = ['active', 'trialing', 'past_due'].includes(subscription.status)
    && (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > new Date());
  return entitled ? (plans[subscription.plan] || plans.FREE) : plans.FREE;
}

async function getBillingSummary(organizationId) {
  const [subscription, members, pendingInvitations, projects] = await Promise.all([
    Subscription.findOne({ organization: organizationId }).lean(),
    Membership.countDocuments({ organization: organizationId, status: 'ACTIVE' }),
    Invitation.countDocuments({ organization: organizationId, status: 'PENDING', expiresAt: { $gt: new Date() } }),
    Project.countDocuments({ organization: organizationId }),
  ]);
  const plan = effectivePlan(subscription);
  const usage = { members, pendingInvitations, projects, storageBytes: null };
  const safePlan = { id: plan.id, name: plan.name, members: plan.members, projects: plan.projects, features: { ...plan.features, storageTracking: false } };
  return {
    subscription: subscription ? { plan: plan.id, status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd } : { plan: 'FREE', status: 'free', currentPeriodEnd: null, cancelAtPeriodEnd: false },
    plan: safePlan,
    usage,
    limits: { members: plan.members, projects: plan.projects, storageBytes: null },
    availablePlans: Object.values(plans).map(({ id, name, members: memberLimit, projects: projectLimit, features }) => ({ id, name, limits: { members: memberLimit, projects: projectLimit, storageBytes: null }, features: { ...features, storageTracking: false } })),
    checkoutAvailable: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && (process.env.STRIPE_PRICE_PRO || process.env.STRIPE_PRICE_ENTERPRISE)),
    configuredPlans: ['PRO', 'ENTERPRISE'].filter((planId) => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && priceForPlan(planId))),
  };
}

async function requirePlanFeature(organizationId, feature) {
  const subscription = await Subscription.findOne({ organization: organizationId }).lean();
  const plan = effectivePlan(subscription);
  if (!plan.features?.[feature]) {
    throw new AppError(`This feature is available on the Pro and Enterprise plans. Upgrade your workspace to continue.`, 402, 'PLAN_FEATURE_REQUIRED');
  }
}

async function ensureCounter(organizationId, field, compute) {
  const organization = await Organization.findById(organizationId).select(`usageCounters.${field}`);
  if (!organization) throw new AppError('Workspace not found.', 404, 'ORGANIZATION_NOT_FOUND');
  if (organization.usageCounters?.[field] == null) {
    const value = await compute();
    await Organization.updateOne({ _id: organizationId, [`usageCounters.${field}`]: { $exists: false } }, { $set: { [`usageCounters.${field}`]: value } });
  }
}

async function reserveMemberSeat(organizationId) {
  const summary = await getBillingSummary(organizationId);
  const now = new Date();
  const beforeCleanup = await Organization.findById(organizationId).select('usageCounters.memberSeats');
  const counterWasInitialized = beforeCleanup?.usageCounters?.memberSeats != null;
  const expired = await Invitation.updateMany({ organization: organizationId, status: 'PENDING', expiresAt: { $lte: now } }, { $set: { status: 'EXPIRED' } });
  if (counterWasInitialized && expired.modifiedCount) {
    await Organization.updateOne({ _id: organizationId }, { $inc: { 'usageCounters.memberSeats': -expired.modifiedCount } });
  }
  await ensureCounter(organizationId, 'memberSeats', async () => {
    const [members, pending] = await Promise.all([
      Membership.countDocuments({ organization: organizationId, status: 'ACTIVE' }),
      Invitation.countDocuments({ organization: organizationId, status: 'PENDING', expiresAt: { $gt: now } }),
    ]);
    return members + pending;
  });
  const updated = await Organization.findOneAndUpdate(
    { _id: organizationId, 'usageCounters.memberSeats': { $lt: summary.limits.members } },
    { $inc: { 'usageCounters.memberSeats': 1 } },
    { new: true },
  );
  if (!updated) throw new AppError(`The ${summary.plan.name} plan supports up to ${summary.limits.members} workspace members, including pending invitations. Upgrade to invite more people.`, 402, 'PLAN_MEMBER_LIMIT');
}

async function releaseMemberSeat(organizationId) {
  await Organization.updateOne({ _id: organizationId, 'usageCounters.memberSeats': { $gt: 0 } }, { $inc: { 'usageCounters.memberSeats': -1 } });
}

async function reserveProjectSlot(organizationId) {
  const summary = await getBillingSummary(organizationId);
  await ensureCounter(organizationId, 'projects', () => Project.countDocuments({ organization: organizationId }));
  const updated = await Organization.findOneAndUpdate(
    { _id: organizationId, 'usageCounters.projects': { $lt: summary.limits.projects } },
    { $inc: { 'usageCounters.projects': 1 } },
    { new: true },
  );
  if (!updated) throw new AppError(`The ${summary.plan.name} plan supports up to ${summary.limits.projects} projects. Upgrade to create more.`, 402, 'PLAN_PROJECT_LIMIT');
}

async function releaseProjectSlot(organizationId) {
  await Organization.updateOne({ _id: organizationId, 'usageCounters.projects': { $gt: 0 } }, { $inc: { 'usageCounters.projects': -1 } });
}

async function createCheckoutSession({ organizationId, user, plan }) {
  const price = priceForPlan(plan);
  if (!price) throw new AppError(`The ${plan.toLowerCase()} plan is not configured in Stripe yet.`, 503, 'BILLING_PLAN_NOT_CONFIGURED');
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new AppError('Stripe webhooks must be configured before checkout is enabled.', 503, 'BILLING_WEBHOOK_NOT_CONFIGURED');
  const stripeApi = stripe();
  const existing = await Subscription.findOne({ organization: organizationId });
  if (existing && ['active', 'trialing', 'past_due'].includes(existing.status)) {
    throw new AppError('This workspace already has a paid subscription. Use subscription management to change plans.', 409, 'BILLING_SUBSCRIPTION_EXISTS');
  }
  let customerId = existing?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripeApi.customers.create({
      email: user.email,
      name: user.name,
      metadata: { organizationId: String(organizationId) },
    }, { idempotencyKey: `teamflow-customer-${organizationId}` });
    customerId = customer.id;
    await Subscription.findOneAndUpdate({ organization: organizationId }, {
      $set: { stripeCustomerId: customerId }, $setOnInsert: { plan: 'FREE', status: 'free' },
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  const baseUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  const session = await stripeApi.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${baseUrl}/billing?checkout=success`,
    cancel_url: `${baseUrl}/billing?checkout=cancelled`,
    metadata: { organizationId: String(organizationId), plan },
    subscription_data: { metadata: { organizationId: String(organizationId), plan } },
  });
  return { url: session.url };
}

async function createPortalSession(organizationId) {
  const subscription = await Subscription.findOne({ organization: organizationId }).select('stripeCustomerId');
  if (!subscription?.stripeCustomerId) throw new AppError('This workspace does not have a Stripe billing account yet.', 404, 'BILLING_CUSTOMER_NOT_FOUND');
  const baseUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  const session = await stripe().billingPortal.sessions.create({ customer: subscription.stripeCustomerId, return_url: `${baseUrl}/billing` });
  return { url: session.url };
}

async function cancelSubscription(organizationId) {
  const current = await Subscription.findOne({ organization: organizationId }).select('stripeSubscriptionId');
  if (!current?.stripeSubscriptionId) throw new AppError('This workspace has no active paid subscription.', 404, 'SUBSCRIPTION_NOT_FOUND');
  const updated = await stripe().subscriptions.update(current.stripeSubscriptionId, { cancel_at_period_end: true });
  await applySubscription(updated, organizationId);
  return { cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end), currentPeriodEnd: periodEnd(updated) };
}

function periodEnd(subscription) {
  const timestamp = subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end;
  return timestamp ? new Date(timestamp * 1000) : undefined;
}

function planFromStripe(subscription) {
  const metadataPlan = subscription.metadata?.plan?.toUpperCase();
  if (metadataPlan && plans[metadataPlan]) return metadataPlan;
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (priceId && priceId === process.env.STRIPE_PRICE_PRO) return 'PRO';
  if (priceId && priceId === process.env.STRIPE_PRICE_ENTERPRISE) return 'ENTERPRISE';
  return 'FREE';
}

async function applySubscription(subscription, organizationId) {
  const orgId = organizationId || subscription.metadata?.organizationId;
  if (!orgId) throw new Error('Stripe subscription is missing the TeamFlow organization reference.');
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const update = {
    organization: orgId,
    plan: subscription.status === 'canceled' ? 'FREE' : planFromStripe(subscription),
    status: subscription.status,
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    currentPeriodEnd: periodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  };
  await Subscription.findOneAndUpdate({ organization: orgId }, { $set: update }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function processStripeEvent(event) {
  let receipt;
  try {
    receipt = await StripeEvent.create({ eventId: event.id, type: event.type, status: 'PROCESSING' });
  } catch (error) {
    if (error.code !== 11000) throw error;
    receipt = await StripeEvent.findOne({ eventId: event.id });
    if (receipt?.status === 'PROCESSED') return { duplicate: true };
    if (receipt?.status === 'PROCESSING' && Date.now() - receipt.updatedAt.getTime() < 5 * 60 * 1000) return { duplicate: true };
    await StripeEvent.updateOne({ eventId: event.id }, { $set: { status: 'PROCESSING', type: event.type } });
  }

  try {
    const object = event.data.object;
    if (event.type === 'checkout.session.completed' && object.mode === 'subscription' && object.subscription) {
      const subscription = await stripe().subscriptions.retrieve(typeof object.subscription === 'string' ? object.subscription : object.subscription.id);
      await applySubscription(subscription, object.metadata?.organizationId);
    } else if (event.type.startsWith('customer.subscription.')) {
      await applySubscription(object);
    }
    await StripeEvent.updateOne({ eventId: event.id }, { $set: { status: 'PROCESSED', processedAt: new Date() } });
    return { duplicate: false };
  } catch (error) {
    await StripeEvent.updateOne({ eventId: event.id }, { $set: { status: 'FAILED' } });
    throw error;
  }
}

async function listInvoices(organizationId) {
  const subscription = await Subscription.findOne({ organization: organizationId }).select('stripeCustomerId');
  if (!subscription?.stripeCustomerId || !process.env.STRIPE_SECRET_KEY) return [];
  const result = await stripe().invoices.list({ customer: subscription.stripeCustomerId, limit: 20 });
  return result.data.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency,
    amountPaid: invoice.amount_paid,
    hostedInvoiceUrl: invoice.hosted_invoice_url,
    createdAt: new Date(invoice.created * 1000),
  }));
}

function verifyWebhook(rawBody, signature) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new AppError('Stripe webhook signing is not configured.', 503, 'BILLING_WEBHOOK_NOT_CONFIGURED');
  try { return stripe().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET); }
  catch (_error) { throw new AppError('Invalid Stripe webhook signature.', 400, 'INVALID_WEBHOOK_SIGNATURE'); }
}

module.exports = { getBillingSummary, requirePlanFeature, reserveMemberSeat, releaseMemberSeat, reserveProjectSlot, releaseProjectSlot, createCheckoutSession, createPortalSession, cancelSubscription, listInvoices, processStripeEvent, verifyWebhook, priceForPlan };
