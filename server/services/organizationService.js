const crypto = require('crypto');
const AppError = require('../utils/AppError');
const slugify = require('../utils/slug');
const { createOpaqueToken, hashToken } = require('../utils/tokenUtils');
const { sendEmail } = require('./mailerService');
const { recordActivity } = require('./activityService');
const { notify } = require('./notificationService');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const Invitation = require('../models/Invitation');
const User = require('../models/User');
const Project = require('../models/Project');
const Task = require('../models/Task');
const billingService = require('./billingService');
const { logger } = require('../config/logger');

async function uniqueSlug(name) {
  const base = slugify(name);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = attempt ? `${base}-${crypto.randomBytes(2).toString('hex')}` : base;
    if (!await Organization.exists({ slug: candidate })) return candidate;
  }
  throw new AppError('We could not create a unique workspace address. Try again.', 409, 'SLUG_CONFLICT');
}

async function createOrganization(userId, name) {
  const organization = await Organization.create({ name, slug: await uniqueSlug(name), createdBy: userId, usageCounters: { memberSeats: 1, projects: 0 } });
  try {
    await Membership.create({ user: userId, organization: organization._id, role: 'ADMIN' });
    return organization;
  } catch (error) {
    await Organization.deleteOne({ _id: organization._id });
    throw error;
  }
}

async function listOrganizations(userId) {
  const memberships = await Membership.find({ user: userId, status: 'ACTIVE' }).populate('organization', 'name slug settings isActive').sort({ createdAt: 1 });
  return memberships.filter((membership) => membership.organization?.isActive !== false).map((membership) => ({
    membershipId: membership._id,
    role: membership.role,
    organization: membership.organization,
  }));
}

async function getOrganization(organizationId) {
  const organization = await Organization.findById(organizationId).select('name slug settings createdAt updatedAt');
  if (!organization) throw new AppError('Workspace not found.', 404, 'ORGANIZATION_NOT_FOUND');
  return organization;
}

async function updateOrganization(organizationId, input, actorId) {
  const before = await Organization.findById(organizationId).select('name slug settings');
  const organization = await Organization.findByIdAndUpdate(organizationId, { $set: input }, { new: true, runValidators: true }).select('name slug settings createdAt updatedAt');
  if (!organization) throw new AppError('Workspace not found.', 404, 'ORGANIZATION_NOT_FOUND');
  if (actorId && before) await recordActivity({ organization: organizationId, actor: actorId, action: 'ORGANIZATION_UPDATED', message: 'updated workspace settings', targetType: 'ORGANIZATION', targetId: organizationId, metadata: { changed: Object.keys(input), before: { name: before.name, slug: before.slug } } });
  return organization;
}

async function listMembers(organizationId) {
  const [members, invitations] = await Promise.all([
    Membership.find({ organization: organizationId, status: 'ACTIVE' }).populate('user', 'name email createdAt').sort({ role: 1, createdAt: 1 }),
    Invitation.find({ organization: organizationId, status: 'PENDING', expiresAt: { $gt: new Date() } }).select('email role status createdAt expiresAt').sort({ createdAt: -1 }),
  ]);
  return { members, invitations };
}

