function refreshCookieOptions() {
  const sameSite = process.env.COOKIE_SAME_SITE || 'lax';
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite,
    path: '/api/v1/auth',
    maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30) * 24 * 60 * 60 * 1000,
  };
}

module.exports = refreshCookieOptions;
