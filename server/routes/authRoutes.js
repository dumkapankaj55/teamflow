const express = require('express');
const controller = require('../controllers/authController');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const validators = require('../validators/authValidators');
const verifyTrustedOrigin = require('../middleware/verifyTrustedOrigin');
const { rateLimit } = require('express-rate-limit');

const router = express.Router();
const sensitiveAuthLimit = () => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'Too many requests. Try again later.' },
});
const verifyEmailLimit = sensitiveAuthLimit();
const resendVerificationLimit = sensitiveAuthLimit();
const forgotPasswordLimit = sensitiveAuthLimit();
const resetPasswordLimit = sensitiveAuthLimit();
router.post('/register', validate({ body: validators.register }), controller.register);
router.post('/login', validate({ body: validators.login }), controller.login);
router.post('/verify-email', verifyEmailLimit, validate({ body: validators.verifyEmail }), controller.verifyEmail);
router.post('/resend-verification', resendVerificationLimit, validate({ body: validators.resendVerification }), controller.resendVerification);
router.post('/refresh', verifyTrustedOrigin, controller.refresh);
router.post('/logout', verifyTrustedOrigin, controller.logout);
router.get('/me', authenticate, controller.me);
router.patch('/me', authenticate, validate({ body: validators.updateProfile }), controller.updateProfile);
router.post('/forgot-password', forgotPasswordLimit, validate({ body: validators.forgotPassword }), controller.forgotPassword);
router.post('/reset-password', resetPasswordLimit, validate({ body: validators.resetPassword }), controller.resetPassword);

module.exports = router;
