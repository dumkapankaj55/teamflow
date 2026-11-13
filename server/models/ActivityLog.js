const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, maxlength: 80 },
  message: { type: String, required: true, maxlength: 300 },
  targetType: { type: String, enum: ['ORGANIZATION', 'PROJECT', 'TASK', 'COMMENT', 'MEMBERSHIP'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

activityLogSchema.index({ organization: 1, createdAt: -1 });
activityLogSchema.index({ organization: 1, targetType: 1, targetId: 1 });
module.exports = mongoose.models.ActivityLog || mongoose.model('ActivityLog', activityLogSchema);
