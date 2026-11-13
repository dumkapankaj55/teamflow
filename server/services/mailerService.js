const nodemailer = require('nodemailer');

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

function transporter() {
  if (!isConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
}

async function sendEmail({ to, subject, text, html, replyTo }) {
  const mailTransport = transporter();
  if (!mailTransport) return false;
  await mailTransport.sendMail({ from: process.env.SMTP_FROM || 'TeamFlow <no-reply@example.com>', to, subject, text, html, ...(replyTo ? { replyTo } : {}) });
  return true;
}

module.exports = { isConfigured, sendEmail };
