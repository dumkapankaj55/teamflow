const { z, objectId, pageQuery } = require('./common');

const status = z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const optionalDate = z.preprocess((value) => value === '' ? null : value == null ? undefined : value, z.union([z.coerce.date(), z.null()]).optional());
const queryBoolean = z.preprocess((value) => value === 'true' || value === true, z.boolean().optional());

module.exports = {
  create: z.object({ title: z.string().trim().min(2).max(160), description: z.string().trim().max(8000).optional().default(''), projectId: objectId, priority: priority.optional(), dueDate: optionalDate, assignedTo: objectId.optional() }).strict(),
  update: z.object({ title: z.string().trim().min(2).max(160).optional(), description: z.string().trim().max(8000).optional(), status: status.optional(), priority: priority.optional(), dueDate: optionalDate, assignedTo: objectId.nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.'),
  id: z.object({ id: objectId }),
  list: pageQuery.extend({ projectId: objectId.optional(), search: z.string().trim().max(100).optional(), status: status.optional(), priority: priority.optional(), assignedTo: objectId.optional(), mine: queryBoolean }),
  comment: z.object({ body: z.string().trim().min(1).max(2000) }).strict(),
  commentList: pageQuery,
};
