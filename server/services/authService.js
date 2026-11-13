const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const AppError = require('../utils/AppError');
const slugify = require('../utils/slug');
const { createAccessToken, createOpaqueToken, hashToken } = require('../utils/tokenUtils');
const refreshCookieOptions = require('../utils/cookieOptions');
const { sendEmail, isConfigured } = require('./mailerService');
const { verifyCaptcha } = require('./captchaService');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const RefreshToken = require('../models/RefreshToken');
const Invitation = require('../models/Invitation');

const safeUser = (user) => ({ _id: user._id, name: user.name, email: user.email, createdAt: user.createdAt });
const cookieName = () => process.env.COOKIE_NAME || 'teamflow_refresh';

async function newOrganization(name, userId) {
  const base = slugify(name);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const slug = attempt ? `${base}-${crypto.randomBytes(2).toString('hex')}` : base;
    if (!await Organization.exists({ slug })) return Organization.create({ name, slug, createdBy: userId });
  }
  throw new AppError('We could not create a unique workspace address. Try again.', 409, 'SLUG_CONFLICT');
}

async function createSession(user, req, res, familyId = crypto.randomUUID()) {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30) * 24 * 60 * 60 * 1000);
  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(token),
    familyId,
    expiresAt,
    userAgent: req.get('user-agent')?.slice(0, 500),
    ipAddress: req.ip?.slice(0, 64),
  });
  res.cookie(cookieName(), token, refreshCookieOptions());
  return { accessToken: createAccessToken(user), user: safeUser(user) };
}

