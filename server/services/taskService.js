const AppError = require('../utils/AppError');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Membership = require('../models/Membership');
const Comment = require('../models/Comment');
const ActivityLog = require('../models/ActivityLog');
const Notification = require('../models/Notification');
const { recordActivity } = require('./activityService');
const { notify } = require('./notificationService');

const populateTask = [
  { path: 'project', select: 'name status dueDate' },
  { path: 'assignee', select: 'name email' },
  { path: 'reporter', select: 'name email' },
];

async function assertTaskReadable(task, userId, role) {
  if (role !== 'MEMBER') return;
  const projectId = task.project?._id || task.project;
  const project = await Project.findOne({ _id: projectId, organization: task.organization }).select('members');
  const isProjectMember = project?.members.some((id) => String(id) === String(userId));
  const assigneeId = task.assignee?._id || task.assignee;
  if (!isProjectMember && String(assigneeId || '') !== String(userId)) throw new AppError('Task not found.', 404, 'TASK_NOT_FOUND');
}

async function listTasks({ organizationId, userId, role, query }) {
  const filter = { organization: organizationId };
  if (role === 'MEMBER' || query.mine) filter.assignee = userId;
  if (query.projectId) filter.project = query.projectId;
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.assignedTo && role !== 'MEMBER') filter.assignee = query.assignedTo;
  if (query.search) filter.$or = [{ title: { $regex: escapeRegex(query.search), $options: 'i' } }, { description: { $regex: escapeRegex(query.search), $options: 'i' } }];
  const skip = (query.page - 1) * query.limit;
  const [tasks, total] = await Promise.all([
    Task.find(filter).sort({ status: 1, sortOrder: 1, dueDate: 1, updatedAt: -1 }).skip(skip).limit(query.limit).populate(populateTask),
    Task.countDocuments(filter),
  ]);
  return { tasks, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } };
}

async function getTask({ organizationId, taskId, userId, role }) {
  const task = await Task.findOne({ _id: taskId, organization: organizationId }).populate(populateTask);
  if (!task) throw new AppError('Task not found.', 404, 'TASK_NOT_FOUND');
  await assertTaskReadable(task, userId, role);
  return task;
}

async function assertAssignee(organizationId, userId) {
  if (!userId) return;
  const membership = await Membership.exists({ organization: organizationId, user: userId, status: 'ACTIVE' });
  if (!membership) throw new AppError('Assignee must be an active member of this workspace.', 400, 'INVALID_ASSIGNEE');
}

async function createTask({ organizationId, userId, input }) {
  const project = await Project.findOne({ _id: input.projectId, organization: organizationId });
  if (!project) throw new AppError('Project not found in this workspace.', 404, 'PROJECT_NOT_FOUND');
  await assertAssignee(organizationId, input.assignedTo);
  const task = await Task.create({
    organization: organizationId,
    project: project._id,
    title: input.title,
    description: input.description || '',
    priority: input.priority || 'MEDIUM',
    dueDate: input.dueDate || undefined,
    assignee: input.assignedTo,
    reporter: userId,
  });
  if (input.assignedTo && !project.members.some((id) => String(id) === String(input.assignedTo))) {
    project.members.push(input.assignedTo); await project.save();
  }
  await recordActivity({ organization: organizationId, actor: userId, action: 'TASK_CREATED', message: `created task “${task.title}”`, targetType: 'TASK', targetId: task._id, project: project._id, task: task._id });
  if (input.assignedTo && String(input.assignedTo) !== String(userId)) await notify({ organization: organizationId, user: input.assignedTo, type: 'TASK_ASSIGNED', title: 'A task was assigned to you', message: `${task.title} in ${project.name}`, project: project._id, task: task._id });
  return getTask({ organizationId, taskId: task._id, userId, role: 'ADMIN' });
}

