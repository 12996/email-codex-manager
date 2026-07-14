import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const require = createRequire(import.meta.url);

function createChatGpt2FAPageHarness() {
  const calls = [];
  const transitions = [];
  let stage = 'chatgpt-entry';
  let currentUrl = 'https://chatgpt.com/';

  function bodyText() {
    if (stage === 'chatgpt-entry') return 'ChatGPT Log in Sign up';
    if (stage === 'email') return 'Welcome back Email address Continue';
    if (stage === 'password') return 'Enter your password Email address Edit Password Forgot password? Continue';
    if (stage === 'mfa') return 'Verify your identity Enter the code from your authenticator app Code Continue';
    if (stage === 'chatgpt-home') return 'ChatGPT Message ChatGPT';
    if (stage === 'session') return JSON.stringify({ accessToken: 'access-token-123', user: { email: 'user@example.com' } });
    return '';
  }

  function advance(nextStage, nextUrl) {
    transitions.push(`${stage}->${nextStage}`);
    stage = nextStage;
    currentUrl = nextUrl;
  }

  const page = {
    getByRole(role, options = {}) {
      calls.push(['getByRole', role, options, stage]);
      if (role === 'button' && String(options.name).match(/log in/i)) {
        return {
          async isVisible() { return stage === 'chatgpt-entry'; },
          async click(clickOptions) {
            calls.push(['login.click', clickOptions]);
            advance('email', 'https://auth.openai.com/log-in');
          },
        };
      }
      if (role === 'textbox' && options.name === 'Email address') {
        return {
          async isVisible() { return stage === 'email'; },
          async waitFor() {},
          async click() {},
          async fill(value) { calls.push(['email.fill', value]); },
        };
      }
      if (role === 'textbox' && options.name === 'Password') {
        return {
          async isVisible() { return stage === 'password'; },
          async waitFor() {},
          async click() {},
          async fill(value) { calls.push(['password.fill', value]); },
        };
      }
      if (role === 'textbox' && options.name === 'Code') {
        return {
          async isVisible() { return stage === 'mfa'; },
          async waitFor() {},
          async click() {},
          async fill(value) { calls.push(['code.fill', value]); },
        };
      }
      return {
        async isVisible() {
          return ['email', 'password', 'mfa'].includes(stage);
        },
        async click(clickOptions) {
          calls.push(['continue.click', clickOptions, stage]);
          if (stage === 'email') advance('password', 'https://auth.openai.com/log-in/password');
          else if (stage === 'password') advance('mfa', 'https://auth.openai.com/mfa-challenge/chal_123');
          else if (stage === 'mfa') advance('chatgpt-home', 'https://chatgpt.com/');
        },
      };
    },
    locator(selector) {
      return {
        async isVisible() { return selector === '#prompt-textarea' && stage === 'chatgpt-home'; },
        async textContent() { return bodyText(); },
      };
    },
    async textContent() {
      return bodyText();
    },
    async title() {
      if (stage === 'password') return 'Enter your password - OpenAI';
      if (stage === 'mfa') return 'Verify your identity - OpenAI';
      return 'ChatGPT';
    },
    url: () => currentUrl,
    async goto(url) {
      calls.push(['goto', url]);
      if (url === 'https://chatgpt.com/api/auth/session') {
        advance('session', url);
      } else {
        currentUrl = url;
      }
    },
    async evaluate(fn, arg) {
      calls.push(['evaluate', arg, stage]);
      if (stage === 'chatgpt-home') {
        return { accessToken: 'access-token-123' };
      }
      return {};
    },
    async waitForTimeout() {},
  };

  return { page, calls, transitions };
}

test('roxy_2fa_login exports the ChatGPT session login helpers and runner', () => {
  const module = require('../src/auto/roxy_2fa_login.js');

  assert.equal(typeof module.processChatGpt2FALoginFlow, 'function');
  assert.equal(typeof module.fetchChatGptSession, 'function');
  assert.equal(typeof module.save2FALoginCredentialFile, 'function');
  assert.equal(typeof module.run, 'function');
  assert.equal(typeof module.runCli, 'function');
});

