const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const AppError = require('../utils/AppError');
const slugify = require('../utils/slug');
const { createAccessToken, createOpaqueToken, hashToken } = require('../utils/tokenUtils');
const refreshCookieOptions = require('../utils/cookieOptions');
const { sendEmail } = require('./mailerService');
const { verifyCaptcha } = require('./captchaService');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const RefreshToken = require('../models/RefreshToken');
const Invitation = require('../models/Invitation');
const { recordActivity } = require('./activityService');
const { logger } = require('../config/logger');

async function recordSecurityEvent(userId, action, message) {
  const memberships = await Membership.find({ user: userId, status: 'ACTIVE' }).select('_id organization');
  await Promise.all(memberships.map((membership) => recordActivity({
    organization: membership.organization,
    actor: userId,
    action,
    message,
    targetType: 'MEMBERSHIP',
    targetId: membership._id,
  })));
}

const safeUser = (user) => ({ _id: user._id, name: user.name, email: user.email, emailVerified: Boolean(user.emailVerifiedAt), createdAt: user.createdAt });
const cookieName = () => process.env.COOKIE_NAME || 'teamflow_refresh';
const emailVerificationRequired = () => process.env.REQUIRE_EMAIL_VERIFICATION === 'true';

function verificationUrl(token) {
  return `${process.env.CLIENT_URL || 'http://localhost:5173'}/verify-email?token=${encodeURIComponent(token)}`;
}

