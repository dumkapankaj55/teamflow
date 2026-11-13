const Notification = require('../models/Notification');
const { emitNotification } = require('./socketService');

async function notify({ organization, user, type, title, message, project, task }) {
  if (!user) return null;
  const notification = await Notification.create({ organization, user, type, title, message, project, task });
  emitNotification(notification);
  return notification;
}

module.exports = { notify };
