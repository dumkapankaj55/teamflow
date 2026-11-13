const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const taskService = require('../services/taskService');

module.exports = {
  create: asyncHandler(async (req, res) => success(res, { task: await taskService.createTask({ organizationId: req.organizationId, userId: req.user._id, input: req.validated.body }) }, 201)),
  list: asyncHandler(async (req, res) => success(res, await taskService.listTasks({ organizationId: req.organizationId, userId: req.user._id, role: req.membership.role, query: req.validated.query }))),
  get: asyncHandler(async (req, res) => success(res, { task: await taskService.getTask({ organizationId: req.organizationId, taskId: req.validated.params.id, userId: req.user._id, role: req.membership.role }) })),
  update: asyncHandler(async (req, res) => success(res, { task: await taskService.updateTask({ organizationId: req.organizationId, taskId: req.validated.params.id, userId: req.user._id, role: req.membership.role, input: req.validated.body }) })),
  remove: asyncHandler(async (req, res) => success(res, await taskService.deleteTask({ organizationId: req.organizationId, taskId: req.validated.params.id, userId: req.user._id }))),
  listComments: asyncHandler(async (req, res) => success(res, await taskService.listComments({ organizationId: req.organizationId, taskId: req.validated.params.id, userId: req.user._id, role: req.membership.role, query: req.validated.query }))),
  listActivity: asyncHandler(async (req, res) => success(res, await taskService.listActivity({ organizationId: req.organizationId, taskId: req.validated.params.id, userId: req.user._id, role: req.membership.role, query: req.validated.query }))),
  addComment: asyncHandler(async (req, res) => success(res, { comment: await taskService.addComment({ organizationId: req.organizationId, taskId: req.validated.params.id, userId: req.user._id, role: req.membership.role, body: req.validated.body.body }) }, 201)),
};
