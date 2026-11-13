const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true, index: true },
  plan: { type: String, enum: ['FREE', 'PRO', 'ENTERPRISE'], default: 'FREE', required: true },
  status: { type: String, enum: ['free', 'incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'], default: 'free', required: true },
  stripeCustomerId: { type: String, sparse: true, unique: true },
  stripeSubscriptionId: { type: String, sparse: true, unique: true },
  stripePriceId: { type: String },
  checkoutSessionId: { type: String, sparse: true, unique: true },
  checkoutExpiresAt: { type: Date },
  currentPeriodStart: { type: Date },
  currentPeriodEnd: { type: Date },
  cancelAtPeriodEnd: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
