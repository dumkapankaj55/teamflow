const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 8000, default: '' },
  status: { type: String, enum: ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'], default: 'TODO', index: true },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM', index: true },
  dueDate: { type: Date },
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sortOrder: { type: Number, default: 0 },
  tags: [{ type: String, trim: true, maxlength: 30 }],
  completedAt: { type: Date },
}, { timestamps: true });

taskSchema.index({ organization: 1, project: 1, status: 1, sortOrder: 1 });
taskSchema.index({ organization: 1, assignee: 1, status: 1, dueDate: 1 });
taskSchema.index({ organization: 1, dueDate: 1, status: 1 });
taskSchema.index({ title: 'text', description: 'text' });
module.exports = mongoose.models.Task || mongoose.model('Task', taskSchema);
