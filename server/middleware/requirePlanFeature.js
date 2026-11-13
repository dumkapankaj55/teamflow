const asyncHandler = require('../utils/asyncHandler');
const billingService = require('../services/billingService');

module.exports = (feature) => asyncHandler(async (req, _res, next) => {
  await billingService.requirePlanFeature(req.organizationId, feature);
  next();
});
