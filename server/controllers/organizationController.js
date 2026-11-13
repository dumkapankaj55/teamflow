const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const organizationService = require('../services/organizationService');

module.exports = {
  create: asyncHandler(async (req, res) => success(res, { organization: await organizationService.createOrganization(req.user._id, req.validated.body.name) }, 201)),
  list: asyncHandler(async (req, res) => success(res, { organizations: await organizationService.listOrganizations(req.user._id) })),
  get: asyncHandler(async (req, res) => success(res, { organization: await organizationService.getOrganization(req.organizationId) })),
  update: asyncHandler(async (req, res) => success(res, { organization: await organizationService.updateOrganization(req.organizationId, req.validated.body, req.user._id) })),
  members: asyncHandler(async (req, res) => success(res, await organizationService.listMembers(req.organizationId))),
  invite: asyncHandler(async (req, res) => success(res, await organizationService.createInvitation({ organizationId: req.organizationId, actor: { user: req.user, role: req.membership.role }, ...req.validated.body }), 201, 'Invitation created.')),
  acceptInvitation: asyncHandler(async (req, res) => success(res, await organizationService.acceptInvitation(req.validated.params.token, req.user), 200, 'Invitation accepted.')),
  changeRole: asyncHandler(async (req, res) => success(res, { membership: await organizationService.changeMemberRole({ organizationId: req.params.id, userId: req.params.userId, role: req.validated.body.role, actorId: req.user._id }) })),
  removeMember: asyncHandler(async (req, res) => success(res, await organizationService.removeMember({ organizationId: req.params.id, userId: req.params.userId, actorId: req.user._id }))),
};
