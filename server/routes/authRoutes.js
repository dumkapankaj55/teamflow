const express = require('express');
const controller = require('../controllers/authController');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const validators = require('../validators/authValidators');
const verifyTrustedOrigin = require('../middleware/verifyTrustedOrigin');

const router = express.Router();
router.post('/register', validate({ body: validators.register }), controller.register);
router.post('/login', validate({ body: validators.login }), controller.login);
router.post('/refresh', verifyTrustedOrigin, controller.refresh);
router.post('/logout', verifyTrustedOrigin, controller.logout);
router.get('/me', authenticate, controller.me);
router.patch('/me', authenticate, validate({ body: validators.updateProfile }), controller.updateProfile);
router.post('/forgot-password', validate({ body: validators.forgotPassword }), controller.forgotPassword);
router.post('/reset-password', validate({ body: validators.resetPassword }), controller.resetPassword);

module.exports = router;
