const ActivityLog = require('../models/ActivityLog');

async function listAuditLogs({ organizationId, page, limit, action, targetType, actor, from, to }) {
  const filter = { organization: organizationId };
  if (action) filter.action = action;
  if (targetType) filter.targetType = targetType;
  if (actor) filter.actor = actor;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    ActivityLog.find(filter).populate('actor', 'name email').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    ActivityLog.countDocuments(filter),
  ]);
  return { auditLogs: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

module.exports = { listAuditLogs };
