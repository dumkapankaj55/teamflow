const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

module.exports = asyncHandler(async (req, _res, next) => {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError('Sign in to continue.', 401, 'UNAUTHENTICATED');
  if (!process.env.ACCESS_TOKEN_SECRET) throw new AppError('Authentication is not configured.', 500, 'AUTH_CONFIG_ERROR');
  let payload;
  try {
    payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, { issuer: 'teamflow-api', audience: 'teamflow-client' });
  } catch (_error) {
    throw new AppError('Your session has expired. Please sign in again.', 401, 'INVALID_ACCESS_TOKEN');
  }
  const user = await User.findById(payload.sub).select('_id name email isActive');
  if (!user || !user.isActive) throw new AppError('Your account is unavailable.', 401, 'ACCOUNT_UNAVAILABLE');
  req.user = user;
  next();
});
