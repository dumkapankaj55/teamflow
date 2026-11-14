const crypto = require('crypto');
const http = require('http');
const { io: connectSocket } = require('socket.io-client');
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || crypto.randomBytes(40).toString('hex');
process.env.NODE_ENV = 'test';

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const User = require('../models/User');
const Membership = require('../models/Membership');
const Invitation = require('../models/Invitation');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const RefreshToken = require('../models/RefreshToken');
const StripeEvent = require('../models/StripeEvent');
const BillingPayment = require('../models/BillingPayment');
const Subscription = require('../models/Subscription');
const { initializeSocket, closeSocket } = require('../services/socketService');
const { notify } = require('../services/notificationService');
const billingService = require('../services/billingService');

const testDatabase = `teamflow_integration_${process.pid}_${Date.now()}`;
const testUri = `mongodb://127.0.0.1:27017/${testDatabase}`;
const headers = (token, organizationId) => ({ Authorization: `Bearer ${token}`, 'X-Organization-Id': organizationId });

async function register({ name = 'Jamie Lee', email = `user-${crypto.randomUUID()}@example.com`, password = 'correct-horse-battery7!', organizationName, invitationToken }) {
  const response = await request(app).post('/api/v1/auth/register').send({ name, email, password, ...(organizationName ? { organizationName } : {}), ...(invitationToken ? { invitationToken } : {}) });
  expect(response.status).toBe(201);
  return { response, token: response.body.data.accessToken, user: response.body.data.user, organization: response.body.data.organization };
}

