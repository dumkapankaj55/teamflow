const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const projectService = require('../services/projectService');

module.exports = {
  create: asyncHandler(async (req, res) => success(res, { project: await projectService.createProject({ organizationId: req.organizationId, userId: req.user._id, input: req.validated.body }) }, 201)),
  list: asyncHandler(async (req, res) => success(res, await projectService.listProjects({ organizationId: req.organizationId, userId: req.user._id, role: req.membership.role, query: req.validated.query }))),
  get: asyncHandler(async (req, res) => success(res, { project: await projectService.getProject({ organizationId: req.organizationId, projectId: req.validated.params.id, userId: req.user._id, role: req.membership.role }) })),
  update: asyncHandler(async (req, res) => success(res, { project: await projectService.updateProject({ organizationId: req.organizationId, projectId: req.validated.params.id, userId: req.user._id, input: req.validated.body }) })),
  remove: asyncHandler(async (req, res) => success(res, await projectService.deleteProject({ organizationId: req.organizationId, projectId: req.validated.params.id, userId: req.user._id }))),
};
