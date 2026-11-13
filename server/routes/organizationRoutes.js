const express = require('express');
const controller = require('../controllers/organizationController');
const authenticate = require('../middleware/authenticate');
const requireMembership = require('../middleware/requireMembership');
const authorizeRoles = require('../middleware/authorizeRoles');
const validate = require('../middleware/validate');
const validators = require('../validators/organizationValidators');

const router = express.Router();
router.post('/', authenticate, validate({ body: validators.create }), controller.create);
router.get('/', authenticate, controller.list);
router.get('/:id', authenticate, requireMembership, validate({ params: validators.id }), controller.get);
router.patch('/:id', authenticate, requireMembership, authorizeRoles('ADMIN'), validate({ params: validators.id, body: validators.update }), controller.update);
router.get('/:id/members', authenticate, requireMembership, validate({ params: validators.id }), controller.members);
router.post('/:id/invitations', authenticate, requireMembership, authorizeRoles('ADMIN'), validate({ params: validators.id, body: validators.invite }), controller.invite);
router.patch('/:id/members/:userId', authenticate, requireMembership, authorizeRoles('ADMIN'), validate({ params: validators.memberParams, body: validators.changeRole }), controller.changeRole);
router.delete('/:id/members/:userId', authenticate, requireMembership, authorizeRoles('ADMIN'), validate({ params: validators.memberParams }), controller.removeMember);

module.exports = router;
