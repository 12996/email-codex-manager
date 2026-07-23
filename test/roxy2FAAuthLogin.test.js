import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

function createPasswordPageHarness() {
  const calls = [];
  let stage = 'password';
  let currentUrl = 'https://auth.openai.com/log-in/password';

  const page = {
    getByRole(role, options = {}) {
      calls.push(['getByRole', role, options, stage]);
      if (role === 'textbox' && options.name === 'Password') {
        return {
          async isVisible() { return stage === 'password'; },
          async waitFor(waitOptions) { calls.push(['password.waitFor', waitOptions]); },
          async click() { calls.push(['password.click']); },
          async fill(value) { calls.push(['password.fill', value]); },
        };
      }
      if (role === 'button' && options.name === 'Log in with a one-time code') {
        return {
          async isVisible() { return stage === 'password'; },
          async click() { throw new Error('one-time-code should not be clicked'); },
        };
      }
      return {
        async isVisible() { return stage === 'password' || stage === 'mfa'; },
        async click(clickOptions) {
          calls.push(['continue.click', clickOptions, stage]);
          stage = 'mfa';
          currentUrl = 'https://auth.openai.com/mfa-challenge/chal_123';
        },
      };
    },
    locator() {
      return {
        async textContent() {
          return stage === 'mfa'
            ? 'Verify your identity Enter the code from your authenticator app Code Continue'
            : 'Enter your password Password Continue Log in with a one-time code';
        },
      };
    },
    url: () => currentUrl,
    title: async () => 'OpenAI',
    textContent: async () => stage === 'mfa'
      ? 'Verify your identity Enter the code from your authenticator app Code Continue'
      : 'Enter your password Password Continue Log in with a one-time code',
    waitForTimeout: async () => {},
  };

  return { page, calls };
}

function createMfaPageHarness() {
  const calls = [];
  let currentUrl = 'https://auth.openai.com/mfa-challenge/chal_123';
  const bodyText = () => currentUrl.includes('/add-phone')
    ? 'Add your phone number to your account Phone number Continue'
    : 'Verify your identity Enter the code from your authenticator app Code Continue';
  const page = {
    getByRole(role, options = {}) {
      calls.push(['getByRole', role, options]);
      if (role === 'textbox' && options.name === 'Code') {
        return {
          async isVisible() { return currentUrl.includes('/mfa-challenge/'); },
          async waitFor(waitOptions) { calls.push(['code.waitFor', waitOptions]); },
          async click() { calls.push(['code.click']); },
          async fill(value) { calls.push(['code.fill', value]); },
        };
      }
      return {
        async isVisible() { return true; },
        async click(clickOptions) {
          calls.push(['continue.click', clickOptions]);
          currentUrl = 'https://auth.openai.com/add-phone';
        },
      };
    },
    locator() {
      return {
        async textContent() {
          return bodyText();
        },
      };
    },
    url: () => currentUrl,
    title: async () => 'Verify your identity - OpenAI',
    textContent: async () => bodyText(),
    waitForTimeout: async () => {},
  };
  return { page, calls };
}

test('roxy_2fa_auth_login exports the 2FA OAuth helpers and runners', () => {
  const module = require('../src/auto/roxy_2fa_auth_login.js');

  assert.equal(typeof module.is_openai_mfa_page, 'function');
  assert.equal(typeof module.openAi_password_login, 'function');
  assert.equal(typeof module.openAi_mfa_code, 'function');
  assert.equal(typeof module.process2FAOAuthLoginFlow, 'function');
  assert.equal(typeof module.generateTotpCode, 'function');
  assert.equal(typeof module.run, 'function');
  assert.equal(typeof module.runCli, 'function');
});

test('openAi_password_login fills the password and does not click one-time code', async () => {
  const { openAi_password_login } = require('../src/auto/roxy_2fa_auth_login.js');
  const { page, calls } = createPasswordPageHarness();

  const result = await openAi_password_login(page, {
    password: 'correct horse battery staple',
    timeoutMs: 100,
    postPasswordStageTimeoutMs: 100,
  });

  assert.equal(result.status, 'password-submitted');
  assert.equal(result.nextStage, 'mfa');
  assert.deepEqual(calls.filter((call) => ['password.fill', 'continue.click'].includes(call[0])), [
    ['password.fill', 'correct horse battery staple'],
    ['continue.click', { timeout: 100 }, 'password'],
  ]);
  assert.equal(calls.some((call) => call[0] === 'oneTimeCode.click'), false);
});

test('is_openai_password_page ignores a visible but disabled password input during a transition', async () => {
  const { is_openai_password_page } = require('../src/auto/roxy_2fa_auth_login.js');
  const page = {
    getByRole(role, options = {}) {
      if (role === 'textbox' && options.name === 'Password') {
        return {
          async isVisible() { return true; },
          async isEnabled() { return false; },
          async isEditable() { return false; },
        };
      }
      return { async isVisible() { return false; } };
    },
    locator() {
      return { async textContent() { return 'Enter your password Password Continue'; } };
    },
    url: () => 'https://auth.openai.com/log-in/password',
  };

  assert.equal(await is_openai_password_page(page, { timeoutMs: 100 }), false);
});