test('detectChatGpt2FAStage treats guest ChatGPT page with prompt box as login entry', async () => {
  const { detectChatGpt2FAStage } = require('../src/auto/roxy_2fa_login.js');
  const page = {
    url: () => 'https://chatgpt.com/',
    getByRole(role, options = {}) {
      if (role === 'button' && String(options.name).match(/log in/i)) {
        return {
          async isVisible() { return true; },
        };
      }
      return {
        async isVisible() { return false; },
      };
    },
    locator(selector) {
      return {
        async isVisible() { return selector === '#prompt-textarea'; },
        async textContent() { return 'ChatGPT Message ChatGPT Log in Sign up'; },
      };
    },
    async textContent() {
      return 'ChatGPT Message ChatGPT Log in Sign up';
    },
    async title() {
      return 'ChatGPT';
    },
    async evaluate() {
      return {};
    },
  };

  const stage = await detectChatGpt2FAStage(page, {
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
  });

  assert.equal(stage.stage, 'chatgpt-entry');
});

test('detectChatGpt2FAStage does not treat ChatGPT prompt box as logged in without session token', async () => {
  const { detectChatGpt2FAStage } = require('../src/auto/roxy_2fa_login.js');
  const page = {
    url: () => 'https://chatgpt.com/',
    getByRole() {
      return {
        async isVisible() { return false; },
      };
    },
    locator(selector) {
      return {
        async isVisible() { return selector === '#prompt-textarea'; },
        async textContent() { return 'ChatGPT Message ChatGPT'; },
      };
    },
    async textContent() {
      return 'ChatGPT Message ChatGPT';
    },
    async title() {
      return 'ChatGPT';
    },
    async evaluate() {
      return {};
    },
  };

  const stage = await detectChatGpt2FAStage(page, {
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
  });

  assert.equal(stage.stage, 'unknown');
});

test('waitForKnownStage rechecks the stage after a timeout-boundary navigation', async () => {
  const { waitForKnownStage } = require('../src/auto/roxy_2fa_login.js');
  assert.equal(typeof waitForKnownStage, 'function');

  let stage = 'loading';
  const page = {
    url: () => 'https://auth.openai.com/log-in',
    getByRole(role, options = {}) {
      if (role === 'textbox' && options.name === 'Email address') {
        return { async isVisible() { return stage === 'email'; } };
      }
      return { async isVisible() { return false; } };
    },
    locator() {
      return { async textContent() { return stage === 'email' ? 'Welcome back Email address Continue' : 'Loading'; } };
    },
    async textContent() {
      return stage === 'email' ? 'Welcome back Email address Continue' : 'Loading';
    },
    async title() { return 'OpenAI'; },
    async waitForTimeout() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      stage = 'email';
    },
  };

  const result = await waitForKnownStage(page, {
    timeoutMs: 100,
    stageDetectTimeoutMs: 1,
    transitionTimeoutMs: 5,
  });

  assert.equal(result.stage, 'openai-email');
});

test('fetchChatGptSession does not navigate away when the page-context session request has no token', async () => {
  const { fetchChatGptSession } = require('../src/auto/roxy_2fa_login.js');
  const gotoCalls = [];
  const page = {
    async evaluate() { return null; },
    async goto(url) { gotoCalls.push(url); },
    async textContent() { return '{}'; },
  };

  await assert.rejects(
    () => fetchChatGptSession(page, { sessionTimeoutMs: 100, logger: { log: () => {} } }),
    (error) => error.code === 'CHATGPT_SESSION_ACCESS_TOKEN_MISSING'
  );
  assert.deepEqual(gotoCalls, []);
});

test('isChatGptLoginEntryPage ignores a visible but disabled Log in button', async () => {
  const { isChatGptLoginEntryPage } = require('../src/auto/roxy_2fa_login.js');
  const page = {
    url: () => 'https://chatgpt.com/',
    getByRole(role, options = {}) {
      if (role === 'button' && String(options.name).match(/log in/i)) {
        return {
          async isVisible() { return true; },
          async isEnabled() { return false; },
        };
      }
      return { async isVisible() { return false; } };
    },
  };

  assert.equal(await isChatGptLoginEntryPage(page, { timeoutMs: 100 }), false);
});

