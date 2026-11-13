const Stripe = require('stripe');
const crypto = require('crypto');
const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const plans = require('../config/plans');
const Subscription = require('../models/Subscription');
const StripeEvent = require('../models/StripeEvent');
const BillingPayment = require('../models/BillingPayment');
const Membership = require('../models/Membership');
const Invitation = require('../models/Invitation');
const Project = require('../models/Project');
const Organization = require('../models/Organization');
const mailerService = require('./mailerService');

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
  const [subscription, members, pendingInvitations, projects, invoices] = await Promise.all([
    Subscription.findOne({ organization: organizationId }).lean(),
    Membership.countDocuments({ organization: organizationId, status: 'ACTIVE' }),
    Invitation.countDocuments({ organization: organizationId, status: 'PENDING', expiresAt: { $gt: new Date() } }),
    Project.countDocuments({ organization: organizationId }),
    listInvoices(organizationId),
  ]);
  const plan = effectivePlan(subscription);
  const usage = { members, pendingInvitations, projects, storageBytes: null };
  const safePlan = { id: plan.id, name: plan.name, members: plan.members, projects: plan.projects, features: { ...plan.features, storageTracking: false } };
  return {
    subscription: subscription ? { plan: plan.id, status: subscription.status, currentPeriodStart: subscription.currentPeriodStart, currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd } : { plan: 'FREE', status: 'free', currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    plan: safePlan,
    usage,
    limits: { members: plan.members, projects: plan.projects, storageBytes: null },
    availablePlans: Object.values(plans).map(({ id, name, members: memberLimit, projects: projectLimit, features }) => ({ id, name, limits: { members: memberLimit, projects: projectLimit, storageBytes: null }, features: { ...features, storageTracking: false } })),
    checkoutAvailable: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && (process.env.STRIPE_PRICE_PRO || process.env.STRIPE_PRICE_ENTERPRISE)),
    configuredPlans: ['PRO', 'ENTERPRISE'].filter((planId) => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && priceForPlan(planId))),
    salesEnquiryAvailable: Boolean(process.env.SALES_EMAIL && mailerService.isConfigured()),
    invoices,
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

async function findOrCreateSubscription(organizationId) {
  let subscription = await Subscription.findOne({ organization: organizationId }).lean();
  if (subscription) return subscription;
  try {
    subscription = await Subscription.create({ organization: organizationId, plan: 'FREE', status: 'free' });
  } catch (error) {
    if (error.code !== 11000) throw error;
    subscription = await Subscription.findOne({ organization: organizationId }).lean();
  }
  return subscription?.toObject ? subscription.toObject() : subscription;
}

