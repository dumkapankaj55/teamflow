const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const notificationService = require('../services/notificationQueryService');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, await notificationService.listNotifications({ organizationId: req.organizationId, userId: req.user._id, ...req.validated.query }))),
  markRead: asyncHandler(async (req, res) => success(res, { notification: await notificationService.markRead({ organizationId: req.organizationId, userId: req.user._id, notificationId: req.validated.params.id }) })),
  markAllRead: asyncHandler(async (req, res) => success(res, await notificationService.markAllRead({ organizationId: req.organizationId, userId: req.user._id }))),
};
