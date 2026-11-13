const { z, objectId } = require('./common');

const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const password = z.string().min(8).max(72).regex(/^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,72}$/, 'Password must be at least 8 characters and include a number and a special character.');

module.exports = {
  register: z.object({
    name: z.string().trim().min(2).max(80),
    email,
    password,
    organizationName: z.string().trim().min(2).max(80).optional(),
    invitationToken: z.string().min(32).max(200).optional(),
  }).strict().refine((value) => value.invitationToken || value.organizationName, 'Workspace name is required unless you are accepting an invitation.'),
  login: z.object({ email, password: z.string().min(1).max(72) }).strict(),
  forgotPassword: z.object({ email }).strict(),
  resetPassword: z.object({
    token: z.string().min(32).max(200),
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email.'),
    password,
    captchaToken: z.string().min(1).max(2048),
  }).strict(),
  updateProfile: z.object({ name: z.string().trim().min(2).max(80) }).strict(),
  id: z.object({ id: objectId }),
};