async function register(input, req, res) {
  const existingUser = await User.exists({ email: input.email });
  if (existingUser) throw new AppError('An account with this email already exists.', 409, 'EMAIL_IN_USE');
  const invitation = input.invitationToken
    ? await Invitation.findOne({ tokenHash: hashToken(input.invitationToken), status: 'PENDING', expiresAt: { $gt: new Date() } }).select('+tokenHash')
    : null;
  if (input.invitationToken && !invitation) throw new AppError('This invitation is invalid or has expired.', 400, 'INVALID_INVITATION');
  if (invitation && invitation.email !== input.email) throw new AppError('Register with the email address that received this invitation.', 403, 'INVITATION_EMAIL_MISMATCH');
  const user = await User.create({ name: input.name, email: input.email, password: await bcrypt.hash(input.password, 12) });
  try {
    let organization;
    if (invitation) {
      organization = await Organization.findById(invitation.organization);
      await Membership.findOneAndUpdate(
        { user: user._id, organization: invitation.organization },
        { $set: { role: invitation.role, status: 'ACTIVE' }, $setOnInsert: { invitedBy: invitation.invitedBy } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      invitation.status = 'ACCEPTED'; invitation.acceptedAt = new Date(); await invitation.save();
    } else {
      organization = await newOrganization(input.organizationName, user._id);
      await Membership.create({ user: user._id, organization: organization._id, role: 'ADMIN' });
    }
    const session = await createSession(user, req, res);
    return { ...session, organization: { _id: organization._id, name: organization.name, slug: organization.slug } };
  } catch (error) {
    if (invitation) { invitation.status = 'PENDING'; invitation.acceptedAt = undefined; await invitation.save(); }
    await Promise.all([Membership.deleteMany({ user: user._id }), Organization.deleteMany({ createdBy: user._id }), User.findByIdAndDelete(user._id)]);
    throw error;
  }
}

async function login(input, req, res) {
  const user = await User.findOne({ email: input.email, isActive: true }).select('+password');
  const passwordMatches = user ? await bcrypt.compare(input.password, user.password) : false;
  if (!passwordMatches) throw new AppError('Email or password is incorrect.', 401, 'INVALID_CREDENTIALS');
  return createSession(user, req, res);
}

async function refresh(req, res) {
  const token = req.cookies?.[cookieName()];
  if (!token) throw new AppError('Your session has expired. Please sign in again.', 401, 'REFRESH_TOKEN_MISSING');
  const tokenHash = hashToken(token);
  const current = await RefreshToken.findOne({ tokenHash }).select('+tokenHash');
  if (!current) throw new AppError('Your session has expired. Please sign in again.', 401, 'INVALID_REFRESH_TOKEN');
  if (current.revokedAt) {
    await RefreshToken.updateMany({ familyId: current.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw new AppError('Session reuse was detected. Please sign in again.', 401, 'REFRESH_TOKEN_REUSE');
  }
  if (current.expiresAt <= new Date()) {
    current.revokedAt = new Date(); await current.save();
    throw new AppError('Your session has expired. Please sign in again.', 401, 'REFRESH_TOKEN_EXPIRED');
  }
  const user = await User.findById(current.user);
  if (!user || !user.isActive) throw new AppError('Your account is unavailable.', 401, 'ACCOUNT_UNAVAILABLE');
  const nextToken = createOpaqueToken();
  const nextSession = await RefreshToken.create({
    user: user._id, tokenHash: hashToken(nextToken), familyId: current.familyId,
    expiresAt: new Date(Date.now() + Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30) * 24 * 60 * 60 * 1000),
    userAgent: req.get('user-agent')?.slice(0, 500), ipAddress: req.ip?.slice(0, 64),
  });
  const rotated = await RefreshToken.findOneAndUpdate(
    { _id: current._id, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { revokedAt: new Date(), replacedBy: nextSession._id } },
    { new: true },
  );
  if (!rotated) {
    await RefreshToken.deleteOne({ _id: nextSession._id });
    await RefreshToken.updateMany({ familyId: current.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw new AppError('Session changed. Please sign in again.', 401, 'REFRESH_TOKEN_RACE');
  }
  res.cookie(cookieName(), nextToken, refreshCookieOptions());
  return { accessToken: createAccessToken(user), user: safeUser(user) };
}

async function logout(req, res) {
  const token = req.cookies?.[cookieName()];
  if (token) await RefreshToken.updateOne({ tokenHash: hashToken(token), revokedAt: null }, { $set: { revokedAt: new Date() } });
  res.clearCookie(cookieName(), { ...refreshCookieOptions(), maxAge: undefined });
}

async function forgotPassword(email) {
  const user = await User.findOne({ email, isActive: true });
  const genericResponse = { message: 'If an account exists for this email, a reset link will be sent shortly.' };
  if (!user) return genericResponse;
  const token = createOpaqueToken();
  const otp = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  user.resetTokenHash = hashToken(token);
  user.resetOtpHash = hashToken(otp);
  user.resetAttempts = 0;
  user.resetTokenExpiresAt = expiresAt;
  await user.save();
  const resetUrl = `${process.env.PASSWORD_RESET_URL || 'http://localhost:5173/reset-password'}?token=${encodeURIComponent(token)}`;
  let sent = false;
  try {
    sent = await sendEmail({
      to: user.email,
      subject: 'Reset your TeamFlow password',
      text: `Open this link to reset your TeamFlow password: ${resetUrl}\n\nEnter this one-time code on the reset page: ${otp}\n\nBoth expire in 15 minutes. If you did not request a reset, ignore this email.`,
      html: `<p>Open the link below to reset your TeamFlow password:</p><p><a href="${resetUrl}">Reset password</a></p><p>Enter this one-time code on the reset page:</p><p style="font-size:24px;font-weight:bold;letter-spacing:5px">${otp}</p><p>The link and code expire in 15 minutes. If you did not request a reset, ignore this email.</p>`,
    });
  } catch (error) {
    console.error('Password reset email delivery failed:', error.message);
  }
  if (!sent && process.env.NODE_ENV === 'production') console.error('Password reset email is not configured; set SMTP_* variables.');
  return process.env.NODE_ENV === 'production' ? genericResponse : { ...genericResponse, debugResetUrl: resetUrl, debugOtp: otp };
}

async function resetPassword({ token, otp, password, captchaToken, remoteIp }) {
  await verifyCaptcha(captchaToken, remoteIp);
  const user = await User.findOne({ resetTokenHash: hashToken(token), resetTokenExpiresAt: { $gt: new Date() }, isActive: true })
    .select('+password +resetTokenHash +resetOtpHash +resetAttempts +resetTokenExpiresAt');
  if (!user) throw new AppError('This password reset link is invalid or expired.', 400, 'INVALID_RESET_TOKEN');
  if (user.resetAttempts >= 5) throw new AppError('Too many incorrect codes. Request a new reset link.', 400, 'RESET_OTP_LOCKED');
  const expectedOtpHash = Buffer.from(hashToken(otp), 'hex');
  const storedOtpHash = Buffer.from(user.resetOtpHash || '', 'hex');
  const otpMatches = expectedOtpHash.length === storedOtpHash.length && crypto.timingSafeEqual(expectedOtpHash, storedOtpHash);
  if (!otpMatches) {
    user.resetAttempts += 1;
    if (user.resetAttempts >= 5) {
      user.resetTokenHash = undefined;
      user.resetOtpHash = undefined;
      user.resetTokenExpiresAt = undefined;
    }
    await user.save();
    throw new AppError(user.resetAttempts >= 5 ? 'Too many incorrect codes. Request a new reset link.' : 'The verification code is incorrect.', 400, user.resetAttempts >= 5 ? 'RESET_OTP_LOCKED' : 'INVALID_RESET_OTP');
  }
  user.password = await bcrypt.hash(password, 12);
  user.passwordChangedAt = new Date();
  user.resetTokenHash = undefined;
  user.resetOtpHash = undefined;
  user.resetAttempts = 0;
  user.resetTokenExpiresAt = undefined;
  await user.save();
  await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { message: 'Password reset successfully. Please sign in again.' };
}

async function updateProfile(userId, name) {
  const user = await User.findByIdAndUpdate(userId, { $set: { name } }, { new: true, runValidators: true });
  return safeUser(user);
}

module.exports = { register, login, refresh, logout, forgotPassword, resetPassword, updateProfile, safeUser };