async function updateTask({ organizationId, taskId, userId, role, input }) {
  const task = await Task.findOne({ _id: taskId, organization: organizationId });
  if (!task) throw new AppError('Task not found.', 404, 'TASK_NOT_FOUND');
  const isManager = role === 'ADMIN' || role === 'MANAGER';
  if (!isManager) {
    if (String(task.assignee) !== String(userId)) throw new AppError('You can only update the status of tasks assigned to you.', 403, 'TASK_UPDATE_FORBIDDEN');
    if (Object.keys(input).some((field) => field !== 'status')) throw new AppError('Members can only update task status.', 403, 'TASK_UPDATE_FORBIDDEN');
  }
  if (Object.hasOwn(input, 'assignedTo')) await assertAssignee(organizationId, input.assignedTo);
  const project = await Project.findOne({ _id: task.project, organization: organizationId }).select('name members');
  if (!project) throw new AppError('Project not found.', 404, 'PROJECT_NOT_FOUND');
  const before = { status: task.status, dueDate: task.dueDate, assignee: task.assignee };
  if (Object.hasOwn(input, 'dueDate')) task.dueDate = input.dueDate || undefined;
  if (Object.hasOwn(input, 'assignedTo')) task.assignee = input.assignedTo || undefined;
  if (Object.hasOwn(input, 'status')) {
    task.status = input.status;
    task.completedAt = input.status === 'DONE' ? (task.completedAt || new Date()) : undefined;
  }
  for (const field of ['title', 'description', 'priority']) if (Object.hasOwn(input, field)) task[field] = input[field];
  await task.save();
  const changed = Object.keys(input);
  await recordActivity({ organization: organizationId, actor: userId, action: 'TASK_UPDATED', message: `updated task “${task.title}”`, targetType: 'TASK', targetId: task._id, project: task.project, task: task._id, metadata: { changed, before, after: { status: task.status, dueDate: task.dueDate, assignee: task.assignee } } });
  if (Object.hasOwn(input, 'assignedTo') && input.assignedTo && String(input.assignedTo) !== String(before.assignee) && String(input.assignedTo) !== String(userId)) {
    await notify({ organization: organizationId, user: input.assignedTo, type: 'TASK_ASSIGNED', title: 'A task was assigned to you', message: `${task.title} in ${project.name}`, project: task.project, task: task._id });
    if (!project.members.some((id) => String(id) === String(input.assignedTo))) { project.members.push(input.assignedTo); await project.save(); }
  }
  if (Object.hasOwn(input, 'dueDate') && String(input.dueDate || '') !== String(before.dueDate || '')) {
    const recipients = new Set([String(task.assignee || ''), String(task.reporter || '')]); recipients.delete(''); recipients.delete(String(userId));
    await Promise.all([...recipients].map((recipient) => notify({ organization: organizationId, user: recipient, type: 'DEADLINE_CHANGED', title: 'A task deadline changed', message: `${task.title} · ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'deadline removed'}`, project: task.project, task: task._id })));
  }
  if (input.status === 'DONE' && before.status !== 'DONE') {
    const recipients = new Set([String(task.reporter || ''), ...project.members.map(String)]); recipients.delete(String(userId));
    await Promise.all([...recipients].map((recipient) => notify({ organization: organizationId, user: recipient, type: 'TASK_COMPLETED', title: 'A task was completed', message: task.title, project: task.project, task: task._id })));
  }
  return getTask({ organizationId, taskId: task._id, userId, role: 'ADMIN' });
}

async function deleteTask({ organizationId, taskId, userId }) {
  const task = await Task.findOneAndDelete({ _id: taskId, organization: organizationId });
  if (!task) throw new AppError('Task not found.', 404, 'TASK_NOT_FOUND');
  await Promise.all([
    Comment.deleteMany({ organization: organizationId, task: taskId }),
    Notification.deleteMany({ organization: organizationId, task: taskId }),
    ActivityLog.deleteMany({ organization: organizationId, task: taskId }),
  ]);
  await recordActivity({ organization: organizationId, actor: userId, action: 'TASK_DELETED', message: `deleted task “${task.title}”`, targetType: 'TASK', targetId: taskId, project: task.project });
  return { deleted: true };
}

async function listComments({ organizationId, taskId, userId, role, query }) {
  const task = await getTask({ organizationId, taskId, userId, role });
  const filter = { organization: organizationId, task: task._id };
  const skip = (query.page - 1) * query.limit;
  const [comments, total] = await Promise.all([
    Comment.find(filter).populate('author', 'name email').sort({ createdAt: 1 }).skip(skip).limit(query.limit),
    Comment.countDocuments(filter),
  ]);
  return { comments, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } };
}

async function listActivity({ organizationId, taskId, userId, role, query }) {
  const task = await getTask({ organizationId, taskId, userId, role });
  const filter = { organization: organizationId, task: task._id };
  const skip = (query.page - 1) * query.limit;
  const [activity, total] = await Promise.all([
    ActivityLog.find(filter).populate('actor', 'name').sort({ createdAt: -1 }).skip(skip).limit(query.limit),
    ActivityLog.countDocuments(filter),
  ]);
  return { activity, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } };
}

async function addComment({ organizationId, taskId, userId, role, body }) {
  const task = await getTask({ organizationId, taskId, userId, role });
  const comment = await Comment.create({ organization: organizationId, task: task._id, author: userId, body });
  const project = await Project.findById(task.project).select('name members');
  await recordActivity({ organization: organizationId, actor: userId, action: 'COMMENT_ADDED', message: `commented on “${task.title}”`, targetType: 'COMMENT', targetId: comment._id, project: task.project, task: task._id });
  const assigneeId = task.assignee?._id || task.assignee;
  const reporterId = task.reporter?._id || task.reporter;
  const recipients = new Set([String(assigneeId || ''), String(reporterId || ''), ...(project?.members || []).map(String)]); recipients.delete(''); recipients.delete(String(userId));
  await Promise.all([...recipients].map((recipient) => notify({ organization: organizationId, user: recipient, type: 'COMMENT_ADDED', title: 'New comment on a task', message: `${task.title}: ${body.slice(0, 160)}`, project: task.project, task: task._id })));
  return comment.populate('author', 'name email');
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = { listTasks, getTask, createTask, updateTask, deleteTask, listComments, listActivity, addComment };
