import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  inspectJwtInput,
  verifyAgentIdentityJwt,
} from '../extensions/codex-oauth-login/lib/jwt-auth-core.js';

const NOW_MS = 1_000_000;

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function defaultClaims(overrides = {}) {
  return {
    iss: 'https://chatgpt.com/codex-backend/agent-identity',
    aud: 'codex-app-server',
    iat: 999,
    exp: 1_001,
    agent_runtime_id: 'fixture-agent',
    agent_private_key: 'fixture-private-key',
    account_id: 'fixture-account',
    chatgpt_user_id: 'fixture-user',
    email: 'friend@example.com',
    plan_type: 'pro',
    chatgpt_account_is_fedramp: false,
    ...overrides,
  };
}

async function createSignedJwtFixture({ header = {}, claims = {} } = {}) {
  const keyPair = await webcrypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const publicJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
  Object.assign(publicJwk, { kid: 'fixture-key', alg: 'RS256', use: 'sig' });

  const headerPart = encodeJson({ alg: 'RS256', kid: 'fixture-key', typ: 'JWT', ...header });
  const payloadPart = encodeJson(defaultClaims(claims));
  const signedBytes = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, signedBytes);

  return {
    jwt: `${headerPart}.${payloadPart}.${toBase64Url(signature)}`,
    publicJwk,
  };
}

function tamperSignature(jwt) {
  const [header, payload, signature] = jwt.split('.');
  const bytes = Buffer.from(signature, 'base64url');
  bytes[0] ^= 1;
  return `${header}.${payload}.${bytes.toString('base64url')}`;
}

async function expectStaticError(action, code, forbidden = 'fixture-private-key') {
  await assert.rejects(action, error => error?.code === code && !error.message.includes(forbidden));
}

test('JWT input inspection accepts only decodable one-line JWT structure', () => {
  assert.deepEqual(inspectJwtInput(''), { kind: 'invalid-format' });
  assert.deepEqual(inspectJwtInput('one\ntwo'), { kind: 'invalid-format' });
  assert.deepEqual(inspectJwtInput('not.a.jwt'), { kind: 'invalid-format' });
  assert.deepEqual(inspectJwtInput(`${encodeJson({ alg: 'RS256', kid: 'key' })}.${encodeJson({})}.signature`), {
    kind: 'valid-format',
  });
});

test('verified Agent Identity JWT returns only email and plan', async () => {
  const fixture = await createSignedJwtFixture();

  const result = await verifyAgentIdentityJwt({
    rawJwt: fixture.jwt,
    jwks: { keys: [fixture.publicJwk] },
    cryptoApi: webcrypto,
    nowMs: NOW_MS,
  });

  assert.deepEqual(result, { email: 'friend@example.com', plan: 'pro' });
});

test('verified JWT without an email returns a null display value', async () => {
  const fixture = await createSignedJwtFixture({ claims: { email: undefined } });

  const result = await verifyAgentIdentityJwt({
    rawJwt: fixture.jwt,
    jwks: { keys: [fixture.publicJwk] },
    cryptoApi: webcrypto,
    nowMs: NOW_MS,
  });

  assert.deepEqual(result, { email: null, plan: 'pro' });
});

test('missing kid or a non-RS256 header fails before accepting a JWT', async () => {
  const missingKid = await createSignedJwtFixture({ header: { kid: undefined } });
  await expectStaticError(
    () => verifyAgentIdentityJwt({
      rawJwt: missingKid.jwt,
      jwks: { keys: [missingKid.publicJwk] },
      cryptoApi: webcrypto,
      nowMs: NOW_MS,
    }),
    'jwt_invalid_format',
  );

  const wrongAlgorithm = await createSignedJwtFixture({ header: { alg: 'HS256' } });
  await expectStaticError(
    () => verifyAgentIdentityJwt({
      rawJwt: wrongAlgorithm.jwt,
      jwks: { keys: [wrongAlgorithm.publicJwk] },
      cryptoApi: webcrypto,
      nowMs: NOW_MS,
    }),
    'jwt_invalid_format',
  );
});

test('missing signing key and changed signature fail closed', async () => {
  const fixture = await createSignedJwtFixture();
  await expectStaticError(
    () => verifyAgentIdentityJwt({
      rawJwt: fixture.jwt,
      jwks: { keys: [] },
      cryptoApi: webcrypto,
      nowMs: NOW_MS,
    }),
    'jwt_signing_key_missing',
  );

  await expectStaticError(
    () => verifyAgentIdentityJwt({
      rawJwt: tamperSignature(fixture.jwt),
      jwks: { keys: [fixture.publicJwk] },
      cryptoApi: webcrypto,
      nowMs: NOW_MS,
    }),
    'jwt_signature_invalid',
  );
});

test('issuer, audience, time, and required claims must match the Agent Identity contract', async () => {
  const cases = [
    { name: 'issuer', claims: { iss: 'https://example.invalid' } },
    { name: 'audience', claims: { aud: 'other-client' } },
    { name: 'expired', claims: { exp: 999 } },
    { name: 'exp type', claims: { exp: '1001' } },
    { name: 'iat', claims: { iat: '999' } },
    { name: 'required claim', claims: { agent_private_key: '' } },
  ];

  for (const item of cases) {
    const fixture = await createSignedJwtFixture({ claims: item.claims });
    await expectStaticError(
      () => verifyAgentIdentityJwt({
        rawJwt: fixture.jwt,
        jwks: { keys: [fixture.publicJwk] },
        cryptoApi: webcrypto,
        nowMs: NOW_MS,
      }),
      'jwt_claims_invalid',
    );
  }
});
