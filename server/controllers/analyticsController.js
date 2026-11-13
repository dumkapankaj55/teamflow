const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const analyticsService = require('../services/analyticsService');

module.exports = {
  overview: asyncHandler(async (req, res) => success(res, await analyticsService.overview({ organizationId: req.organizationId, userId: req.user._id, role: req.membership.role }))),
  tasks: asyncHandler(async (req, res) => success(res, await analyticsService.taskAnalytics(req.organizationId))),
  projects: asyncHandler(async (req, res) => success(res, await analyticsService.projectAnalytics(req.organizationId))),
  team: asyncHandler(async (req, res) => success(res, await analyticsService.teamAnalytics(req.organizationId))),
};
