const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const billingService = require('../services/billingService');
const plans = require('../config/plans');

module.exports = {
  plans: (_req, res) => success(res, { plans: Object.values(plans).map(({ id, name, members, projects, features }) => ({ id, name, limits: { members, projects, storageBytes: null }, features: { ...features, storageTracking: false } })) }),
  summary: asyncHandler(async (req, res) => {
    const [billing, invoices] = await Promise.all([
      billingService.getBillingSummary(req.organizationId),
      billingService.listInvoices(req.organizationId),
    ]);
    return success(res, { ...billing, invoices });
  }),
  checkout: asyncHandler(async (req, res) => success(res, await billingService.createCheckoutSession({ organizationId: req.organizationId, user: req.user, plan: req.validated.body.plan }), 201)),
  portal: asyncHandler(async (req, res) => success(res, await billingService.createPortalSession(req.organizationId))),
  cancel: asyncHandler(async (req, res) => success(res, await billingService.cancelSubscription(req.organizationId))),
  webhook: asyncHandler(async (req, res) => {
    const event = billingService.verifyWebhook(req.body, req.get('stripe-signature'));
    await billingService.processStripeEvent(event);
    return res.status(200).json({ received: true });
  }),
};
