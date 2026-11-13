const ActivityLog = require('../models/ActivityLog');

async function recordActivity({ organization, actor, action, message, targetType, targetId, project, task, metadata = {} }) {
  return ActivityLog.create({ organization, actor, action, message, targetType, targetId, project, task, metadata });
}

module.exports = { recordActivity };
