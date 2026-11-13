const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema({
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  role: { type: String, enum: ['ADMIN', 'MANAGER', 'MEMBER'], default: 'MEMBER', required: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true },
  acceptedAt: { type: Date },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'], default: 'PENDING', index: true },
}, { timestamps: true });

invitationSchema.index({ organization: 1, email: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'PENDING' } });
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.models.Invitation || mongoose.model('Invitation', invitationSchema);
