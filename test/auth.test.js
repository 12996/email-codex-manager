import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthMiddleware, PERSISTENT_LOGIN_MAX_AGE_MS, isAuthenticatedCookieValue, setAuthCookie } from '../src/auth.js';

test('isAuthenticatedCookieValue validates signed admin cookie value', () => {
  assert.equal(isAuthenticatedCookieValue('1'), true);
  assert.equal(isAuthenticatedCookieValue('0'), false);
  assert.equal(isAuthenticatedCookieValue(undefined), false);
});

test('createAuthMiddleware redirects unauthenticated requests to login', () => {
  const middleware = createAuthMiddleware();
  const req = { signedCookies: {} };
  const res = {
    redirectedTo: null,
    redirect(path) {
      this.redirectedTo = path;
    },
  };
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.redirectedTo, '/login');
});

test('createAuthMiddleware allows authenticated requests', () => {
  const middleware = createAuthMiddleware();
  const req = { signedCookies: { admin_auth: '1' } };
  const res = {
    redirect() {
      throw new Error('should not redirect');
    },
  };
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test('setAuthCookie keeps admin login for 30 days', () => {
  const res = {
    cookieName: null,
    cookieValue: null,
    cookieOptions: null,
    cookie(name, value, options) {
      this.cookieName = name;
      this.cookieValue = value;
      this.cookieOptions = options;
    },
  };

  setAuthCookie(res);

  assert.equal(res.cookieName, 'admin_auth');
  assert.equal(res.cookieValue, '1');
  assert.equal(res.cookieOptions.httpOnly, true);
  assert.equal(res.cookieOptions.sameSite, 'lax');
  assert.equal(res.cookieOptions.signed, true);
  assert.equal(res.cookieOptions.maxAge, PERSISTENT_LOGIN_MAX_AGE_MS);
  assert.equal(PERSISTENT_LOGIN_MAX_AGE_MS, 30 * 24 * 60 * 60 * 1000);
});
