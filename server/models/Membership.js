const mongoose = require('mongoose');

const membershipSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  role: { type: String, enum: ['ADMIN', 'MANAGER', 'MEMBER'], default: 'MEMBER', required: true },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE', index: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

membershipSchema.index({ organization: 1, user: 1 }, { unique: true });
membershipSchema.index({ organization: 1, role: 1, status: 1 });
module.exports = mongoose.models.Membership || mongoose.model('Membership', membershipSchema);
