import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const require = createRequire(import.meta.url);

function createOpenAiPageHarness(bodyText) {
  const calls = [];
  const codeInput = {
    async waitFor(options) { calls.push(['code.waitFor', options]); },
    async click() { calls.push(['code.click']); },
    async fill(value) { calls.push(['code.fill', value]); },
    async isVisible() { calls.push(['code.isVisible']); return bodyText.includes('Code'); },
  };
  const continueButton = {
    async click(options) { calls.push(['continue.click', options]); },
    async isVisible() { calls.push(['continue.isVisible']); return bodyText.includes('Continue'); },
  };
  const bodyLocator = {
    async textContent() {
      calls.push(['body.textContent']);
      return bodyText;
    },
  };
  const page = {
    getByRole(role, options) {
      calls.push(['getByRole', role, options]);
      if (role === 'textbox') {
        return codeInput;
      }
      return continueButton;
    },
    locator(selector) {
      calls.push(['locator', selector]);
      return bodyLocator;
    },
    request: {
      async post(url, options) {
        calls.push(['request.post', url, options]);
        return {
          async json() {
            calls.push(['request.json']);
            return { ok: true, code: '687664' };
          },
        };
      },
    },
    url() {
      return 'https://auth.openai.com/log-in';
    },
    async title() {
      return 'Welcome back - OpenAI';
    },
    async textContent(selector) {
      calls.push(['textContent', selector]);
      return bodyText;
    },
  };
  return { page, calls };
}

function createPhoneVerifyPageHarness(bodyText) {
  const calls = [];
  const textMessageRadio = {
    async check(options) { calls.push(['textMessage.check', options]); },
    async isVisible() { calls.push(['textMessage.isVisible']); return bodyText.includes('Text Message'); },
  };
  const continueButton = {
    async click(options) { calls.push(['continue.click', options]); },
    async isVisible() { calls.push(['continue.isVisible']); return bodyText.includes('Continue'); },
  };
  const codeInput = {
    async waitFor(options) { calls.push(['code.waitFor', options]); },
    async click() { calls.push(['code.click']); },
    async fill(value) { calls.push(['code.fill', value]); },
    async isVisible() { calls.push(['code.isVisible']); return bodyText.includes('Code'); },
  };
  const bodyLocator = {
    async textContent() {
      calls.push(['body.textContent']);
      return bodyText;
    },
  };
  const page = {
    getByRole(role, options) {
      calls.push(['getByRole', role, options]);
      if (role === 'radio') return textMessageRadio;
      if (role === 'textbox') return codeInput;
      return continueButton;
    },
    locator(selector) {
      calls.push(['locator', selector]);
      return bodyLocator;
    },
    url() {
      return 'https://auth.openai.com/log-in';
    },
    async title() {
      return 'Phone verification - OpenAI';
    },
    async textContent(selector) {
      calls.push(['textContent', selector]);
      return bodyText;
    },
  };
  return { page, calls };
}

function createOpenAiLoginPageHarness({ subtitleText = 'user@example.com', emailVisible = true } = {}) {
  const calls = [];
  let currentUrl = 'https://auth.openai.com/log-in';
  const emailInput = {
    async waitFor(options) { calls.push(['email.waitFor', options]); },
    async click() { calls.push(['email.click']); },
    async fill(value) { calls.push(['email.fill', value]); },
    async isVisible() { calls.push(['email.isVisible']); return emailVisible; },
  };
  const continueButton = {
    async click(options) {
      calls.push(['continue.click', options]);
      currentUrl = 'https://auth.openai.com/email-verification';
    },
  };
  const subtitleLocator = {
    async waitFor(options) { calls.push(['subtitle.waitFor', options]); },
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
      return currentUrl;
    },
    async title() {
      return 'Welcome back - OpenAI';
    },
    async textContent(selector) {
      calls.push(['textContent', selector]);
      return 'OpenAI login page body';
    },
    async waitForTimeout(ms) {
      calls.push(['waitForTimeout', ms]);
    },
  };
  return { page, calls };
}

test('is_openai_login_page detects the OpenAI email input screen', async () => {
  const { is_openai_login_page } = require('../src/auto/roxy_oauth_login.js');
  const { page } = createOpenAiLoginPageHarness({ emailVisible: true });

  assert.equal(await is_openai_login_page(page, { timeoutMs: 100 }), true);
});

test('openAi_login fills email, clicks Continue, then waits for email verification page', async () => {
  const { openAi_login } = require('../src/auto/roxy_oauth_login.js');
  const { page, calls } = createOpenAiLoginPageHarness({
    subtitleText: 'smiro4099+s1@gmail.com',
  });

  const result = await openAi_login(page, 'smiro4099+s1@gmail.com', { timeoutMs: 100 });

  assert.equal(result.status, 'email-submitted');
  assert.equal(result.email, 'smiro4099+s1@gmail.com');
  assert.equal(result.nextStatus, 'email-verification-page');
  assert.equal(result.url, 'https://auth.openai.com/email-verification');
  assert.deepEqual(calls.slice(0, 6), [
    ['getByRole', 'textbox', { name: 'Email address' }],
    ['email.isVisible'],
    ['getByRole', 'textbox', { name: 'Email address' }],
    ['email.waitFor', { state: 'visible', timeout: 100 }],
    ['email.click'],
    ['email.fill', 'smiro4099+s1@gmail.com'],
  ]);
  assert.deepEqual(calls.filter((call) => call[0] === 'continue.click'), [
    ['continue.click', { timeout: 100 }],
  ]);
});

