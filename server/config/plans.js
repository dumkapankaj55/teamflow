const plans = {
  FREE: { id: 'FREE', name: 'Free', members: 5, projects: 3, storageBytes: 100 * 1024 * 1024, features: { auditHistory: true, advancedAnalytics: true } },
  PRO: { id: 'PRO', name: 'Pro', members: 25, projects: 50, storageBytes: 10 * 1024 * 1024 * 1024, features: { auditHistory: true, advancedAnalytics: true } },
  ENTERPRISE: { id: 'ENTERPRISE', name: 'Enterprise', members: Infinity, projects: Infinity, storageBytes: Infinity, features: { auditHistory: true, advancedAnalytics: true } },
};

module.exports = plans;
