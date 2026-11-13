const express = require('express');
const controller = require('../controllers/organizationController');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const validators = require('../validators/organizationValidators');

const router = express.Router();
router.post('/:token/accept', authenticate, validate({ params: validators.acceptInviteParams }), controller.acceptInvitation);

module.exports = router;
