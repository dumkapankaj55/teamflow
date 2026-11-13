const { z, objectId, pageQuery } = require('./common');

const optionalDate = z.preprocess((value) => value === '' || value == null ? undefined : value, z.coerce.date().optional());
const projectStatus = z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']);

module.exports = {
  create: z.object({ name: z.string().trim().min(2).max(100), description: z.string().trim().max(4000).optional().default(''), startDate: optionalDate, dueDate: optionalDate, status: projectStatus.optional(), members: z.array(objectId).max(100).optional() }).strict(),
  update: z.object({ name: z.string().trim().min(2).max(100).optional(), description: z.string().trim().max(4000).optional(), startDate: optionalDate, dueDate: optionalDate, status: projectStatus.optional(), members: z.array(objectId).max(100).optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.'),
  id: z.object({ id: objectId }),
  list: pageQuery.extend({ search: z.string().trim().max(100).optional(), status: projectStatus.optional(), sort: z.enum(['updatedAt', 'createdAt', 'name', 'dueDate']).default('updatedAt') }),
};
