const operation = (summary, { auth = false, workspace = false, params = [], body, roles, status = 200, response = 'A successful TeamFlow response.' } = {}) => ({
  summary,
  ...(auth ? { security: [{ bearerAuth: [] }] } : {}),
  ...(workspace ? { parameters: [{ $ref: '#/components/parameters/OrganizationHeader' }, ...params] } : params.length ? { parameters: params } : {}),
  ...(roles ? { description: `Required workspace role: ${roles.join(' or ')}.` } : {}),
  ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } } : {}),
  responses: {
    [status]: { description: response, content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
    '400': { description: 'Invalid input or request state.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    '401': { description: 'Authentication is required or the session is invalid.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    '403': { description: 'The authenticated user lacks permission.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    '402': { description: 'A workspace plan limit prevents this operation.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    '404': { description: 'The requested workspace resource was not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    '409': { description: 'The request conflicts with existing workspace state.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    '429': { description: 'Too many requests. Retry after the rate limit window.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    '500': { description: 'Unexpected server error.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    '503': { description: 'An optional service or dependency is unavailable.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
  },
});

const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'objectid' } };
const bodyRef = (name) => ({ $ref: `#/components/schemas/${name}` });
const queryParam = (name, schema, description) => ({ name, in: 'query', required: false, description, schema });
const paginationParams = [queryParam('page', { type: 'integer', minimum: 1, default: 1 }), queryParam('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 })];
const securedWorkspace = (summary, roles, params = []) => operation(summary, { auth: true, workspace: true, params, ...(roles ? { roles } : {}) });
const projectListParams = [...paginationParams, queryParam('search', { type: 'string', maxLength: 100 }), queryParam('status', { type: 'string', enum: ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] }), queryParam('sort', { type: 'string', enum: ['updatedAt', 'createdAt', 'name', 'dueDate'], default: 'updatedAt' })];
const taskListParams = [...paginationParams, queryParam('projectId', { type: 'string', format: 'objectid' }), queryParam('search', { type: 'string', maxLength: 100 }), queryParam('status', { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] }), queryParam('priority', { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] }), queryParam('assignedTo', { type: 'string', format: 'objectid' }), queryParam('mine', { type: 'boolean' }, 'When true, return tasks assigned to the current user.')];

module.exports = {
  openapi: '3.1.0',
  info: {
    title: 'TeamFlow API',
    version: '1.0.0',
    description: 'REST API for TeamFlow multi-tenant workspaces. Authenticated requests use a short-lived bearer access token. Workspace endpoints also require `X-Organization-Id`; the server verifies active membership and role on every request.',
  },
  servers: [{ url: '/api/v1', description: 'Current TeamFlow API host' }],
  tags: [
    { name: 'Health' }, { name: 'Authentication' }, { name: 'Organizations' }, { name: 'Invitations' },
    { name: 'Projects' }, { name: 'Tasks' }, { name: 'Notifications' }, { name: 'Analytics' }, { name: 'Billing' },
  ],
  paths: {
    '/health': { get: { tags: ['Health'], summary: 'Check API health', responses: { '200': { description: 'API is available.' } } } },
    '/health/ready': { get: { tags: ['Health'], summary: 'Check API and MongoDB readiness', responses: { '200': { description: 'API and database are ready.' }, '503': { description: 'Database is unavailable.' } } } },
    '/auth/register': { post: { tags: ['Authentication'], ...operation('Create an account and workspace', { body: bodyRef('RegisterRequest'), status: 201 }) } },
    '/auth/login': { post: { tags: ['Authentication'], ...operation('Sign in with email and password', { body: bodyRef('LoginRequest') }) } },
    '/auth/verify-email': { post: { tags: ['Authentication'], ...operation('Verify an email address', { body: bodyRef('VerifyEmailRequest') }) } },
    '/auth/resend-verification': { post: { tags: ['Authentication'], ...operation('Resend email verification', { body: bodyRef('EmailRequest') }) } },
    '/auth/refresh': { post: { tags: ['Authentication'], ...operation('Rotate the HTTP-only refresh session cookie') } },
    '/auth/logout': { post: { tags: ['Authentication'], ...operation('Revoke the refresh session cookie') } },
    '/auth/me': {
      get: { tags: ['Authentication'], ...operation('Read the signed-in user', { auth: true }) },
      patch: { tags: ['Authentication'], ...operation('Update the signed-in user profile', { auth: true, body: bodyRef('UpdateProfileRequest') }) },
    },
    '/auth/forgot-password': { post: { tags: ['Authentication'], ...operation('Request a password reset link and one-time code', { body: bodyRef('EmailRequest') }) } },
    '/auth/reset-password': { post: { tags: ['Authentication'], ...operation('Verify the one-time code and reset a password', { body: bodyRef('ResetPasswordRequest') }) } },
    '/organizations': {
      get: { tags: ['Organizations'], ...operation('List workspaces for the signed-in user', { auth: true }) },
      post: { tags: ['Organizations'], ...operation('Create a workspace', { auth: true, body: bodyRef('CreateOrganizationRequest'), status: 201 }) },
    },
    '/organizations/{id}': {
      get: { tags: ['Organizations'], ...securedWorkspace('Read workspace settings'), parameters: [id, { $ref: '#/components/parameters/OrganizationHeader' }] },
      patch: { tags: ['Organizations'], ...operation('Update workspace settings', { auth: true, workspace: true, params: [id], roles: ['ADMIN'], body: bodyRef('UpdateOrganizationRequest') }) },
    },
    '/organizations/{id}/members': {
      get: { tags: ['Organizations'], ...operation('List workspace members and pending invitations', { auth: true, workspace: true, params: [id] }) },
    },
    '/organizations/{id}/audit-logs': { get: { tags: ['Organizations'], ...operation('List filtered workspace audit history (ADMIN or MANAGER)', { auth: true, workspace: true, roles: ['ADMIN', 'MANAGER'], params: [id, ...paginationParams, queryParam('action', { type: 'string', maxLength: 80 }), queryParam('targetType', { type: 'string', enum: ['ORGANIZATION', 'PROJECT', 'TASK', 'COMMENT', 'MEMBERSHIP'] }), queryParam('actor', { type: 'string', format: 'objectid' }), queryParam('from', { type: 'string', format: 'date-time' }), queryParam('to', { type: 'string', format: 'date-time' })] }) } },
    '/organizations/{id}/invitations': { post: { tags: ['Organizations'], ...operation('Invite a workspace member', { auth: true, workspace: true, params: [id], roles: ['ADMIN'], body: bodyRef('InvitationRequest'), status: 201 }) } },
    '/organizations/{id}/members/{userId}': {
      patch: { tags: ['Organizations'], ...operation('Change a member role', { auth: true, workspace: true, params: [id, { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'objectid' } }], roles: ['ADMIN'], body: bodyRef('ChangeRoleRequest') }) },
      delete: { tags: ['Organizations'], ...operation('Remove a member', { auth: true, workspace: true, params: [id, { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'objectid' } }], roles: ['ADMIN'] }) },
    },
    '/invitations/{token}/accept': { post: { tags: ['Invitations'], ...operation('Accept an invitation for the signed-in email address', { auth: true, params: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }] }) } },
    '/projects': {
      get: { tags: ['Projects'], ...securedWorkspace('List visible projects', undefined, projectListParams) },
      post: { tags: ['Projects'], ...operation('Create a project', { auth: true, workspace: true, roles: ['ADMIN', 'MANAGER'], body: bodyRef('ProjectRequest'), status: 201 }) },
    },
    '/projects/{id}': {
      get: { tags: ['Projects'], ...operation('Read a project', { auth: true, workspace: true, params: [id] }) },
      patch: { tags: ['Projects'], ...operation('Update a project', { auth: true, workspace: true, params: [id], roles: ['ADMIN', 'MANAGER'], body: bodyRef('ProjectUpdateRequest') }) },
      delete: { tags: ['Projects'], ...operation('Delete a project', { auth: true, workspace: true, params: [id], roles: ['ADMIN'] }) },
    },
    '/tasks': {
      get: { tags: ['Tasks'], ...securedWorkspace('List visible tasks with filtering and pagination', undefined, taskListParams) },
      post: { tags: ['Tasks'], ...operation('Create a task', { auth: true, workspace: true, roles: ['ADMIN', 'MANAGER'], body: bodyRef('TaskRequest'), status: 201 }) },
    },
    '/tasks/{id}': {
      get: { tags: ['Tasks'], ...operation('Read a task', { auth: true, workspace: true, params: [id] }) },
      patch: { tags: ['Tasks'], ...operation('Update a task', { auth: true, workspace: true, params: [id], body: bodyRef('TaskUpdateRequest') }) },
      delete: { tags: ['Tasks'], ...operation('Delete a task', { auth: true, workspace: true, params: [id], roles: ['ADMIN', 'MANAGER'] }) },
    },
    '/tasks/{id}/comments': {
      get: { tags: ['Tasks'], ...operation('List task comments', { auth: true, workspace: true, params: [id, ...paginationParams] }) },
      post: { tags: ['Tasks'], ...operation('Comment on a task; use @email to notify visible workspace members', { auth: true, workspace: true, params: [id], body: bodyRef('CommentRequest'), status: 201 }) },
    },
    '/tasks/{id}/activity': { get: { tags: ['Tasks'], ...operation('List task activity history', { auth: true, workspace: true, params: [id, ...paginationParams] }) } },
    '/notifications': { get: { tags: ['Notifications'], ...securedWorkspace('List notification history', undefined, paginationParams) } },
    '/notifications/read-all': { patch: { tags: ['Notifications'], ...securedWorkspace('Mark all notifications as read') } },
    '/notifications/{id}/read': { patch: { tags: ['Notifications'], ...operation('Mark a notification as read', { auth: true, workspace: true, params: [id] }) } },
    '/analytics/overview': { get: { tags: ['Analytics'], ...securedWorkspace('Read workspace overview analytics') } },
    '/analytics/tasks': { get: { tags: ['Analytics'], ...operation('Read task analytics (all plans; ADMIN or MANAGER)', { auth: true, workspace: true, roles: ['ADMIN', 'MANAGER'] }) } },
    '/analytics/projects': { get: { tags: ['Analytics'], ...operation('Read project analytics (all plans; ADMIN or MANAGER)', { auth: true, workspace: true, roles: ['ADMIN', 'MANAGER'] }) } },
    '/analytics/team': { get: { tags: ['Analytics'], ...operation('Read team workload analytics (all plans; ADMIN or MANAGER)', { auth: true, workspace: true, roles: ['ADMIN', 'MANAGER'] }) } },
    '/billing/plans': { get: { tags: ['Billing'], summary: 'List plans and configured usage limits', responses: { '200': { description: 'Available plans.' } } } },
    '/billing': { get: { tags: ['Billing'], ...securedWorkspace('Read subscription, workspace usage, and invoice history') } },
    '/billing/checkout': { post: { tags: ['Billing'], ...operation('Create a Stripe-hosted subscription checkout (ADMIN)', { auth: true, workspace: true, roles: ['ADMIN'], body: bodyRef('CheckoutRequest'), status: 201 }) } },
    '/billing/portal': { post: { tags: ['Billing'], ...operation('Create a Stripe customer portal session (ADMIN)', { auth: true, workspace: true, roles: ['ADMIN'] }) } },
    '/billing/cancel': { post: { tags: ['Billing'], ...operation('Schedule subscription cancellation at period end (ADMIN)', { auth: true, workspace: true, roles: ['ADMIN'] }) } },
    '/billing/free': { post: { tags: ['Billing'], ...operation('Select Free or schedule downgrade at period end (ADMIN)', { auth: true, workspace: true, roles: ['ADMIN'] }) } },
    '/billing/sales-enquiry': { post: { tags: ['Billing'], ...operation('Send an Enterprise sales enquiry (ADMIN)', { auth: true, workspace: true, roles: ['ADMIN'], body: { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string', minLength: 10, maxLength: 2000 } } }, status: 202 }) } },
    '/billing/webhook': { post: { tags: ['Billing'], summary: 'Receive and verify Stripe webhook events', description: 'Requires the raw request body and Stripe-Signature header. Stripe event IDs are processed idempotently.', parameters: [{ name: 'Stripe-Signature', in: 'header', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Webhook event accepted.' }, '400': { description: 'Invalid signature.' } } } },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Short-lived TeamFlow access token.' } },
    parameters: { OrganizationHeader: { name: 'X-Organization-Id', in: 'header', required: true, description: 'Workspace context. Membership and permissions are verified server-side.', schema: { type: 'string', format: 'objectid' } } },
    schemas: {
      RegisterRequest: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 80 }, email: { type: 'string', format: 'email', maxLength: 254 }, password: { $ref: '#/components/schemas/StrongPassword' }, organizationName: { type: 'string', minLength: 2, maxLength: 80 }, invitationToken: { type: 'string', minLength: 32, maxLength: 200 } }, required: ['name', 'email', 'password'], description: 'Provide organizationName when creating a workspace, or invitationToken when joining an existing one.' },
      LoginRequest: { type: 'object', additionalProperties: false, properties: { email: { type: 'string', format: 'email', maxLength: 254 }, password: { type: 'string', minLength: 1, maxLength: 72 } }, required: ['email', 'password'] },
      VerifyEmailRequest: { type: 'object', additionalProperties: false, properties: { token: { type: 'string', minLength: 32, maxLength: 200 } }, required: ['token'] },
      EmailRequest: { type: 'object', additionalProperties: false, properties: { email: { type: 'string', format: 'email', maxLength: 254 } }, required: ['email'] },
      UpdateProfileRequest: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 80 } }, required: ['name'] },
      ResetPasswordRequest: { type: 'object', additionalProperties: false, properties: { token: { type: 'string', minLength: 32, maxLength: 200 }, otp: { type: 'string', pattern: '^\\d{6}$' }, password: { $ref: '#/components/schemas/StrongPassword' }, captchaToken: { type: 'string', minLength: 1, maxLength: 2048 } }, required: ['token', 'otp', 'password', 'captchaToken'] },
      CreateOrganizationRequest: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 80 } }, required: ['name'] },
      UpdateOrganizationRequest: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 80 }, slug: { type: 'string', minLength: 2, maxLength: 48, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }, settings: { type: 'object', additionalProperties: false, properties: { timezone: { type: 'string', maxLength: 80 }, weekStartsOn: { type: 'integer', minimum: 0, maximum: 6 } } } }, minProperties: 1 },
      InvitationRequest: { type: 'object', additionalProperties: false, properties: { email: { type: 'string', format: 'email', maxLength: 254 }, role: { type: 'string', enum: ['ADMIN', 'MANAGER', 'MEMBER'], default: 'MEMBER' } }, required: ['email'] },
      ChangeRoleRequest: { type: 'object', additionalProperties: false, properties: { role: { type: 'string', enum: ['ADMIN', 'MANAGER', 'MEMBER'] } }, required: ['role'] },
      ProjectRequest: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 100 }, description: { type: 'string', maxLength: 4000 }, startDate: { type: 'string', format: 'date-time' }, dueDate: { type: 'string', format: 'date-time' }, status: { type: 'string', enum: ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] }, members: { type: 'array', maxItems: 100, items: { type: 'string', format: 'objectid' } } }, required: ['name'] },
      ProjectUpdateRequest: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 100 }, description: { type: 'string', maxLength: 4000 }, startDate: { type: ['string', 'null'], format: 'date-time' }, dueDate: { type: ['string', 'null'], format: 'date-time' }, status: { type: 'string', enum: ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] }, members: { type: 'array', maxItems: 100, items: { type: 'string', format: 'objectid' } } }, minProperties: 1 },
      TaskRequest: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', minLength: 2, maxLength: 160 }, description: { type: 'string', maxLength: 8000 }, projectId: { type: 'string', format: 'objectid' }, priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] }, dueDate: { type: ['string', 'null'], format: 'date-time' }, assignedTo: { type: 'string', format: 'objectid' } }, required: ['title', 'projectId'] },
      TaskUpdateRequest: { type: 'object', additionalProperties: false, properties: { title: { type: 'string', minLength: 2, maxLength: 160 }, description: { type: 'string', maxLength: 8000 }, status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] }, priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] }, dueDate: { type: ['string', 'null'], format: 'date-time' }, assignedTo: { type: ['string', 'null'], format: 'objectid' } }, minProperties: 1 },
      CommentRequest: { type: 'object', additionalProperties: false, properties: { body: { type: 'string', minLength: 1, maxLength: 2000, description: 'Use @email to notify a workspace member who is allowed to view the task.' } }, required: ['body'] },
      CheckoutRequest: { type: 'object', additionalProperties: false, properties: { plan: { type: 'string', enum: ['PRO', 'ENTERPRISE'] } }, required: ['plan'] },
      StrongPassword: { type: 'string', minLength: 8, maxLength: 72, pattern: '^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,72}$', description: 'At least 8 characters with a number and a special character.' },
      SuccessResponse: { type: 'object', properties: { success: { type: 'boolean', const: true }, message: { type: 'string' }, data: {}, requestId: { type: 'string', format: 'uuid' } }, required: ['success'] },
      ErrorResponse: { type: 'object', properties: { success: { type: 'boolean', const: false }, code: { type: 'string' }, message: { type: 'string' }, errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } }, requestId: { type: 'string', format: 'uuid' } }, required: ['success', 'message'] },
    },
  },
};
