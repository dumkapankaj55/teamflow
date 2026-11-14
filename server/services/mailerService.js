const { Resend } = require('resend');
const AppError = require('../utils/AppError');
const { logger } = require('../config/logger');

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

async function sendEmail({ to, subject, text, html, replyTo }) {
  if (!isConfigured()) return false;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to,
      subject,
      text,
      html,
      ...(replyTo ? { replyTo } : {}),
    });
    if (error) throw error;
    return true;
  } catch (error) {
    logger.warn({ errorName: error?.name }, 'Resend email delivery failed');
    throw new AppError('Email delivery failed. Please try again later.', 503, 'EMAIL_DELIVERY_UNAVAILABLE');
  }
}

module.exports = { isConfigured, sendEmail };
