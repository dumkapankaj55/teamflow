const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  password: { type: String, required: true, select: false },
  isActive: { type: Boolean, default: true, index: true },
  resetTokenHash: { type: String, select: false },
  resetOtpHash: { type: String, select: false },
  resetAttempts: { type: Number, default: 0, select: false },
  resetTokenExpiresAt: { type: Date, select: false },
  passwordChangedAt: { type: Date },
}, { timestamps: true, toJSON: { transform: (_doc, ret) => { delete ret.password; delete ret.resetTokenHash; delete ret.resetTokenExpiresAt; delete ret.__v; return ret; } } });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
