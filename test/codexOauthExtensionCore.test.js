import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
  OAUTH_SCOPE,
  buildTokenExchangeBody,
  createPkceTransaction,
  extractDisplayClaims,
  parseOAuthCallback,
  precheckAccessToken,
} from '../extensions/codex-oauth-login/lib/oauth-core.js';

function encodeJwt(payload) {
  return [
    'header',
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

async function sha256Base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('base64url');
}

test('AT precheck classifies local input without claiming remote validity', () => {
  assert.deepEqual(precheckAccessToken('', 100_000), { kind: 'empty' });
  assert.deepEqual(precheckAccessToken('abc\ndef', 100_000), { kind: 'invalid' });
  assert.deepEqual(precheckAccessToken('opaque-token', 100_000), { kind: 'opaque' });
  assert.deepEqual(precheckAccessToken('header.not-json.signature', 100_000), { kind: 'opaque' });
  assert.deepEqual(precheckAccessToken(encodeJwt({ exp: 101 }), 100_000), {
    kind: 'jwt-valid',
    expiresAt: 101_000,
  });
  assert.deepEqual(precheckAccessToken(encodeJwt({ exp: 99 }), 100_000), {
    kind: 'jwt-expired',
    expiresAt: 99_000,
  });
});

test('PKCE transaction uses the fixed OAuth contract and a verifier-derived challenge', async () => {
  const transaction = await createPkceTransaction({ cryptoApi: webcrypto, nowMs: 1_000 });
  const authorizationUrl = new URL(transaction.authorizationUrl);

  assert.equal(transaction.expiresAt, 901_000);
  assert.match(transaction.state, /^[A-Za-z0-9_-]+$/);
  assert.match(transaction.verifier, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(transaction.state, transaction.verifier);
  assert.equal(authorizationUrl.searchParams.get('client_id'), OAUTH_CLIENT_ID);
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), OAUTH_REDIRECT_URI);
  assert.equal(authorizationUrl.searchParams.get('scope'), OAUTH_SCOPE);
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorizationUrl.searchParams.get('code_challenge'), await sha256Base64Url(transaction.verifier));
});

test('callback parser accepts only the exact single-code localhost callback', () => {
  assert.deepEqual(
    parseOAuthCallback('http://localhost:1455/auth/callback?code=code-one&state=state-one'),
    { kind: 'valid', code: 'code-one', state: 'state-one' },
  );
  assert.deepEqual(
    parseOAuthCallback('http://localhost:1455/auth/callback?code=one&code=two&state=state-one'),
    { kind: 'error', error: 'invalid_callback' },
  );
  assert.deepEqual(
    parseOAuthCallback('http://localhost:1455/auth/callback?error=login_required&state=state-one'),
    { kind: 'error', error: 'login_required' },
  );
  assert.deepEqual(
    parseOAuthCallback('http://localhost:1455/other?code=code-one&state=state-one'),
    { kind: 'not-callback' },
  );
  assert.deepEqual(
    parseOAuthCallback('https://localhost:1455/auth/callback?code=code-one&state=state-one'),
    { kind: 'not-callback' },
  );
});

test('token exchange body binds an authorization code to the fixed client and redirect URI', () => {
  const body = buildTokenExchangeBody({ code: 'test-code', verifier: 'test-verifier' });

  assert.deepEqual([...body.entries()], [
    ['client_id', OAUTH_CLIENT_ID],
    ['grant_type', 'authorization_code'],
    ['code', 'test-code'],
    ['redirect_uri', OAUTH_REDIRECT_URI],
    ['code_verifier', 'test-verifier'],
  ]);
});

test('claim extractor returns only display values from decodable token payloads', () => {
  const result = extractDisplayClaims({
    id_token: encodeJwt({ email: 'friend@example.com' }),
    access_token: encodeJwt({
      'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' },
    }),
  });

  assert.deepEqual(result, { email: 'friend@example.com', plan: 'plus' });
  assert.deepEqual(extractDisplayClaims({ id_token: 'bad', access_token: 'also-bad' }), {
    email: null,
    plan: null,
  });
});