test('session_check rejects when displayed email differs', async () => {
  const { session_check } = require('../src/auto/roxy_oauth_login.js');
  const { page } = createOpenAiLoginPageHarness({ subtitleText: 'other@gmail.com' });

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

test('is_email_code_page detects the email verification code screen from English keywords', async () => {
  const { is_email_code_page } = require('../src/auto/roxy_oauth_login.js');
  const { page } = createOpenAiPageHarness('Enter the code sent to your email. Code Continue');

  assert.equal(await is_email_code_page(page, { timeoutMs: 100 }), true);
});

test('is_email_code_page does not misclassify Codex consent text as email code page', async () => {
  const { is_email_code_page } = require('../src/auto/roxy_oauth_login.js');
  const { page } = createOpenAiPageHarness(
    'Sign in to Codex with ChatGPT. jregkolpig+s4@gmail.com Codex makes mistakes. Review the code it writes. Continue'
  );

  assert.equal(await is_email_code_page(page, { timeoutMs: 100 }), false);
});

test('openAi_email_code fetches latest code by API, fills Code, and clicks Continue', async () => {
  const { openAi_email_code } = require('../src/auto/roxy_oauth_login.js');
  const { page, calls } = createOpenAiPageHarness('Enter the code sent to your email. Code Continue');

  const result = await openAi_email_code(page, 'smiro4099+s1@gmail.com', {
    verificationApiUrl: 'http://127.0.0.1:3000/api/verification-code/latest',
    timeoutMs: 100,
  });

  assert.deepEqual(result, {
    status: 'email-code-submitted',
    email: 'smiro4099+s1@gmail.com',
    code: '687664',
  });
  assert.deepEqual(calls.filter((call) => ['request.post', 'code.fill', 'continue.click'].includes(call[0])), [
    ['request.post', 'http://127.0.0.1:3000/api/verification-code/latest', {
      data: { account: 'smiro4099+s1@gmail.com' },
      headers: { Cookie: 'admin_auth=s%3A1.VU9C5Zr7JzIEl761twodGqwXJydas1N5tQ%2Fa1LdNwG8' },
      timeout: 100,
    }],
    ['code.fill', '687664'],
    ['continue.click', { timeout: 100 }],
  ]);
});

test('openAi_email_code sends configured admin_auth cookie when fetching email code', async () => {
  const { openAi_email_code } = require('../src/auto/roxy_oauth_login.js');
  const { page, calls } = createOpenAiPageHarness('Enter the code sent to your email. Code Continue');

  await openAi_email_code(page, 'jregkolpig+s2@gmail.com', {
    verificationApiUrl: 'http://127.0.0.1:3000/api/verification-code/latest',
    adminAuthCookie: 's%3Atest-cookie',
    timeoutMs: 100,
  });

  const postCall = calls.find((call) => call[0] === 'request.post');
  assert.deepEqual(postCall[2], {
    data: { account: 'jregkolpig+s2@gmail.com' },
    headers: { Cookie: 'admin_auth=s%3Atest-cookie' },
    timeout: 100,
  });
});

test('openAi_email_code polls email verification API until a valid code is available', async () => {
  const { openAi_email_code } = require('../src/auto/roxy_oauth_login.js');
  const { page, calls } = createOpenAiPageHarness('Enter the code sent to your email. Code Continue');
  const waits = [];
  let attempts = 0;
  page.request.post = async (url, options) => {
    calls.push(['request.post', url, options]);
    attempts += 1;
    return {
      async json() {
        return attempts < 3
          ? { ok: true, code: '' }
          : { ok: true, code: '112233' };
      },
    };
  };

  const result = await openAi_email_code(page, 'jregkolpig+s2@gmail.com', {
    timeoutMs: 100,
    codePollIntervalMs: 1,
    codePollMaxAttempts: 3,
    waitForTimeout: async (ms) => waits.push(ms),
  });

  assert.equal(result.code, '112233');
  assert.equal(calls.filter((call) => call[0] === 'request.post').length, 3);
  assert.deepEqual(waits, [1, 1]);
});

test('openAi_email_code stops filling when email code polling lands on Codex consent page', async () => {
  const { openAi_email_code } = require('../src/auto/roxy_oauth_login.js');
  const calls = [];
  let stage = 'email-code';
  const roleCodeInput = {
    async isVisible() { calls.push(['roleCode.isVisible', stage]); return stage === 'email-code'; },
    async waitFor() {
      calls.push(['roleCode.waitFor', stage]);
      if (stage !== 'email-code') throw new Error('Code input is gone');
    },
    async click() { calls.push(['roleCode.click']); },
    async fill(value) { calls.push(['roleCode.fill', value]); },
  };
  const continueButton = {
    async isVisible() { calls.push(['continue.isVisible', stage]); return true; },
    async click(options) { calls.push(['continue.click', options, stage]); },
  };
  const fallbackInput = {
    async waitFor(options) {
      calls.push(['fallback.waitFor', options, stage]);
      if (stage !== 'email-code') throw new Error('fallback input is gone');
    },
    async click() { calls.push(['fallback.click']); },
    async fill(value) { calls.push(['fallback.fill', value]); },
  };
  const page = {
    getByRole(role) {
      calls.push(['getByRole', role, stage]);
      if (role === 'textbox') return roleCodeInput;
      return continueButton;
    },
    locator(selector) {
      calls.push(['locator', selector, stage]);
      if (selector === 'body') {
        return {
          async textContent() {
            if (stage === 'email-code') return 'Enter the code sent to your email. Code Continue';
            return 'Sign in to Codex with ChatGPT. Codex will not receive your chat history. Continue';
          },
        };
      }
      return { first: () => fallbackInput };
    },
    request: {
      async post() {
        calls.push(['request.post', stage]);
        stage = 'codex';
        return { async json() { return { ok: true, code: '112233' }; } };
      },
    },
    url() {
      return stage === 'email-code'
        ? 'https://auth.openai.com/email-verification'
        : 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent';
    },
    title: async () => 'OAuth',
    async textContent() {
      if (stage === 'email-code') return 'Enter the code sent to your email. Code Continue';
      return 'Sign in to Codex with ChatGPT. Codex will not receive your chat history. Continue';
    },
  };

  const result = await openAi_email_code(page, 'jregkolpig+s2@gmail.com', { timeoutMs: 100 });

  assert.deepEqual(result, { status: 'next-stage', next: 'codex-login' });
  assert.equal(calls.some((call) => call[0] === 'roleCode.fill'), false);
  assert.equal(calls.some((call) => call[0] === 'fallback.fill'), false);
  assert.equal(calls.some((call) => call[0] === 'continue.click'), false);
});

test('openAi_email_code falls back to numeric input selector when role Code is unstable', async () => {
  const { openAi_email_code } = require('../src/auto/roxy_oauth_login.js');
  const calls = [];
  const roleCodeInput = {
    async isVisible() { calls.push(['roleCode.isVisible']); return true; },
    async waitFor() { calls.push(['roleCode.waitFor']); throw new Error('role input detached'); },
  };
  const fallbackInput = {
    async waitFor(options) { calls.push(['fallback.waitFor', options]); },
    async click() { calls.push(['fallback.click']); },
    async fill(value) { calls.push(['fallback.fill', value]); },
  };
  const page = {
    getByRole(role) {
      calls.push(['getByRole', role]);
      if (role === 'textbox') return roleCodeInput;
      return { async click(options) { calls.push(['continue.click', options]); } };
    },
    locator(selector) {
      calls.push(['locator', selector]);
      if (selector === 'body') {
        return { async textContent() { return 'Enter the code sent to your email. Code Continue'; } };
      }
      return { first: () => fallbackInput };
    },
    request: {
      async post() {
        return { async json() { return { ok: true, code: '654321' }; } };
      },
    },
    url: () => 'https://auth.openai.com/email-verification',
    title: async () => 'Verification',
    textContent: async () => 'Enter the code sent to your email. Code Continue',
  };

  const result = await openAi_email_code(page, 'jregkolpig+s2@gmail.com', { timeoutMs: 100 });

  assert.equal(result.code, '654321');
  assert.deepEqual(calls.filter((call) => ['roleCode.waitFor', 'fallback.fill', 'continue.click'].includes(call[0])), [
    ['roleCode.waitFor'],
    ['fallback.fill', '654321'],
    ['continue.click', { timeout: 100 }],
  ]);
});

test('openAi_email_code accepts a direct code without requiring email', async () => {
  const { openAi_email_code } = require('../src/auto/roxy_oauth_login.js');
  const { page, calls } = createOpenAiPageHarness('Enter the code sent to your email. Code Continue');

  const result = await openAi_email_code(page, '', {
    code: '197768',
    timeoutMs: 100,
  });

  assert.deepEqual(result, {
    status: 'email-code-submitted',
    email: '',
    code: '197768',
  });
  assert.deepEqual(calls.filter((call) => ['request.post', 'code.fill', 'continue.click'].includes(call[0])), [
    ['code.fill', '197768'],
    ['continue.click', { timeout: 100 }],
  ]);
});

test('captureFailureScreenshot saves a timestamped step screenshot without sensitive filename data', async () => {
  const { captureFailureScreenshot } = require('../src/auto/roxy_oauth_login.js');
  const debugImageDir = await mkdtemp(join(tmpdir(), 'roxy-oauth-debug-'));
  const screenshotCalls = [];
  const page = {
    async screenshot(options) {
      screenshotCalls.push(options);
    },
  };
  const error = new Error('failed after API fetch');

  try {
    const screenshotPath = await captureFailureScreenshot(page, error, 'email-code-submit', {
      debugImageDir,
      verificationApiUrl: 'https://secret.example.test/path?token=do-not-leak',
    });

    assert.equal(error.debugScreenshotPath, screenshotPath);
    assert.equal(screenshotCalls.length, 1);
    assert.equal(screenshotCalls[0].path, screenshotPath);
    assert.match(screenshotPath, /debug|roxy-oauth-debug/);
    assert.match(screenshotPath, /\d{8}-\d{6}-\d{3}-email-code-submit\.png$/);
    assert.doesNotMatch(screenshotPath, /secret|token|do-not-leak/);
  } finally {
    await rm(debugImageDir, { recursive: true, force: true });
  }
});

test('openAi_email_code captures failure screenshot and preserves the original error', async () => {
  const { openAi_email_code } = require('../src/auto/roxy_oauth_login.js');
  const debugImageDir = await mkdtemp(join(tmpdir(), 'roxy-oauth-debug-'));
  const { page } = createOpenAiPageHarness('Enter the code sent to your email. Code Continue');
  const screenshotCalls = [];
  page.screenshot = async (options) => {
    screenshotCalls.push(options);
  };
  page.request.post = async () => ({
    async json() {
      return { ok: false, code: '' };
    },
  });

  try {
    await assert.rejects(
      () => openAi_email_code(page, 'smiro4099+s1@gmail.com', {
        verificationApiUrl: 'http://127.0.0.1:3000/api/verification-code/latest',
        timeoutMs: 100,
        codePollMaxAttempts: 1,
        debugImageDir,
      }),
      (error) => {
        assert.equal(error.code, 'OPENAI_EMAIL_CODE_FETCH_FAILED');
        assert.equal(screenshotCalls.length, 1);
        assert.equal(error.debugScreenshotPath, screenshotCalls[0].path);
        assert.match(error.debugScreenshotPath, /\d{8}-\d{6}-\d{3}-openAi_email_code\.png$/);
        assert.doesNotMatch(error.debugScreenshotPath, /smiro4099|gmail|verification-code|latest/);
        return true;
      }
    );
  } finally {
    await rm(debugImageDir, { recursive: true, force: true });
  }
});

test('openAi_email_code can disable failure screenshots', async () => {
  const { openAi_email_code } = require('../src/auto/roxy_oauth_login.js');
  const { page } = createOpenAiPageHarness('unexpected page');
  let screenshotCalled = false;
  page.screenshot = async () => {
    screenshotCalled = true;
  };

  await assert.rejects(
    () => openAi_email_code(page, 'smiro4099+s1@gmail.com', {
      timeoutMs: 100,
      disableFailureScreenshot: true,
    }),
    (error) => {
      assert.equal(error.code, 'OPENAI_EMAIL_CODE_PAGE_NOT_FOUND');
      assert.equal(error.debugScreenshotPath, undefined);
      assert.equal(screenshotCalled, false);
      return true;
    }
  );
});

test('is_phone_verify_page detects the phone number verification screen', async () => {
  const { is_phone_verify_page } = require('../src/auto/roxy_oauth_login.js');
  const { page } = createPhoneVerifyPageHarness('Verify your phone number Text Message Continue');

  assert.equal(await is_phone_verify_page(page, { timeoutMs: 100 }), true);
});

test('openAi_phone_verify selects Text Message and clicks Continue', async () => {
  const { openAi_phone_verify } = require('../src/auto/roxy_oauth_login.js');
  const { page, calls } = createPhoneVerifyPageHarness('Verify your phone number Text Message Continue');

  const result = await openAi_phone_verify(page, { timeoutMs: 100 });

  assert.deepEqual(result, { status: 'phone-verify-submitted', method: 'Text Message' });
  assert.deepEqual(calls.filter((call) => ['textMessage.check', 'continue.click'].includes(call[0])), [
    ['textMessage.check', { timeout: 100 }],
    ['continue.click', { timeout: 100 }],
  ]);
});

test('is_phone_code_page detects the phone verification code screen', async () => {
  const { is_phone_code_page } = require('../src/auto/roxy_oauth_login.js');
  const { page } = createPhoneVerifyPageHarness('Check your phone Enter the verification code Code Continue');

  assert.equal(await is_phone_code_page(page, { timeoutMs: 100 }), true);
});

test('fetchPhoneVerificationCode extracts a continuous 6-digit code from SMS API text', async () => {
  const { fetchPhoneVerificationCode } = require('../src/auto/roxy_oauth_login.js');
  const calls = [];
  const code = await fetchPhoneVerificationCode({
    smsApiUrl: 'https://cdc.smslease.link/adminapi/jsscript/smsInfo/ABC_sms?key=test',
    timeoutMs: 100,
    fetch: async (url, options) => {
      calls.push(['fetch', url, options.method]);
      return {
        async text() {
          calls.push(['response.text']);
          return 'yes|Your OpenAI verification code is: 798824';
        },
      };
    },
  });

  assert.equal(code, '798824');
  assert.deepEqual(calls, [
    ['fetch', 'https://cdc.smslease.link/adminapi/jsscript/smsInfo/ABC_sms?key=test', 'GET'],
    ['response.text'],
  ]);
});

test('fetchPhoneVerificationCode polls SMS API until a valid code is available', async () => {
  const { fetchPhoneVerificationCode } = require('../src/auto/roxy_oauth_login.js');
  const waits = [];
  const calls = [];
  let attempts = 0;

  const code = await fetchPhoneVerificationCode({
    smsApiUrl: 'https://cdc.smslease.link/adminapi/jsscript/smsInfo/ABC_sms?key=test',
    timeoutMs: 100,
    codePollIntervalMs: 1,
    codePollMaxAttempts: 3,
    waitForTimeout: async (ms) => waits.push(ms),
    fetch: async (url, options) => {
      calls.push(['fetch', url, options.method]);
      attempts += 1;
      return {
        async text() {
          return attempts < 3 ? 'no sms yet' : 'yes|Your OpenAI verification code is: 798824';
        },
      };
    },
  });

  assert.equal(code, '798824');
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [1, 1]);
});

test('openAi_phone_code fills Code and clicks Continue with a direct code', async () => {
  const { openAi_phone_code } = require('../src/auto/roxy_oauth_login.js');
  const { page, calls } = createPhoneVerifyPageHarness('Check your phone Enter the verification code Code Continue');

  const result = await openAi_phone_code(page, {
    code: '798824',
    timeoutMs: 100,
  });

  assert.deepEqual(result, {
    status: 'phone-code-submitted',
    code: '798824',
  });
  assert.deepEqual(calls.filter((call) => ['code.fill', 'continue.click'].includes(call[0])), [
    ['code.fill', '798824'],
    ['continue.click', { timeout: 100 }],
  ]);
});

test('openAi_phone_code stops filling when SMS polling lands on Codex consent page', async () => {
  const { openAi_phone_code } = require('../src/auto/roxy_oauth_login.js');
  const calls = [];
  let stage = 'phone-code';
  const page = {
    getByRole(role, options) {
      calls.push(['getByRole', role, options, stage]);
      if (role === 'textbox') {
        return {
          async isVisible() { return stage === 'phone-code'; },
          async waitFor() {
            calls.push(['code.waitFor', stage]);
            if (stage !== 'phone-code') throw new Error('Code input is gone');
          },
          async click() { calls.push(['code.click']); },
          async fill(value) { calls.push(['code.fill', value]); },
        };
      }
      return {
        async isVisible() { return true; },
        async click(options) { calls.push(['continue.click', options, stage]); },
      };
    },
    locator() {
      return {
        async textContent() {
          if (stage === 'phone-code') return 'Check your phone Enter the verification code Code Continue';
          return 'Sign in to Codex with ChatGPT. Codex will not receive your chat history. Continue';
        },
      };
    },
    url() {
      return stage === 'phone-code'
        ? 'https://auth.openai.com/phone-verification'
        : 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent';
    },
    async title() { return 'OAuth'; },
    async textContent() {
      if (stage === 'phone-code') return 'Check your phone Enter the verification code Code Continue';
      return 'Sign in to Codex with ChatGPT. Codex will not receive your chat history. Continue';
    },
  };

  const result = await openAi_phone_code(page, {
    timeoutMs: 100,
    fetch: async () => ({
      async text() {
        stage = 'codex';
        return 'yes|Your OpenAI verification code is: 798824';
      },
    }),
  });

  assert.deepEqual(result, { status: 'next-stage', next: 'codex-login' });
  assert.equal(calls.some((call) => call[0] === 'code.fill'), false);
  assert.equal(calls.some((call) => call[0] === 'continue.click'), false);
});

test('is_codex_login_page detects Codex consent page from English keywords', async () => {
  const { is_codex_login_page } = require('../src/auto/roxy_oauth_login.js');
  const { page } = createOpenAiPageHarness(
    'Sign in to Codex with ChatGPT. Codex will not receive your chat history. Continue'
  );

  assert.equal(await is_codex_login_page(page, { timeoutMs: 100 }), true);
});

test('codex_login clicks Continue on the Codex consent page', async () => {
  const { codex_login } = require('../src/auto/roxy_oauth_login.js');
  const { page, calls } = createOpenAiPageHarness(
    'Sign in to Codex with ChatGPT. Codex will not receive your chat history. Continue'
  );

  const result = await codex_login(page, { timeoutMs: 100 });

  assert.deepEqual(result, { status: 'codex-login-submitted' });
  assert.deepEqual(calls.filter((call) => call[0] === 'continue.click'), [
    ['continue.click', { timeout: 100 }],
  ]);
});

test('automation page actions log each visible step without leaking verification codes', async () => {
  const {
    codex_login,
    openAi_email_code,
    openAi_login,
    openAi_phone_code,
    openAi_phone_verify,
  } = require('../src/auto/roxy_oauth_login.js');
  const messages = [];
  const logger = {
    log(message) { messages.push(String(message)); },
    warn() {},
    error() {},
  };

  await openAi_login(
    createOpenAiLoginPageHarness({ subtitleText: 'user@example.com' }).page,
    'user@example.com',
    { timeoutMs: 100, logger },
  );
  await openAi_email_code(
    createOpenAiPageHarness('Enter the code sent to your email. Code Continue').page,
    'user@example.com',
    { timeoutMs: 100, logger },
  );
  await openAi_phone_verify(
    createPhoneVerifyPageHarness('Verify your phone number Text Message Continue').page,
    { timeoutMs: 100, logger },
  );
  await openAi_phone_code(
    createPhoneVerifyPageHarness('Check your phone Enter the verification code Code Continue').page,
    { code: '798824', timeoutMs: 100, logger },
  );
  await codex_login(
    createOpenAiPageHarness('Sign in to Codex with ChatGPT. Codex will not receive your chat history. Continue').page,
    { timeoutMs: 100, logger },
  );

  const text = messages.join('\n');
  assert.match(text, /phase=openai-email action=填写邮箱/);
  assert.match(text, /phase=openai-email-code action=请求邮箱验证码/);
  assert.match(text, /phase=openai-email-code action=填写邮箱验证码/);
  assert.match(text, /phase=openai-phone-verify action=选择短信验证方式/);
  assert.match(text, /phase=openai-phone-code action=填写手机验证码/);
  assert.match(text, /phase=codex-login action=点击授权继续/);
  assert.doesNotMatch(text, /687664|798824/);
});

test('codex_login treats click timeout as success when callback URL is already reached', async () => {
  const { codex_login } = require('../src/auto/roxy_oauth_login.js');
  let currentUrl = 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent';
  const page = {
    getByRole(role) {
      if (role === 'button') {
        return {
          async isVisible() { return true; },
          async click() {
            currentUrl = 'http://localhost:1455/auth/callback?code=code_ok&state=state_ok';
            throw new Error('locator.click: Timeout 60000ms exceeded');
          },
        };
      }
      return { async isVisible() { return false; } };
    },
    locator() {
      return { async textContent() { return 'Sign in to Codex with ChatGPT. Continue'; } };
    },
    url: () => currentUrl,
    title: async () => 'Sign in to Codex with ChatGPT - OpenAI',
    textContent: async () => 'Sign in to Codex with ChatGPT. Continue',
  };

  const result = await codex_login(page, { timeoutMs: 100 });

  assert.deepEqual(result, { status: 'codex-login-submitted', callbackReached: true });
});

test('codex_login listens for OAuth callback request before clicking Continue', async () => {
  const { codex_login } = require('../src/auto/roxy_oauth_login.js');
  const calls = [];
  const messages = [];
  let callbackResolver;
  const page = {
    waitForRequest(predicate) {
      calls.push(['waitForRequest']);
      const req = { url: () => 'http://localhost:1455/auth/callback?code=code_req&state=state_req' };
      assert.equal(predicate(req), true);
      return new Promise((resolve) => {
        callbackResolver = () => resolve(req);
      });
    },
    getByRole(role) {
      if (role === 'button') {
        return {
          async isVisible() { return true; },
          async click() {
            calls.push(['continue.click']);
            callbackResolver();
            await new Promise((resolve) => setTimeout(resolve, 30));
            throw new Error('locator.click: Timeout 30000ms exceeded');
          },
        };
      }
      return { async isVisible() { return false; } };
    },
    locator() {
      return { async textContent() { return 'Sign in to Codex with ChatGPT. Continue'; } };
    },
    url: () => 'chrome-error://chromewebdata/',
    title: async () => 'localhost',
    textContent: async () => 'Sign in to Codex with ChatGPT. Continue',
  };

  const result = await codex_login(page, {
    timeoutMs: 100,
    state: 'state_req',
    logger: { log: (message) => messages.push(String(message)), warn() {}, error() {} },
  });

  assert.deepEqual(result, { status: 'codex-login-submitted', callbackReached: true });
  assert.deepEqual(calls, [['waitForRequest'], ['continue.click']]);
  assert.match(messages.join('\n'), /phase=codex-login action=监听 OAuth callback/);
  assert.match(messages.join('\n'), /phase=codex-login action=捕获 OAuth callback source=request/);
});

test('codex_login treats a changed URL with matching code and state as OAuth success', async () => {
  const { codex_login } = require('../src/auto/roxy_oauth_login.js');
  const messages = [];
  let currentUrl = 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent';
  const page = {
    getByRole(role) {
      if (role === 'button') {
        return {
          async isVisible() { return true; },
          async click() {
            currentUrl = 'https://auth.openai.com/oauth/complete?code=code_url&state=state_url';
          },
        };
      }
      return { async isVisible() { return false; } };
    },
    locator() {
      return { async textContent() { return 'Sign in to Codex with ChatGPT. Continue'; } };
    },
    url: () => currentUrl,
    title: async () => 'Sign in to Codex with ChatGPT - OpenAI',
    textContent: async () => 'Sign in to Codex with ChatGPT. Continue',
    waitForTimeout: async () => {},
  };

  const result = await codex_login(page, {
    timeoutMs: 100,
    state: 'state_url',
    logger: { log: (message) => messages.push(String(message)), warn() {}, error() {} },
  });

  assert.deepEqual(result, { status: 'codex-login-submitted', callbackReached: true });
  assert.match(messages.join('\n'), /phase=codex-login action=URL 变化且包含 OAuth code\/state/);
  assert.match(messages.join('\n'), /phase=codex-login action=捕获 OAuth callback source=url-code-state/);
});

function unsignedJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

test('buildCpaAuthFile creates the CPA compatible auth JSON from token bundle', () => {
  const { buildCpaAuthFile } = require('../src/auto/roxy_oauth_login.js');
  const accessToken = unsignedJwt({
    exp: 1780000000,
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_123',
      chatgpt_user_id: 'user_123',
      chatgpt_plan_type: 'plus',
    },
  });
  const idToken = unsignedJwt({ sub: 'sub_123' });

  const cpa = buildCpaAuthFile({
    name: 'jregkolpig+s2@gmail.com',
    credentials: { chatgpt_account_id: 'acct_123' },
  }, {
    access_token: accessToken,
    id_token: idToken,
    refresh_token: 'refresh_123',
  }, {
    now: new Date('2026-06-02T08:00:00.000Z'),
  });

  assert.deepEqual(cpa, {
    type: 'codex',
    email: 'jregkolpig+s2@gmail.com',
    expired: '2026-05-29T04:26:40+08:00',
    id_token: idToken,
    account_id: 'acct_123',
    access_token: accessToken,
    last_refresh: '2026-06-02T16:00:00+08:00',
    refresh_token: 'refresh_123',
  });
});