test('isChatGptLoginEntryPage ignores a visible Log in button with aria-disabled', async () => {
  const { isChatGptLoginEntryPage } = require('../src/auto/roxy_2fa_login.js');
  const page = {
    url: () => 'https://chatgpt.com/',
    getByRole(role, options = {}) {
      if (role === 'button' && String(options.name).match(/log in/i)) {
        return {
          async isVisible() { return true; },
          async isEnabled() { return true; },
          async getAttribute(name) { return name === 'aria-disabled' ? 'true' : null; },
        };
      }
      return { async isVisible() { return false; } };
    },
  };

  assert.equal(await isChatGptLoginEntryPage(page, { timeoutMs: 100 }), false);
});

test('submitOpenAiEmail rejects a visible but disabled email input before filling it', async () => {
  const { submitOpenAiEmail } = require('../src/auto/roxy_2fa_login.js');
  const page = {
    url: () => 'https://auth.openai.com/log-in',
    getByRole(role, options = {}) {
      if (role === 'textbox' && options.name === 'Email address') {
        return {
          async isVisible() { return true; },
          async isEnabled() { return false; },
          async isEditable() { return false; },
          async waitFor() {},
          async click() {},
          async fill() {},
        };
      }
      return { async isVisible() { return true; }, async click() {} };
    },
    locator() {
      return { async textContent() { return 'Welcome back Email address Continue'; } };
    },
  };

  await assert.rejects(
    () => submitOpenAiEmail(page, { email: 'user@example.com', timeoutMs: 100 }),
    (error) => error.code === 'OPENAI_LOGIN_PAGE_NOT_FOUND'
  );
});

test('detectChatGpt2FAStage rejects a callback path embedded in another origin', async () => {
  const { detectChatGpt2FAStage } = require('../src/auto/roxy_2fa_login.js');
  const page = {
    url: () => 'https://evil.example/?next=https://chatgpt.com/api/auth/callback/openai',
    getByRole() {
      return { async isVisible() { return false; } };
    },
    locator() {
      return { async textContent() { return 'Unexpected page'; } };
    },
    async textContent() { return 'Unexpected page'; },
    async title() { return 'Unexpected'; },
    async evaluate() { return null; },
  };

  const stage = await detectChatGpt2FAStage(page, { timeoutMs: 100, stageDetectTimeoutMs: 1 });
  assert.equal(stage.stage, 'unknown');
});

test('detectChatGpt2FAStage ignores a visible but disabled OpenAI email input', async () => {
  const { detectChatGpt2FAStage } = require('../src/auto/roxy_2fa_login.js');
  const page = {
    url: () => 'https://auth.openai.com/log-in',
    getByRole(role, options = {}) {
      if (role === 'textbox' && options.name === 'Email address') {
        return {
          async isVisible() { return true; },
          async isEnabled() { return false; },
          async isEditable() { return false; },
        };
      }
      return { async isVisible() { return false; } };
    },
    locator() {
      return { async textContent() { return 'Welcome back Email address Continue'; } };
    },
    async textContent() { return 'Welcome back Email address Continue'; },
    async title() { return 'Welcome back - OpenAI'; },
    async evaluate() { return null; },
  };

  const stage = await detectChatGpt2FAStage(page, { timeoutMs: 100, stageDetectTimeoutMs: 1 });
  assert.equal(stage.stage, 'unknown');
});

test('openChatGptLoginEntry clicks the first visible login button when multiple exist', async () => {
  const { openChatGptLoginEntry } = require('../src/auto/roxy_2fa_login.js');
  const calls = [];
  const page = {
    url: () => 'https://chatgpt.com/',
    getByRole(role, options = {}) {
      if (role === 'button' && String(options.name).match(/log in/i)) {
        return {
          first() {
            return {
              async isVisible() { return true; },
              async click(clickOptions) { calls.push(['first-login.click', clickOptions]); },
            };
          },
          async isVisible() { throw new Error('strict mode violation'); },
          async click() { throw new Error('strict mode violation'); },
        };
      }
      return {
        first() { return this; },
        async isVisible() { return false; },
      };
    },
    locator(selector) {
      return {
        async isVisible() { return selector === '#prompt-textarea'; },
        async textContent() { return 'ChatGPT Message ChatGPT Log in Sign up'; },
      };
    },
    async textContent() {
      return 'ChatGPT Message ChatGPT Log in Sign up';
    },
    async title() {
      return 'ChatGPT';
    },
    async evaluate() {
      return {};
    },
  };

  const result = await openChatGptLoginEntry(page, {
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
    logger: { log: () => {} },
  });

  assert.equal(result.status, 'chatgpt-login-clicked');
  assert.deepEqual(calls, [['first-login.click', { timeout: 100 }]]);
});

