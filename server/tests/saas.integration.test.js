const crypto = require('crypto');
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || crypto.randomBytes(40).toString('hex');
process.env.NODE_ENV = 'test';

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const Invitation = require('../models/Invitation');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const RefreshToken = require('../models/RefreshToken');

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
    const privateProject = await request(app).post('/api/v1/projects').set(headers(admin.token, organizationId)).send({ name: 'Admin-only planning' });
    const privateTask = await request(app).post('/api/v1/tasks').set(headers(admin.token, organizationId)).send({ title: 'Confidential budget review', projectId: privateProject.body.data.project._id });
    expect(privateTask.status).toBe(201);

    const memberTasks = await request(app).get('/api/v1/tasks?mine=true').set(headers(member.token, organizationId));
    expect(memberTasks.status).toBe(200);
    expect(memberTasks.body.data.tasks.map((task) => task._id)).toContain(taskId);
    const updateStatus = await request(app).patch(`/api/v1/tasks/${taskId}`).set(headers(member.token, organizationId)).send({ status: 'IN_PROGRESS' });
    expect(updateStatus.status).toBe(200);
    const forbiddenEdit = await request(app).patch(`/api/v1/tasks/${taskId}`).set(headers(member.token, organizationId)).send({ title: 'Try to change the task title' });
    expect(forbiddenEdit.status).toBe(403);
    const forbiddenProject = await request(app).post('/api/v1/projects').set(headers(member.token, organizationId)).send({ name: 'Unauthorized project' });
    expect(forbiddenProject.status).toBe(403);

    const comment = await request(app).post(`/api/v1/tasks/${taskId}/comments`).set(headers(member.token, organizationId)).send({ body: 'I reviewed this and left a note.' });
    if (comment.status !== 201) throw new Error(JSON.stringify(comment.body));
    expect(comment.status).toBe(201);
    expect(await Comment.countDocuments({ organization: organizationId, task: taskId })).toBe(1);
    expect(await ActivityLog.countDocuments({ organization: organizationId, task: taskId })).toBeGreaterThanOrEqual(3);
    expect(await Notification.countDocuments({ organization: organizationId, user: member.user._id })).toBeGreaterThanOrEqual(1);
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