test('saveIndividualAccountJson writes CPA JSON locally and returns its path', async () => {
  const { saveIndividualAccountJson } = require('../src/auto/roxy_oauth_login.js');
  const outputRootDir = await mkdtemp(join(tmpdir(), 'roxy-oauth-product-'));
  const accessToken = unsignedJwt({ exp: 1780000000 });
  const idToken = unsignedJwt({ sub: 'sub_123' });

  try {
    const exportInfo = saveIndividualAccountJson({
      name: 'jregkolpig+s2@gmail.com',
      credentials: { chatgpt_account_id: 'acct_123' },
    }, {
      access_token: accessToken,
      id_token: idToken,
      refresh_token: 'refresh_123',
    }, {
      outputRootDir,
      now: new Date('2026-06-02T08:00:00.000Z'),
    });

    assert.equal(exportInfo.cpaFile, 'jregkolpig+s2@gmail.com.json');
    assert.match(exportInfo.cpaPath, /cpa/);
    const saved = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(exportInfo.cpaPath, 'utf8')));
    assert.equal(saved.email, 'jregkolpig+s2@gmail.com');
    assert.equal(saved.account_id, 'acct_123');
    assert.equal(saved.refresh_token, 'refresh_123');
  } finally {
    await rm(outputRootDir, { recursive: true, force: true });
  }
});

