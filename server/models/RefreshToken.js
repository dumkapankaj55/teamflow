const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  familyId: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date },
  replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'RefreshToken' },
  userAgent: { type: String, maxlength: 500 },
  ipAddress: { type: String, maxlength: 64 },
}, { timestamps: true });

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ user: 1, revokedAt: 1 });
module.exports = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);
