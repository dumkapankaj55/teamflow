const Notification = require('../models/Notification');

async function notify({ organization, user, type, title, message, project, task }) {
  if (!user) return null;
  return Notification.create({ organization, user, type, title, message, project, task });
}

module.exports = { notify };
