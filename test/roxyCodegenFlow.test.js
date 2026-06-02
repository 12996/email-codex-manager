import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

function createPageHarness({ subtitleText = 'user@example.com', selectorDelayMs = 0 } = {}) {
  const calls = [];
  const emailInput = {
    async waitFor(options) { calls.push(['email.waitFor', options]); },
    async click() { calls.push(['email.click']); },
    async fill(value) { calls.push(['email.fill', value]); },
  };
  const continueButton = {
    async click(options) { calls.push(['continue.click', options]); },
  };
  const subtitleLocator = {
    async waitFor(options) {
      calls.push(['subtitle.waitFor', options]);
      if (selectorDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, selectorDelayMs));
      }
    },
    async innerText() {
      calls.push(['subtitle.innerText']);
      return subtitleText;
    },
  };
  const page = {
    getByRole(role, options) {
      calls.push(['getByRole', role, options]);
      if (role === 'textbox') {
        return emailInput;
      }
      return continueButton;
    },
    locator(selector) {
      calls.push(['locator', selector]);
      return subtitleLocator;
    },
    url() {
      return 'https://auth.openai.com/log-in';
    },
    async title() {
      return 'Welcome back - OpenAI';
    },
    async textContent(selector) {
      calls.push(['textContent', selector]);
      return 'OpenAI login page body';
    },
  };
  return { page, calls };
}

test('openAi_login fills passed email, clicks Continue, then checks displayed session email', async () => {
  const { openAi_login } = require('../scripts/roxy-codegen.cjs');
  const { page, calls } = createPageHarness({ subtitleText: 'smiro4099+s1@gmail.com' });

  const result = await openAi_login(page, 'smiro4099+s1@gmail.com', {
    timeoutMs: 100,
  });

  assert.equal(result.status, 'session-email-confirmed');
  assert.equal(result.email, 'smiro4099+s1@gmail.com');
  assert.deepEqual(calls.slice(0, 6), [
    ['getByRole', 'textbox', { name: 'Email address' }],
    ['email.waitFor', { state: 'visible', timeout: 100 }],
    ['email.click'],
    ['email.fill', 'smiro4099+s1@gmail.com'],
    ['getByRole', 'button', { name: 'Continue', exact: true }],
    ['continue.click', { timeout: 100 }],
  ]);
});

test('session_check throws OPENAI_LOGIN_EMAIL_MISMATCH when displayed email differs', async () => {
  const { session_check } = require('../scripts/roxy-codegen.cjs');
  const { page } = createPageHarness({ subtitleText: 'other@gmail.com' });

  await assert.rejects(
    () => session_check(page, 'smiro4099+s1@gmail.com', { timeoutMs: 100 }),
    (error) => {
      assert.equal(error.code, 'OPENAI_LOGIN_EMAIL_MISMATCH');
      assert.equal(error.expectedEmail, 'smiro4099+s1@gmail.com');
      assert.equal(error.actualText, 'other@gmail.com');
      return true;
    }
  );
});

test('session_check throws OPENAI_LOGIN_TIMEOUT when displayed email does not appear in time', async () => {
  const { session_check } = require('../scripts/roxy-codegen.cjs');
  const { page } = createPageHarness({ subtitleText: 'smiro4099+s1@gmail.com', selectorDelayMs: 50 });

  await assert.rejects(
    () => session_check(page, 'smiro4099+s1@gmail.com', { timeoutMs: 1 }),
    (error) => {
      assert.equal(error.code, 'OPENAI_LOGIN_TIMEOUT');
      assert.equal(error.email, 'smiro4099+s1@gmail.com');
      assert.equal(error.url, 'https://auth.openai.com/log-in');
      return true;
    }
  );
});
