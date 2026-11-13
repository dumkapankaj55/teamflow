const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  password: { type: String, required: true, select: false },
  isActive: { type: Boolean, default: true, index: true },
  emailVerifiedAt: { type: Date },
  emailVerificationTokenHash: { type: String, select: false },
  emailVerificationExpiresAt: { type: Date, select: false },
  tokenVersion: { type: Number, default: 0 },
  resetTokenHash: { type: String, select: false },
  resetOtpHash: { type: String, select: false },
  resetAttempts: { type: Number, default: 0, select: false },
  resetTokenExpiresAt: { type: Date, select: false },
  passwordChangedAt: { type: Date },
}, { timestamps: true, toJSON: { transform: (_doc, ret) => {
  delete ret.password;
  delete ret.resetTokenHash;
  delete ret.resetOtpHash;
  delete ret.resetAttempts;
  delete ret.resetTokenExpiresAt;
  delete ret.emailVerificationTokenHash;
  delete ret.emailVerificationExpiresAt;
  delete ret.tokenVersion;
  delete ret.__v;
  return ret;
} } });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