describe('TeamFlow SaaS workflows', () => {
  beforeAll(async () => {
    await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  });

  beforeEach(async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it('registers a secure account and rotates a single-use refresh session', async () => {
    const account = await register({ organizationName: 'Rotation Workspace' });
    expect(account.response.body.data.user).not.toHaveProperty('password');
    expect(account.response.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(await User.countDocuments()).toBe(1);
    expect(await Membership.countDocuments({ user: account.user._id, role: 'ADMIN' })).toBe(1);

    const originalCookie = account.response.headers['set-cookie'][0].split(';')[0];
    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', originalCookie);
    expect(rotated.status).toBe(200);
    expect(rotated.headers['set-cookie'][0]).not.toContain(originalCookie);
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', originalCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('REFRESH_TOKEN_REUSE');
    expect(await RefreshToken.countDocuments({ revokedAt: { $ne: null } })).toBeGreaterThan(0);
  });

  it('verifies email using a single-use hashed verification token', async () => {
    const account = await register({ organizationName: 'Verification Workspace' });
    const token = account.response.body.data.debugVerificationToken;
    expect(token).toEqual(expect.any(String));
    const verification = await request(app).post('/api/v1/auth/verify-email').send({ token });
    expect(verification.status).toBe(200);
    expect(verification.body.data.user.emailVerified).toBe(true);
    const storedUser = await User.findById(account.user._id).select('+emailVerificationTokenHash');
    expect(storedUser.emailVerifiedAt).toEqual(expect.any(Date));
    expect(storedUser.emailVerificationTokenHash).toBeUndefined();
    const replay = await request(app).post('/api/v1/auth/verify-email').send({ token });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('allows only one concurrent use of an email verification link', async () => {
    const account = await register({ organizationName: 'Verification Race Workspace' });
    const token = account.response.body.data.debugVerificationToken;
    const responses = await Promise.all([
      request(app).post('/api/v1/auth/verify-email').send({ token }),
      request(app).post('/api/v1/auth/verify-email').send({ token }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(await User.exists({ _id: account.user._id, emailVerifiedAt: { $type: 'date' } })).toBeTruthy();
  });

  it('blocks unverified accounts from signing in or using existing access tokens when verification is required', async () => {
    const account = await register({ organizationName: 'Verified Access Workspace' });
    const previousSetting = process.env.REQUIRE_EMAIL_VERIFICATION;
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    try {
      const login = await request(app).post('/api/v1/auth/login').send({ email: account.user.email, password: 'correct-horse-battery7!' });
      expect(login.status).toBe(403);
      expect(login.body.code).toBe('EMAIL_NOT_VERIFIED');
      const profile = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${account.token}`);
      expect(profile.status).toBe(403);
      expect(profile.body.code).toBe('EMAIL_NOT_VERIFIED');
    } finally {
      if (previousSetting === undefined) delete process.env.REQUIRE_EMAIL_VERIFICATION;
      else process.env.REQUIRE_EMAIL_VERIFICATION = previousSetting;
    }
  });

  it('sends password reset links without storing or accepting plaintext reset tokens', async () => {
    const account = await register({ organizationName: 'Password Workspace' });
    const resetRequest = await request(app).post('/api/v1/auth/forgot-password').send({ email: account.user.email });
    expect(resetRequest.status).toBe(200);
    const resetUrl = new URL(resetRequest.body.data.debugResetUrl);
    const resetToken = resetUrl.searchParams.get('token');
    const otp = resetRequest.body.data.debugOtp;
    expect(otp).toMatch(/^\d{6}$/);
    const storedUser = await User.findById(account.user._id).select('+resetTokenHash +resetOtpHash');
    expect(storedUser.resetTokenHash).not.toBe(resetToken);
    expect(storedUser.resetOtpHash).not.toBe(otp);

    const wrongOtp = otp === '000000' ? '000001' : '000000';
    const rejectedCode = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, otp: wrongOtp, password: 'new-correct-password7!', captchaToken: 'test-captcha-token' });
    expect(rejectedCode.status).toBe(400);
    expect(rejectedCode.body.code).toBe('INVALID_RESET_OTP');
    const weakPassword = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, otp, password: 'no-number-or-symbol', captchaToken: 'test-captcha-token' });
    expect(weakPassword.status).toBe(400);
    expect(weakPassword.body.code).toBe('VALIDATION_ERROR');

    const reset = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, otp, password: 'new-correct-password7!', captchaToken: 'test-captcha-token' });
    expect(reset.status).toBe(200);
    const revokedAccessToken = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${account.token}`);
    expect(revokedAccessToken.status).toBe(401);
    expect(revokedAccessToken.body.code).toBe('ACCESS_TOKEN_REVOKED');
    const oldPassword = await request(app).post('/api/v1/auth/login').send({ email: account.user.email, password: 'correct-horse-battery7!' });
    const newPassword = await request(app).post('/api/v1/auth/login').send({ email: account.user.email, password: 'new-correct-password7!' });
    expect(oldPassword.status).toBe(401);
    expect(newPassword.status).toBe(200);
  });

  it('locks a reset link after five incorrect email codes', async () => {
    const account = await register({ organizationName: 'OTP Lock Workspace' });
    const resetRequest = await request(app).post('/api/v1/auth/forgot-password').send({ email: account.user.email });
    const resetToken = new URL(resetRequest.body.data.debugResetUrl).searchParams.get('token');
    const otp = resetRequest.body.data.debugOtp;
    const wrongOtp = otp === '999999' ? '999998' : '999999';

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, otp: wrongOtp, password: 'new-password9!', captchaToken: 'test-captcha-token' });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(attempt === 5 ? 'RESET_OTP_LOCKED' : 'INVALID_RESET_OTP');
    }
    const locked = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, otp, password: 'new-password9!', captchaToken: 'test-captcha-token' });
    expect(locked.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('counts simultaneous incorrect reset codes atomically and locks the link', async () => {
    const account = await register({ organizationName: 'Concurrent Reset Workspace' });
    const resetRequest = await request(app).post('/api/v1/auth/forgot-password').send({ email: account.user.email });
    const resetToken = new URL(resetRequest.body.data.debugResetUrl).searchParams.get('token');
    const otp = resetRequest.body.data.debugOtp;
    const wrongOtp = otp === '000000' ? '111111' : '000000';
    const attempts = await Promise.all(Array.from({ length: 8 }, () => request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, otp: wrongOtp, password: 'new-password9!', captchaToken: 'test-captcha-token' })));

    expect(attempts.every((response) => response.status === 400)).toBe(true);
    expect(attempts.some((response) => response.body.code === 'RESET_OTP_LOCKED')).toBe(true);
    const storedUser = await User.findById(account.user._id).select('+resetTokenHash +resetAttempts');
    expect(storedUser.resetTokenHash).toBeUndefined();
    expect(storedUser.resetAttempts).toBe(5);
  });

  it('accepts an invitation once when simultaneous requests race', async () => {
    const admin = await register({ organizationName: 'Invite Race Workspace' });
    const invitee = await register({ email: 'racing-invitee@example.test', organizationName: 'Invitee Workspace' });
    const created = await request(app).post(`/api/v1/organizations/${admin.organization._id}/invitations`)
      .set(headers(admin.token, admin.organization._id)).send({ email: invitee.user.email, role: 'MEMBER' });
    expect(created.status).toBe(201);
    const token = new URL(created.body.data.invitation.inviteUrl).searchParams.get('token');
    const responses = await Promise.all([
      request(app).post(`/api/v1/invitations/${token}/accept`).set(`Authorization`, `Bearer ${invitee.token}`),
      request(app).post(`/api/v1/invitations/${token}/accept`).set(`Authorization`, `Bearer ${invitee.token}`),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(await Membership.countDocuments({ organization: admin.organization._id, user: invitee.user._id, status: 'ACTIVE' })).toBe(1);
    expect(await Invitation.countDocuments({ organization: admin.organization._id, status: 'ACCEPTED' })).toBe(1);
  });

  it('isolates projects and tasks between organizations and enforces member permissions', async () => {
    const admin = await register({ organizationName: 'Northstar Workspace' });
    const organizationId = admin.organization._id;
    const inviteResponse = await request(app).post(`/api/v1/organizations/${organizationId}/invitations`)
      .set(headers(admin.token, organizationId)).send({ email: 'member@example.com', role: 'MEMBER' });
    expect(inviteResponse.status).toBe(201);
    const invitationUrl = new URL(inviteResponse.body.data.invitation.inviteUrl);
    const member = await register({ email: 'member@example.com', invitationToken: invitationUrl.searchParams.get('token') });
    expect(member.organization._id).toBe(organizationId);

    const projectResponse = await request(app).post('/api/v1/projects').set(headers(admin.token, organizationId)).send({ name: 'Customer launch', description: 'Launch project' });
    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.project._id;
    const taskResponse = await request(app).post('/api/v1/tasks').set(headers(admin.token, organizationId)).send({ title: 'Review launch plan', projectId, assignedTo: member.user._id, priority: 'HIGH' });
    expect(taskResponse.status).toBe(201);
    const taskId = taskResponse.body.data.task._id;
    const unassignedTask = await request(app).post('/api/v1/tasks').set(headers(admin.token, organizationId)).send({ title: 'Prepare release checklist', projectId });
    expect(unassignedTask.status).toBe(201);
    const privateProject = await request(app).post('/api/v1/projects').set(headers(admin.token, organizationId)).send({ name: 'Admin-only planning' });
    const privateTask = await request(app).post('/api/v1/tasks').set(headers(admin.token, organizationId)).send({ title: 'Confidential budget review', projectId: privateProject.body.data.project._id });
    expect(privateTask.status).toBe(201);

    const memberTasks = await request(app).get('/api/v1/tasks?mine=true').set(headers(member.token, organizationId));
    expect(memberTasks.status).toBe(200);
    expect(memberTasks.body.data.tasks.map((task) => task._id)).toContain(taskId);
    expect(memberTasks.body.data.tasks.map((task) => task._id)).not.toContain(unassignedTask.body.data.task._id);
    const memberProjectTasks = await request(app).get(`/api/v1/tasks?projectId=${projectId}`).set(headers(member.token, organizationId));
    expect(memberProjectTasks.status).toBe(200);
    expect(memberProjectTasks.body.data.tasks.map((task) => task._id)).toEqual(expect.arrayContaining([taskId, unassignedTask.body.data.task._id]));
    const privateTaskSearch = await request(app).get('/api/v1/tasks?search=Confidential').set(headers(member.token, organizationId));
    expect(privateTaskSearch.status).toBe(200);
    expect(privateTaskSearch.body.data.tasks).toHaveLength(0);
    const updateStatus = await request(app).patch(`/api/v1/tasks/${taskId}`).set(headers(member.token, organizationId)).send({ status: 'IN_PROGRESS' });
    expect(updateStatus.status).toBe(200);
    const forbiddenEdit = await request(app).patch(`/api/v1/tasks/${taskId}`).set(headers(member.token, organizationId)).send({ title: 'Try to change the task title' });
    expect(forbiddenEdit.status).toBe(403);
    const forbiddenProject = await request(app).post('/api/v1/projects').set(headers(member.token, organizationId)).send({ name: 'Unauthorized project' });
    expect(forbiddenProject.status).toBe(403);

    const comment = await request(app).post(`/api/v1/tasks/${taskId}/comments`).set(headers(member.token, organizationId)).send({ body: `I reviewed this and left a note. @${admin.user.email}` });
    if (comment.status !== 201) throw new Error(JSON.stringify(comment.body));
    expect(comment.status).toBe(201);
    expect(await Comment.countDocuments({ organization: organizationId, task: taskId })).toBe(1);
    expect(await ActivityLog.countDocuments({ organization: organizationId, task: taskId })).toBeGreaterThanOrEqual(3);
    expect(await Notification.countDocuments({ organization: organizationId, user: member.user._id })).toBeGreaterThanOrEqual(1);
    expect(await Notification.exists({ organization: organizationId, user: admin.user._id, type: 'MENTIONED', task: taskId })).toBeTruthy();
    const deadlineChange = await request(app).patch(`/api/v1/tasks/${taskId}`).set(headers(admin.token, organizationId)).send({ dueDate: '2030-01-01T00:00:00.000Z' });
    expect(deadlineChange.status).toBe(200);
    expect(await Notification.exists({ organization: organizationId, user: member.user._id, task: taskId, type: 'DEADLINE_CHANGED' })).toBeTruthy();
    const markDone = await request(app).patch(`/api/v1/tasks/${taskId}`).set(headers(member.token, organizationId)).send({ status: 'DONE' });
    expect(markDone.status).toBe(200);
    expect(await Notification.exists({ organization: organizationId, user: admin.user._id, task: taskId, type: 'TASK_COMPLETED' })).toBeTruthy();
    const memberOverview = await request(app).get('/api/v1/analytics/overview').set(headers(member.token, organizationId));
    expect(memberOverview.status).toBe(200);
    expect(JSON.stringify(memberOverview.body.data.recentActivity)).not.toContain('Confidential budget review');

    const otherAccount = await register({ organizationName: 'Orchard Workspace' });
    const otherOrganizationId = otherAccount.organization._id;
    const otherProjects = await request(app).get('/api/v1/projects').set(headers(otherAccount.token, otherOrganizationId));
    expect(otherProjects.status).toBe(200);
    expect(otherProjects.body.data.projects).toHaveLength(0);
    const hiddenProject = await request(app).get(`/api/v1/projects/${projectId}`).set(headers(otherAccount.token, otherOrganizationId));
    expect(hiddenProject.status).toBe(404);
    const wrongTenantHeader = await request(app).get('/api/v1/projects').set(headers(otherAccount.token, organizationId));
    expect(wrongTenantHeader.status).toBe(403);

    const thirdProject = await request(app).post('/api/v1/projects').set(headers(admin.token, organizationId)).send({ name: 'Third project' });
    expect(thirdProject.status).toBe(201);
    const overLimit = await request(app).post('/api/v1/projects').set(headers(admin.token, organizationId)).send({ name: 'Fourth project' });
    expect(overLimit.status).toBe(402);
    expect(overLimit.body.code).toBe('PLAN_PROJECT_LIMIT');

    const audit = await request(app).get(`/api/v1/organizations/${organizationId}/audit-logs?targetType=TASK&limit=5`).set(headers(admin.token, organizationId));
    expect(audit.status).toBe(200);
    expect(audit.body.data.auditLogs.length).toBeGreaterThan(0);
    const memberAudit = await request(app).get(`/api/v1/organizations/${organizationId}/audit-logs`).set(headers(member.token, organizationId));
    expect(memberAudit.status).toBe(403);
  });

  it('reserves free-plan seats for pending invitations and reports usage', async () => {
    const admin = await register({ organizationName: 'Usage Workspace' });
    for (const index of [1, 2, 3, 4]) {
      const response = await request(app).post(`/api/v1/organizations/${admin.organization._id}/invitations`)
        .set(headers(admin.token, admin.organization._id)).send({ email: `pending-${index}@example.test`, role: 'MEMBER' });
      if (index <= 4) expect(response.status).toBe(201);
    }
    await Invitation.updateOne({ organization: admin.organization._id, email: 'pending-1@example.test' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const replacement = await request(app).post(`/api/v1/organizations/${admin.organization._id}/invitations`)
      .set(headers(admin.token, admin.organization._id)).send({ email: 'replacement@example.test', role: 'MEMBER' });
    expect(replacement.status).toBe(201);
    expect(await Invitation.findOne({ organization: admin.organization._id, email: 'pending-1@example.test' }).select('status')).toMatchObject({ status: 'EXPIRED' });
    const overLimit = await request(app).post(`/api/v1/organizations/${admin.organization._id}/invitations`)
      .set(headers(admin.token, admin.organization._id)).send({ email: 'pending-over-limit@example.test', role: 'MEMBER' });
    expect(overLimit.status).toBe(402);
    expect(overLimit.body.code).toBe('PLAN_MEMBER_LIMIT');
    const summary = await request(app).get('/api/v1/billing').set(headers(admin.token, admin.organization._id));
    expect(summary.status).toBe(200);
    expect(summary.body.data.plan.id).toBe('FREE');
    expect(summary.body.data.usage.pendingInvitations).toBe(4);
    expect(summary.body.data.limits.members).toBe(5);
    expect(summary.body.data.usage.storageBytes).toBeNull();
    expect(summary.body.data.plan.features.storageTracking).toBe(false);

    const selectedFree = await request(app).post('/api/v1/billing/free').set(headers(admin.token, admin.organization._id));
    expect(selectedFree.status).toBe(200);
    expect(selectedFree.body.data).toMatchObject({ plan: 'FREE', status: 'free', cancelAtPeriodEnd: false });
    expect(await Subscription.exists({ organization: admin.organization._id, plan: 'FREE', status: 'free' })).toBeTruthy();
  });

  it('only lets workspace admins select Free and returns a clear error for unconfigured sales enquiries', async () => {
    const admin = await register({ organizationName: 'Billing Permission Workspace' });
    const member = await register({ organizationName: 'Billing Member Workspace' });
    await Membership.create({ user: member.user._id, organization: admin.organization._id, role: 'MEMBER' });

    const forbidden = await request(app).post('/api/v1/billing/free').set(headers(member.token, admin.organization._id));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');

    const previousSalesEmail = process.env.SALES_EMAIL;
    delete process.env.SALES_EMAIL;
    let enquiry;
    try {
      enquiry = await request(app).post('/api/v1/billing/sales-enquiry')
        .set(headers(admin.token, admin.organization._id))
        .send({ message: 'We need centralized workspace administration.' });
    } finally {
      if (previousSalesEmail === undefined) delete process.env.SALES_EMAIL;
      else process.env.SALES_EMAIL = previousSalesEmail;
    }
    expect(enquiry.status).toBe(503);
    expect(enquiry.body.code).toBe('SALES_CONTACT_NOT_CONFIGURED');
  });

  it('does not expose an invitation URL when production email delivery is unavailable', async () => {
    const admin = await register({ organizationName: 'No Email Workspace' });
    const environment = Object.fromEntries(['NODE_ENV', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL'].map((key) => [key, process.env[key]]));
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    let response;
    try {
      response = await request(app).post(`/api/v1/organizations/${admin.organization._id}/invitations`)
        .set(headers(admin.token, admin.organization._id)).send({ email: 'private-invite@example.test', role: 'MEMBER' });
    } finally {
      for (const [key, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('accept-invitation?token=');
    expect(await Invitation.countDocuments({ organization: admin.organization._id, status: 'PENDING' })).toBe(0);
  });

  it('allows Free plan admins to access analytics while retaining workspace authorization', async () => {
    const admin = await register({ organizationName: 'Analytics Plan Workspace' });
    const analyticsEndpoints = ['/tasks', '/projects', '/team'];
    const freeAccess = await Promise.all(analyticsEndpoints.map((endpoint) => request(app).get(`/api/v1/analytics${endpoint}`).set(headers(admin.token, admin.organization._id))));
    expect(freeAccess.map((response) => response.status)).toEqual([200, 200, 200]);

    await Subscription.create({ organization: admin.organization._id, plan: 'PRO', status: 'active', currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    const proAccess = await Promise.all(analyticsEndpoints.map((endpoint) => request(app).get(`/api/v1/analytics${endpoint}`).set(headers(admin.token, admin.organization._id))));
    expect(proAccess.map((response) => response.status)).toEqual([200, 200, 200]);

    const otherWorkspace = await register({ organizationName: 'Other Analytics Workspace' });
    const wrongWorkspace = await request(app).get('/api/v1/analytics/tasks').set(headers(admin.token, otherWorkspace.organization._id));
    expect(wrongWorkspace.status).toBe(403);
    expect(wrongWorkspace.body.code).toBe('ORGANIZATION_ACCESS_DENIED');
  });

  it('verifies Stripe event signatures and processes webhook event IDs idempotently', async () => {
    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(() => billingService.verifyWebhook(Buffer.from('{}'), 'signature')).toThrow(expect.objectContaining({ code: 'BILLING_WEBHOOK_NOT_CONFIGURED' }));
    if (previousSecret !== undefined) process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    const event = { id: `evt_${crypto.randomUUID()}`, type: 'customer.updated', data: { object: {} } };
    expect(await billingService.processStripeEvent(event)).toEqual({ duplicate: false });
    expect(await billingService.processStripeEvent(event)).toEqual({ duplicate: true });
    expect(await StripeEvent.countDocuments({ eventId: event.id, status: 'PROCESSED' })).toBe(1);
  });

  it('stores paid and failed Stripe invoice events once per invoice and isolates billing history', async () => {
    const admin = await register({ organizationName: 'Invoice History Workspace' });
    const otherWorkspace = await register({ organizationName: 'Other Invoice Workspace' });
    await Subscription.create({
      organization: admin.organization._id,
      plan: 'PRO',
      status: 'active',
      stripeCustomerId: 'cus_teamflow_invoice_test',
      stripeSubscriptionId: 'sub_teamflow_invoice_test',
      currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const created = Math.floor(Date.now() / 1000);
    const paidEvent = {
      id: 'evt_teamflow_invoice_paid',
      type: 'invoice.paid',
      data: { object: { id: 'in_teamflow_paid', customer: 'cus_teamflow_invoice_test', subscription: 'sub_teamflow_invoice_test', number: 'TF-100', currency: 'usd', amount_paid: 4900, amount_due: 4900, created } },
    };
    const failedEvent = {
      id: 'evt_teamflow_invoice_failed',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_teamflow_failed', customer: 'cus_teamflow_invoice_test', subscription: 'sub_teamflow_invoice_test', number: 'TF-101', currency: 'usd', amount_paid: 0, amount_due: 4900, created } },
    };

    await expect(billingService.processStripeEvent(paidEvent)).resolves.toEqual({ duplicate: false });
    await expect(billingService.processStripeEvent(paidEvent)).resolves.toEqual({ duplicate: true });
    await expect(billingService.processStripeEvent(failedEvent)).resolves.toEqual({ duplicate: false });
    expect(await BillingPayment.countDocuments({ organization: admin.organization._id })).toBe(2);
    expect(await BillingPayment.findOne({ stripeInvoiceId: 'in_teamflow_failed' })).toMatchObject({ status: 'payment_failed', amountDue: 4900 });
    expect(await Subscription.exists({ organization: admin.organization._id, status: 'past_due' })).toBeTruthy();

    const billing = await request(app).get('/api/v1/billing').set(headers(admin.token, admin.organization._id));
    const otherBilling = await request(app).get('/api/v1/billing').set(headers(otherWorkspace.token, otherWorkspace.organization._id));
    expect(billing.body.data.invoices).toHaveLength(2);
    expect(otherBilling.body.data.invoices).toHaveLength(0);
  });

  it('authenticates socket connections, limits them to active workspaces, and delivers user notifications', async () => {
    const account = await register({ organizationName: 'Realtime Workspace' });
    const server = http.createServer();
    const socketServer = initializeSocket(server);
    await new Promise((resolve) => socketServer.httpServer.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${socketServer.httpServer.address().port}`;
    const socket = connectSocket(url, { auth: { token: account.token, organizationId: account.organization._id }, transports: ['websocket'], reconnection: false });
    try {
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const incoming = new Promise((resolve) => socket.once('notification:new', resolve));
      await notify({ organization: account.organization._id, user: account.user._id, type: 'TASK_COMPLETED', title: 'Live update', message: 'A task was completed.' });
      expect(await incoming).toMatchObject({ title: 'Live update', type: 'TASK_COMPLETED' });

      const rejectedSocket = connectSocket(url, { auth: { token: account.token, organizationId: new mongoose.Types.ObjectId().toString() }, transports: ['websocket'], reconnection: false });
      const failure = await new Promise((resolve) => rejectedSocket.once('connect_error', resolve));
      expect(failure.message).toBe('Workspace access denied');
      rejectedSocket.disconnect();
    } finally {
      socket.disconnect();
      await closeSocket();
    }
  });

  it('only returns notifications belonging to the signed-in user and active organization', async () => {
    const admin = await register({ organizationName: 'Notification Workspace' });
    const outsider = await register({ organizationName: 'Private Workspace' });
    await Notification.create({ organization: admin.organization._id, user: admin.user._id, type: 'TASK_COMPLETED', title: 'Done', message: 'A task was completed.' });
    await Notification.create({ organization: admin.organization._id, user: outsider.user._id, type: 'TASK_COMPLETED', title: 'Private', message: 'Not yours.' });

    const response = await request(app).get('/api/v1/notifications').set(headers(admin.token, admin.organization._id));
    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.notifications[0].title).toBe('Done');
  });
});
