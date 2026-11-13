const mongoose = require('mongoose');

const billingPaymentSchema = new mongoose.Schema({
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  stripeInvoiceId: { type: String, required: true, unique: true },
  stripeSubscriptionId: { type: String },
  invoiceNumber: { type: String },
  status: { type: String, enum: ['paid', 'payment_failed'], required: true },
  currency: { type: String, required: true },
  amountPaid: { type: Number, required: true, min: 0 },
  amountDue: { type: Number, required: true, min: 0 },
  hostedInvoiceUrl: { type: String },
  invoiceCreatedAt: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.models.BillingPayment || mongoose.model('BillingPayment', billingPaymentSchema);
