const mongoose = require('mongoose');
const Membership = require('../models/Membership');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

module.exports = asyncHandler(async (req, _res, next) => {
  const organizationId = req.params.organizationId || req.params.id || req.get('x-organization-id');
  if (!organizationId || !mongoose.isValidObjectId(organizationId)) {
    throw new AppError('Select a valid workspace to continue.', 400, 'ORGANIZATION_REQUIRED');
  }
  const membership = await Membership.findOne({ user: req.user._id, organization: organizationId, status: 'ACTIVE' })
    .populate('organization', 'name slug settings');
  if (!membership || !membership.organization || membership.organization.isActive === false) throw new AppError('You do not have access to this workspace.', 403, 'ORGANIZATION_ACCESS_DENIED');
  req.organizationId = membership.organization._id;
  req.membership = membership;
  req.organization = membership.organization;
  next();
});
