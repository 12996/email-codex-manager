import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_IDENTITY_JWKS_URL } from '../extensions/codex-oauth-login/lib/jwt-auth-core.js';
import { createJwtAuthController } from '../extensions/codex-oauth-login/lib/jwt-auth-controller.js';

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function syntheticJwt() {
  return `${encodeJson({ alg: 'RS256', kid: 'fixture-key' })}.${encodeJson({})}.signature`;
}

function createDeferred() {
  let resolve;
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createChromeApi({ rejectMessages = false } = {}) {
  const data = {};
  const messages = [];
  return {
    data,
    messages,
    storage: {
      session: {
        async get(key) {
          return { [key]: data[key] };
        },
        async set(values) {
          Object.assign(data, values);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete data[key];
          }
        },
      },
    },
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (rejectMessages) {
          throw new Error('no extension page is listening');
        }
      },
    },
  };
}

function createHarness({
  rejectMessages = false,
  response = {
    ok: true,
    async json() {
      return { keys: [{ kid: 'fixture-key' }] };
    },
  },
  verifyResult = { email: 'friend@example.com', plan: 'pro' },
  verifyError = null,
  fetchImpl,
} = {}) {
  const chromeApi = createChromeApi({ rejectMessages });
  const fetchCalls = [];
  const verifyCalls = [];
  const resolvedFetch = fetchImpl || (async () => response);
  const verifyJwt = async options => {
    verifyCalls.push(options);
    if (verifyError) {
      throw verifyError;
    }
    return verifyResult;
  };
  const controller = createJwtAuthController({
    chromeApi,
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return resolvedFetch(url, options);
    },
    verifyJwt,
    createAttemptId: () => 'attempt-one',
  });
  return { chromeApi, controller, fetchCalls, verifyCalls };
}

test('successful JWT validation publishes only redacted account state', async () => {
  const harness = createHarness();
  const rawJwt = syntheticJwt();

  const state = await harness.controller.startJwtLogin(rawJwt);

  assert.deepEqual(state, {
    phase: 'authenticated',
    message: '已登录（JWT AT 已验证）',
    email: 'friend@example.com',
    plan: 'pro',
  });
  assert.deepEqual(harness.fetchCalls, [{
    url: AGENT_IDENTITY_JWKS_URL,
    options: { credentials: 'omit' },
  }]);
  assert.equal(harness.verifyCalls.length, 1);
  assert.doesNotMatch(JSON.stringify(harness.chromeApi.data), new RegExp(rawJwt));
  assert.doesNotMatch(JSON.stringify(harness.chromeApi.messages), new RegExp(rawJwt));
});

test('local JWT format errors fail without requesting JWKS', async () => {
  const harness = createHarness();

  const state = await harness.controller.startJwtLogin('not-a-jwt');

  assert.deepEqual(state, {
    phase: 'failed',
    message: '请输入有效的 JWT AT',
    email: null,
    plan: null,
  });
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.verifyCalls.length, 0);
});

test('JWKS retrieval failures publish a safe network diagnostic', async () => {
  const failedResponse = createHarness({ response: { ok: false } });
  const responseState = await failedResponse.controller.startJwtLogin(syntheticJwt());
  assert.deepEqual(responseState, {
    phase: 'failed',
    message: '无法获取 JWKS，请检查 chatgpt.com 网络连接后重试',
    email: null,
    plan: null,
  });

  const failedRequest = createHarness({
    fetchImpl: async () => {
      throw new Error('network detail that must not reach the UI');
    },
  });
  const requestState = await failedRequest.controller.startJwtLogin(syntheticJwt());
  assert.deepEqual(requestState, {
    phase: 'failed',
    message: '无法获取 JWKS，请检查 chatgpt.com 网络连接后重试',
    email: null,
    plan: null,
  });
});

test('claim validation failures identify an unsupported or expired JWT without leaking details', async () => {
  const verificationError = Object.assign(new Error('sensitive verification detail'), {
    code: 'jwt_claims_invalid',
  });
  const failedVerification = createHarness({ verifyError: verificationError });
  const verificationState = await failedVerification.controller.startJwtLogin(syntheticJwt());
  assert.deepEqual(verificationState, {
    phase: 'failed',
    message: 'JWT 不符合 Codex Agent Identity 要求，可能不是此类凭证或已过期',
    email: null,
    plan: null,
  });
  assert.doesNotMatch(JSON.stringify(failedVerification.chromeApi.messages), /sensitive verification detail/);
});

test('signature failures identify a JWT that was not issued for this Codex flow', async () => {
  for (const code of ['jwt_signing_key_missing', 'jwt_signature_invalid']) {
    const verificationError = Object.assign(new Error('sensitive verification detail'), { code });
    const harness = createHarness({ verifyError: verificationError });

    const state = await harness.controller.startJwtLogin(syntheticJwt());

    assert.deepEqual(state, {
      phase: 'failed',
      message: 'JWT 签名与当前 Codex Agent Identity 不匹配',
      email: null,
      plan: null,
    });
    assert.doesNotMatch(JSON.stringify(harness.chromeApi.messages), /sensitive verification detail/);
  }
});

test('controller state persists when no visible extension page is listening', async () => {
  const harness = createHarness({ rejectMessages: true });

  const state = await harness.controller.startJwtLogin(syntheticJwt());

  assert.equal(state.phase, 'authenticated');
  assert.equal(harness.chromeApi.data.codex_jwt_auth_attempt, undefined);
});

test('clear prevents a late JWT verification result from restoring authenticated state', async () => {
  const fetchStarted = createDeferred();
  const responseDeferred = createDeferred();
  const harness = createHarness({
    fetchImpl: async () => {
      fetchStarted.resolve();
      return responseDeferred.promise;
    },
  });

  const pendingLogin = harness.controller.startJwtLogin(syntheticJwt());
  await fetchStarted.promise;
  await harness.controller.clear();
  responseDeferred.resolve({
    ok: true,
    async json() {
      return { keys: [{ kid: 'fixture-key' }] };
    },
  });
  await pendingLogin;

  assert.deepEqual(await harness.controller.getPublicState(), {
    phase: 'idle',
    message: '等待登录',
    email: null,
    plan: null,
  });
  assert.equal(harness.chromeApi.data.codex_jwt_auth_attempt, undefined);
  assert.equal(harness.chromeApi.data.codex_jwt_auth_public_state.phase, 'idle');
});
