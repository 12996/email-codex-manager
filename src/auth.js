export const AUTH_COOKIE_NAME = 'admin_auth';
export const PERSISTENT_LOGIN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function isAuthenticatedCookieValue(value) {
  return value === '1';
}

export function createAuthMiddleware() {
  return function requireAuth(req, res, next) {
    if (isAuthenticatedCookieValue(req.signedCookies?.[AUTH_COOKIE_NAME])) {
      next();
      return;
    }
    res.redirect('/login');
  };
}

export function setAuthCookie(res) {
  res.cookie(AUTH_COOKIE_NAME, '1', {
    httpOnly: true,
    maxAge: PERSISTENT_LOGIN_MAX_AGE_MS,
    sameSite: 'lax',
    signed: true,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME);
}