test('openAi_mfa_code detects MFA page, fills code, and clicks Continue', async () => {
  const { is_openai_mfa_page, openAi_mfa_code } = require('../src/auto/roxy_2fa_auth_login.js');
  const { page, calls } = createMfaPageHarness();

  assert.equal(await is_openai_mfa_page(page, { timeoutMs: 100 }), true);

  const result = await openAi_mfa_code(page, {
    mfaCode: '654321',
    timeoutMs: 100,
  });

  assert.equal(result.status, 'mfa-code-submitted');
  assert.deepEqual(calls.filter((call) => ['code.fill', 'continue.click'].includes(call[0])), [
    ['code.fill', '654321'],
    ['continue.click', { timeout: 100 }],
  ]);
});

test('generateTotpCode implements RFC 6238 compatible TOTP without external dependencies', () => {
  const { generateTotpCode } = require('../src/auto/roxy_2fa_auth_login.js');

  assert.equal(
    generateTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { timestampMs: 59000, digits: 8 }),
    '94287082'
  );
});

test('process2FAOAuthLoginFlow follows password -> mfa -> phone-add -> phone-verify -> phone-code -> codex -> callback', async () => {
  const { process2FAOAuthLoginFlow } = require('../src/auto/roxy_2fa_auth_login.js');
  const calls = [];
  const transitions = [];
  let stage = 'password';
  let currentUrl = 'https://auth.openai.com/log-in/password';

  const bodyText = () => {
    if (stage === 'password') return 'Enter your password Password Continue Log in with a one-time code';
    if (stage === 'mfa') return 'Verify your identity Enter the code from your authenticator app Code Continue';
    if (stage === 'phone-add') return 'Add your phone number to your account Phone number Continue';
    if (stage === 'phone-verify') return 'Verify your phone number Text Message Continue';
    if (stage === 'phone-code') return 'Check your phone Enter the verification code Code Continue';
    if (stage === 'codex') return 'Sign in to Codex with ChatGPT. Continue';
    return '';
  };

  function advance(nextStage, nextUrl) {
    transitions.push(`${stage}->${nextStage}`);
    stage = nextStage;
    currentUrl = nextUrl;
  }

  const page = {
    getByRole(role, options = {}) {
      calls.push(['getByRole', role, options, stage]);
      if (role === 'textbox' && options.name === 'Password') {
        return {
          async isVisible() { return stage === 'password'; },
          async waitFor() {},
          async click() {},
          async fill(value) { calls.push(['password.fill', value]); },
        };
      }
      if (role === 'textbox' && options.name === 'Email address') {
        return { async isVisible() { return false; } };
      }
      if (role === 'textbox' && options.name === 'Code') {
        return {
          async isVisible() { return stage === 'mfa' || stage === 'phone-code'; },
          async waitFor() {},
          async click() { calls.push(['code.click', stage]); },
          async fill(value) { calls.push(['code.fill', value, stage]); },
        };
      }
      if (role === 'textbox' && options.name === 'Phone number') {
        return {
          async isVisible() { return stage === 'phone-add'; },
          async waitFor() {},
          async click() {},
          async press(key) { calls.push(['phone.press', key]); },
          async fill(value) { calls.push(['phone.fill', value]); },
        };
      }
      if (role === 'radio' && options.name === 'Text Message') {
        return {
          async isVisible() { return stage === 'phone-verify'; },
          async check(checkOptions) { calls.push(['textMessage.check', checkOptions]); },
        };
      }
      return {
        async isVisible() {
          return ['password', 'mfa', 'phone-add', 'phone-verify', 'phone-code', 'codex'].includes(stage);
        },
        async click(clickOptions) {
          calls.push(['continue.click', clickOptions, stage]);
          if (stage === 'password') advance('mfa', 'https://auth.openai.com/mfa-challenge/chal_123');
          else if (stage === 'mfa') advance('phone-add', 'https://auth.openai.com/add-phone');
          else if (stage === 'phone-add') advance('phone-verify', 'https://auth.openai.com/phone-verification');
          else if (stage === 'phone-verify') advance('phone-code', 'https://auth.openai.com/phone-verification');
          else if (stage === 'phone-code') advance('codex', 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent');
          else if (stage === 'codex') advance('callback', 'http://localhost:1455/auth/callback?code=code_2fa&state=state_2fa');
        },
      };
    },
    locator() {
      return { async textContent() { return bodyText(); } };
    },
    url: () => currentUrl,
    title: async () => 'OAuth',
    textContent: async () => bodyText(),
    waitForTimeout: async () => {},
  };

  const result = await process2FAOAuthLoginFlow(page, {
    email: 'jregkolpig+s2@gmail.com',
    password: 'openai-password',
    mfaCode: '654321',
    phone: '+13523282595',
    code: '112233',
    verifier: 'verifier_2fa',
    state: 'state_2fa',
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
    transitionTimeoutMs: 100,
    maxStageTurns: 12,
    exchangeToken: async (code, verifier, email) => {
      calls.push(['exchangeToken', code, verifier, email]);
      return { cpaPath: 'local-cpa.json' };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.deepEqual(transitions, [
    'password->mfa',
    'mfa->phone-add',
    'phone-add->phone-verify',
    'phone-verify->phone-code',
    'phone-code->codex',
    'codex->callback',
  ]);
  assert.deepEqual(calls.filter((call) => ['password.fill', 'phone.fill', 'exchangeToken'].includes(call[0])), [
    ['password.fill', 'openai-password'],
    ['phone.fill', '+13523282595'],
    ['exchangeToken', 'code_2fa', 'verifier_2fa', 'jregkolpig+s2@gmail.com'],
  ]);
  assert.deepEqual(calls.filter((call) => call[0] === 'code.fill'), [
    ['code.fill', '654321', 'mfa'],
    ['code.fill', '112233', 'phone-code'],
  ]);
});

test('process2FAOAuthLoginFlow waits for MFA transition before the next stage detection', async () => {
  const { process2FAOAuthLoginFlow } = require('../src/auto/roxy_2fa_auth_login.js');
  const calls = [];
  let stage = 'mfa';
  let mfaSubmitted = false;
  let currentUrl = 'https://auth.openai.com/mfa-challenge/chal_123';

  const bodyText = () => {
    if (stage === 'mfa') return 'Verify your identity Enter the code from your authenticator app Code Continue';
    if (stage === 'phone-add') return 'Add your phone number to your account Phone number Continue';
    if (stage === 'codex') return 'Sign in to Codex with ChatGPT. Continue';
    return '';
  };

  const page = {
    getByRole(role, options = {}) {
      calls.push(['getByRole', role, options, stage]);
      if (role === 'textbox' && options.name === 'Email address') {
        return { async isVisible() { return false; } };
      }
      if (role === 'textbox' && options.name === 'Password') {
        return { async isVisible() { return false; } };
      }
      if (role === 'textbox' && options.name === 'Code') {
        return {
          async isVisible() { return stage === 'mfa'; },
          async waitFor() {},
          async click() { calls.push(['code.click', stage]); },
          async fill(value) { calls.push(['code.fill', value, stage]); },
        };
      }
      if (role === 'textbox' && options.name === 'Phone number') {
        return {
          async isVisible() { return stage === 'phone-add'; },
          async waitFor() {},
          async click() {},
          async press(key) { calls.push(['phone.press', key]); },
          async fill(value) { calls.push(['phone.fill', value]); },
        };
      }
      return {
        async isVisible() {
          return ['mfa', 'phone-add', 'codex'].includes(stage);
        },
        async click(clickOptions) {
          calls.push(['continue.click', clickOptions, stage]);
          if (stage === 'mfa') {
            mfaSubmitted = true;
          } else if (stage === 'phone-add') {
            stage = 'codex';
            currentUrl = 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent';
          } else if (stage === 'codex') {
            stage = 'callback';
            currentUrl = 'http://localhost:1455/auth/callback?code=code_after_mfa&state=state_after_mfa';
          }
        },
      };
    },
    locator() {
      return { async textContent() { return bodyText(); } };
    },
    url: () => currentUrl,
    title: async () => 'OAuth',
    textContent: async () => bodyText(),
    waitForTimeout: async () => {
      if (mfaSubmitted && stage === 'mfa') {
        stage = 'phone-add';
        currentUrl = 'https://auth.openai.com/add-phone';
      }
    },
  };

  const result = await process2FAOAuthLoginFlow(page, {
    email: 'jregkolpig+s2@gmail.com',
    password: 'openai-password',
    mfaCode: '654321',
    phone: '+13523282595',
    verifier: 'verifier_after_mfa',
    state: 'state_after_mfa',
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
    postMfaStageTimeoutMs: 100,
    transitionTimeoutMs: 100,
    maxStageTurns: 8,
    exchangeToken: async (code, verifier, email) => {
      calls.push(['exchangeToken', code, verifier, email]);
      return { cpaPath: 'local-cpa.json' };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.deepEqual(calls.filter((call) => call[0] === 'code.fill'), [
    ['code.fill', '654321', 'mfa'],
  ]);
  assert.deepEqual(calls.filter((call) => ['phone.fill', 'exchangeToken'].includes(call[0])), [
    ['phone.fill', '+13523282595'],
    ['exchangeToken', 'code_after_mfa', 'verifier_after_mfa', 'jregkolpig+s2@gmail.com'],
  ]);
});

test('process2FAOAuthLoginFlow follows email -> password -> mfa without clicking one-time code', async () => {
  const { process2FAOAuthLoginFlow } = require('../src/auto/roxy_2fa_auth_login.js');
  const calls = [];
  const transitions = [];
  let stage = 'email-login';
  let currentUrl = 'https://auth.openai.com/log-in-or-create-account';

  const bodyText = () => {
    if (stage === 'email-login') return 'Welcome back Email address Continue';
    if (stage === 'password') return 'Enter your password Password Continue Log in with a one-time code';
    if (stage === 'mfa') return 'Verify your identity Enter the code from your authenticator app Code Continue';
    if (stage === 'codex') return 'Sign in to Codex with ChatGPT. Continue';
    return '';
  };

  function advance(nextStage, nextUrl) {
    transitions.push(`${stage}->${nextStage}`);
    stage = nextStage;
    currentUrl = nextUrl;
  }

  const page = {
    getByRole(role, options = {}) {
      calls.push(['getByRole', role, options, stage]);
      if (role === 'textbox' && options.name === 'Email address') {
        return {
          async isVisible() { return stage === 'email-login'; },
          async waitFor(waitOptions) { calls.push(['email.waitFor', waitOptions]); },
          async click() { calls.push(['email.click']); },
          async fill(value) { calls.push(['email.fill', value]); },
        };
      }
      if (role === 'textbox' && options.name === 'Password') {
        return {
          async isVisible() { return stage === 'password'; },
          async waitFor(waitOptions) { calls.push(['password.waitFor', waitOptions]); },
          async click() { calls.push(['password.click']); },
          async fill(value) { calls.push(['password.fill', value]); },
        };
      }
      if (role === 'textbox' && options.name === 'Code') {
        return {
          async isVisible() { return stage === 'mfa'; },
          async waitFor(waitOptions) { calls.push(['code.waitFor', waitOptions]); },
          async click() { calls.push(['code.click', stage]); },
          async fill(value) { calls.push(['code.fill', value, stage]); },
        };
      }
      if (role === 'button' && options.name === 'Log in with a one-time code') {
        return {
          async isVisible() { return stage === 'password'; },
          async click() {
            calls.push(['oneTimeCode.click', stage]);
            throw new Error('one-time-code should not be clicked in 2FA flow');
          },
        };
      }
      return {
        async isVisible() {
          return ['email-login', 'password', 'mfa', 'codex'].includes(stage);
        },
        async click(clickOptions) {
          calls.push(['continue.click', clickOptions, stage]);
          if (stage === 'email-login') advance('password', 'https://auth.openai.com/log-in/password');
          else if (stage === 'password') advance('mfa', 'https://auth.openai.com/mfa-challenge/chal_123');
          else if (stage === 'mfa') advance('codex', 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent');
          else if (stage === 'codex') advance('callback', 'http://localhost:1455/auth/callback?code=code_email_2fa&state=state_email_2fa');
        },
      };
    },
    locator() {
      return { async textContent() { return bodyText(); } };
    },
    url: () => currentUrl,
    title: async () => 'OAuth',
    textContent: async () => bodyText(),
    waitForTimeout: async () => {},
  };

  const result = await process2FAOAuthLoginFlow(page, {
    email: 'jregkolpig+s2@gmail.com',
    password: 'openai-password',
    mfaCode: '654321',
    verifier: 'verifier_email_2fa',
    state: 'state_email_2fa',
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
    transitionTimeoutMs: 100,
    maxStageTurns: 10,
    exchangeToken: async (code, verifier, email) => {
      calls.push(['exchangeToken', code, verifier, email]);
      return { cpaPath: 'local-cpa.json' };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.deepEqual(transitions, [
    'email-login->password',
    'password->mfa',
    'mfa->codex',
    'codex->callback',
  ]);
  assert.equal(calls.some((call) => call[0] === 'oneTimeCode.click'), false);
  assert.deepEqual(calls.filter((call) => ['email.fill', 'password.fill', 'exchangeToken'].includes(call[0])), [
    ['email.fill', 'jregkolpig+s2@gmail.com'],
    ['password.fill', 'openai-password'],
    ['exchangeToken', 'code_email_2fa', 'verifier_email_2fa', 'jregkolpig+s2@gmail.com'],
  ]);
  assert.deepEqual(calls.filter((call) => call[0] === 'code.fill'), [
    ['code.fill', '654321', 'mfa'],
  ]);
});

test('process2FAOAuthLoginFlow accepts the newer password page without one-time-code button after email submit', async () => {
  const { process2FAOAuthLoginFlow } = require('../src/auto/roxy_2fa_auth_login.js');
  const calls = [];
  const transitions = [];
  let stage = 'email-login';
  let currentUrl = 'https://auth.openai.com/log-in-or-create-account';

  const bodyText = () => {
    if (stage === 'email-login') return 'Welcome back Email address Continue';
    if (stage === 'password') return 'Enter your password Email address Edit Password Forgot password? Continue';
    if (stage === 'mfa') return 'Verify your identity Enter the code from your authenticator app Code Continue';
    if (stage === 'codex') return 'Sign in to Codex with ChatGPT. Continue';
    return '';
  };

  function advance(nextStage, nextUrl) {
    transitions.push(`${stage}->${nextStage}`);
    stage = nextStage;
    currentUrl = nextUrl;
  }

  const page = {
    getByRole(role, options = {}) {
      calls.push(['getByRole', role, options, stage]);
      if (role === 'textbox' && options.name === 'Email address') {
        return {
          async isVisible() { return stage === 'email-login'; },
          async waitFor(waitOptions) { calls.push(['email.waitFor', waitOptions]); },
          async click() { calls.push(['email.click']); },
          async fill(value) { calls.push(['email.fill', value]); },
        };
      }
      if (role === 'textbox' && options.name === 'Password') {
        return {
          async isVisible() { return stage === 'password'; },
          async waitFor(waitOptions) { calls.push(['password.waitFor', waitOptions]); },
          async click() { calls.push(['password.click']); },
          async fill(value) { calls.push(['password.fill', value]); },
        };
      }
      if (role === 'textbox' && options.name === 'Code') {
        return {
          async isVisible() { return stage === 'mfa'; },
          async waitFor(waitOptions) { calls.push(['code.waitFor', waitOptions]); },
          async click() { calls.push(['code.click', stage]); },
          async fill(value) { calls.push(['code.fill', value, stage]); },
        };
      }
      if (role === 'button' && options.name === 'Log in with a one-time code') {
        return {
          async isVisible() { return false; },
          async click() {
            calls.push(['oneTimeCode.click', stage]);
            throw new Error('one-time-code should not be clicked in 2FA flow');
          },
        };
      }
      return {
        async isVisible() {
          return ['email-login', 'password', 'mfa', 'codex'].includes(stage);
        },
        async click(clickOptions) {
          calls.push(['continue.click', clickOptions, stage]);
          if (stage === 'email-login') advance('password', 'https://auth.openai.com/log-in/password');
          else if (stage === 'password') advance('mfa', 'https://auth.openai.com/mfa-challenge/chal_123');
          else if (stage === 'mfa') advance('codex', 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent');
          else if (stage === 'codex') advance('callback', 'http://localhost:1455/auth/callback?code=code_new_password&state=state_new_password');
        },
      };
    },
    locator() {
      return { async textContent() { return bodyText(); } };
    },
    url: () => currentUrl,
    title: async () => 'OAuth',
    textContent: async () => bodyText(),
    waitForTimeout: async () => {},
  };

  const result = await process2FAOAuthLoginFlow(page, {
    email: 'hamper.steaks-0m+rqf0833vi873fl987@icloud.com',
    password: 'openai-password',
    mfaCode: '654321',
    verifier: 'verifier_new_password',
    state: 'state_new_password',
    timeoutMs: 100,
    postEmailStageTimeoutMs: 100,
    stageDetectTimeoutMs: 10,
    transitionTimeoutMs: 100,
    maxStageTurns: 10,
    exchangeToken: async (code, verifier, email) => {
      calls.push(['exchangeToken', code, verifier, email]);
      return { cpaPath: 'local-cpa.json' };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.deepEqual(transitions, [
    'email-login->password',
    'password->mfa',
    'mfa->codex',
    'codex->callback',
  ]);
  assert.equal(calls.some((call) => call[0] === 'oneTimeCode.click'), false);
  assert.deepEqual(calls.filter((call) => ['email.fill', 'password.fill', 'exchangeToken'].includes(call[0])), [
    ['email.fill', 'hamper.steaks-0m+rqf0833vi873fl987@icloud.com'],
    ['password.fill', 'openai-password'],
    ['exchangeToken', 'code_new_password', 'verifier_new_password', 'hamper.steaks-0m+rqf0833vi873fl987@icloud.com'],
  ]);
});

test('process2FAOAuthLoginFlow waits when email submit slowly lands on the password page', async () => {
  const { process2FAOAuthLoginFlow } = require('../src/auto/roxy_2fa_auth_login.js');
  const calls = [];
  const transitions = [];
  let stage = 'email-login';
  let pendingPassword = false;
  let waitCountAfterEmail = 0;
  let currentUrl = 'https://auth.openai.com/log-in-or-create-account';

  const bodyText = () => {
    if (stage === 'email-login') return 'Welcome back Email address Continue';
    if (stage === 'loading') return 'Loading';
    if (stage === 'password') return 'Enter your password Email address Edit Password Forgot password? Continue';
    if (stage === 'mfa') return 'Verify your identity Enter the code from your authenticator app Code Continue';
    if (stage === 'codex') return 'Sign in to Codex with ChatGPT. Continue';
    return '';
  };

  function advance(nextStage, nextUrl) {
    transitions.push(`${stage}->${nextStage}`);
    stage = nextStage;
    currentUrl = nextUrl;
  }

  const page = {
    getByRole(role, options = {}) {
      calls.push(['getByRole', role, options, stage]);
      if (role === 'textbox' && options.name === 'Email address') {
        return {
          async isVisible() { return stage === 'email-login'; },
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
          async fill(value) { calls.push(['code.fill', value, stage]); },
        };
      }
      return {
        async isVisible() {
          return ['email-login', 'password', 'mfa', 'codex'].includes(stage);
        },
        async click(clickOptions) {
          calls.push(['continue.click', clickOptions, stage]);
          if (stage === 'email-login') {
            pendingPassword = true;
            advance('loading', 'https://auth.openai.com/log-in');
          } else if (stage === 'password') {
            advance('mfa', 'https://auth.openai.com/mfa-challenge/chal_123');
          } else if (stage === 'mfa') {
            advance('codex', 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent');
          } else if (stage === 'codex') {
            advance('callback', 'http://localhost:1455/auth/callback?code=code_slow_password&state=state_slow_password');
          }
        },
      };
    },
    locator() {
      return { async textContent() { return bodyText(); } };
    },
    url: () => currentUrl,
    title: async () => 'OAuth',
    textContent: async () => bodyText(),
    waitForTimeout: async () => {
      if (pendingPassword && stage === 'loading') {
        waitCountAfterEmail += 1;
      }
      if (pendingPassword && stage === 'loading' && waitCountAfterEmail >= 2) {
        pendingPassword = false;
        advance('password', 'https://auth.openai.com/log-in/password');
      }
    },
  };

  const result = await process2FAOAuthLoginFlow(page, {
    email: 'hamper.steaks-0m+rqf0833vi873fl987@icloud.com',
    password: 'openai-password',
    mfaCode: '654321',
    verifier: 'verifier_slow_password',
    state: 'state_slow_password',
    timeoutMs: 100,
    postEmailStageTimeoutMs: 100,
    stageDetectTimeoutMs: 10,
    transitionTimeoutMs: 100,
    maxStageTurns: 10,
    exchangeToken: async (code, verifier, email) => {
      calls.push(['exchangeToken', code, verifier, email]);
      return { cpaPath: 'local-cpa.json' };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.deepEqual(calls.filter((call) => ['email.fill', 'password.fill', 'exchangeToken'].includes(call[0])), [
    ['email.fill', 'hamper.steaks-0m+rqf0833vi873fl987@icloud.com'],
    ['password.fill', 'openai-password'],
    ['exchangeToken', 'code_slow_password', 'verifier_slow_password', 'hamper.steaks-0m+rqf0833vi873fl987@icloud.com'],
  ]);
});

test('process2FAOAuthLoginFlow rechecks the page when password appears during the final post-email wait', async () => {
  const { process2FAOAuthLoginFlow } = require('../src/auto/roxy_2fa_auth_login.js');
  const calls = [];
  let stage = 'email-login';
  let waitCount = 0;
  let currentUrl = 'https://auth.openai.com/log-in';

  const bodyText = () => {
    if (stage === 'email-login') return 'Welcome back Email address Continue';
    if (stage === 'loading') return 'Loading';
    if (stage === 'password') return 'Enter your password Email address Edit Password Forgot password? Continue';
    if (stage === 'mfa') return 'Verify your identity Enter the code from your authenticator app Code Continue';
    if (stage === 'codex') return 'Sign in to Codex with ChatGPT. Continue';
    return '';
  };

  const advance = (nextStage, nextUrl) => {
    stage = nextStage;
    currentUrl = nextUrl;
  };

  const page = {
    getByRole(role, options = {}) {
      if (role === 'textbox' && options.name === 'Email address') {
        return {
          async isVisible() { return stage === 'email-login'; },
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
      if (role === 'button' && options.name === 'Log in with a one-time code') {
        return { async isVisible() { return false; } };
      }
      return {
        async isVisible() { return ['email-login', 'password', 'mfa', 'codex'].includes(stage); },
        async click() {
          calls.push(['continue.click', stage]);
          if (stage === 'email-login') advance('loading', 'https://auth.openai.com/log-in');
          else if (stage === 'password') advance('mfa', 'https://auth.openai.com/mfa-challenge/chal_123');
          else if (stage === 'mfa') advance('codex', 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent');
          else if (stage === 'codex') advance('callback', 'http://localhost:1455/auth/callback?code=code_final_wait&state=state_final_wait');
        },
      };
    },
    locator() {
      return { async textContent() { return bodyText(); } };
    },
    url: () => currentUrl,
    title: async () => 'OAuth',
    textContent: async () => bodyText(),
    waitForTimeout: async () => {
      waitCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (stage === 'loading' && waitCount >= 2) {
        advance('password', 'https://auth.openai.com/log-in/password');
      }
    },
  };

  const result = await process2FAOAuthLoginFlow(page, {
    email: 'final-wait@example.com',
    password: 'openai-password',
    mfaCode: '654321',
    verifier: 'verifier_final_wait',
    state: 'state_final_wait',
    timeoutMs: 100,
    postEmailStageTimeoutMs: 5,
    stageDetectTimeoutMs: 1,
    transitionTimeoutMs: 100,
    maxStageTurns: 10,
    exchangeToken: async (code, verifier, email) => {
      calls.push(['exchangeToken', code, verifier, email]);
      return { cpaPath: 'local-cpa.json' };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.deepEqual(calls.filter((call) => ['password.fill', 'exchangeToken'].includes(call[0])), [
    ['password.fill', 'openai-password'],
    ['exchangeToken', 'code_final_wait', 'verifier_final_wait', 'final-wait@example.com'],
  ]);
});

test('process2FAOAuthLoginFlow selects the existing account before the 2FA password flow', async () => {
  const { process2FAOAuthLoginFlow } = require('../src/auto/roxy_2fa_auth_login.js');
  const calls = [];
  const transitions = [];
  let stage = 'choose-account';
  let currentUrl = 'https://auth.openai.com/choose-an-account';

  const bodyText = () => {
    if (stage === 'choose-account') return 'Welcome back Choose an account to continue to Codex Select account hamper.steaks-0m+rqf0833vi873fl987@icloud.com';
    if (stage === 'password') return 'Enter your password Email address Edit Password Forgot password? Continue';
    if (stage === 'mfa') return 'Verify your identity Enter the code from your authenticator app Code Continue';
    if (stage === 'codex') return 'Sign in to Codex with ChatGPT. Continue';
    return '';
  };

  function advance(nextStage, nextUrl) {
    transitions.push(`${stage}->${nextStage}`);
    stage = nextStage;
    currentUrl = nextUrl;
  }

  const page = {
    getByRole(role, options = {}) {
      calls.push(['getByRole', role, options, stage]);
      if (role === 'textbox' && options.name === 'Email address') {
        return { async isVisible() { return false; } };
      }
      if (role === 'textbox' && options.name === 'Password') {
        return {
          async isVisible() { return stage === 'password'; },
          async waitFor() {},
          async click() { calls.push(['password.click']); },
          async fill(value) { calls.push(['password.fill', value]); },
        };
      }
      if (role === 'textbox' && options.name === 'Code') {
        return {
          async isVisible() { return stage === 'mfa'; },
          async waitFor() {},
          async click() { calls.push(['code.click', stage]); },
          async fill(value) { calls.push(['code.fill', value, stage]); },
        };
      }
      if (role === 'button' && String(options.name || '').includes('one-time code')) {
        return {
          async isVisible() { return false; },
          async click() { throw new Error('one-time-code should not be clicked in 2FA flow'); },
        };
      }
      if (role === 'button' && options.name instanceof RegExp) {
        return {
          async isVisible() { return stage === 'choose-account'; },
          async click(clickOptions) {
            calls.push(['select-account.click', clickOptions]);
            advance('password', 'https://auth.openai.com/log-in/password');
          },
        };
      }
      return {
        async isVisible() {
          return ['password', 'mfa', 'codex'].includes(stage);
        },
        async click(clickOptions) {
          calls.push(['continue.click', clickOptions, stage]);
          if (stage === 'password') advance('mfa', 'https://auth.openai.com/mfa-challenge/chal_123');
          else if (stage === 'mfa') advance('codex', 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent');
          else if (stage === 'codex') advance('callback', 'http://localhost:1455/auth/callback?code=code_choose&state=state_choose');
        },
      };
    },
    locator() {
      return { async textContent() { return bodyText(); } };
    },
    url: () => currentUrl,
    title: async () => 'OAuth',
    textContent: async () => bodyText(),
    waitForTimeout: async () => {},
  };

  const result = await process2FAOAuthLoginFlow(page, {
    email: 'hamper.steaks-0m+rqf0833vi873fl987@icloud.com',
    password: 'openai-password',
    mfaCode: '654321',
    verifier: 'verifier_choose',
    state: 'state_choose',
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
    transitionTimeoutMs: 100,
    maxStageTurns: 10,
    exchangeToken: async (code, verifier, email) => {
      calls.push(['exchangeToken', code, verifier, email]);
      return { cpaPath: 'local-cpa.json' };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.deepEqual(transitions, [
    'choose-account->password',
    'password->mfa',
    'mfa->codex',
    'codex->callback',
  ]);
  assert.equal(calls.some((call) => call[0] === 'oneTimeCode.click'), false);
  assert.deepEqual(calls.filter((call) => ['select-account.click', 'password.fill', 'exchangeToken'].includes(call[0])), [
    ['select-account.click', { timeout: 100 }],
    ['password.fill', 'openai-password'],
    ['exchangeToken', 'code_choose', 'verifier_choose', 'hamper.steaks-0m+rqf0833vi873fl987@icloud.com'],
  ]);
});

test('process2FAOAuthLoginFlow waits for delayed choose-account navigation before detecting the next stage', async () => {
  const { process2FAOAuthLoginFlow } = require('../src/auto/roxy_2fa_auth_login.js');
  const calls = [];
  let stage = 'choose-account';
  let selectClicks = 0;
  let pendingNavigation = false;
  let waitCount = 0;
  let currentUrl = 'https://auth.openai.com/choose-an-account';

  const bodyText = () => {
    if (stage === 'choose-account') {
      return 'Welcome back Choose an account to continue to Codex Select account 19_immoral.bitmap@icloud.com';
    }
    if (stage === 'password') return 'Enter your password Password Continue';
    if (stage === 'mfa') return 'Verify your identity Authenticator app Code Continue';
    return '';
  };

  const page = {
    getByRole(role, options = {}) {
      if (role === 'button' && options.name instanceof RegExp && /select account/i.test(String(options.name))) {
        return {
          async isVisible() { return stage === 'choose-account'; },
          async click() {
            selectClicks += 1;
            calls.push(['select-account.click']);
            pendingNavigation = true;
          },
        };
      }
      if (role === 'textbox' && options.name === 'Email address') {
        return {
          async isVisible() { return false; },
          async waitFor() {},
          async click() {},
          async fill() {},
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
          async isEnabled() { return stage === 'mfa'; },
          async isEditable() { return stage === 'mfa'; },
          async waitFor() {},
          async click() {},
          async fill(value) { calls.push(['code.fill', value]); },
        };
      }
      return {
        async isVisible() { return stage === 'password' || stage === 'mfa'; },
        async click() {
          calls.push(['continue.click', stage]);
          if (stage === 'password') {
            stage = 'mfa';
            currentUrl = 'https://auth.openai.com/mfa-challenge/chal_delayed';
          } else if (stage === 'mfa') {
            stage = 'callback';
            currentUrl = 'http://localhost:1455/auth/callback?code=delayed_choose&state=state_delayed_choose';
          }
        },
      };
    },
    locator() {
      return { async textContent() { return bodyText(); } };
    },
    url: () => currentUrl,
    title: async () => 'OAuth',
    textContent: async () => bodyText(),
    waitForTimeout: async () => {
      if (pendingNavigation) {
        waitCount += 1;
        if (waitCount >= 2) {
          pendingNavigation = false;
          stage = 'password';
          currentUrl = 'https://auth.openai.com/log-in/password';
        }
      }
    },
  };

  const result = await process2FAOAuthLoginFlow(page, {
    email: '19_immoral.bitmap@icloud.com',
    password: 'openai-password',
    mfaCode: '654321',
    verifier: 'verifier_delayed_choose',
    state: 'state_delayed_choose',
    timeoutMs: 100,
    stageDetectTimeoutMs: 10,
    postEmailStageTimeoutMs: 100,
    transitionTimeoutMs: 100,
    maxStageTurns: 10,
    exchangeToken: async (code, verifier, email) => {
      calls.push(['exchangeToken', code, verifier, email]);
      return { cpaPath: 'local-cpa.json' };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result.status, 'oauth-completed');
  assert.equal(selectClicks, 1);
  assert.equal(waitCount >= 2, true);
  assert.deepEqual(calls.filter((call) => ['password.fill', 'code.fill', 'exchangeToken'].includes(call[0])), [
    ['password.fill', 'openai-password'],
    ['code.fill', '654321'],
    ['exchangeToken', 'delayed_choose', 'verifier_delayed_choose', '19_immoral.bitmap@icloud.com'],
  ]);
});

test('roxy_2fa_auth_login default auth URL matches oauth_login.js and first CLI arg still overrides it', async () => {
  const { run } = require('../src/auto/roxy_2fa_auth_login.js');
  const navigatedUrls = [];

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
        browser: { disconnect: async () => {} },
        page: {
          goto: async (url) => navigatedUrls.push(url),
          waitForLoadState: async () => {},
          url: () => navigatedUrls.at(-1) || '',
          title: async () => 'Target',
          getByRole: () => ({ async isVisible() { return false; } }),
          locator: () => ({ async textContent() { return ''; } }),
          textContent: async () => '',
        },
      };
    }
  }

  const deps = {
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
    processOAuthLoginFlow: async () => ({ status: 'stubbed' }),
  };

  await run([], deps);
  await run(['https://example.test/custom-oauth'], deps);

  assert.doesNotMatch(navigatedUrls[0], /(?:[?&])prompt=login(?:&|$)/);
  assert.match(navigatedUrls[0], /code_challenge=challenge_fixed/);
  assert.match(navigatedUrls[0], /state=state_fixed/);
  assert.equal(navigatedUrls[1], 'https://example.test/custom-oauth');
});
