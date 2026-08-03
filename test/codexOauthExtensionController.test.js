import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { createAuthController } from '../extensions/codex-oauth-login/lib/auth-controller.js';

function encodeJwt(payload) {
  return [
    'header',
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

function createChromeApi({ rejectMessages = false } = {}) {
  const data = {};
  const alarms = new Map();
  const messages = [];

  return {
    data,
    alarms,
    messages,
    tabs: {
      created: [],
      async create(options) {
        this.created.push(options);
        return { id: 41 };
      },
    },
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
    alarms: {
      async create(name, details) {
        alarms.set(name, details);
      },
      async clear(name) {
        alarms.delete(name);
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

function createFetch(response) {
  const calls = [];
  return {
    calls,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return response;
    },
  };
}

function createHarness({ rejectMessages = false, response, tokenResponse, nowMs = 1_000 } = {}) {
  const chromeApi = createChromeApi({ rejectMessages });
  const fetch = createFetch(response || {
    ok: true,
    async json() {
      return tokenResponse || {
        access_token: encodeJwt({
          'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' },
        }),
        id_token: encodeJwt({ email: 'friend@example.com' }),
        refresh_token: 'rt-test-value',
      };
    },
  });
  let currentNow = nowMs;
  const controller = createAuthController({
    chromeApi,
    cryptoApi: webcrypto,
    fetchImpl: fetch.fetchImpl,
    now: () => currentNow,
  });

  return {
    chromeApi,
    controller,
    fetch,
    setNow(value) {
      currentNow = value;
    },
  };
}

async function startAndGetTransaction(harness) {
  await harness.controller.startAuthorization();
  return harness.chromeApi.data.codex_oauth_transaction;
}

test('matching callback in the authorization tab exchanges once and publishes redacted success', async () => {
  const harness = createHarness();
  const transaction = await startAndGetTransaction(harness);

  await harness.controller.handleBeforeNavigate({
    tabId: 42,
    url: `http://localhost:1455/auth/callback?code=code-one&state=${transaction.state}`,
  });
  assert.equal(harness.fetch.calls.length, 0);

  await harness.controller.handleBeforeNavigate({
    tabId: 41,
    url: `http://localhost:1455/auth/callback?code=code-one&state=${transaction.state}`,
  });
  await harness.controller.handleBeforeNavigate({
    tabId: 41,
    url: `http://localhost:1455/auth/callback?code=code-one&state=${transaction.state}`,
  });

  assert.equal(harness.fetch.calls.length, 1);
  assert.deepEqual(await harness.controller.getPublicState(), {
    phase: 'authenticated',
    message: '登录成功',
    email: 'friend@example.com',
    plan: 'plus',
    canDownloadRt: true,
  });
  assert.equal(harness.chromeApi.data.codex_oauth_transaction, undefined);
  assert.equal(harness.chromeApi.data.codex_oauth_result.refreshToken, 'rt-test-value');
  assert.match(harness.fetch.calls[0].url, /oauth\/token$/);
  assert.equal(harness.fetch.calls[0].options.credentials, 'omit');

  const published = JSON.stringify(harness.chromeApi.messages);
  assert.doesNotMatch(published, /code-one|rt-test-value|refresh_token/);
});

test('matching callback with a wrong state fails closed without token exchange', async () => {
  const harness = createHarness();
  await startAndGetTransaction(harness);

  await harness.controller.handleBeforeNavigate({
    tabId: 41,
    url: 'http://localhost:1455/auth/callback?code=code-one&state=wrong-state',
  });

  assert.equal(harness.fetch.calls.length, 0);
  assert.deepEqual(await harness.controller.getPublicState(), {
    phase: 'failed',
    message: 'OAuth 回调校验失败',
    email: null,
    plan: null,
    canDownloadRt: false,
  });
  assert.equal(harness.chromeApi.data.codex_oauth_transaction, undefined);
  assert.equal(harness.chromeApi.data.codex_oauth_result, undefined);
});

test('OAuth callback error and a missing RT are terminal failures', async () => {
  const callbackFailure = createHarness();
  const callbackTransaction = await startAndGetTransaction(callbackFailure);

  await callbackFailure.controller.handleBeforeNavigate({
    tabId: 41,
    url: `http://localhost:1455/auth/callback?error=login_required&state=${callbackTransaction.state}`,
  });
  assert.equal(callbackFailure.fetch.calls.length, 0);
  assert.equal((await callbackFailure.controller.getPublicState()).phase, 'failed');

  const missingRt = createHarness({
    tokenResponse: {
      access_token: encodeJwt({}),
      id_token: encodeJwt({ email: 'friend@example.com' }),
    },
  });
  const missingRtTransaction = await startAndGetTransaction(missingRt);
  await missingRt.controller.handleBeforeNavigate({
    tabId: 41,
    url: `http://localhost:1455/auth/callback?code=code-one&state=${missingRtTransaction.state}`,
  });
  assert.equal((await missingRt.controller.getPublicState()).phase, 'failed');
  assert.equal(missingRt.chromeApi.data.codex_oauth_result, undefined);
});

test('failed token response clears the transaction without exposing its response body', async () => {
  const harness = createHarness({
    response: {
      ok: false,
      async json() {
        return { error_description: 'server-detail-that-must-not-reach-the-user' };
      },
    },
  });
  const transaction = await startAndGetTransaction(harness);

  await harness.controller.handleBeforeNavigate({
    tabId: 41,
    url: `http://localhost:1455/auth/callback?code=code-one&state=${transaction.state}`,
  });

  assert.deepEqual(await harness.controller.getPublicState(), {
    phase: 'failed',
    message: '凭证兑换失败',
    email: null,
    plan: null,
    canDownloadRt: false,
  });
  assert.equal(harness.chromeApi.data.codex_oauth_transaction, undefined);
  assert.equal(harness.chromeApi.data.codex_oauth_result, undefined);
  assert.doesNotMatch(JSON.stringify(harness.chromeApi.messages), /server-detail-that-must-not-reach-the-user/);
});

test('expiry alarm and closing the authorization tab clear private state', async () => {
  const expiry = createHarness();
  await startAndGetTransaction(expiry);
  await expiry.controller.handleAlarm('codex_oauth_transaction_expiry');
  assert.equal((await expiry.controller.getPublicState()).phase, 'idle');
  assert.equal(expiry.chromeApi.data.codex_oauth_transaction, undefined);

  const close = createHarness();
  await startAndGetTransaction(close);
  await close.controller.handleTabRemoved(41);
  assert.equal((await close.controller.getPublicState()).phase, 'idle');
  assert.equal(close.chromeApi.data.codex_oauth_transaction, undefined);
});

test('state persistence does not depend on a visible extension page receiving notifications', async () => {
  const harness = createHarness({ rejectMessages: true });

  const state = await harness.controller.startAuthorization();

  assert.equal(state.phase, 'authorizing');
  assert.equal(harness.chromeApi.data.codex_oauth_transaction.authTabId, 41);
});