async function deliverVerificationEmail(user, token) {
  const url = verificationUrl(token);
  return sendEmail({
    to: user.email,
    subject: 'Verify your TeamFlow email',
    text: `Verify your email address to finish setting up TeamFlow: ${url}\n\nThis link expires in 24 hours.`,
    html: `<p>Verify your email address to finish setting up TeamFlow:</p><p><a href="${url}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

async function newOrganization(name, userId) {
  const base = slugify(name);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const slug = attempt ? `${base}-${crypto.randomBytes(2).toString('hex')}` : base;
    if (!await Organization.exists({ slug })) return Organization.create({ name, slug, createdBy: userId, usageCounters: { memberSeats: 1, projects: 0 } });
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
  let invitationClaimedAt;
  try {
    let organization;
    if (invitation) {
      invitationClaimedAt = new Date();
      const claimedInvitation = await Invitation.findOneAndUpdate(
        { _id: invitation._id, status: 'PENDING', expiresAt: { $gt: invitationClaimedAt } },
        { $set: { status: 'ACCEPTED', acceptedAt: invitationClaimedAt } },
        { new: true },
      ).select('+tokenHash');
      if (!claimedInvitation) {
        invitationClaimedAt = undefined;
        throw new AppError('This invitation has already been used or has expired.', 400, 'INVALID_INVITATION');
      }
      organization = await Organization.findOne({ _id: invitation.organization, isActive: true });
      if (!organization) throw new AppError('This workspace is unavailable.', 404, 'ORGANIZATION_NOT_FOUND');
      await Membership.findOneAndUpdate(
        { user: user._id, organization: invitation.organization },
        { $set: { role: claimedInvitation.role, status: 'ACTIVE' }, $setOnInsert: { invitedBy: claimedInvitation.invitedBy } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    } else {
      organization = await newOrganization(input.organizationName, user._id);
      await Membership.create({ user: user._id, organization: organization._id, role: 'ADMIN' });
    }
    const verificationToken = createOpaqueToken();
    user.emailVerificationTokenHash = hashToken(verificationToken);
    user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();
    let verificationSent = false;
    try {
      verificationSent = await deliverVerificationEmail(user, verificationToken);
    } catch (_error) {
      if (emailVerificationRequired()) throw new AppError('Verification email could not be sent. Please try again later.', 503, 'EMAIL_DELIVERY_UNAVAILABLE');
    }
    if (emailVerificationRequired() && !verificationSent) {
      throw new AppError('Verification email could not be sent. Please try again later.', 503, 'EMAIL_DELIVERY_UNAVAILABLE');
    }
    const session = emailVerificationRequired() ? null : await createSession(user, req, res);
    return {
      ...(session || { user: safeUser(user) }),
      organization: { _id: organization._id, name: organization.name, slug: organization.slug },
      verificationRequired: emailVerificationRequired(),
      ...(!verificationSent && process.env.NODE_ENV !== 'production' ? { debugVerificationToken: verificationToken } : {}),
    };
  } catch (error) {
    if (invitation && invitationClaimedAt) {
      await Invitation.updateOne({ _id: invitation._id, status: 'ACCEPTED', acceptedAt: invitationClaimedAt }, { $set: { status: 'PENDING' }, $unset: { acceptedAt: 1 } });
    }
    await Promise.all([Membership.deleteMany({ user: user._id }), Organization.deleteMany({ createdBy: user._id }), User.findByIdAndDelete(user._id)]);
    throw error;
  }
}

async function login(input, req, res) {
  const user = await User.findOne({ email: input.email, isActive: true }).select('+password');
  const passwordMatches = user ? await bcrypt.compare(input.password, user.password) : false;
  if (!passwordMatches) throw new AppError('Email or password is incorrect.', 401, 'INVALID_CREDENTIALS');
  if (emailVerificationRequired() && !user.emailVerifiedAt) throw new AppError('Verify your email before signing in.', 403, 'EMAIL_NOT_VERIFIED');
  const session = await createSession(user, req, res);
  try { await recordSecurityEvent(user._id, 'USER_LOGIN', 'signed in'); }
  catch (error) { logger.warn({ errorName: error?.name }, 'Could not save login audit event'); }
  return session;
}

async function verifyEmail(token) {
  const user = await User.findOneAndUpdate({
    emailVerificationTokenHash: hashToken(token),
    emailVerificationExpiresAt: { $gt: new Date() },
    isActive: true,
  }, {
    $set: { emailVerifiedAt: new Date() },
    $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1 },
  }, { new: true });
  if (!user) throw new AppError('This verification link is invalid or expired.', 400, 'INVALID_VERIFICATION_TOKEN');
  return safeUser(user);
}

async function resendVerification(email) {
  const genericResponse = { message: 'If an unverified account exists for this email, a verification link will be sent shortly.' };
  const user = await User.findOne({ email, isActive: true });
  if (!user || user.emailVerifiedAt) return genericResponse;
  const token = createOpaqueToken();
  user.emailVerificationTokenHash = hashToken(token);
  user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save();
  try {
    await deliverVerificationEmail(user, token);
  } catch (_error) {
    if (process.env.NODE_ENV === 'production') return genericResponse;
  }
  return process.env.NODE_ENV === 'production' ? genericResponse : { ...genericResponse, debugVerificationToken: token };
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
  if (emailVerificationRequired() && !user.emailVerifiedAt) {
    await RefreshToken.updateMany({ familyId: current.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw new AppError('Verify your email before signing in.', 403, 'EMAIL_NOT_VERIFIED');
  }
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
  let userId;
  if (token) {
    const session = await RefreshToken.findOne({ tokenHash: hashToken(token), revokedAt: null }).select('user');
    userId = session?.user;
    await RefreshToken.updateOne({ tokenHash: hashToken(token), revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
  res.clearCookie(cookieName(), { ...refreshCookieOptions(), maxAge: undefined });
  if (userId) {
    try { await recordSecurityEvent(userId, 'USER_LOGOUT', 'signed out'); }
    catch (error) { logger.warn({ errorName: error?.name }, 'Could not save logout audit event'); }
  }
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
    logger.warn({ errorName: error?.name }, 'Password reset email delivery failed');
  }
  if (!sent && process.env.NODE_ENV === 'production') logger.error('Password reset email is not configured; set SMTP_* variables.');
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
    const attempt = await User.findOneAndUpdate({
      _id: user._id,
      resetTokenHash: hashToken(token),
      resetTokenExpiresAt: { $gt: new Date() },
      resetAttempts: { $lt: 5 },
    }, { $inc: { resetAttempts: 1 } }, { new: true }).select('+resetAttempts');
    const latestUser = attempt || await User.findById(user._id).select('+resetAttempts');
    const attempts = latestUser?.resetAttempts ?? user.resetAttempts;
    const locked = attempts >= 5;
    if (locked) {
      await User.updateOne({ _id: user._id, resetTokenHash: hashToken(token), resetAttempts: { $gte: 5 } }, {
        $unset: { resetTokenHash: 1, resetOtpHash: 1, resetTokenExpiresAt: 1 },
      });
    }
    throw new AppError(locked ? 'Too many incorrect codes. Request a new reset link.' : 'The verification code is incorrect.', 400, locked ? 'RESET_OTP_LOCKED' : 'INVALID_RESET_OTP');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const resetUser = await User.findOneAndUpdate({
    _id: user._id,
    resetTokenHash: hashToken(token),
    resetOtpHash: hashToken(otp),
    resetTokenExpiresAt: { $gt: new Date() },
    resetAttempts: { $lt: 5 },
    isActive: true,
  }, {
    $set: { password: passwordHash, passwordChangedAt: new Date(), resetAttempts: 0 },
    $inc: { tokenVersion: 1 },
    $unset: { resetTokenHash: 1, resetOtpHash: 1, resetTokenExpiresAt: 1 },
  }, { new: true });
  if (!resetUser) throw new AppError(user.resetAttempts >= 5 ? 'Too many incorrect codes. Request a new reset link.' : 'This password reset link is invalid or expired.', 400, user.resetAttempts >= 5 ? 'RESET_OTP_LOCKED' : 'INVALID_RESET_TOKEN');
  await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { message: 'Password reset successfully. Please sign in again.' };
}

async function updateProfile(userId, name) {
  const user = await User.findByIdAndUpdate(userId, { $set: { name } }, { new: true, runValidators: true });
  return safeUser(user);
}

module.exports = { register, login, verifyEmail, resendVerification, refresh, logout, forgotPassword, resetPassword, updateProfile, safeUser };
