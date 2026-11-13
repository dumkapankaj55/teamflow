const { z, objectId } = require('./common');

const role = z.enum(['ADMIN', 'MANAGER', 'MEMBER']);
const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const slug = z.string().trim().toLowerCase().min(2).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

module.exports = {
  create: z.object({ name: z.string().trim().min(2).max(80) }).strict(),
  update: z.object({ name: z.string().trim().min(2).max(80).optional(), slug: slug.optional(), settings: z.object({ timezone: z.string().max(80).optional(), weekStartsOn: z.number().int().min(0).max(6).optional() }).strict().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.'),
  id: z.object({ id: objectId }),
  memberParams: z.object({ id: objectId, userId: objectId }),
  invite: z.object({ email, role: role.default('MEMBER') }).strict(),
  changeRole: z.object({ role }).strict(),
  acceptInviteParams: z.object({ token: z.string().min(32).max(200) }),
  auditQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    action: z.string().trim().min(1).max(80).optional(),
    targetType: z.enum(['ORGANIZATION', 'PROJECT', 'TASK', 'COMMENT', 'MEMBERSHIP']).optional(),
    actor: objectId.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }).refine((value) => !value.from || !value.to || value.from <= value.to, { message: 'Start date must be before end date.' }),
};
