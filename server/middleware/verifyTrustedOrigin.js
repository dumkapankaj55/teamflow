const AppError = require('../utils/AppError');

module.exports = (req, _res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();
  const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  const origin = req.get('origin');
  if (!origin || !allowedOrigins.includes(origin)) return next(new AppError('Request origin is not allowed.', 403, 'ORIGIN_FORBIDDEN'));
  return next();
};
