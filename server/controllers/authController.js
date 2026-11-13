const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const authService = require('../services/authService');

module.exports = {
  register: asyncHandler(async (req, res) => {
    const result = await authService.register(req.validated.body, req, res);
    return success(res, result, 201, result.verificationRequired ? 'Check your email to verify your account.' : 'Account created.');
  }),
  login: asyncHandler(async (req, res) => success(res, await authService.login(req.validated.body, req, res), 200, 'Signed in.')),
  refresh: asyncHandler(async (req, res) => success(res, await authService.refresh(req, res))),
  logout: asyncHandler(async (req, res) => { await authService.logout(req, res); return success(res, {}, 200, 'Signed out.'); }),
  me: asyncHandler(async (req, res) => success(res, { user: authService.safeUser(req.user) })),
  verifyEmail: asyncHandler(async (req, res) => success(res, { user: await authService.verifyEmail(req.validated.body.token) }, 200, 'Email verified. You can sign in.')),
  resendVerification: asyncHandler(async (req, res) => {
    const result = await authService.resendVerification(req.validated.body.email);
    return success(res, process.env.NODE_ENV === 'production' ? undefined : result, 200, result.message);
  }),
  updateProfile: asyncHandler(async (req, res) => success(res, { user: await authService.updateProfile(req.user._id, req.validated.body.name) })),
  forgotPassword: asyncHandler(async (req, res) => {
    const result = await authService.forgotPassword(req.validated.body.email);
    return success(res, process.env.NODE_ENV === 'production' ? undefined : result, 200, result.message);
  }),
  resetPassword: asyncHandler(async (req, res) => success(res, await authService.resetPassword({ ...req.validated.body, remoteIp: req.ip }), 200, 'Password reset successfully.')),
};
