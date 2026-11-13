const express = require('express');
const controller = require('../controllers/analyticsController');
const authenticate = require('../middleware/authenticate');
const requireMembership = require('../middleware/requireMembership');
const authorizeRoles = require('../middleware/authorizeRoles');
const requirePlanFeature = require('../middleware/requirePlanFeature');

const router = express.Router();
router.use(authenticate, requireMembership);
router.get('/overview', controller.overview);
router.get('/tasks', authorizeRoles('ADMIN', 'MANAGER'), requirePlanFeature('advancedAnalytics'), controller.tasks);
router.get('/projects', authorizeRoles('ADMIN', 'MANAGER'), requirePlanFeature('advancedAnalytics'), controller.projects);
router.get('/team', authorizeRoles('ADMIN', 'MANAGER'), requirePlanFeature('advancedAnalytics'), controller.team);

module.exports = router;