async function createInvitation({ organizationId, actor, email, role }) {
  if (actor.role !== 'ADMIN') throw new AppError('Only workspace admins can invite members.', 403, 'FORBIDDEN');
  const existingUser = await User.findOne({ email, isActive: true }).select('_id name email');
  if (existingUser && await Membership.exists({ user: existingUser._id, organization: organizationId, status: 'ACTIVE' })) {
    throw new AppError('This person is already a workspace member.', 409, 'ALREADY_A_MEMBER');
  }
  const pending = await Invitation.findOne({ organization: organizationId, email, status: 'PENDING' });
  if (pending && pending.expiresAt > new Date()) throw new AppError('An invitation is already pending for this email.', 409, 'INVITATION_PENDING');
  await billingService.reserveMemberSeat(organizationId);
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  let invitation;
  try {
    invitation = await Invitation.create({ organization: organizationId, email, role, tokenHash: hashToken(token), invitedBy: actor.user._id, expiresAt });
  } catch (error) {
    await billingService.releaseMemberSeat(organizationId);
    throw error;
  }
  const organization = await Organization.findById(organizationId).select('name');
  const inviteUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/accept-invitation?token=${encodeURIComponent(token)}`;
  let sent;
  try {
    sent = await sendEmail({
      to: email,
      subject: `You’re invited to ${organization.name} on TeamFlow`,
      text: `${actor.user.name} invited you to join ${organization.name} on TeamFlow as a ${role.toLowerCase()}. Accept your invitation: ${inviteUrl}`,
      html: `<p>${escapeHtml(actor.user.name)} invited you to join <strong>${escapeHtml(organization.name)}</strong> on TeamFlow.</p><p><a href="${escapeHtml(inviteUrl)}">Accept invitation</a></p>`,
    });
  } catch (error) {
    await Invitation.deleteOne({ _id: invitation._id });
    await billingService.releaseMemberSeat(organizationId);
    throw error;
  }
  if (!sent && process.env.NODE_ENV === 'production') {
    await Invitation.deleteOne({ _id: invitation._id });
    await billingService.releaseMemberSeat(organizationId);
    logger.error('Invitation email is not configured; set SMTP_* variables.');
    throw new AppError('Invitation email could not be sent. Please try again later.', 503, 'EMAIL_DELIVERY_UNAVAILABLE');
  }
  if (existingUser) await notify({ organization: organizationId, user: existingUser._id, type: 'INVITATION_RECEIVED', title: 'You’ve been invited', message: `${actor.user.name} invited you to join ${organization.name}.` });
  await recordActivity({ organization: organizationId, actor: actor.user._id, action: 'MEMBER_INVITED', message: `invited ${email} to the workspace`, targetType: 'MEMBERSHIP', targetId: invitation._id, metadata: { role } });
  return { invitation: { _id: invitation._id, email, role, status: invitation.status, expiresAt, inviteUrl: !sent && process.env.NODE_ENV !== 'production' ? inviteUrl : undefined } };
}

async function acceptInvitation(token, user) {
  const pending = await Invitation.findOne({ tokenHash: hashToken(token), status: 'PENDING', expiresAt: { $gt: new Date() } }).select('+tokenHash');
  if (!pending) throw new AppError('This invitation is invalid or has expired.', 400, 'INVALID_INVITATION');
  if (pending.email !== user.email) throw new AppError('Sign in with the email address that received this invitation.', 403, 'INVITATION_EMAIL_MISMATCH');
  const acceptedAt = new Date();
  const invitation = await Invitation.findOneAndUpdate(
    { _id: pending._id, status: 'PENDING', expiresAt: { $gt: acceptedAt } },
    { $set: { status: 'ACCEPTED', acceptedAt } },
    { new: true },
  ).select('+tokenHash');
  if (!invitation) throw new AppError('This invitation has already been used or has expired.', 400, 'INVALID_INVITATION');
  try {
    const organization = await Organization.findOne({ _id: invitation.organization, isActive: true }).select('name slug settings createdAt updatedAt');
    if (!organization) throw new AppError('This workspace is unavailable.', 404, 'ORGANIZATION_NOT_FOUND');
    const membership = await Membership.findOneAndUpdate(
      { user: user._id, organization: invitation.organization },
      { $set: { role: invitation.role, status: 'ACTIVE' }, $setOnInsert: { invitedBy: invitation.invitedBy } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await notify({ organization: invitation.organization, user: user._id, type: 'INVITATION_RECEIVED', title: 'You joined a workspace', message: `You accepted an invitation to join ${organization.name}.` });
    await recordActivity({ organization: invitation.organization, actor: user._id, action: 'INVITATION_ACCEPTED', message: 'accepted a workspace invitation', targetType: 'MEMBERSHIP', targetId: membership._id, metadata: { role: invitation.role } });
    return { membership, organization };
  } catch (error) {
    await Invitation.updateOne({ _id: invitation._id, status: 'ACCEPTED', acceptedAt }, { $set: { status: 'PENDING' }, $unset: { acceptedAt: 1 } });
    throw error;
  }
}

function escapeHtml(value = '') { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }

async function changeMemberRole({ organizationId, userId, role, actorId }) {
  if (userId === actorId) {
    const otherAdmins = await Membership.countDocuments({ organization: organizationId, role: 'ADMIN', status: 'ACTIVE', user: { $ne: actorId } });
    if (!otherAdmins && role !== 'ADMIN') throw new AppError('Add another admin before changing your own role.', 409, 'LAST_ADMIN');
  }
  const target = await Membership.findOne({ organization: organizationId, user: userId, status: 'ACTIVE' });
  if (!target) throw new AppError('Workspace member not found.', 404, 'MEMBER_NOT_FOUND');
  const beforeRole = target.role;
  if (target.role === 'ADMIN' && role !== 'ADMIN') {
    const admins = await Membership.countDocuments({ organization: organizationId, role: 'ADMIN', status: 'ACTIVE' });
    if (admins <= 1) throw new AppError('A workspace must have at least one admin.', 409, 'LAST_ADMIN');
  }
  target.role = role; await target.save();
  await recordActivity({ organization: organizationId, actor: actorId, action: 'MEMBER_ROLE_CHANGED', message: 'changed a workspace member role', targetType: 'MEMBERSHIP', targetId: target._id, metadata: { before: { role: beforeRole }, after: { role } } });
  return target;
}

async function removeMember({ organizationId, userId, actorId }) {
  if (userId === actorId) throw new AppError('You cannot remove yourself from your own workspace.', 400, 'CANNOT_REMOVE_SELF');
  const target = await Membership.findOne({ organization: organizationId, user: userId, status: 'ACTIVE' });
  if (!target) throw new AppError('Workspace member not found.', 404, 'MEMBER_NOT_FOUND');
  if (target.role === 'ADMIN' && await Membership.countDocuments({ organization: organizationId, role: 'ADMIN', status: 'ACTIVE' }) <= 1) {
    throw new AppError('A workspace must have at least one admin.', 409, 'LAST_ADMIN');
  }
  await Promise.all([
    Membership.deleteOne({ _id: target._id }),
    Project.updateMany({ organization: organizationId }, { $pull: { members: userId } }),
    Task.updateMany({ organization: organizationId, assignee: userId }, { $unset: { assignee: 1 } }),
  ]);
  await billingService.releaseMemberSeat(organizationId);
  await recordActivity({ organization: organizationId, actor: actorId, action: 'MEMBER_REMOVED', message: 'removed a workspace member', targetType: 'MEMBERSHIP', targetId: target._id, metadata: { removedUserId: String(target.user), role: target.role } });
  return { removed: true };
}

module.exports = { createOrganization, listOrganizations, getOrganization, updateOrganization, listMembers, createInvitation, acceptInvitation, changeMemberRole, removeMember };
