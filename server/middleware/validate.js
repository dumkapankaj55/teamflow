const AppError = require('../utils/AppError');

function validate(schemas) {
  return (req, _res, next) => {
    try {
      req.validated = {
        body: schemas.body ? schemas.body.parse(req.body) : req.body,
        params: schemas.params ? schemas.params.parse(req.params) : req.params,
        query: schemas.query ? schemas.query.parse(req.query) : req.query,
      };
      return next();
    } catch (error) {
      if (error.issues) {
        return next(new AppError('Request validation failed.', 400, 'VALIDATION_ERROR', error.issues.map((issue) => ({
          field: issue.path.join('.'), message: issue.message,
        }))));
      }
      return next(error);
    }
  };
}

module.exports = validate;