test('exchangeToken posts authorization code, parses tokens, and saves CPA JSON', async () => {
  const { exchangeToken } = require('../src/auto/roxy_oauth_login.js');
  const outputRootDir = await mkdtemp(join(tmpdir(), 'roxy-oauth-exchange-'));
  const calls = [];
  const accessToken = unsignedJwt({
    exp: 1780000000,
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_456',
      chatgpt_user_id: 'user_456',
      chatgpt_plan_type: 'team',
    },
  });
  const idToken = unsignedJwt({ sub: 'sub_456' });

  try {
    const result = await exchangeToken('code_123', 'verifier_123', 'jregkolpig+s2@gmail.com', '', {
      outputRootDir,
      now: new Date('2026-06-02T08:00:00.000Z'),
      fetch: async (url, options) => {
        calls.push(['fetch', url, JSON.parse(options.body), options.headers]);
        return {
          ok: true,
          async json() {
            return {
              access_token: accessToken,
              id_token: idToken,
              refresh_token: 'refresh_456',
              expires_in: 3600,
            };
          },
        };
      },
    });

    assert.equal(result.cpaFile, 'jregkolpig+s2@gmail.com.json');
    assert.equal(JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(result.cpaPath, 'utf8'))).account_id, 'acct_456');
    assert.deepEqual(calls, [[
      'fetch',
      'https://auth.openai.com/oauth/token',
      {
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        grant_type: 'authorization_code',
        code: 'code_123',
        redirect_uri: 'http://localhost:1455/auth/callback',
        code_verifier: 'verifier_123',
      },
      { 'Content-Type': 'application/json' },
    ]]);
  } finally {
    await rm(outputRootDir, { recursive: true, force: true });
  }
});

