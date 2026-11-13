const AppError = require('../utils/AppError');

module.exports = (req, _res, next) => next(new AppError(`Route ${req.method} ${req.originalUrl} was not found.`, 404, 'NOT_FOUND'));