async function createCheckoutSession({ organizationId, user, plan }) {
  const price = priceForPlan(plan);
  if (!price) throw new AppError(`The ${plan.toLowerCase()} plan is not configured in Stripe yet.`, 503, 'BILLING_PLAN_NOT_CONFIGURED');
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new AppError('Stripe webhooks must be configured before checkout is enabled.', 503, 'BILLING_WEBHOOK_NOT_CONFIGURED');
  const stripeApi = stripe();
  let existing = await findOrCreateSubscription(organizationId);
  if (['active', 'trialing', 'past_due'].includes(existing.status)
    || (existing.stripeSubscriptionId && !['free', 'canceled'].includes(existing.status))) {
    throw new AppError('This workspace already has a paid subscription. Use subscription management to change plans.', 409, 'BILLING_SUBSCRIPTION_EXISTS');
  }

  let lockId;
  if (existing.checkoutSessionId) {
    if (existing.checkoutSessionId.startsWith('pending:') && existing.checkoutExpiresAt > new Date()) {
      lockId = existing.checkoutSessionId;
    } else if (!existing.checkoutSessionId.startsWith('pending:')) {
      const currentSession = await stripeApi.checkout.sessions.retrieve(existing.checkoutSessionId);
      if (currentSession.status === 'open') return { url: currentSession.url };
      if (currentSession.status === 'complete') {
        throw new AppError('Checkout is complete and your payment is being confirmed. Refresh billing shortly.', 409, 'CHECKOUT_AWAITING_CONFIRMATION');
      }
      await Subscription.updateOne(
        { organization: organizationId, checkoutSessionId: existing.checkoutSessionId },
        { $unset: { checkoutSessionId: 1, checkoutExpiresAt: 1 } },
      );
      existing = { ...existing, checkoutSessionId: undefined, checkoutExpiresAt: undefined };
    } else {
      await Subscription.updateOne(
        { organization: organizationId, checkoutSessionId: existing.checkoutSessionId },
        { $unset: { checkoutSessionId: 1, checkoutExpiresAt: 1 } },
      );
      existing = { ...existing, checkoutSessionId: undefined, checkoutExpiresAt: undefined };
    }
  }

  if (!lockId) {
    lockId = `pending:${crypto.randomUUID()}`;
    const lockExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const reserved = await Subscription.findOneAndUpdate({
      organization: organizationId,
      status: { $in: ['free', 'canceled'] },
      $or: [
        { checkoutSessionId: { $exists: false } },
        { checkoutSessionId: null },
        { checkoutExpiresAt: { $lte: new Date() } },
        { checkoutExpiresAt: { $exists: false } },
      ],
    }, {
      $set: { checkoutSessionId: lockId, checkoutExpiresAt: lockExpiry },
    }, { new: true });
    if (!reserved) {
      throw new AppError('A checkout is already active for this workspace. Finish or cancel it before starting another.', 409, 'CHECKOUT_ALREADY_IN_PROGRESS');
    }
  }

  try {
    let customerId = existing.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeApi.customers.create({
        email: user.email,
        name: user.name,
        metadata: { organizationId: String(organizationId) },
      }, { idempotencyKey: `teamflow-customer-${organizationId}` });
      customerId = customer.id;
      await Subscription.updateOne({ organization: organizationId }, { $set: { stripeCustomerId: customerId } });
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
    }, { idempotencyKey: `teamflow-checkout-${lockId}` });
    await Subscription.updateOne(
      { organization: organizationId, checkoutSessionId: lockId },
      { $set: { checkoutSessionId: session.id, checkoutExpiresAt: session.expires_at ? new Date(session.expires_at * 1000) : new Date(Date.now() + 24 * 60 * 60 * 1000) } },
    );
    return { url: session.url };
  } catch (error) {
    if (Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
      await Subscription.updateOne(
        { organization: organizationId, checkoutSessionId: lockId },
        { $unset: { checkoutSessionId: 1, checkoutExpiresAt: 1 } },
      );
    }
    throw error;
  }
}

async function createPortalSession(organizationId) {
  const subscription = await Subscription.findOne({ organization: organizationId }).select('stripeCustomerId');
  if (!subscription?.stripeCustomerId) throw new AppError('This workspace does not have a Stripe billing account yet.', 404, 'BILLING_CUSTOMER_NOT_FOUND');
  const baseUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  const session = await stripe().billingPortal.sessions.create({ customer: subscription.stripeCustomerId, return_url: `${baseUrl}/billing` });
  return { url: session.url };
}

async function scheduleCancellation(organizationId, current) {
  if (!current?.stripeSubscriptionId) throw new AppError('This workspace has no active Stripe subscription to cancel.', 409, 'SUBSCRIPTION_NOT_FOUND');
  if (current.cancelAtPeriodEnd) {
    return { cancelAtPeriodEnd: true, currentPeriodEnd: current.currentPeriodEnd };
  }
  const updated = await stripe().subscriptions.update(current.stripeSubscriptionId, { cancel_at_period_end: true });
  await applySubscription(updated, organizationId);
  return { cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end), currentPeriodEnd: periodEnd(updated) };
}

async function cancelSubscription(organizationId) {
  const current = await Subscription.findOne({ organization: organizationId }).lean();
  return scheduleCancellation(organizationId, current);
}

