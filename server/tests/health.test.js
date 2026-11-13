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
    expect(response.body).toMatchObject({ success: false, message: 'Route GET /api/v1/unknown was not found.', code: 'NOT_FOUND' });
    expect(response.body.requestId).toMatch(/^[a-f0-9-]{36}$/i);
  });

  it('serves the OpenAPI document with resolvable internal references', async () => {
    const response = await request(app).get('/api/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    const unresolved = [];
    const visit = (value) => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
        const result = value.$ref.slice(2).split('/').reduce((current, key) => current?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], response.body);
        if (result === undefined) unresolved.push(value.$ref);
      }
      Object.values(value).forEach(visit);
    };
    visit(response.body);
    expect(unresolved).toEqual([]);
    expect(response.body.paths['/auth/reset-password'].post.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/ResetPasswordRequest');
    expect(response.body.paths['/billing/checkout'].post.responses['201']).toBeDefined();
  });

  it('serves the interactive API reference without the global CSP blocking Swagger UI', async () => {
    const response = await request(app).get('/api/docs/');

    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger-ui');
    expect(response.headers['content-security-policy']).toBeUndefined();
  });
});
