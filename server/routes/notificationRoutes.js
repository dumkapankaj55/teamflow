const express = require('express');
const { z, objectId, pageQuery } = require('../validators/common');
const controller = require('../controllers/notificationController');
const authenticate = require('../middleware/authenticate');
const requireMembership = require('../middleware/requireMembership');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(authenticate, requireMembership);
router.get('/', validate({ query: pageQuery }), controller.list);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', validate({ params: z.object({ id: objectId }) }), controller.markRead);

module.exports = router;