test('exchangeToken prefers Playwright request context over Node fetch for token exchange', async () => {
  const { exchangeToken } = require('../src/auto/roxy_oauth_login.js');
  const outputRootDir = await mkdtemp(join(tmpdir(), 'roxy-oauth-exchange-request-'));
  const calls = [];
  const accessToken = unsignedJwt({
    exp: 1780000000,
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct_req' },
  });

  try {
    await exchangeToken('code_req', 'verifier_req', 'jregkolpig+s2@gmail.com', '', {
      outputRootDir,
      request: {
        async post(url, options) {
          calls.push(['request.post', url, options.data, options.headers]);
          return {
            ok: () => true,
            async json() {
              return {
                access_token: accessToken,
                id_token: unsignedJwt({ sub: 'sub_req' }),
                refresh_token: 'refresh_req',
                expires_in: 3600,
              };
            },
          };
        },
      },
      fetch: async () => {
        throw new Error('fetch should not be used');
      },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    assert.deepEqual(calls, [[
      'request.post',
      'https://auth.openai.com/oauth/token',
      {
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        grant_type: 'authorization_code',
        code: 'code_req',
        redirect_uri: 'http://localhost:1455/auth/callback',
        code_verifier: 'verifier_req',
      },
      { 'Content-Type': 'application/json' },
    ]]);
  } finally {
    await rm(outputRootDir, { recursive: true, force: true });
  }
});

test('exchangeToken prefers browser page fetch over request context for token exchange', async () => {
  const { exchangeToken } = require('../src/auto/roxy_oauth_login.js');
  const outputRootDir = await mkdtemp(join(tmpdir(), 'roxy-oauth-exchange-page-'));
  const calls = [];
  const accessToken = unsignedJwt({
    exp: 1780000000,
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct_page' },
  });

  try {
    await exchangeToken('code_page', 'verifier_page', 'jregkolpig+s2@gmail.com', '', {
      outputRootDir,
      tokenPageSettleMs: 1,
      tokenPageTimeoutMs: 100,
      page: {
        async waitForTimeout(ms) {
          calls.push(['page.waitForTimeout', ms]);
        },
        async evaluate(fn, arg) {
          calls.push(['page.evaluate', arg.url, arg.payload]);
          return {
            ok: true,
            data: {
              access_token: accessToken,
              id_token: unsignedJwt({ sub: 'sub_page' }),
              refresh_token: 'refresh_page',
              expires_in: 3600,
            },
          };
        },
      },
      request: {
        async post() {
          throw new Error('request should not be used when page context exists');
        },
      },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    assert.deepEqual(calls.map((call) => call[0]), ['page.waitForTimeout', 'page.evaluate']);
    assert.equal(calls[1][1], 'https://auth.openai.com/oauth/token');
    assert.equal(calls[1][2].code, 'code_page');
  } finally {
    await rm(outputRootDir, { recursive: true, force: true });
  }
});

test('exchangeToken falls back when browser page evaluation context is destroyed', async () => {
  const { exchangeToken } = require('../src/auto/roxy_oauth_login.js');
  const outputRootDir = await mkdtemp(join(tmpdir(), 'roxy-oauth-exchange-fallback-'));
  const calls = [];
  const messages = [];
  const warnings = [];
  const accessToken = unsignedJwt({
    exp: 1780000000,
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct_fallback' },
  });

  try {
    await exchangeToken('code_fallback', 'verifier_fallback', 'jregkolpig+s2@gmail.com', '', {
      outputRootDir,
      tokenPageSettleMs: 1,
      tokenPageTimeoutMs: 100,
      page: {
        async waitForTimeout(ms) {
          calls.push(['page.waitForTimeout', ms]);
        },
        async evaluate() {
          calls.push(['page.evaluate']);
          throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
        },
      },
      fetch: async (url, options) => {
        calls.push(['fetch', url, JSON.parse(options.body)]);
        return {
          ok: true,
          async json() {
            return {
              access_token: accessToken,
              id_token: unsignedJwt({ sub: 'sub_fallback' }),
              refresh_token: 'refresh_fallback',
              expires_in: 3600,
            };
          },
        };
      },
      logger: {
        log: (message) => messages.push(String(message)),
        warn: (message) => warnings.push(String(message)),
        error: () => {},
      },
    });

    assert.deepEqual(calls.map((call) => call[0]), ['page.waitForTimeout', 'page.evaluate', 'fetch']);
    assert.equal(calls[2][2].code, 'code_fallback');
    assert.match(warnings.join('\n'), /页面上下文换 Token 失败，回退 fetch/);
    assert.match(messages.join('\n'), /phase=token action=使用 Node fetch 换 Token/);
  } finally {
    await rm(outputRootDir, { recursive: true, force: true });
  }
});

test('processOAuthLoginFlow skips missing phone verification, reaches callback, and exchanges token', async () => {
  const { processOAuthLoginFlow } = require('../src/auto/roxy_oauth_login.js');
  const calls = [];
  let stage = 'email-login';
  let currentUrl = 'https://auth.openai.com/oauth/authorize';
  const page = {
    getByRole(role, options) {
      calls.push(['getByRole', role, options, stage]);
      if (role === 'textbox' && options.name === 'Email address') {
        return {
          async isVisible() { return stage === 'email-login'; },
          async waitFor() {},
          async click() {},
          async fill(value) { calls.push(['email.fill', value]); },
        };
      }
      if (role === 'textbox' && options.name === 'Code') {
        return {
          async isVisible() { return stage === 'email-code'; },
          async waitFor() {},
          async click() {},
          async fill(value) { calls.push(['code.fill', value]); },
        };
      }
      return {
        async isVisible() { return stage === 'email-login' || stage === 'email-code' || stage === 'codex'; },
        async click() {
          calls.push(['continue.click', stage]);
          if (stage === 'email-login') {
            stage = 'email-code';
            currentUrl = 'https://auth.openai.com/email-verification';
          } else if (stage === 'email-code') {
            stage = 'codex';
          } else if (stage === 'codex') {
            currentUrl = 'http://localhost:1455/auth/callback?code=code_789&state=state_123';
            stage = 'callback';
          }
        },
      };
    },
    locator() {
      return {
        async textContent() {
          if (stage === 'email-code') return 'Enter the code sent to your email. Code Continue';
          if (stage === 'codex') return 'Sign in to Codex with ChatGPT. Continue';
          return 'Welcome';
        },
      };
    },
    request: {
      async post() {
        return { async json() { return { ok: true, code: '123456' }; } };
      },
    },
    url() { return currentUrl; },
    async title() { return 'OAuth'; },
    async textContent() {
      if (stage === 'email-code') return 'Enter the code sent to your email. Code Continue';
      if (stage === 'codex') return 'Sign in to Codex with ChatGPT. Continue';
      return 'Welcome';
    },
    async waitForTimeout() {},
  };

  const result = await processOAuthLoginFlow(page, {
    email: 'jregkolpig+s2@gmail.com',
    verifier: 'verifier_123',
    state: 'state_123',
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
    exchangeToken: async (code, verifier, email) => {
      calls.push(['exchangeToken', code, verifier, email]);
      return { cpaPath: 'local-cpa.json' };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.equal(result.code, 'code_789');
  assert.equal(result.exchangeResult.cpaPath, 'local-cpa.json');
  assert.deepEqual(calls.filter((call) => ['email.fill', 'code.fill', 'exchangeToken'].includes(call[0])), [
    ['email.fill', 'jregkolpig+s2@gmail.com'],
    ['code.fill', '123456'],
    ['exchangeToken', 'code_789', 'verifier_123', 'jregkolpig+s2@gmail.com'],
  ]);
  assert.equal(calls.some((call) => call[0] === 'textMessage.check'), false);
});

test('processOAuthLoginFlow prioritizes Codex consent over stale email-code signals', async () => {
  const { processOAuthLoginFlow } = require('../src/auto/roxy_oauth_login.js');
  const calls = [];
  let currentUrl = 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent';
  const page = {
    getByRole(role, options) {
      calls.push(['getByRole', role, options]);
      if (role === 'textbox') {
        return {
          async isVisible() { return options.name === 'Code'; },
          async waitFor() { calls.push(['code.waitFor']); },
          async click() { calls.push(['code.click']); },
          async fill(value) { calls.push(['code.fill', value]); },
        };
      }
      return {
        async isVisible() { return true; },
        async click() {
          calls.push(['continue.click']);
          currentUrl = 'http://localhost:1455/auth/callback?code=code_abc&state=state_abc';
        },
      };
    },
    locator() {
      return {
        async textContent() {
          return 'Sign in to Codex with ChatGPT. email profile. Review the code it writes. Continue';
        },
      };
    },
    request: {
      async post() {
        calls.push(['request.post']);
        return { async json() { return { ok: true, code: '111111' }; } };
      },
    },
    url: () => currentUrl,
    title: async () => 'Sign in to Codex with ChatGPT - OpenAI',
    textContent: async () => 'Sign in to Codex with ChatGPT. email profile. Review the code it writes. Continue',
    waitForTimeout: async () => new Promise((resolve) => setTimeout(resolve, 1)),
  };

  const result = await processOAuthLoginFlow(page, {
    email: 'jregkolpig+s4@gmail.com',
    verifier: 'verifier_abc',
    state: 'state_abc',
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
    exchangeToken: async () => ({ cpaPath: 'local-cpa.json' }),
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.equal(calls.some((call) => call[0] === 'request.post'), false);
  assert.equal(calls.some((call) => call[0] === 'code.fill'), false);
  assert.deepEqual(calls.filter((call) => call[0] === 'continue.click'), [['continue.click']]);
});

test('processOAuthLoginFlow extracts callback code from request before localhost chrome-error page', async () => {
  const { processOAuthLoginFlow } = require('../src/auto/roxy_oauth_login.js');
  const page = {
    waitForRequest(predicate) {
      const req = { url: () => 'http://localhost:1455/auth/callback?code=code_req&state=state_req' };
      assert.equal(predicate(req), true);
      return Promise.resolve(req);
    },
    getByRole() {
      return { async isVisible() { return false; } };
    },
    locator() {
      return { async textContent() { return ''; } };
    },
    url: () => 'chrome-error://chromewebdata/',
    title: async () => 'localhost',
    textContent: async () => 'This site can’t be reached localhost refused to connect',
    waitForTimeout: async () => {},
  };

  const result = await processOAuthLoginFlow(page, {
    email: 'jregkolpig+s4@gmail.com',
    verifier: 'verifier_req',
    state: 'state_req',
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
    maxStageTurns: 5,
    exchangeToken: async (code, verifier, email) => ({ code, verifier, email, cpaPath: 'local-cpa.json' }),
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.equal(result.code, 'code_req');
  assert.equal(result.exchangeResult.cpaPath, 'local-cpa.json');
});

test('roxy_oauth_login 默认导航 OAuth 授权页并保持 Roxy 窗口打开', async () => {
  const messages = [];
  const calls = [];

  class FakeRoxyBrowserClient {
    constructor() {
      calls.push(['constructor']);
      this.dirId = 'dir-1';
      this.workspaceId = 1;
    }

    async resolveDirId() {
      calls.push(['resolveDirId']);
      return 'dir-1';
    }

    async closeBrowser() {
      calls.push(['closeBrowser']);
    }

    async clearLocalCache() {
      calls.push(['clearLocalCache']);
    }

    async clearServerCache() {
      calls.push(['clearServerCache']);
    }

    async randomFingerprint() {
      calls.push(['randomFingerprint']);
    }

    async openBrowser() {
      calls.push(['openBrowser']);
    }

    async getConnectionInfo() {
      calls.push(['getConnectionInfo']);
      return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' };
    }

    async connectPlaywright(ws) {
      calls.push(['connectPlaywright', ws]);
      return {
        browser: {
          disconnect: async () => calls.push(['browser.disconnect']),
          close: async () => calls.push(['browser.close']),
        },
        page: {
          goto: async (url, options) => calls.push(['page.goto', url, options.waitUntil]),
          waitForLoadState: async (state) => calls.push(['page.waitForLoadState', state]),
          url: () => 'https://chatgpt.com/',
          title: async () => 'ChatGPT',
        },
      };
    }
  }

  const { run } = require('../src/auto/roxy_oauth_login.js');

  const result = await run([], {
    RoxyBrowserClient: FakeRoxyBrowserClient,
    dotenv: { config: () => calls.push(['dotenv.config']) },
    logger: {
      log: (message) => messages.push(String(message)),
      error: (message) => messages.push(String(message)),
      warn: (message) => messages.push(String(message)),
    },
    env: {
      ROXY_API_BASE_URL: 'http://127.0.0.1:59325',
      ROXY_WORKSPACE_ID: '1',
      ROXY_BROWSER_DIR_ID: 'dir-1',
    },
  });

  assert.match(result.targetUrl, /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
  assert.equal(result.keepOpen, true);
  assert.deepEqual(calls, [
    ['dotenv.config'],
    ['constructor'],
    ['resolveDirId'],
    ['closeBrowser'],
    ['clearLocalCache'],
    ['clearServerCache'],
    ['randomFingerprint'],
    ['openBrowser'],
    ['getConnectionInfo'],
    ['connectPlaywright', 'ws://127.0.0.1:9222/devtools/browser/abc'],
    calls[10],
    ['page.waitForLoadState', 'networkidle'],
    ['browser.disconnect'],
  ]);
  assert.equal(calls[10][0], 'page.goto');
  assert.match(calls[10][1], /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
  assert.equal(calls[10][2], 'domcontentloaded');
  assert.equal(calls.some((call) => call[0] === 'browser.close'), false);
  assert.match(messages.join('\n'), /读取配置/);
  assert.match(messages.join('\n'), /解析目标窗口/);
  assert.match(messages.join('\n'), /清缓存/);
  assert.match(messages.join('\n'), /随机指纹/);
  assert.match(messages.join('\n'), /打开窗口/);
  assert.match(messages.join('\n'), /获取 CDP/);
  assert.match(messages.join('\n'), /ws:\/\/127\.0\.0\.1:9222\/devtools\/browser\/abc/);
  assert.match(messages.join('\n'), /Playwright 连接/);
  assert.match(messages.join('\n'), /导航目标 URL/);
  assert.match(messages.join('\n'), /当前页面 URL/);
  assert.match(messages.join('\n'), /保持浏览器打开: 是/);
});

test('run navigates OAuth URL, processes callback flow, and returns local CPA export result', async () => {
  const calls = [];

  class FakeRoxyBrowserClient {
    constructor() {
      this.workspaceId = 1;
    }
    async resolveDirId() { return 'dir-1'; }
    async closeBrowser() {}
    async clearLocalCache() {}
    async clearServerCache() {}
    async randomFingerprint() {}
    async openBrowser() {}
    async getConnectionInfo() { return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }; }
    async connectPlaywright() {
      return {
        browser: { disconnect: async () => calls.push(['browser.disconnect']) },
        page: {
          goto: async (url) => calls.push(['page.goto', url]),
          waitForLoadState: async () => {},
          getByRole: () => ({ async isVisible() { return false; } }),
          locator: () => ({ async textContent() { return ''; } }),
          url: () => 'http://localhost:1455/auth/callback?code=code_999&state=state_fixed',
          title: async () => 'Callback',
          textContent: async () => '',
        },
      };
    }
  }

  const { run } = require('../src/auto/roxy_oauth_login.js');
  const result = await run([], {
    RoxyBrowserClient: FakeRoxyBrowserClient,
    dotenv: { config: () => {} },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    env: {
      ROXY_API_BASE_URL: 'http://127.0.0.1:59325',
      ROXY_WORKSPACE_ID: '1',
      ROXY_BROWSER_DIR_ID: 'dir-1',
      ROXY_OAUTH_EMAIL: 'jregkolpig+s2@gmail.com',
    },
    generatePKCE: () => ({ verifier: 'verifier_fixed', challenge: 'challenge_fixed' }),
    randomState: () => 'state_fixed',
    exchangeToken: async (code, verifier, email) => {
      calls.push(['exchangeToken', code, verifier, email]);
      return { cpaPath: 'local-cpa.json' };
    },
  });

  assert.equal(result.oauthResult.exchangeResult.cpaPath, 'local-cpa.json');
  assert.deepEqual(calls.filter((call) => call[0] === 'exchangeToken'), [
    ['exchangeToken', 'code_999', 'verifier_fixed', 'jregkolpig+s2@gmail.com'],
  ]);
});

test('run continues after page.goto connection aborted when page is still inspectable', async () => {
  const calls = [];
  class FakeRoxyBrowserClient {
    constructor() { this.workspaceId = 1; }
    async resolveDirId() { return 'dir-1'; }
    async closeBrowser() {}
    async clearLocalCache() {}
    async clearServerCache() {}
    async randomFingerprint() {}
    async openBrowser() {}
    async getConnectionInfo() { return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }; }
    async connectPlaywright() {
      return {
        browser: { disconnect: async () => calls.push(['browser.disconnect']) },
        page: {
          goto: async () => { throw new Error('page.goto: net::ERR_CONNECTION_ABORTED'); },
          waitForLoadState: async () => {},
          getByRole: () => ({ async isVisible() { return false; } }),
          locator: () => ({ async textContent() { return ''; } }),
          url: () => 'http://localhost:1455/auth/callback?code=code_abort&state=state_abort',
          title: async () => 'Callback',
          textContent: async () => '',
        },
      };
    }
  }
  const { run } = require('../src/auto/roxy_oauth_login.js');

  const result = await run([], {
    RoxyBrowserClient: FakeRoxyBrowserClient,
    dotenv: { config: () => {} },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    env: {
      ROXY_API_BASE_URL: 'http://127.0.0.1:59325',
      ROXY_WORKSPACE_ID: '1',
      ROXY_BROWSER_DIR_ID: 'dir-1',
      ROXY_OAUTH_EMAIL: 'jregkolpig+s2@gmail.com',
    },
    generatePKCE: () => ({ verifier: 'verifier_abort', challenge: 'challenge_abort' }),
    randomState: () => 'state_abort',
    exchangeToken: async () => ({ cpaPath: 'local-cpa.json' }),
  });

  assert.equal(result.oauthResult.exchangeResult.cpaPath, 'local-cpa.json');
});

test('openRoxyBrowserForAutomation 打开 Roxy 窗口并返回 CDP 和 Playwright 对象', async () => {
  const calls = [];

  class FakeRoxyBrowserClient {
    constructor() {
      this.dirId = 'dir-1';
      this.workspaceId = 1;
    }
    async resolveDirId() { calls.push(['resolveDirId']); return 'dir-1'; }
    async closeBrowser() { calls.push(['closeBrowser']); }
    async clearLocalCache() { calls.push(['clearLocalCache']); }
    async clearServerCache() { calls.push(['clearServerCache']); }
    async randomFingerprint() { calls.push(['randomFingerprint']); }
    async openBrowser() { calls.push(['openBrowser']); }
    async getConnectionInfo() {
      calls.push(['getConnectionInfo']);
      return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' };
    }
    async connectPlaywright(ws) {
      calls.push(['connectPlaywright', ws]);
      return { browser: { disconnect: async () => {} }, page: { marker: 'page' }, context: { marker: 'context' } };
    }
  }

  const { openRoxyBrowserForAutomation } = require('../src/auto/roxy_oauth_login.js');

  const session = await openRoxyBrowserForAutomation({
    RoxyBrowserClient: FakeRoxyBrowserClient,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    env: {},
  });

  assert.equal(session.dirId, 'dir-1');
  assert.equal(session.workspaceId, 1);
  assert.equal(session.cdpEndpoint, 'ws://127.0.0.1:9222/devtools/browser/abc');
  assert.equal(session.page.marker, 'page');
  assert.deepEqual(calls, [
    ['resolveDirId'],
    ['closeBrowser'],
    ['clearLocalCache'],
    ['clearServerCache'],
    ['randomFingerprint'],
    ['openBrowser'],
    ['getConnectionInfo'],
    ['connectPlaywright', 'ws://127.0.0.1:9222/devtools/browser/abc'],
  ]);
});

test('openRoxyBrowserForAutomation 检测到 ROXY_CDP_ENDPOINT 时跳过 Roxy 准备流程并直接 connectOverCDP', async () => {
  const calls = [];
  const messages = [];

  class ForbiddenRoxyBrowserClient {
    async resolveDirId() { calls.push(['resolveDirId']); throw new Error('should not resolve'); }
    async closeBrowser() { calls.push(['closeBrowser']); }
    async clearLocalCache() { calls.push(['clearLocalCache']); }
    async clearServerCache() { calls.push(['clearServerCache']); }
    async randomFingerprint() { calls.push(['randomFingerprint']); }
    async openBrowser() { calls.push(['openBrowser']); }
    async getConnectionInfo() { calls.push(['getConnectionInfo']); }
  }

  const browser = {
    contexts: () => [{
      pages: () => [{ marker: 'page' }],
    }],
    disconnect: async () => calls.push(['browser.disconnect']),
  };
  const playwright = {
    chromium: {
      connectOverCDP: async (ws) => {
        calls.push(['connectOverCDP', ws]);
        return browser;
      },
    },
  };

  const { openRoxyBrowserForAutomation } = require('../src/auto/roxy_oauth_login.js');

  const session = await openRoxyBrowserForAutomation({
    RoxyBrowserClient: ForbiddenRoxyBrowserClient,
    playwright,
    logger: {
      log: (message) => messages.push(String(message)),
      warn: (message) => messages.push(String(message)),
      error: (message) => messages.push(String(message)),
    },
    env: { ROXY_CDP_ENDPOINT: 'ws://127.0.0.1:9222/devtools/browser/reuse' },
  });

  assert.equal(session.cdpEndpoint, 'ws://127.0.0.1:9222/devtools/browser/reuse');
  assert.equal(session.reuseCdp, true);
  assert.equal(session.page.marker, 'page');
  assert.deepEqual(calls, [
    ['connectOverCDP', 'ws://127.0.0.1:9222/devtools/browser/reuse'],
  ]);
  assert.match(messages.join('\n'), /检测到 ROXY_CDP_ENDPOINT/);
  assert.match(messages.join('\n'), /跳过 Roxy 准备流程/);
  assert.match(messages.join('\n'), /直接连接 CDP/);
});

test('openRoxyBrowserForAutomation 在复用 CDP 连接失败时回退到 Roxy 正常开窗', async () => {
  const calls = [];
  class FakeRoxyBrowserClient {
    constructor() {
      this.workspaceId = 1;
    }
    async resolveDirId() { calls.push(['resolveDirId']); return 'dir-1'; }
    async closeBrowser() { calls.push(['closeBrowser']); }
    async clearLocalCache() { calls.push(['clearLocalCache']); }
    async clearServerCache() { calls.push(['clearServerCache']); }
    async randomFingerprint() { calls.push(['randomFingerprint']); }
    async openBrowser() { calls.push(['openBrowser']); }
    async getConnectionInfo() {
      calls.push(['getConnectionInfo']);
      return { ws: 'ws://127.0.0.1:9222/devtools/browser/new' };
    }
    async connectPlaywright(ws) {
      calls.push(['connectPlaywright', ws]);
      return { browser: { disconnect: async () => {} }, page: { marker: 'page' }, context: {} };
    }
  }
  const playwright = {
    chromium: {
      connectOverCDP: async (ws) => {
        calls.push(['connectOverCDP', ws]);
        throw new Error('connect ECONNREFUSED 127.0.0.1:4361');
      },
    },
  };
  const { openRoxyBrowserForAutomation } = require('../src/auto/roxy_oauth_login.js');

  const session = await openRoxyBrowserForAutomation({
    RoxyBrowserClient: FakeRoxyBrowserClient,
    playwright,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    env: { ROXY_CDP_ENDPOINT: 'ws://127.0.0.1:4361/devtools/browser/stale' },
  });

  assert.equal(session.cdpEndpoint, 'ws://127.0.0.1:9222/devtools/browser/new');
  assert.deepEqual(calls, [
    ['connectOverCDP', 'ws://127.0.0.1:4361/devtools/browser/stale'],
    ['resolveDirId'],
    ['closeBrowser'],
    ['clearLocalCache'],
    ['clearServerCache'],
    ['randomFingerprint'],
    ['openBrowser'],
    ['getConnectionInfo'],
    ['connectPlaywright', 'ws://127.0.0.1:9222/devtools/browser/new'],
  ]);
});

test('closeRoxyBrowserSession 在 CDP 复用模式下即使 keepOpen=false 也只断开 Playwright', async () => {
  const calls = [];
  const { closeRoxyBrowserSession } = require('../src/auto/roxy_oauth_login.js');

  const result = await closeRoxyBrowserSession({
    reuseCdp: true,
    browser: {
      disconnect: async () => calls.push(['browser.disconnect']),
      close: async () => calls.push(['browser.close']),
    },
    client: { closeBrowser: async () => calls.push(['client.closeBrowser']) },
  }, {
    keepOpen: false,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result, 'disconnect');
  assert.deepEqual(calls, [['browser.disconnect']]);
});

test('closeRoxyBrowserSession 默认断开 Playwright 并保持 Roxy 窗口打开', async () => {
  const calls = [];
  const { closeRoxyBrowserSession } = require('../src/auto/roxy_oauth_login.js');

  const result = await closeRoxyBrowserSession({
    browser: { disconnect: async () => calls.push(['browser.disconnect']) },
    client: { closeBrowser: async () => calls.push(['client.closeBrowser']) },
  }, {
    keepOpen: true,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result, 'disconnect');
  assert.deepEqual(calls, [['browser.disconnect']]);
});

test('closeRoxyBrowserSession 可关闭 Playwright 和 Roxy 窗口', async () => {
  const calls = [];
  const { closeRoxyBrowserSession } = require('../src/auto/roxy_oauth_login.js');

  const result = await closeRoxyBrowserSession({
    browser: { close: async () => calls.push(['browser.close']) },
    client: { closeBrowser: async () => calls.push(['client.closeBrowser']) },
  }, {
    keepOpen: false,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result, 'close');
  assert.deepEqual(calls, [['browser.close'], ['client.closeBrowser']]);
});

test('roxy_oauth_login 允许命令行第一个参数覆盖目标 URL', async () => {
  const navigatedUrls = [];

  class FakeRoxyBrowserClient {
    async resolveDirId() { return 'dir-1'; }
    async closeBrowser() {}
    async clearLocalCache() {}
    async clearServerCache() {}
    async randomFingerprint() {}
    async openBrowser() {}
    async getConnectionInfo() { return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }; }
    async connectPlaywright() {
      return {
        browser: { disconnect: async () => {} },
        page: {
          goto: async (url) => navigatedUrls.push(url),
          waitForLoadState: async () => {},
          url: () => navigatedUrls[0],
          title: async () => 'Target',
        },
      };
    }
  }

  const { run } = require('../src/auto/roxy_oauth_login.js');

  await run(['https://example.test/path'], {
    RoxyBrowserClient: FakeRoxyBrowserClient,
    dotenv: { config: () => {} },
    logger: { log: () => {}, error: () => {}, warn: () => {} },
    env: {
      ROXY_API_BASE_URL: 'http://127.0.0.1:59325',
      ROXY_WORKSPACE_ID: '1',
      ROXY_BROWSER_DIR_ID: 'dir-1',
    },
  });

  assert.deepEqual(navigatedUrls, ['https://example.test/path']);
});

test('roxy_oauth_login 在 dotenv 后读取 ROXY_KEEP_OPEN 并可关闭 Roxy 窗口', async () => {
  const calls = [];

  class FakeRoxyBrowserClient {
    constructor() {
      this.dirId = 'dir-1';
      this.workspaceId = 1;
    }
    async resolveDirId() { calls.push(['resolveDirId']); return 'dir-1'; }
    async closeBrowser() { calls.push(['closeBrowser']); }
    async clearLocalCache() { calls.push(['clearLocalCache']); }
    async clearServerCache() { calls.push(['clearServerCache']); }
    async randomFingerprint() { calls.push(['randomFingerprint']); }
    async openBrowser() { calls.push(['openBrowser']); }
    async getConnectionInfo() { return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }; }
    async connectPlaywright() {
      return {
        browser: { close: async () => calls.push(['browser.close']) },
        page: {
          goto: async () => calls.push(['page.goto']),
          waitForLoadState: async () => calls.push(['page.waitForLoadState']),
          url: () => 'https://auth.openai.com/log-in',
          title: async () => 'Welcome back - OpenAI',
        },
      };
    }
  }

  const env = {
    ROXY_API_BASE_URL: 'http://127.0.0.1:59325',
    ROXY_WORKSPACE_ID: '1',
    ROXY_BROWSER_DIR_ID: 'dir-1',
  };
  const { run } = require('../src/auto/roxy_oauth_login.js');

  const result = await run([], {
    RoxyBrowserClient: FakeRoxyBrowserClient,
    dotenv: { config: () => { env.ROXY_KEEP_OPEN = '0'; } },
    logger: { log: () => {}, error: () => {}, warn: () => {} },
    env,
  });

  assert.equal(result.keepOpen, false);
  assert.equal(result.disconnectMode, 'close');
  assert.deepEqual(calls.slice(-2), [['browser.close'], ['closeBrowser']]);
});

test('roxy_oauth_login 默认按 ROXY_KEEP_OPEN 推导 Roxy headless 参数', async () => {
  const openedArgs = [];

  class FakeRoxyBrowserClient {
    constructor() {
      this.dirId = 'dir-1';
      this.workspaceId = 1;
    }
    async resolveDirId() { return 'dir-1'; }
    async closeBrowser() {}
    async clearLocalCache() {}
    async clearServerCache() {}
    async randomFingerprint() {}
    async openBrowser(args) { openedArgs.push(args); }
    async getConnectionInfo() { return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }; }
    async connectPlaywright() {
      return {
        browser: { close: async () => {} },
        page: {
          goto: async () => {},
          waitForLoadState: async () => {},
          url: () => 'https://auth.openai.com/log-in',
          title: async () => 'Welcome back - OpenAI',
        },
      };
    }
  }

  const { run } = require('../src/auto/roxy_oauth_login.js');

  await run([], {
    RoxyBrowserClient: FakeRoxyBrowserClient,
    dotenv: { config: () => {} },
    logger: { log: () => {}, error: () => {}, warn: () => {} },
    env: {
      ROXY_API_BASE_URL: 'http://127.0.0.1:59325',
      ROXY_WORKSPACE_ID: '1',
      ROXY_BROWSER_DIR_ID: 'dir-1',
      ROXY_KEEP_OPEN: '0',
    },
  });

  assert.deepEqual(openedArgs[0], ['--headless=new']);
});

test('roxy_oauth_login 调试保留浏览器时默认有头运行', async () => {
  const openedArgs = [];

  class FakeRoxyBrowserClient {
    constructor() {
      this.dirId = 'dir-1';
      this.workspaceId = 1;
    }
    async resolveDirId() { return 'dir-1'; }
    async closeBrowser() {}
    async clearLocalCache() {}
    async clearServerCache() {}
    async randomFingerprint() {}
    async openBrowser(args) { openedArgs.push(args); }
    async getConnectionInfo() { return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }; }
    async connectPlaywright() {
      return {
        browser: { disconnect: async () => {} },
        page: {
          goto: async () => {},
          waitForLoadState: async () => {},
          url: () => 'https://auth.openai.com/log-in',
          title: async () => 'Welcome back - OpenAI',
        },
      };
    }
  }

  const { run } = require('../src/auto/roxy_oauth_login.js');

  await run([], {
    RoxyBrowserClient: FakeRoxyBrowserClient,
    dotenv: { config: () => {} },
    logger: { log: () => {}, error: () => {}, warn: () => {} },
    env: {
      ROXY_API_BASE_URL: 'http://127.0.0.1:59325',
      ROXY_WORKSPACE_ID: '1',
      ROXY_BROWSER_DIR_ID: 'dir-1',
      ROXY_KEEP_OPEN: '1',
    },
  });

  assert.deepEqual(openedArgs[0], []);
});

test('runCli 打印可复用的 CDP endpoint', async () => {
  const messages = [];

  class FakeRoxyBrowserClient {
    constructor() {
      this.dirId = 'dir-1';
      this.workspaceId = 1;
    }
    async resolveDirId() { return 'dir-1'; }
    async closeBrowser() {}
    async clearLocalCache() {}
    async clearServerCache() {}
    async randomFingerprint() {}
    async openBrowser() {}
    async getConnectionInfo() { return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }; }
    async connectPlaywright() {
      return {
        browser: { close: async () => {} },
        page: {
          goto: async () => {},
          waitForLoadState: async () => {},
          url: () => 'https://auth.openai.com/log-in',
          title: async () => 'Welcome back - OpenAI',
        },
      };
    }
  }

  const { runCli } = require('../src/auto/roxy_oauth_login.js');
  const fakeProcess = {
    argv: ['node', 'src/auto/roxy_oauth_login.js'],
    env: {
      ROXY_API_BASE_URL: 'http://127.0.0.1:59325',
      ROXY_WORKSPACE_ID: '1',
      ROXY_BROWSER_DIR_ID: 'dir-1',
    },
    exitCode: 0,
  };

  await runCli(fakeProcess, {
    RoxyBrowserClient: FakeRoxyBrowserClient,
    dotenv: { config: () => {} },
    logger: {
      log: (message) => messages.push(String(message)),
      warn: (message) => messages.push(String(message)),
      error: (message) => messages.push(String(message)),
    },
  });

  assert.equal(fakeProcess.exitCode, 0);
  assert.match(messages.join('\n'), /phase=result action=CDP endpoint ws=ws:\/\/127\.0\.0\.1:9222\/devtools\/browser\/abc/);
  assert.match(messages.join('\n'), /ROXY_CDP_ENDPOINT=ws:\/\/127\.0\.0\.1:9222\/devtools\/browser\/abc/);
});

test('roxy_oauth_login 出错时打印清晰错误并设置退出码 1', async () => {
  const errors = [];

  class FailingRoxyBrowserClient {
    async resolveDirId() {
      throw new Error('missing window');
    }
  }

  const { runCli } = require('../src/auto/roxy_oauth_login.js');

  const fakeProcess = {
    argv: ['node', 'src/auto/roxy_oauth_login.js'],
    env: { ROXY_API_BASE_URL: 'http://127.0.0.1:59325', ROXY_WORKSPACE_ID: '1' },
    exitCode: 0,
    exit(code) {
      this.exitCode = code;
    },
  };

  await runCli(fakeProcess, {
    RoxyBrowserClient: FailingRoxyBrowserClient,
    dotenv: { config: () => {} },
    logger: { log: () => {}, warn: () => {}, error: (message) => errors.push(String(message)) },
  });

  assert.equal(fakeProcess.exitCode, 1);
  assert.match(errors.join('\n'), /roxy_oauth_login 失败/);
  assert.match(errors.join('\n'), /missing window/);
});

test('disconnectPlaywright 在 Browser 无 disconnect 时用 close 断开连接', async () => {
  const calls = [];
  const warnings = [];
  const { disconnectPlaywright } = require('../src/auto/roxy_oauth_login.js');

  const mode = await disconnectPlaywright({
    close: async (options) => calls.push(['close', options.reason]),
  }, {
    warn: (message) => warnings.push(String(message)),
  });

  assert.equal(mode, 'close-connection');
  assert.deepEqual(calls, [['close', 'roxy_oauth_login disconnect after navigation']]);
  assert.match(warnings.join('\n'), /断开 CDP 连接/);
});
