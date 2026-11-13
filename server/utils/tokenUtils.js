const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const AppError = require('./AppError');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const createOpaqueToken = () => crypto.randomBytes(48).toString('base64url');
const createAccessToken = (user) => {
  if (!process.env.ACCESS_TOKEN_SECRET) throw new AppError('Authentication is not configured.', 500, 'AUTH_CONFIG_ERROR');
  return jwt.sign({ sub: user._id.toString(), email: user.email, ver: Number(user.tokenVersion || 0) }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_TTL || '15m',
    issuer: 'teamflow-api',
    audience: 'teamflow-client',
  });
};

module.exports = { hashToken, createOpaqueToken, createAccessToken };
