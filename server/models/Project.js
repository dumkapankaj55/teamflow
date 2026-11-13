const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 4000, default: '' },
  startDate: { type: Date },
  dueDate: { type: Date },
  status: { type: String, enum: ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'], default: 'ACTIVE', index: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

projectSchema.index({ organization: 1, status: 1, updatedAt: -1 });
projectSchema.index({ organization: 1, name: 1 });
module.exports = mongoose.models.Project || mongoose.model('Project', projectSchema);
