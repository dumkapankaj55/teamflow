const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['TASK_ASSIGNED', 'DEADLINE_CHANGED', 'COMMENT_ADDED', 'INVITATION_RECEIVED', 'TASK_COMPLETED', 'MENTIONED'], required: true },
  title: { type: String, required: true, maxlength: 120 },
  message: { type: String, required: true, maxlength: 500 },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  isRead: { type: Boolean, default: false, index: true },
  readAt: { type: Date },
}, { timestamps: true });

notificationSchema.index({ organization: 1, user: 1, isRead: 1, createdAt: -1 });
module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
