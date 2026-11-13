const request = require('supertest');
const app = require('../app');
const Membership = require('../models/Membership');
const requireMembership = require('../middleware/requireMembership');

describe('API security baseline', () => {
  it('rejects invalid auth input before database access', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email', password: '' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
  });

  it('requires a valid access token for the current-user endpoint', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('allows a private LAN Vite origin during development', async () => {
    const response = await request(app).get('/api/v1/health').set('Origin', 'http://10.252.25.91:5173');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://10.252.25.91:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('looks up tenant access using both the authenticated user and requested organization', async () => {
    const userId = '665f2a9820bfcf3e5a129011';
    const organizationId = '665f2a9820bfcf3e5a129022';
    const populate = jest.fn().mockResolvedValue(null);
    const findOne = jest.spyOn(Membership, 'findOne').mockReturnValue({ populate });
    const req = {
      params: {}, user: { _id: userId },
      get: (name) => name === 'x-organization-id' ? organizationId : undefined,
    };
    const next = jest.fn();

    await requireMembership(req, {}, next);

    expect(findOne).toHaveBeenCalledWith({ user: userId, organization: organizationId, status: 'ACTIVE' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'ORGANIZATION_ACCESS_DENIED' }));
    findOne.mockRestore();
  });

  it('uses a workspace path id ahead of an unrelated workspace header', async () => {
    const userId = '665f2a9820bfcf3e5a129011';
    const pathOrganizationId = '665f2a9820bfcf3e5a129022';
    const headerOrganizationId = '665f2a9820bfcf3e5a129033';
    const populate = jest.fn().mockResolvedValue(null);
    const findOne = jest.spyOn(Membership, 'findOne').mockReturnValue({ populate });
    const req = {
      params: { id: pathOrganizationId }, user: { _id: userId },
      get: (name) => name === 'x-organization-id' ? headerOrganizationId : undefined,
    };
    const next = jest.fn();

    await requireMembership(req, {}, next);

    expect(findOne).toHaveBeenCalledWith({ user: userId, organization: pathOrganizationId, status: 'ACTIVE' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    findOne.mockRestore();
  });
});