async function selectFreePlan(organizationId) {
  let current = await Subscription.findOne({ organization: organizationId }).lean();
  if (!current) {
    await findOrCreateSubscription(organizationId);
    return { plan: 'FREE', status: 'free', cancelAtPeriodEnd: false };
  }

  if (['active', 'trialing', 'past_due'].includes(current.status)) {
    return scheduleCancellation(organizationId, current);
  }

  if (current.stripeSubscriptionId && !['free', 'canceled'].includes(current.status)) {
    const canceled = await stripe().subscriptions.cancel(current.stripeSubscriptionId);
    await applySubscription(canceled, organizationId);
    return { plan: 'FREE', status: canceled.status, cancelAtPeriodEnd: false };
  }

  if (current.checkoutSessionId) {
    if (current.checkoutSessionId.startsWith('pending:')) {
      if (current.checkoutExpiresAt > new Date()) {
        throw new AppError('Checkout is being created. Try selecting Free again shortly.', 409, 'CHECKOUT_ALREADY_IN_PROGRESS');
      }
    } else {
      const session = await stripe().checkout.sessions.retrieve(current.checkoutSessionId);
      if (session.status === 'complete') {
        throw new AppError('Checkout is complete and your payment is being confirmed. Refresh billing shortly.', 409, 'CHECKOUT_AWAITING_CONFIRMATION');
      }
      if (session.status === 'open') await stripe().checkout.sessions.expire(current.checkoutSessionId);
    }
  }

  await Subscription.updateOne({ organization: organizationId }, {
    $set: { plan: 'FREE', status: 'free', cancelAtPeriodEnd: false },
    $unset: { checkoutSessionId: 1, checkoutExpiresAt: 1, currentPeriodStart: 1, currentPeriodEnd: 1 },
  });
  return { plan: 'FREE', status: 'free', cancelAtPeriodEnd: false };
}

function periodEnd(subscription) {
  const timestamp = subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end;
  return timestamp ? new Date(timestamp * 1000) : undefined;
}

function periodStart(subscription) {
  const timestamp = subscription.current_period_start || subscription.items?.data?.[0]?.current_period_start;
  return timestamp ? new Date(timestamp * 1000) : undefined;
}

function planFromStripe(subscription) {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (priceId && priceId === process.env.STRIPE_PRICE_PRO) return 'PRO';
  if (priceId && priceId === process.env.STRIPE_PRICE_ENTERPRISE) return 'ENTERPRISE';
  return 'FREE';
}

