'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyRegistrationPage,
  fetchRegistrationEmailVerificationCode,
} = require('../src/auto/roxy_register_openai.js');

test('classifies a ChatGPT auth error before treating the host as a session', async () => {
  const hidden = {
    first() { return this; },
    async isVisible() { return false; },
  };
  const page = {
    url() { return 'https://chatgpt.com/auth/error?error=callback'; },
    async title() { return 'ChatGPT'; },
    locator() { return hidden; },
  };

  const state = await classifyRegistrationPage(page, {
    passwordSubmitted: true,
    timeoutMs: 100,
  });

  assert.equal(state.state, 'auth-error');
});

test('retries a transient external email-code request before accepting the OTP', async () => {
  let requests = 0;
  const page = {
    request: {
      async get() {
        requests += 1;
        if (requests === 1) {
          throw new Error('net::ERR_CONNECTION_RESET');
        }
        return {
          async text() {
            return JSON.stringify({ code: '123456' });
          },
        };
      },
    },
  };

  const code = await fetchRegistrationEmailVerificationCode(page, 'new.user@example.test', {
    registrationEmailCodeApiUrl: 'https://mail.example.test/code',
    codePollMaxAttempts: 2,
    codePollIntervalMs: 1,
    logger: { log() {}, warn() {} },
  });

  assert.equal(code, '123456');
  assert.equal(requests, 2);
});
