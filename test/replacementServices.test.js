import assert from 'node:assert/strict';
import test from 'node:test';

import { createReplacementServices } from '../src/replacementServices.js';

function okResponse(body) {
  return {
    ok: true,
    status: 200,
    async text() {
      return body;
    },
  };
}

function errorResponse(status, body = '') {
  return {
    ok: false,
    status,
    async text() {
      return body;
    },
  };
}

test('fetchSmsCode extracts code from top-level JSON code field', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('{"code":"123456"}'),
  });

  assert.equal(await services.fetchSmsCode('https://example.invalid/sms'), '123456');
});

test('fetchSmsCode extracts code from nested JSON data.code field', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('{"data":{"code":"234567"}}'),
  });

  assert.equal(await services.fetchSmsCode('https://example.invalid/sms'), '234567');
});

test('fetchSmsCode extracts first six digit code from text', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('Your code is 345678.'),
  });

  assert.equal(await services.fetchSmsCode('https://example.invalid/sms'), '345678');
});

test('fetchSmsCode rejects responses without a verification code', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('no code here'),
  });

  await assert.rejects(
    () => services.fetchSmsCode('https://example.invalid/sms'),
    /SMS_FETCH_FAILED/,
  );
});

test('fetchJson returns raw JSON string and rejects non-2xx', async () => {
  const services = createReplacementServices({
    fetchImpl: async (url) => {
      if (url.includes('fail')) return errorResponse(500);
      return okResponse('{"ok":true}');
    },
  });

  assert.equal(await services.fetchJson('https://example.invalid/account.json'), '{"ok":true}');
  await assert.rejects(
    () => services.fetchJson('https://example.invalid/fail.json'),
    /JSON_FETCH_FAILED/,
  );
});

test('replaceAccount uses injected automation and otherwise reports unconfigured service', async () => {
  const configured = createReplacementServices({
    replacementAutomation: {
      async replaceAccount(account) {
        return { ok: true, email: account.email };
      },
    },
  });
  const unconfigured = createReplacementServices();

  assert.deepEqual(await configured.replaceAccount({ email: 'user@example.com' }), {
    ok: true,
    email: 'user@example.com',
  });
  await assert.rejects(
    () => unconfigured.replaceAccount({ email: 'user@example.com' }),
    /REPLACE_NOT_CONFIGURED/,
  );
});