async function applySubscription(subscription, organizationId) {
  const metadataOrganizationId = subscription.metadata?.organizationId;
  if (organizationId && metadataOrganizationId && String(organizationId) !== String(metadataOrganizationId)) {
    throw new AppError('Stripe checkout workspace metadata does not match the subscription.', 400, 'BILLING_WORKSPACE_REFERENCE_MISMATCH');
  }
  const orgId = organizationId || metadataOrganizationId;
  if (!mongoose.isValidObjectId(orgId)) throw new AppError('Stripe subscription is missing a valid TeamFlow workspace reference.', 400, 'BILLING_WORKSPACE_REFERENCE_INVALID');
  if (!await Organization.exists({ _id: orgId })) throw new AppError('Stripe subscription references an unknown TeamFlow workspace.', 404, 'ORGANIZATION_NOT_FOUND');
  const customerId = stripeId(subscription.customer);
  const current = await Subscription.findOne({ organization: orgId }).select('stripeCustomerId').lean();
  if (current?.stripeCustomerId && customerId && current.stripeCustomerId !== customerId) {
    throw new AppError('Stripe customer does not match the TeamFlow workspace billing record.', 409, 'BILLING_CUSTOMER_MISMATCH');
  }
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const update = {
    organization: orgId,
    plan: subscription.status === 'canceled' ? 'FREE' : planFromStripe(subscription),
    status: subscription.status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    currentPeriodStart: periodStart(subscription),
    currentPeriodEnd: periodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  };
  await Subscription.findOneAndUpdate({ organization: orgId }, {
    $set: update,
    $unset: { checkoutSessionId: 1, checkoutExpiresAt: 1 },
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

function stripeId(value) {
  return typeof value === 'string' ? value : value?.id;
}

async function recordInvoice(invoice, status) {
  if (!invoice.id) throw new AppError('Stripe invoice event is missing its invoice ID.', 400, 'BILLING_INVOICE_ID_MISSING');
  const stripeCustomerId = stripeId(invoice.customer);
  const stripeSubscriptionId = stripeId(invoice.subscription || invoice.parent?.subscription_details?.subscription);
  const match = {};
  if (stripeCustomerId) match.stripeCustomerId = stripeCustomerId;
  if (stripeSubscriptionId) match.stripeSubscriptionId = stripeSubscriptionId;
  if (!Object.keys(match).length) return;

  const subscription = await Subscription.findOne(match).select('organization stripeSubscriptionId').lean();
  if (!subscription) return;
  await BillingPayment.findOneAndUpdate({ stripeInvoiceId: invoice.id }, {
    $set: {
      organization: subscription.organization,
      stripeSubscriptionId: stripeSubscriptionId || subscription.stripeSubscriptionId,
      invoiceNumber: invoice.number || undefined,
      status,
      currency: invoice.currency || 'usd',
      amountPaid: invoice.amount_paid || 0,
      amountDue: invoice.amount_due || 0,
      hostedInvoiceUrl: invoice.hosted_invoice_url || undefined,
      invoiceCreatedAt: invoice.created ? new Date(invoice.created * 1000) : new Date(),
    },
  }, { upsert: true, new: true, setDefaultsOnInsert: true });

  if (status === 'payment_failed' && stripeSubscriptionId) {
    await Subscription.updateOne(
      { organization: subscription.organization, stripeSubscriptionId },
      { $set: { status: 'past_due' } },
    );
  }
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
    if (event.type === 'checkout.session.completed' && object.mode === 'subscription') {
      if (!object.subscription) throw new AppError('Completed Stripe checkout is missing its subscription.', 400, 'BILLING_SUBSCRIPTION_MISSING');
      const subscription = await stripe().subscriptions.retrieve(typeof object.subscription === 'string' ? object.subscription : object.subscription.id);
      await applySubscription(subscription, object.metadata?.organizationId);
    } else if (event.type.startsWith('customer.subscription.')) {
      await applySubscription(object);
    } else if (event.type === 'checkout.session.expired') {
      await Subscription.updateOne(
        { checkoutSessionId: object.id },
        { $unset: { checkoutSessionId: 1, checkoutExpiresAt: 1 } },
      );
    } else if (event.type === 'invoice.paid') {
      await recordInvoice(object, 'paid');
    } else if (event.type === 'invoice.payment_failed') {
      await recordInvoice(object, 'payment_failed');
    }
    await StripeEvent.updateOne({ eventId: event.id }, { $set: { status: 'PROCESSED', processedAt: new Date() } });
    return { duplicate: false };
  } catch (error) {
    await StripeEvent.updateOne({ eventId: event.id }, { $set: { status: 'FAILED' } });
    throw error;
  }
}

async function listInvoices(organizationId) {
  const invoices = await BillingPayment.find({ organization: organizationId }).sort({ invoiceCreatedAt: -1 }).limit(20).lean();
  return invoices.map((invoice) => ({
    id: invoice.stripeInvoiceId,
    number: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    amountPaid: invoice.amountPaid,
    amountDue: invoice.amountDue,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    createdAt: invoice.invoiceCreatedAt,
  }));
}

async function sendEnterpriseEnquiry({ organization, user, message }) {
  if (!process.env.SALES_EMAIL || !mailerService.isConfigured()) {
    throw new AppError('Enterprise sales enquiries are not configured. Set SALES_EMAIL and the SMTP_* variables.', 503, 'SALES_CONTACT_NOT_CONFIGURED');
  }
  const sent = await mailerService.sendEmail({
    to: process.env.SALES_EMAIL,
    replyTo: user.email,
    subject: 'TeamFlow Enterprise plan enquiry',
    text: `Workspace: ${organization.name}\nWorkspace ID: ${organization._id}\nContact: ${user.name} <${user.email}>\n\n${message}`,
  });
  if (!sent) throw new AppError('The sales enquiry could not be sent. Please try again later.', 503, 'SALES_CONTACT_UNAVAILABLE');
  return { sent: true };
}

function verifyWebhook(rawBody, signature) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new AppError('Stripe webhook signing is not configured.', 503, 'BILLING_WEBHOOK_NOT_CONFIGURED');
  try { return stripe().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET); }
  catch (_error) { throw new AppError('Invalid Stripe webhook signature.', 400, 'INVALID_WEBHOOK_SIGNATURE'); }
}

module.exports = { getBillingSummary, requirePlanFeature, reserveMemberSeat, releaseMemberSeat, reserveProjectSlot, releaseProjectSlot, createCheckoutSession, createPortalSession, cancelSubscription, selectFreePlan, sendEnterpriseEnquiry, listInvoices, processStripeEvent, verifyWebhook, priceForPlan };
