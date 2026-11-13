const mongoose = require('mongoose');

const stripeEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  status: { type: String, enum: ['PROCESSING', 'PROCESSED', 'FAILED'], default: 'PROCESSING', required: true },
  receivedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.models.StripeEvent || mongoose.model('StripeEvent', stripeEventSchema);
