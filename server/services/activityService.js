const ActivityLog = require('../models/ActivityLog');
const Membership = require('../models/Membership');
const Project = require('../models/Project');
const { emitActivity } = require('./socketService');

async function recordActivity({ organization, actor, action, message, targetType, targetId, project, task, metadata = {} }) {
  const activity = await ActivityLog.create({ organization, actor, action, message, targetType, targetId, project, task, metadata });
  try {
    const projectRecord = project ? await Project.findOne({ _id: project, organization }).select('members') : null;
    const visibleMemberIds = projectRecord?.members || [];
    const memberships = await Membership.find({
      organization,
      status: 'ACTIVE',
      $or: [{ role: { $in: ['ADMIN', 'MANAGER'] } }, { user: { $in: visibleMemberIds } }],
    }).select('user');
    const recipients = new Set([String(actor), ...memberships.map((membership) => String(membership.user))]);
    emitActivity({ recipients: [...recipients], organizationId: organization, activity });
  } catch (_error) {
    // Realtime delivery is best effort; saving the activity is the source of truth.
  }
  return activity;
}

module.exports = { recordActivity };
