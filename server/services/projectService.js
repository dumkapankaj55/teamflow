const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Membership = require('../models/Membership');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const { recordActivity } = require('./activityService');
const billingService = require('./billingService');

async function validateMembers(organizationId, members = []) {
  if (!members.length) return [];
  const found = await Membership.countDocuments({ organization: organizationId, user: { $in: members }, status: 'ACTIVE' });
  if (found !== new Set(members.map(String)).size) throw new AppError('Every project member must belong to this workspace.', 400, 'INVALID_PROJECT_MEMBER');
  return [...new Set(members.map(String))];
}

async function decorateProjects(projects, organizationId) {
  if (!projects.length) return [];
  const projectIds = projects.map((project) => project._id);
  const taskStats = await Task.aggregate([
    { $match: { organization: new mongoose.Types.ObjectId(organizationId), project: { $in: projectIds } } },
    { $group: { _id: '$project', taskCount: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } } } },
  ]);
  const byId = new Map(taskStats.map((item) => [String(item._id), item]));
  return projects.map((project) => {
    const stats = byId.get(String(project._id)) || { taskCount: 0, completed: 0 };
    const plain = typeof project.toObject === 'function' ? project.toObject() : project;
    return { ...plain, taskCount: stats.taskCount, progress: stats.taskCount ? Math.round((stats.completed / stats.taskCount) * 100) : 0 };
  });
}

async function listProjects({ organizationId, userId, role, query }) {
  const filter = { organization: organizationId };
  if (query.status) filter.status = query.status;
  if (query.search) filter.$or = [{ name: { $regex: escapeRegex(query.search), $options: 'i' } }, { description: { $regex: escapeRegex(query.search), $options: 'i' } }];
  if (role === 'MEMBER') {
    const assignedProjects = await Task.distinct('project', { organization: organizationId, assignee: userId });
    const visibility = [{ members: userId }];
    if (assignedProjects.length) visibility.push({ _id: { $in: assignedProjects } });
    if (filter.$or) filter.$and = [{ $or: filter.$or }, { $or: visibility }];
    else filter.$or = visibility;
  }
  const sort = query.sort === 'name' ? { name: 1 } : query.sort === 'dueDate' ? { dueDate: 1, updatedAt: -1 } : { [query.sort]: -1 };
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    Project.find(filter).sort(sort).skip(skip).limit(query.limit).populate('members', 'name email').populate('createdBy', 'name').lean({ virtuals: false }),
    Project.countDocuments(filter),
  ]);
  return { projects: await decorateProjects(items, organizationId), pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } };
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function getProject({ organizationId, projectId, userId, role }) {
  const project = await Project.findOne({ _id: projectId, organization: organizationId }).populate('members', 'name email').populate('createdBy', 'name');
  if (!project) throw new AppError('Project not found.', 404, 'PROJECT_NOT_FOUND');
  if (role === 'MEMBER') {
    const isMember = project.members.some((member) => String(member._id) === String(userId));
    const hasTask = await Task.exists({ organization: organizationId, project: projectId, assignee: userId });
    if (!isMember && !hasTask) throw new AppError('Project not found.', 404, 'PROJECT_NOT_FOUND');
  }
  const [stats] = await Task.aggregate([
    { $match: { organization: new mongoose.Types.ObjectId(organizationId), project: new mongoose.Types.ObjectId(projectId) } },
    { $group: { _id: null, taskCount: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } } } },
  ]);
  return { ...project.toObject(), taskCount: stats?.taskCount || 0, progress: stats?.taskCount ? Math.round((stats.completed / stats.taskCount) * 100) : 0 };
}

async function createProject({ organizationId, userId, input }) {
  const members = await validateMembers(organizationId, [...new Set([userId, ...(input.members || [])])]);
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) throw new AppError('Due date must be on or after the start date.', 400, 'INVALID_DATE_RANGE');
  await billingService.reserveProjectSlot(organizationId);
  let project;
  try {
    project = await Project.create({ ...input, members, organization: organizationId, createdBy: userId, updatedBy: userId });
  } catch (error) {
    await billingService.releaseProjectSlot(organizationId);
    throw error;
  }
  await recordActivity({ organization: organizationId, actor: userId, action: 'PROJECT_CREATED', message: `created project “${project.name}”`, targetType: 'PROJECT', targetId: project._id, project: project._id });
  return getProject({ organizationId, projectId: project._id, userId, role: 'ADMIN' });
}

async function updateProject({ organizationId, projectId, userId, input }) {
  const project = await Project.findOne({ _id: projectId, organization: organizationId });
  if (!project) throw new AppError('Project not found.', 404, 'PROJECT_NOT_FOUND');
  const update = { ...input };
  if (Object.hasOwn(update, 'members')) {
    const requestedMembers = new Set(update.members.map(String));
    if (await Membership.exists({ organization: organizationId, user: project.createdBy, status: 'ACTIVE' })) requestedMembers.add(project.createdBy.toString());
    update.members = await validateMembers(organizationId, [...requestedMembers]);
  }
  const startDate = Object.hasOwn(update, 'startDate') ? update.startDate : project.startDate;
  const dueDate = Object.hasOwn(update, 'dueDate') ? update.dueDate : project.dueDate;
  if (startDate && dueDate && dueDate < startDate) throw new AppError('Due date must be on or after the start date.', 400, 'INVALID_DATE_RANGE');
  const before = { name: project.name, status: project.status };
  Object.assign(project, update, { updatedBy: userId });
  await project.save();
  const changed = Object.keys(update);
  await recordActivity({ organization: organizationId, actor: userId, action: 'PROJECT_UPDATED', message: `updated project “${project.name}”`, targetType: 'PROJECT', targetId: project._id, project: project._id, metadata: { changed, before } });
  return getProject({ organizationId, projectId, userId, role: 'ADMIN' });
}

async function deleteProject({ organizationId, projectId, userId }) {
  const project = await Project.findOne({ _id: projectId, organization: organizationId }).select('_id name');
  if (!project) throw new AppError('Project not found.', 404, 'PROJECT_NOT_FOUND');
  const taskIds = await Task.distinct('_id', { organization: organizationId, project: projectId });
  await Promise.all([
    Comment.deleteMany({ organization: organizationId, task: { $in: taskIds } }),
    Notification.deleteMany({ organization: organizationId, $or: [{ project: projectId }, { task: { $in: taskIds } }] }),
    Task.deleteMany({ organization: organizationId, project: projectId }),
    Project.deleteOne({ _id: projectId, organization: organizationId }),
  ]);
  await billingService.releaseProjectSlot(organizationId);
  await recordActivity({ organization: organizationId, actor: userId, action: 'PROJECT_DELETED', message: `deleted project “${project.name}”`, targetType: 'PROJECT', targetId: projectId });
  return { deleted: true };
}

module.exports = { listProjects, getProject, createProject, updateProject, deleteProject };
