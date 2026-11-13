const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const Notification = require('../models/Notification');

async function listNotifications({ organizationId, userId, page = 1, limit = 20 }) {
  const filter = { organization: organizationId, user: userId };
  const skip = (page - 1) * limit;
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('project', 'name').populate('task', 'title'),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...filter, isRead: false }),
  ]);
  return { notifications, unreadCount, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function markRead({ organizationId, userId, notificationId }) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, organization: organizationId, user: userId },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true },
  );
  if (!notification) throw new AppError('Notification not found.', 404, 'NOTIFICATION_NOT_FOUND');
  return notification;
}

async function markAllRead({ organizationId, userId }) {
  const result = await Notification.updateMany({ organization: organizationId, user: userId, isRead: false }, { $set: { isRead: true, readAt: new Date() } });
  return { updatedCount: result.modifiedCount };
}

module.exports = { listNotifications, markRead, markAllRead };
