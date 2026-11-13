const request = require('supertest');
const app = require('../app');

describe('API foundation', () => {
  it('returns service health without exposing configuration', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { service: 'teamflow-api', status: 'ok' },
    });
    expect(response.body).not.toHaveProperty('env');
  });

  it('returns a consistent 404 for unknown API routes', async () => {
    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, message: 'Route GET /api/v1/unknown was not found.', code: 'NOT_FOUND' });
  });
});
