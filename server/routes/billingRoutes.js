const express = require('express');
const { z } = require('../validators/common');
const authenticate = require('../middleware/authenticate');
const requireMembership = require('../middleware/requireMembership');
const authorizeRoles = require('../middleware/authorizeRoles');
const validate = require('../middleware/validate');
const controller = require('../controllers/billingController');

const router = express.Router();
router.get('/plans', controller.plans);
router.use(authenticate, requireMembership);
router.get('/', controller.summary);
router.post('/checkout', authorizeRoles('ADMIN'), validate({ body: z.object({ plan: z.enum(['PRO', 'ENTERPRISE']) }).strict() }), controller.checkout);
router.post('/portal', authorizeRoles('ADMIN'), controller.portal);
router.post('/cancel', authorizeRoles('ADMIN'), controller.cancel);

module.exports = router;
