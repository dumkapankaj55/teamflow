const mongoose = require('mongoose');
const Project = require('../models/Project');
const Task = require('../models/Task');
const ActivityLog = require('../models/ActivityLog');

const id = (value) => new mongoose.Types.ObjectId(value);

async function overview({ organizationId, userId, role }) {
  const organization = id(organizationId);
  const taskFilter = { organization };
  const projectFilter = { organization };
  const activityFilter = { organization };
  if (role === 'MEMBER') {
    taskFilter.assignee = id(userId);
    const [assignedProjectIds, memberProjectIds, assignedTaskIds] = await Promise.all([
      Task.distinct('project', taskFilter),
      Project.distinct('_id', { organization, members: id(userId) }),
      Task.distinct('_id', taskFilter),
    ]);
    projectFilter.$or = [{ members: id(userId) }, { _id: { $in: assignedProjectIds } }];
    activityFilter.$or = [
      { project: { $in: memberProjectIds } },
      { task: { $in: assignedTaskIds } },
    ];
  }
  const now = new Date(); const upcomingLimit = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [totalProjects, activeProjects, taskStats, recentProjects, upcomingDeadlines, recentActivity] = await Promise.all([
    Project.countDocuments(projectFilter),
    Project.countDocuments({ ...projectFilter, status: 'ACTIVE' }),
    Task.aggregate([
      { $match: taskFilter },
      { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } }, overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'DONE'] }, { $lt: ['$dueDate', now] }] }, 1, 0] } } } },
    ]),
    Project.find(projectFilter).sort({ updatedAt: -1 }).limit(5).select('name status dueDate updatedAt'),
    Task.find({ ...taskFilter, dueDate: { $gte: now, $lte: upcomingLimit }, status: { $ne: 'DONE' } }).sort({ dueDate: 1 }).limit(6).populate('project', 'name').populate('assignee', 'name'),
    ActivityLog.find(activityFilter).sort({ createdAt: -1 }).limit(6).populate('actor', 'name').populate('project', 'name').populate('task', 'title'),
  ]);
  const taskTotal = taskStats[0]?.total || 0; const completedTasks = taskStats[0]?.completed || 0;
  const projectStats = await Task.aggregate([
    { $match: { organization, project: { $in: recentProjects.map((project) => project._id) } } },
    { $group: { _id: '$project', count: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } } } },
  ]);
  const progressByProject = new Map(projectStats.map((item) => [String(item._id), item]));
  const projectsWithProgress = recentProjects.map((project) => {
    const stats = progressByProject.get(String(project._id)) || { count: 0, completed: 0 };
    return { ...project.toObject(), taskCount: stats.count, progress: stats.count ? Math.round(stats.completed / stats.count * 100) : 0 };
  });
  const activities = recentActivity.map((item) => {
    const target = item.task || item.project;
    return { ...item.toObject(), target: target ? { title: target.title || target.name, name: target.name } : null };
  });
  return {
    stats: { totalProjects, activeProjects, totalTasks: taskTotal, completedTasks, pendingTasks: taskTotal - completedTasks, overdueTasks: taskStats[0]?.overdue || 0, completionRate: taskTotal ? Math.round(completedTasks / taskTotal * 100) : 0 },
    recentProjects: projectsWithProgress,
    upcomingDeadlines,
    recentActivity: activities,
  };
}

async function taskAnalytics(organizationId) {
  const organization = id(organizationId);
  const since = new Date(); since.setDate(since.getDate() - 29); since.setHours(0, 0, 0, 0);
  const [tasksByStatus, tasksByPriority, completionTrend] = await Promise.all([
    Task.aggregate([{ $match: { organization } }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $project: { _id: 0, status: '$_id', count: 1 } }]),
    Task.aggregate([{ $match: { organization, status: { $ne: 'DONE' } } }, { $group: { _id: '$priority', count: { $sum: 1 } } }, { $project: { _id: 0, priority: '$_id', count: 1 } }]),
    Task.aggregate([
      { $match: { organization, status: 'DONE', completedAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } }, completed: { $sum: 1 } } },
      { $sort: { _id: 1 } }, { $project: { _id: 0, date: '$_id', completed: 1 } },
    ]),
  ]);
  return { tasksByStatus, tasksByPriority, completionTrend };
}

async function projectAnalytics(organizationId) {
  const organization = id(organizationId);
  const [projects, tasks] = await Promise.all([
    Project.find({ organization }).select('name status dueDate createdAt').sort({ updatedAt: -1 }).limit(20),
    Task.aggregate([{ $match: { organization } }, { $group: { _id: '$project', taskCount: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } } } }]),
  ]);
  const byProject = new Map(tasks.map((task) => [String(task._id), task]));
  return { projectProgress: projects.map((project) => { const stats = byProject.get(String(project._id)) || { taskCount: 0, completed: 0 }; return { _id: project._id, name: project.name, status: project.status, taskCount: stats.taskCount, progress: stats.taskCount ? Math.round(stats.completed / stats.taskCount * 100) : 0 }; }) };
}

async function teamAnalytics(organizationId) {
  const organization = id(organizationId);
  const teamWorkload = await Task.aggregate([
    { $match: { organization, assignee: { $ne: null }, status: { $ne: 'DONE' } } },
    { $group: { _id: '$assignee', openTasks: { $sum: 1 } } },
    { $sort: { openTasks: -1 } }, { $limit: 30 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $project: { _id: 0, userId: '$_id', name: '$user.name', openTasks: 1 } },
  ]);
  return { teamWorkload };
}

module.exports = { overview, taskAnalytics, projectAnalytics, teamAnalytics };
