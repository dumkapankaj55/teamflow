const express = require('express');
const controller = require('../controllers/projectController');
const authenticate = require('../middleware/authenticate');
const requireMembership = require('../middleware/requireMembership');
const authorizeRoles = require('../middleware/authorizeRoles');
const validate = require('../middleware/validate');
const validators = require('../validators/projectValidators');

const router = express.Router();
router.use(authenticate, requireMembership);
router.post('/', authorizeRoles('ADMIN', 'MANAGER'), validate({ body: validators.create }), controller.create);
router.get('/', validate({ query: validators.list }), controller.list);
router.get('/:id', validate({ params: validators.id }), controller.get);
router.patch('/:id', authorizeRoles('ADMIN', 'MANAGER'), validate({ params: validators.id, body: validators.update }), controller.update);
router.delete('/:id', authorizeRoles('ADMIN'), validate({ params: validators.id }), controller.remove);

module.exports = router;
