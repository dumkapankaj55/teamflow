const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  slug: { type: String, required: true, lowercase: true, trim: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  settings: { timezone: { type: String, default: 'UTC' }, weekStartsOn: { type: Number, min: 0, max: 6, default: 1 } },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

module.exports = mongoose.models.Organization || mongoose.model('Organization', organizationSchema);
