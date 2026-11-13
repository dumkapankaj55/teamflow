const AppError = require('../utils/AppError');
const { logger } = require('../config/logger');

module.exports = (err, req, res, _next) => {
  let error = err;
  if (err?.name === 'ValidationError' || err?.name === 'CastError' || err?.code === 11000) {
    const duplicate = err.code === 11000;
    const details = !duplicate && err.errors ? Object.entries(err.errors).map(([field, issue]) => ({ field, message: issue.message })) : undefined;
    error = new AppError(duplicate ? 'A record with that value already exists.' : 'The provided data is invalid.', duplicate ? 409 : 400, duplicate ? 'DUPLICATE_RECORD' : 'DATABASE_VALIDATION_ERROR', details);
  } else if (!(err instanceof AppError)) {
    const message = process.env.NODE_ENV === 'development' && err?.message
      ? err.message
      : 'An unexpected server error occurred.';
    error = new AppError(message, 500, 'INTERNAL_ERROR');
  }
  if (error.statusCode >= 500) {
    req.log?.error({ errorName: err?.name, errorCode: err?.code, requestId: req.id }, 'API request failed');
    if (!req.log) logger.error({ errorName: err?.name, errorCode: err?.code, requestId: req.id }, 'API request failed');
  }
  return res.status(error.statusCode).json({
    success: false,
    message: error.message,
    code: error.code,
    ...(error.details ? { errors: error.details } : {}),
    ...(req.id ? { requestId: req.id } : {}),
  });
};