test('processChatGpt2FALoginFlow follows ChatGPT login -> password -> MFA -> session without phone verification', async () => {
  const { processChatGpt2FALoginFlow } = require('../src/auto/roxy_2fa_login.js');
  const { page, calls, transitions } = createChatGpt2FAPageHarness();
  const outputRootDir = await mkdtemp(join(tmpdir(), 'roxy-2fa-login-'));
  const logs = [];

  const result = await processChatGpt2FALoginFlow(page, {
    email: 'user@example.com',
    password: 'correct-password',
    mfaCode: '654321',
    outputRootDir,
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
    maxStageTurns: 10,
    logger: { log: (message) => logs.push(String(message)), warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'session-saved');
  assert.equal(result.email, 'user@example.com');
  assert.equal(result.session.accessToken, 'access-token-123');
  assert.equal(basename(result.credentialFile), 'user@example.com.json');
  assert.deepEqual(transitions, [
    'chatgpt-entry->email',
    'email->password',
    'password->mfa',
    'mfa->chatgpt-home',
  ]);
  assert.equal(calls.some((call) => call[0] === 'goto' && call[1] === 'https://chatgpt.com/api/auth/session'), false);
  assert.ok(calls.some((call) => call[0] === 'evaluate' && call[1] === 'https://chatgpt.com/api/auth/session'));
  assert.deepEqual(calls.filter((call) => ['email.fill', 'password.fill', 'code.fill'].includes(call[0])), [
    ['email.fill', 'user@example.com'],
    ['password.fill', 'correct-password'],
    ['code.fill', '654321'],
  ]);
  assert.equal(calls.some((call) => String(call).includes('Phone number')), false);
  assert.ok(logs.some((line) => line.includes('action=动作后阶段识别 from=chatgpt-entry stage=openai-email')));
  assert.ok(logs.some((line) => line.includes('action=动作后阶段识别 from=openai-email stage=openai-password')));
  assert.ok(logs.some((line) => line.includes('action=动作后阶段识别 from=openai-password stage=openai-mfa')));
  assert.ok(logs.some((line) => line.includes('action=动作后阶段识别 from=openai-mfa stage=chatgpt-home')));

  const saved = JSON.parse(await readFile(result.credentialFile, 'utf8'));
  assert.equal(saved.email, 'user@example.com');
  assert.equal(saved.access_token, 'access-token-123');
  assert.equal(saved.source, 'chatgpt_2fa_session_login');
});

test('save2FALoginCredentialFile writes token file without logging token', async () => {
  const { save2FALoginCredentialFile } = require('../src/auto/roxy_2fa_login.js');
  const outputRootDir = await mkdtemp(join(tmpdir(), 'roxy-2fa-save-'));
  const logs = [];

  const result = save2FALoginCredentialFile({
    email: 'user+tag@example.com',
    accessToken: 'secret-access-token',
    outputRootDir,
    logger: { log: (message) => logs.push(String(message)) },
    now: () => '2026-07-03T00:00:00.000Z',
  });

  assert.equal(basename(result.path), 'user+tag@example.com.json');
  assert.deepEqual(JSON.parse(await readFile(result.path, 'utf8')), {
    email: 'user+tag@example.com',
    access_token: 'secret-access-token',
    created_at: '2026-07-03T00:00:00.000Z',
    source: 'chatgpt_2fa_session_login',
  });
  assert.equal(logs.some((line) => line.includes('secret-access-token')), false);
});
