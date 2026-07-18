import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

function requireRegisterModuleWithStubs() {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'playwright-extra') {
      return { chromium: { use() {}, launch() { throw new Error('launch should not be called'); } } };
    }
    if (request === 'puppeteer-extra-plugin-stealth') return () => ({});
    if (request === 'axios') return {};
    if (request === './imap-auth') return { getImapAuthHeaders: async () => ({}) };
    if (request === './pool-email-imap') return { fetchLatestOpenAiOtpOnce: async () => '' };
    if (request === './inbox-email') return {};
    if (request === './local-proxy-bridge') return { createProxyBridge: async () => ({}), closeProxyBridge: async () => {} };
    if (request === './lib/california-fingerprint') {
      return {
        generateRandomCaliforniaFingerprint: () => ({}),
        createCaliforniaContext: async () => ({ context: { newPage: async () => ({}) } }),
      };
    }
    if (request === './mysql-store') {
      return {
        getActiveProxy: async () => '',
        markPoolEmailRegistered: async () => {},
        releasePoolEmailReservation: async () => {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../src/auto/roxy_register_openai.js')];
    return require('../src/auto/roxy_register_openai.js');
  } finally {
    Module._load = originalLoad;
  }
}

function makeAboutYouPageWithNumericAge() {
  const ageLocator = {
    async isVisible() {
      return true;
    },
    async evaluate(fn) {
      return fn({
        disabled: false,
        readOnly: false,
        type: 'number',
        name: 'age',
        id: 'age',
        placeholder: 'Age',
        autocomplete: 'off',
        inputMode: 'numeric',
        ariaLabel: 'Age',
        ariaDescription: '',
        maxLength: -1,
      });
    },
  };
  const hiddenLocator = {
    async isVisible() {
      return false;
    },
    async isEnabled() {
      return false;
    },
    async evaluate() {
      return null;
    },
  };

  return {
    url: () => 'https://auth.openai.com/about-you',
    title: async () => 'A few details help us set up your account. - OpenAI',
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            return 'A few details help us set up your account. Full name Age Finish creating account';
          },
        };
      }
      if (selector === 'input[inputmode="numeric"]') {
        return {
          async count() {
            return 1;
          },
          first() {
            return ageLocator;
          },
          nth() {
            return ageLocator;
          },
        };
      }
      return {
        async count() {
          return 0;
        },
        first() {
          return hiddenLocator;
        },
        nth() {
          return hiddenLocator;
        },
      };
    },
    async textContent() {
      return 'A few details help us set up your account. Full name Age Finish creating account';
    },
    async waitForTimeout() {},
    async waitForLoadState() {},
  };
}

test('registration email verification uses POST latest API and does not log code', async () => {
  const { fetchRegistrationEmailVerificationCodeOnce } = requireRegisterModuleWithStubs();
  const calls = [];
  const logs = [];
  const page = {
    request: {
      async post(url, options) {
        calls.push(['post', url, options]);
        return { async json() { return { ok: true, code: '654321' }; } };
      },
      async get(url) {
        calls.push(['get', url]);
        throw new Error('GET should not be called');
      },
    },
  };

  const result = await fetchRegistrationEmailVerificationCodeOnce(page, 'user@example.com', {
    verificationApiUrl: 'http://127.0.0.1:3100/api/verification-code/latest',
    logger: { log: (message) => logs.push(message), warn: (message) => logs.push(message), error: (message) => logs.push(message) },
  }, 2, 12);

  assert.equal(result.code, '654321');
  assert.deepEqual(calls, [[
    'post',
    'http://127.0.0.1:3100/api/verification-code/latest',
    { data: { account: 'user@example.com' }, timeout: 30000 },
  ]]);
  assert.equal(logs.some((line) => String(line).includes('654321')), false);
  assert.equal(logs.some((line) => String(line).includes('code=received')), true);
});

test('registration email verification defaults to iCloud code API for iCloud email', async () => {
  const {
    buildDefaultVerificationApiUrl,
    fetchRegistrationEmailVerificationCodeOnce,
  } = requireRegisterModuleWithStubs();
  const calls = [];
  const previousPort = process.env.PORT;
  const previousUrl = process.env.VERIFICATION_CODE_API_URL;
  const page = {
    request: {
      async post(url, options) {
        calls.push(['post', url, options]);
        return { async json() { return { ok: true, code: '654321' }; } };
      },
    },
  };

  try {
    process.env.PORT = '4567';
    delete process.env.VERIFICATION_CODE_API_URL;

    assert.equal(
      buildDefaultVerificationApiUrl(process.env, 'target-user@icloud.com'),
      'http://127.0.0.1:4567/api/icloud-verification-code/latest',
    );

    const result = await fetchRegistrationEmailVerificationCodeOnce(page, 'target-user@icloud.com', {}, 1, 12);
    assert.equal(result.code, '654321');
  } finally {
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    if (previousUrl === undefined) delete process.env.VERIFICATION_CODE_API_URL;
    else process.env.VERIFICATION_CODE_API_URL = previousUrl;
  }

  assert.deepEqual(calls, [[
    'post',
    'http://127.0.0.1:4567/api/icloud-verification-code/latest',
    { data: { account: 'target-user@icloud.com' }, timeout: 30000 },
  ]]);
});

test('registration email verification prefers external GET API and does not log code', async () => {
  const { fetchRegistrationEmailVerificationCodeOnce } = requireRegisterModuleWithStubs();
  const calls = [];
  const logs = [];
  const page = {
    request: {
      async post() {
        throw new Error('POST should not be called');
      },
      async get(url, options) {
        calls.push(['get', url, options]);
        return {
          async text() {
            return '<style>.c{color:#123456}</style><p>Your code is 789012</p>';
          },
        };
      },
    },
  };

  const result = await fetchRegistrationEmailVerificationCodeOnce(page, 'user@example.com', {
    registrationEmailCodeApiUrl: 'https://example.invalid/code',
    logger: { log: (message) => logs.push(message), warn: (message) => logs.push(message), error: (message) => logs.push(message) },
  }, 1, 3);

  assert.equal(result.code, '789012');
  assert.deepEqual(calls, [[
    'get',
    'https://example.invalid/code',
    { timeout: 30000 },
  ]]);
  assert.equal(logs.some((line) => String(line).includes('789012')), false);
  assert.equal(logs.some((line) => String(line).includes('https://example.invalid/code')), false);
  assert.equal(logs.some((line) => String(line).includes('api=external-email-code')), true);
  assert.equal(logs.some((line) => String(line).includes('code=received')), true);
});

test('registration email verification accepts email_code_api option alias before local POST', async () => {
  const { fetchRegistrationEmailVerificationCodeOnce } = requireRegisterModuleWithStubs();
  const calls = [];
  const page = {
    request: {
      async post() {
        throw new Error('POST should not be called');
      },
      async get(url, options) {
        calls.push(['get', url, options]);
        return {
          async text() {
            return 'OpenAI verification code: 345678';
          },
        };
      },
    },
  };

  const result = await fetchRegistrationEmailVerificationCodeOnce(page, 'user@example.com', {
    email_code_api: 'https://example.invalid/email-code',
  }, 1, 1);

  assert.equal(result.code, '345678');
  assert.deepEqual(calls, [[
    'get',
    'https://example.invalid/email-code',
    { timeout: 30000 },
  ]]);
});

test('registration success saves access token file named by email without logging token', () => {
  const { saveRegistrationAccessTokenFile } = requireRegisterModuleWithStubs();
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'registration-token-'));
  const logs = [];

  const result = saveRegistrationAccessTokenFile({
    email: 'user+tag@example.com',
    accessToken: 'secret-access-token',
    outputRootDir: dir,
    logger: { log: (message) => logs.push(String(message)) },
    now: () => '2026-06-24T00:00:00.000Z',
  });

  assert.equal(require('node:path').basename(result.path), 'user+tag@example.com.txt');
  assert.equal(require('node:fs').readFileSync(result.path, 'utf8'), 'secret-access-token');
  assert.equal(logs.some((line) => line.includes('secret-access-token')), false);
  assert.equal(logs.some((line) => line.includes(result.path)), true);
});

test('enableChatGptTotpMfa runs MFA protocol in page context and returns secret without logging it', async () => {
  const { enableChatGptTotpMfa } = requireRegisterModuleWithStubs();
  const calls = [];
  const logs = [];
  const page = {
    async evaluate(fn, args) {
      calls.push(args);
      assert.equal(typeof fn, 'function');
      return {
        ok: true,
        enabled: true,
        secret: 'WAITOC2YTXEEBUXP2266NLIGOLYSNYWE',
        secretMasked: 'WAIT...NYWE',
        factorId: 'factor_123',
      };
    },
  };

  const result = await enableChatGptTotpMfa(page, 'access-token', {
    logger: { log: (message) => logs.push(String(message)), warn: (message) => logs.push(String(message)) },
  });

  assert.equal(result.secret, 'WAITOC2YTXEEBUXP2266NLIGOLYSNYWE');
  assert.equal(result.enabled, true);
  assert.deepEqual(calls, [{ accessToken: 'access-token' }]);
  assert.equal(logs.some((line) => line.includes('WAITOC2YTXEEBUXP2266NLIGOLYSNYWE')), false);
  assert.equal(logs.some((line) => line.includes('secret=WAIT...NYWE')), true);
});

test('detectNextRegistrationStep treats email verification before password as password gate even with OTP input', async () => {
  const { detectNextRegistrationStep } = requireRegisterModuleWithStubs();
  const calls = [];
  const page = {
    url: () => 'https://auth.openai.com/email-verification',
    locator(selector) {
      return {
        first() {
          return {
            async isVisible() {
              calls.push(['isVisible', selector]);
              return selector === 'input[name="code"]';
            },
          };
        },
      };
    },
    async waitForTimeout() {},
  };

  const step = await detectNextRegistrationStep(page, {
    passwordSubmitted: false,
    timeout: 1,
  });

  assert.equal(step, 'email-verification-before-password');
  assert.equal(calls.some((call) => call[1] === 'input[name="code"]'), true);
});

test('detectNextRegistrationStep treats visible OTP before password as password gate even when URL is not email-verification', async () => {
  const { detectNextRegistrationStep } = requireRegisterModuleWithStubs();
  const page = {
    url: () => 'https://auth.openai.com/authorize',
    locator(selector) {
      return {
        first() {
          return {
            async isVisible() {
              return selector === 'input[name="code"]';
            },
          };
        },
      };
    },
    async waitForTimeout() {},
  };

  const step = await detectNextRegistrationStep(page, {
    passwordSubmitted: false,
    timeout: 1,
  });

  assert.equal(step, 'email-verification-before-password');
});

test('detectNextRegistrationStep treats OpenAI login password page as password gate', async () => {
  const { detectNextRegistrationStep } = requireRegisterModuleWithStubs();
  const page = {
    url: () => 'https://auth.openai.com/log-in/password',
    locator(selector) {
      return {
        first() {
          return {
            async isVisible() {
              return selector === 'input[type="password"]';
            },
            async evaluate(fn) {
              if (selector !== 'input[type="password"]') return false;
              return fn({ disabled: false, readOnly: false });
            },
          };
        },
      };
    },
    async waitForTimeout() {},
  };

  const step = await detectNextRegistrationStep(page, {
    passwordSubmitted: false,
    timeout: 1,
  });

  assert.equal(step, 'password');
});

test('classifyRegistrationPage reports stable registration page states with evidence', async () => {
  const { classifyRegistrationPage } = requireRegisterModuleWithStubs();
  const makePage = ({ url, text = '', visible = {} }) => ({
    url: () => url,
    title: async () => text.split('\n')[0] || '',
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            return text;
          },
        };
      }
      return {
        async count() {
          return visible[selector] ? 1 : 0;
        },
        first() {
          return {
            async waitFor() {
              if (!visible[selector]) throw new Error('not visible');
            },
            async isVisible() {
              return Boolean(visible[selector]);
            },
            async evaluate(fn) {
              const meta = visible[selector] || {};
              if (typeof fn !== 'function') return meta;
              return fn({
                disabled: false,
                readOnly: false,
                type: meta.type || 'text',
                name: meta.name || '',
                value: '',
                getAttribute(name) {
                  return meta[name] || '';
                },
                maxLength: meta.maxLength || -1,
              });
            },
          };
        },
      };
    },
    async waitForTimeout() {},
    async textContent() {
      return text;
    },
  });

  assert.equal((await classifyRegistrationPage(makePage({
    url: 'https://auth.openai.com/log-in/password',
    text: 'Enter your password Email address Password Continue',
    visible: { 'input[type="password"]': { type: 'password', name: 'password' } },
  }), { passwordSubmitted: false })).state, 'password-login');

  assert.equal((await classifyRegistrationPage(makePage({
    url: 'https://auth.openai.com/create-account/password',
    text: 'Create your password Password Continue',
    visible: { 'input[name="new-password"]': { type: 'password', name: 'new-password' } },
  }), { passwordSubmitted: false })).state, 'password-create');

  assert.equal((await classifyRegistrationPage(makePage({
    url: 'https://auth.openai.com/email-verification',
    text: 'Check your inbox Code Continue',
    visible: { 'input[name="code"]': { type: 'text', name: 'code', autocomplete: 'one-time-code' } },
  }), { passwordSubmitted: false })).state, 'email-verification-before-password');

  const otpState = await classifyRegistrationPage(makePage({
    url: 'https://auth.openai.com/email-verification',
    text: 'Check your inbox Code Continue',
    visible: { 'input[name="code"]': { type: 'text', name: 'code', autocomplete: 'one-time-code' } },
  }), { passwordSubmitted: true });
  assert.equal(otpState.state, 'otp');
  assert.equal(otpState.otpSelector, 'input[name="code"]');
  assert.match(otpState.evidence.bodySnippet, /Check your inbox/);
});

test('classifyRegistrationPage reports incorrect password as password-error', async () => {
  const { classifyRegistrationPage } = requireRegisterModuleWithStubs();
  const page = {
    url: () => 'https://auth.openai.com/log-in/password',
    title: async () => 'Enter your password - OpenAI',
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            return 'Enter your password Email address Password Incorrect email address or password Continue';
          },
        };
      }
      return {
        first() {
          return {
            async waitFor() {
              if (selector !== 'input[type="password"]') throw new Error('not visible');
            },
            async isVisible() {
              return selector === 'input[type="password"]';
            },
            async evaluate(fn) {
              if (selector !== 'input[type="password"]') return false;
              return fn({
                disabled: false,
                readOnly: false,
                type: 'password',
                name: 'password',
                getAttribute(name) {
                  return name === 'type' ? 'password' : '';
                },
                maxLength: -1,
              });
            },
          };
        },
      };
    },
    async waitForTimeout() {},
    async textContent() {
      return 'Enter your password Email address Password Incorrect email address or password Continue';
    },
  };

  const state = await classifyRegistrationPage(page, { passwordSubmitted: true, timeoutMs: 100 });
  assert.equal(state.state, 'password-error');
});

test('detectNextRegistrationStep only treats email verification as OTP after password was submitted', async () => {
  const { detectNextRegistrationStep } = requireRegisterModuleWithStubs();
  const page = {
    url: () => 'https://auth.openai.com/email-verification',
    locator(selector) {
      return {
        first() {
          return {
            async isVisible() {
              return selector === 'input[name="code"]';
            },
          };
        },
      };
    },
    async waitForTimeout() {},
  };

  const step = await detectNextRegistrationStep(page, {
    passwordSubmitted: true,
    timeout: 1,
  });

  assert.equal(step, 'otp');
});

test('findVisibleOtpSelector ignores readonly email text input and selects editable OTP text input', async () => {
  const { findVisibleOtpSelector } = requireRegisterModuleWithStubs();
  const page = {
    locator(selector) {
      const textInputs = [
        {
          visible: true,
          meta: {
            disabled: false,
            readOnly: true,
            type: 'text',
            name: '',
            id: 'email',
            placeholder: 'Email address',
            autocomplete: '',
            inputMode: '',
            ariaLabel: '',
            ariaDescription: 'Read only.',
            maxLength: -1,
          },
        },
        {
          visible: true,
          meta: {
            disabled: false,
            readOnly: false,
            type: 'text',
            name: 'code',
            id: 'code',
            placeholder: 'Code',
            autocomplete: '',
            inputMode: '',
            ariaLabel: '',
            ariaDescription: '',
            maxLength: 6,
          },
        },
      ];
      const items = selector === 'input[type="text"]' ? textInputs : [];
      const makeLocator = (index) => ({
        async isVisible() {
          return Boolean(items[index]?.visible);
        },
        async evaluate() {
          return items[index]?.meta || null;
        },
      });
      return {
        async count() {
          return items.length;
        },
        first() {
          return makeLocator(0);
        },
        nth(index) {
          return makeLocator(index);
        },
      };
    },
    async waitForTimeout() {},
    async textContent() {
      return '';
    },
  };

  const selector = await findVisibleOtpSelector(page, 1);
  assert.equal(selector, ':nth-match(input[type="text"], 2)');
});

test('about-you age input is not classified as an OTP input', async () => {
  const { classifyRegistrationPage, findVisibleOtpSelector } = requireRegisterModuleWithStubs();
  const page = makeAboutYouPageWithNumericAge();

  assert.equal(await findVisibleOtpSelector(page, 1), '');
  const state = await classifyRegistrationPage(page, { passwordSubmitted: true, timeoutMs: 100 });
  assert.equal(state.state, 'profile');
});

test('waitForOtpInputReady stops when the profile page is already reached', async () => {
  const { waitForOtpInputReady } = requireRegisterModuleWithStubs();
  const page = makeAboutYouPageWithNumericAge();

  await assert.rejects(
    () => waitForOtpInputReady(page, async () => false, async () => false, 1000),
    /OTP_ALREADY_COMPLETED/
  );
});

test('initial OTP wait treats an already reached profile page as completed', async () => {
  const { waitForOtpStageOrCompleted } = requireRegisterModuleWithStubs();
  const page = makeAboutYouPageWithNumericAge();

  const result = await waitForOtpStageOrCompleted(
    page,
    async () => false,
    async () => false,
    1000,
  );

  assert.equal(result, 'already-completed');
});

test('findVisiblePasswordSelector ignores password input that Playwright does not consider enabled', async () => {
  const { findVisiblePasswordSelector } = requireRegisterModuleWithStubs();
  const page = {
    locator(selector) {
      return {
        first() {
          return {
            async isVisible() {
              return selector === 'input[type="password"]';
            },
            async isEnabled() {
              return false;
            },
            async evaluate(fn) {
              return fn({
                disabled: false,
                readOnly: false,
              });
            },
          };
        },
      };
    },
    async waitForTimeout() {},
  };

  const selector = await findVisiblePasswordSelector(page, 1);
  assert.equal(selector, '');
});

test('waitForOtpInputReady refetches code when timeout recovery lands on password page', async () => {
  const { waitForOtpInputReady } = requireRegisterModuleWithStubs();
  let handledReason = '';
  const page = {
    url() {
      return 'https://auth.openai.com/create-account/password';
    },
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            return 'Create your password';
          },
        };
      }
      return {
        async count() {
          return selector === 'input[name="new-password"]' ? 1 : 0;
        },
        first() {
          return {
            async waitFor() {
              if (selector !== 'input[name="new-password"]') throw new Error('not visible');
            },
            async isVisible() {
              return selector === 'input[name="new-password"]';
            },
            async evaluate() {
              return { type: 'password', name: 'new-password' };
            },
          };
        },
      };
    },
    async waitForTimeout() {},
    async textContent() {
      return 'Create your password';
    },
  };

  await assert.rejects(
    () => waitForOtpInputReady(
      page,
      async () => false,
      async () => false,
      50,
      {
        handlePasswordPage: async (reason) => {
          handledReason = reason;
          return true;
        },
        refetchAfterPassword: true,
      },
    ),
    /OTP_REFETCH_AFTER_RECOVERY/,
  );
  assert.equal(handledReason, 'password-page-during-otp-wait');
});

test('waitForOtpInputReady ignores stale password page when OTP appears after navigation settles', async () => {
  const { waitForOtpInputReady } = requireRegisterModuleWithStubs();
  let stage = 'password-stale';
  let handled = false;
  const page = {
    url() {
      return stage === 'otp'
        ? 'https://auth.openai.com/email-verification'
        : 'https://auth.openai.com/create-account/password';
    },
    locator(selector) {
      return {
        async count() {
          if (stage === 'otp' && selector === 'input[name="code"]') return 1;
          if (selector === 'input[name="new-password"]') return 1;
          return 0;
        },
        first() {
          return {
            async isVisible() {
              if (selector === 'input[name="new-password"]') return stage === 'password-stale';
              if (selector === 'input[name="code"]') return stage === 'otp';
              return false;
            },
            async evaluate() {
              return selector === 'input[name="code"]'
                ? { type: 'text', name: 'code', autocomplete: 'one-time-code' }
                : { type: 'password', name: 'new-password' };
            },
          };
        },
        nth(index) {
          return this.first(index);
        },
      };
    },
    async waitForTimeout() {
      stage = 'otp';
    },
    async textContent() {
      return 'Check your inbox Code';
    },
  };

  const selector = await waitForOtpInputReady(
    page,
    async () => false,
    async () => false,
    500,
    {
      handlePasswordPage: async () => {
        handled = true;
        return true;
      },
      refetchAfterPassword: true,
    },
  );

  assert.equal(selector, 'input[name="code"]');
  assert.equal(handled, false);
});

test('submitRegistrationPassword treats OTP page after password transition as already submitted', async () => {
  const { submitRegistrationPassword } = requireRegisterModuleWithStubs();
  const originalRandom = Math.random;
  let stage = 'password';
  let clicked = false;
  const page = {
    url() {
      return stage === 'otp'
        ? 'https://auth.openai.com/email-verification'
        : 'https://auth.openai.com/create-account/password';
    },
    locator(selector) {
      return {
        async count() {
          return selector === 'input[name="code"]' ? 1 : 0;
        },
        first() {
          return {
            async isVisible() {
              if (selector === 'input[name="new-password"]') {
                stage = 'otp';
                return false;
              }
              if (selector === 'input[name="code"]') return stage === 'otp';
              return false;
            },
            async evaluate(fn) {
              if (selector === 'input[name="code"]') {
                return fn({
                  disabled: false,
                  readOnly: false,
                  type: 'text',
                  name: 'code',
                  value: '',
                  getAttribute(name) {
                    return name === 'autocomplete' ? 'one-time-code' : '';
                  },
                  maxLength: 6,
                });
              }
              return false;
            },
          };
        },
        nth(index) {
          return this.first(index);
        },
      };
    },
    async waitForTimeout() {},
    async textContent() {
      return 'Check your inbox Code Continue';
    },
  };

  try {
    Math.random = () => -1;
    const result = await submitRegistrationPassword(page, 'database-pass', {
      timeoutMs: 1,
      logger: { log() {}, warn() {} },
      humanFillInput: async () => {
        throw new Error('should not fill password after OTP is visible');
      },
      humanClick: async () => {
        clicked = true;
      },
    });
    assert.equal(result, true);
    assert.equal(clicked, false);
  } finally {
    Math.random = originalRandom;
  }
});

test('waitForOtpInputReady rejects immediately on incorrect password page', async () => {
  const { waitForOtpInputReady } = requireRegisterModuleWithStubs();
  let handled = false;
  const page = {
    url() {
      return 'https://auth.openai.com/log-in/password';
    },
    title: async () => 'Enter your password - OpenAI',
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            return 'Enter your password Incorrect email address or password';
          },
        };
      }
      return {
        async count() {
          return selector === 'input[type="password"]' ? 1 : 0;
        },
        first() {
          return {
            async waitFor() {
              if (selector !== 'input[type="password"]') throw new Error('not visible');
            },
            async isVisible() {
              return selector === 'input[type="password"]';
            },
            async evaluate(fn) {
              if (selector !== 'input[type="password"]') return false;
              return fn({
                disabled: false,
                readOnly: false,
                type: 'password',
                name: 'password',
                getAttribute(name) {
                  return name === 'type' ? 'password' : '';
                },
                maxLength: -1,
              });
            },
          };
        },
      };
    },
    async waitForTimeout() {},
    async textContent() {
      return 'Enter your password Incorrect email address or password';
    },
  };

  await assert.rejects(
    () => waitForOtpInputReady(
      page,
      async () => false,
      async () => false,
      500,
      {
        handlePasswordPage: async () => {
          handled = true;
          return true;
        },
      },
    ),
    /密码错误|password/i,
  );
  assert.equal(handled, false);
});

test('waitForOtpInputReady does not refill password page when password recovery is disabled', async () => {
  const { waitForOtpInputReady } = requireRegisterModuleWithStubs();
  let handled = false;
  const page = {
    url() {
      return 'https://auth.openai.com/log-in/password';
    },
    title: async () => 'Enter your password - OpenAI',
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            return 'Enter your password Password Continue';
          },
        };
      }
      return {
        async count() {
          return selector === 'input[type="password"]' ? 1 : 0;
        },
        first() {
          return {
            async waitFor() {
              if (selector !== 'input[type="password"]') throw new Error('not visible');
            },
            async isVisible() {
              return selector === 'input[type="password"]';
            },
            async evaluate(fn) {
              if (selector !== 'input[type="password"]') return false;
              return fn({
                disabled: false,
                readOnly: false,
                type: 'password',
                name: 'password',
                getAttribute(name) {
                  return name === 'type' ? 'password' : '';
                },
                maxLength: -1,
              });
            },
          };
        },
      };
    },
    async waitForTimeout() {},
    async waitForLoadState() {},
    async textContent() {
      return 'Enter your password Password Continue';
    },
  };

  await assert.rejects(
    () => waitForOtpInputReady(
      page,
      async () => false,
      async () => false,
      20,
      {
        recoverPasswordPage: false,
        handlePasswordPage: async () => {
          handled = true;
          return true;
        },
      },
    ),
    /未找到可见的验证码输入框/,
  );
  assert.equal(handled, false);
});

test('waitForOtpInputReady continues after timeout recovery refills password during initial OTP wait', async () => {
  const { waitForOtpInputReady } = requireRegisterModuleWithStubs();
  let stage = 'timeout';
  const handledReasons = [];
  const page = {
    url() {
      if (stage === 'otp') return 'https://auth.openai.com/email-verification';
      if (stage === 'password') return 'https://auth.openai.com/create-account/password';
      return 'https://auth.openai.com/error';
    },
    title: async () => '',
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            if (stage === 'timeout') return 'Operation timed out Try again';
            if (stage === 'password') return 'Create your password';
            return 'Check your inbox Code';
          },
        };
      }
      return {
        async count() {
          if (stage === 'password' && selector === 'input[name="new-password"]') return 1;
          if (stage === 'otp' && selector === 'input[name="code"]') return 1;
          return 0;
        },
        first() {
          return {
            async waitFor() {},
            async isVisible() {
              if (selector === 'input[name="new-password"]') return stage === 'password';
              if (selector === 'input[name="code"]') return stage === 'otp';
              return false;
            },
            async evaluate(fn) {
              if (selector === 'input[name="new-password"]') {
                return fn({
                  disabled: false,
                  readOnly: false,
                  type: 'password',
                  name: 'new-password',
                  getAttribute(name) {
                    if (name === 'type') return 'password';
                    if (name === 'name') return 'new-password';
                    return '';
                  },
                  maxLength: -1,
                });
              }
              if (selector === 'input[name="code"]') {
                return fn({
                  disabled: false,
                  readOnly: false,
                  type: 'text',
                  name: 'code',
                  getAttribute(name) {
                    if (name === 'type') return 'text';
                    if (name === 'name') return 'code';
                    if (name === 'autocomplete') return 'one-time-code';
                    return '';
                  },
                  maxLength: 6,
                });
              }
              return false;
            },
          };
        },
        nth() {
          return this.first();
        },
      };
    },
    async waitForTimeout() {},
    async waitForLoadState() {},
    async textContent() {
      if (stage === 'timeout') return 'Operation timed out Try again';
      if (stage === 'password') return 'Create your password';
      return 'Check your inbox Code';
    },
  };

  const selector = await waitForOtpInputReady(
    page,
    async () => {
      if (stage !== 'timeout') return false;
      stage = 'password';
      return true;
    },
    async () => false,
    500,
    {
      handlePasswordPage: async (reason) => {
        handledReasons.push(reason);
        stage = 'otp';
        return true;
      },
      refetchAfterPassword: false,
      recoverPasswordPage: false,
    },
  );

  assert.equal(selector, 'input[name="code"]');
  assert.deepEqual(handledReasons, ['timeout-recovery-returned-password-page']);
});

test('waitForOtpInputReady resets OTP wait window after timeout recovery submits password', async () => {
  const { waitForOtpInputReady } = requireRegisterModuleWithStubs();
  let stage = 'timeout';
  const page = {
    url() {
      if (stage === 'otp') return 'https://auth.openai.com/email-verification';
      if (stage === 'password') return 'https://auth.openai.com/create-account/password';
      return 'https://auth.openai.com/error';
    },
    title: async () => '',
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            if (stage === 'timeout') return 'Operation timed out Try again';
            if (stage === 'password') return 'Create your password';
            return 'Check your inbox Code';
          },
        };
      }
      return {
        async count() {
          if (stage === 'password' && selector === 'input[name="new-password"]') return 1;
          if (stage === 'otp' && selector === 'input[name="code"]') return 1;
          return 0;
        },
        first() {
          return {
            async isVisible() {
              if (selector === 'input[name="new-password"]') return stage === 'password';
              if (selector === 'input[name="code"]') return stage === 'otp';
              return false;
            },
            async evaluate(fn) {
              if (selector === 'input[name="new-password"]') {
                return fn({
                  disabled: false,
                  readOnly: false,
                  type: 'password',
                  name: 'new-password',
                  getAttribute(name) {
                    if (name === 'type') return 'password';
                    if (name === 'name') return 'new-password';
                    return '';
                  },
                  maxLength: -1,
                });
              }
              if (selector === 'input[name="code"]') {
                return fn({
                  disabled: false,
                  readOnly: false,
                  type: 'text',
                  name: 'code',
                  getAttribute(name) {
                    if (name === 'type') return 'text';
                    if (name === 'name') return 'code';
                    if (name === 'autocomplete') return 'one-time-code';
                    return '';
                  },
                  maxLength: 6,
                });
              }
              return false;
            },
          };
        },
        nth() {
          return this.first();
        },
      };
    },
    async waitForTimeout() {
      await new Promise((resolve) => setTimeout(resolve, 35));
      if (stage === 'password-submitted') stage = 'otp';
    },
    async waitForLoadState() {},
    async textContent() {
      if (stage === 'timeout') return 'Operation timed out Try again';
      if (stage === 'password') return 'Create your password';
      return 'Check your inbox Code';
    },
  };

  const selector = await waitForOtpInputReady(
    page,
    async () => {
      if (stage !== 'timeout') return false;
      stage = 'password';
      return true;
    },
    async () => false,
    40,
    {
      handlePasswordPage: async () => {
        stage = 'password-submitted';
        return true;
      },
      refetchAfterPassword: false,
      recoverPasswordPage: false,
    },
  );

  assert.equal(selector, 'input[name="code"]');
});

test('waitForOtpInputReady retries a stable password page even when immediate recovery is disabled', async () => {
  const { waitForOtpInputReady } = requireRegisterModuleWithStubs();
  let stage = 'password';
  const handledReasons = [];
  const page = {
    url() {
      return stage === 'otp'
        ? 'https://auth.openai.com/email-verification'
        : 'https://auth.openai.com/create-account/password';
    },
    title: async () => '',
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            return stage === 'otp' ? 'Check your inbox Code' : 'Create your password';
          },
        };
      }
      return {
        async count() {
          if (stage === 'password' && selector === 'input[name="new-password"]') return 1;
          if (stage === 'otp' && selector === 'input[name="code"]') return 1;
          return 0;
        },
        first() {
          return {
            async isVisible() {
              if (selector === 'input[name="new-password"]') return stage === 'password';
              if (selector === 'input[name="code"]') return stage === 'otp';
              return false;
            },
            async evaluate(fn) {
              if (selector === 'input[name="new-password"]') {
                return fn({
                  disabled: false,
                  readOnly: false,
                  type: 'password',
                  name: 'new-password',
                  getAttribute(name) {
                    if (name === 'type') return 'password';
                    if (name === 'name') return 'new-password';
                    return '';
                  },
                  maxLength: -1,
                });
              }
              if (selector === 'input[name="code"]') {
                return fn({
                  disabled: false,
                  readOnly: false,
                  type: 'text',
                  name: 'code',
                  getAttribute(name) {
                    if (name === 'type') return 'text';
                    if (name === 'name') return 'code';
                    if (name === 'autocomplete') return 'one-time-code';
                    return '';
                  },
                  maxLength: 6,
                });
              }
              return false;
            },
          };
        },
        nth() {
          return this.first();
        },
      };
    },
    async waitForTimeout() {
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
    async waitForLoadState() {},
    async textContent() {
      return stage === 'otp' ? 'Check your inbox Code' : 'Create your password';
    },
  };

  const selector = await waitForOtpInputReady(
    page,
    async () => false,
    async () => false,
    200,
    {
      recoverPasswordPage: false,
      delayedPasswordRecoveryMs: 1,
      refetchAfterPassword: false,
      handlePasswordPage: async (reason) => {
        handledReasons.push(reason);
        stage = 'otp';
        return true;
      },
    },
  );

  assert.equal(selector, 'input[name="code"]');
  assert.deepEqual(handledReasons, ['password-page-during-otp-wait']);
});

test('submitRegistrationPassword clears existing input before typing database password', async () => {
  const { submitRegistrationPassword } = requireRegisterModuleWithStubs();
  let value = 'old-value';
  const clicks = [];
  const page = {
    url() {
      return 'https://auth.openai.com/create-account/password';
    },
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            return 'Create your password';
          },
        };
      }
      if (selector === 'button[type="submit"]') {
        return {
          first() {
            return this;
          },
          async waitFor() {},
          async click() {
            clicks.push(['submit.click']);
          },
        };
      }
      return {
        async count() {
          return selector === 'input[name="new-password"]' ? 1 : 0;
        },
        first() {
          return {
            async waitFor() {
              if (selector !== 'input[name="new-password"]') throw new Error('not visible');
            },
            async click() {
              clicks.push(['input.click']);
            },
            async fill(nextValue) {
              value = nextValue;
            },
            async type(char) {
              value += char;
            },
            async isVisible() {
              return selector === 'input[name="new-password"]';
            },
            async evaluate(fn) {
              if (selector !== 'input[name="new-password"]') {
                return { type: 'text', name: '' };
              }
              return fn({ value, type: 'password', name: 'new-password' });
            },
          };
        },
      };
    },
    async waitForTimeout() {},
    async textContent() {
      return 'Create your password';
    },
    async waitForSelector(selector) {
      assert.equal(selector, 'button[type="submit"]');
      return {
        async hover() {},
        async click() {
          clicks.push(['submit.click']);
        },
      };
    },
  };

  await submitRegistrationPassword(page, 'DbPass12!', {
    logger: { log() {} },
    timeoutMs: 100,
  });

  assert.equal(value, 'DbPass12!');
  assert.deepEqual(clicks, [['input.click'], ['submit.click']]);
});

test('submitRegistrationPassword treats a detached submit button as completed when page entered OTP', async () => {
  const { submitRegistrationPassword } = requireRegisterModuleWithStubs();
  const originalRandom = Math.random;
  let stage = 'password';
  let typedValue = '';
  let locatorClickCount = 0;

  const makeLocator = (selector) => {
    const isPassword = selector === 'input[name="new-password"]';
    const isOtp = selector.includes('one-time-code')
      || selector.includes('inputmode="numeric"')
      || selector === 'input[name="code"]'
      || selector === 'input[type="tel"]'
      || selector === 'input[type="text"]';
    const locator = {
      async count() {
        return (isPassword && stage === 'password') || (isOtp && stage === 'otp') ? 1 : 0;
      },
      first() {
        return locator;
      },
      async waitFor() {
        if (!await locator.isVisible()) throw new Error('not visible');
      },
      async isVisible() {
        if (isPassword) return stage === 'password';
        if (isOtp) return stage === 'otp';
        return false;
      },
      async isEnabled() {
        return true;
      },
      async evaluate(fn) {
        if (isPassword) {
          return fn({
            disabled: false,
            readOnly: false,
            type: 'password',
            name: 'new-password',
            value: typedValue,
            getAttribute(name) {
              return name === 'type' ? 'password' : '';
            },
          });
        }
        if (isOtp && stage === 'otp') {
          return fn({
            disabled: false,
            readOnly: false,
            type: 'text',
            name: 'code',
            maxLength: 6,
            getAttribute(name) {
              return name === 'autocomplete' ? 'one-time-code' : '';
            },
          });
        }
        return false;
      },
      async click() {},
      async fill(value) {
        typedValue = String(value);
      },
      async type(char) {
        typedValue += char;
      },
    };
    return locator;
  };

  const submitLocator = {
    first() {
      return submitLocator;
    },
    async waitFor() {},
    async hover() {},
    async click() {
      locatorClickCount += 1;
      stage = 'otp';
      throw new Error('elementHandle.click: Element is not attached to the DOM');
    },
  };

  const page = {
    url() {
      return stage === 'otp'
        ? 'https://auth.openai.com/email-verification'
        : 'https://auth.openai.com/create-account/password';
    },
    async title() {
      return stage === 'otp' ? 'Check your inbox - OpenAI' : 'Create password - OpenAI';
    },
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            return stage === 'otp' ? 'Check your inbox Code Continue' : 'Create your password';
          },
        };
      }
      if (selector === 'button[type="submit"]') return submitLocator;
      return makeLocator(selector);
    },
    async textContent() {
      return stage === 'otp' ? 'Check your inbox Code Continue' : 'Create your password';
    },
    async waitForSelector() {
      return {
        async hover() {},
        async click() {
          stage = 'otp';
          throw new Error('elementHandle.click: Element is not attached to the DOM');
        },
      };
    },
    async waitForTimeout() {},
  };

  try {
    Math.random = () => -1;
    const result = await submitRegistrationPassword(page, 'DbPass12!', {
      logger: { log() {}, warn() {} },
      timeoutMs: 100,
    });
    assert.equal(result, true);
    assert.equal(locatorClickCount, 1);
  } finally {
    Math.random = originalRandom;
  }
});

test('submitRegistrationPassword fills OpenAI login password input before OTP polling', async () => {
  const { submitRegistrationPassword } = requireRegisterModuleWithStubs();
  let value = '';
  const page = {
    url() {
      return 'https://auth.openai.com/log-in/password';
    },
    locator(selector) {
      if (selector === 'body') {
        return {
          async textContent() {
            return 'Enter your password';
          },
        };
      }
      if (selector === 'button[type="submit"]') {
        return {
          first() {
            return this;
          },
          async waitFor() {},
          async click() {},
        };
      }
      return {
        first() {
          return {
            async waitFor() {
              if (selector !== 'input[type="password"]') throw new Error('not visible');
            },
            async click() {},
            async fill(nextValue) {
              value = nextValue;
            },
            async type(char) {
              value += char;
            },
            async isVisible() {
              return selector === 'input[type="password"]';
            },
            async evaluate(fn) {
              if (selector !== 'input[type="password"]') return false;
              return fn({ value, type: 'password', disabled: false, readOnly: false });
            },
          };
        },
      };
    },
    async waitForTimeout() {},
    async textContent() {
      return 'Enter your password';
    },
    async waitForSelector(selector) {
      assert.equal(selector, 'button[type="submit"]');
      return {
        async hover() {},
        async click() {},
      };
    },
  };

  await submitRegistrationPassword(page, 'DbPass12!', {
    logger: { log() {} },
    timeoutMs: 100,
  });

  assert.equal(value, 'DbPass12!');
});

test('submitOtpWithRetry waits for OTP input before fetching email code', async () => {
  const { submitOtpWithRetry } = requireRegisterModuleWithStubs();
  const sequence = [];
  const page = {
    locator() {
      return {
        first() {
          return {
            async isVisible() {
              return false;
            },
          };
        },
      };
    },
    async waitForTimeout() {},
  };

  await assert.rejects(
    () => submitOtpWithRetry(page, 'user@example.com', 1, {
      fetchCode: async () => {
        sequence.push('fetch-code');
        return '123456';
      },
      waitForOtpInput: async () => {
        sequence.push('wait-otp');
        throw new Error('WAIT_OTP_SENTINEL');
      },
    }),
    /WAIT_OTP_SENTINEL/,
  );

  assert.deepEqual(sequence, ['wait-otp']);
});

test('submitOtpWithRetry does not treat a still-visible OTP page as success before checking for incorrect code', async () => {
  const { submitOtpWithRetry } = requireRegisterModuleWithStubs();
  let currentUrl = 'https://auth.openai.com/email-verification';
  let currentInput = '';
  let submittedCode = '';
  let submitCount = 0;
  let waitTicksAfterSubmit = 0;
  let incorrectVisible = false;
  const fetched = [];

  const makeLocator = (selector) => ({
    first() {
      return this;
    },
    nth() {
      return this;
    },
    async count() {
      return selector === 'input[name="code"]' ? 1 : 0;
    },
    async waitFor() {
      if (selector === 'input[name="code"]' && currentUrl.includes('/email-verification')) return;
      if (selector === 'body') return;
      if (/button/.test(selector)) return;
      throw new Error(`not visible: ${selector}`);
    },
    async isVisible() {
      if (selector === 'input[name="code"]') return currentUrl.includes('/email-verification');
      if (selector === 'input[type="email"]') return false;
      if (selector === 'body') return true;
      if (/button\[type="submit"\]\[name="intent"\]\[value="resend"\]/.test(selector)) return false;
      if (/button/.test(selector)) return true;
      return false;
    },
    async isDisabled() {
      return false;
    },
    async click() {},
    async fill(value) {
      currentInput = String(value || '');
    },
    async type(char) {
      currentInput += char;
    },
    async hover() {},
    async scrollIntoViewIfNeeded() {},
    async evaluate(fn) {
      if (selector === 'input[name="code"]') {
        return fn({
          value: currentInput,
          disabled: false,
          readOnly: false,
          type: 'text',
          maxLength: 6,
          getAttribute(name) {
            if (name === 'name') return 'code';
            if (name === 'autocomplete') return 'one-time-code';
            if (name === 'type') return 'text';
            return '';
          },
        });
      }
      if (/button/.test(selector)) {
        return fn({
          disabled: false,
          textContent: 'Continue',
          getAttribute(name) {
            if (name === 'name') return 'intent';
            if (name === 'value') return '';
            return '';
          },
        });
      }
      return fn({ value: '', getAttribute() { return ''; } });
    },
    async textContent() {
      return incorrectVisible ? 'Check your inbox Incorrect code Continue' : 'Check your inbox Code Continue';
    },
  });

  const continueButton = {
    first() {
      return this;
    },
    async waitFor() {},
    async isVisible() {
      return true;
    },
    async isDisabled() {
      return false;
    },
    async scrollIntoViewIfNeeded() {},
    async hover() {},
    async click() {
      submitCount += 1;
      submittedCode = currentInput;
      waitTicksAfterSubmit = 0;
      incorrectVisible = false;
      if (submittedCode === '222222') {
        currentUrl = 'https://auth.openai.com/about-you';
      }
    },
    async evaluate(fn) {
      return fn({
        disabled: false,
        textContent: 'Continue',
        getAttribute(name) {
          if (name === 'name') return 'intent';
          if (name === 'value') return '';
          return '';
        },
      });
    },
  };

  const page = {
    url() {
      return currentUrl;
    },
    locator(selector) {
      return makeLocator(selector);
    },
    getByRole() {
      return continueButton;
    },
    async waitForTimeout() {
      if (submittedCode === '111111' && currentUrl.includes('/email-verification')) {
        waitTicksAfterSubmit += 1;
        if (waitTicksAfterSubmit >= 2) incorrectVisible = true;
      }
    },
    async waitForFunction(fn, oldUrl) {
      if (currentUrl !== oldUrl) return true;
      return new Promise(() => {});
    },
    async waitForSelector(selector) {
      if (selector === '#prompt-textarea') return new Promise(() => {});
      return makeLocator(selector);
    },
    async focus() {},
    async type(_selector, char) {
      currentInput += char;
    },
    async evaluate(fn) {
      return fn();
    },
    async waitForLoadState() {},
    async textContent() {
      return incorrectVisible ? 'Check your inbox Incorrect code Continue' : 'Check your inbox Code Continue';
    },
  };

  const result = await submitOtpWithRetry(page, 'user@example.com', 2, {
    fetchCode: async (excludeCode) => {
      fetched.push(excludeCode);
      return fetched.length === 1 ? '111111' : '222222';
    },
    waitForOtpInput: async () => 'input[name="code"]',
  });

  assert.equal(result, '222222');
  assert.equal(submitCount, 2);
  assert.deepEqual(fetched, ['', '111111']);
});

test('resolveRegistrationPassword requires database password from env', () => {
  const { resolveRegistrationPassword } = requireRegisterModuleWithStubs();

  assert.equal(resolveRegistrationPassword({ ROXY_REGISTER_PASSWORD: ' AccountPass12! ' }), 'AccountPass12!');
  assert.equal(resolveRegistrationPassword({ ROXY_OAUTH_PASSWORD: ' FallbackPass12! ' }), 'FallbackPass12!');
  assert.throws(() => resolveRegistrationPassword({}), /ROXY_REGISTER_PASSWORD/);
});

test('prepareChatGptEmailEntry accepts already-open email modal without requiring login/signup buttons', async () => {
  const { prepareChatGptEmailEntry } = requireRegisterModuleWithStubs();
  const clicks = [];
  const page = {
    url: () => 'https://chatgpt.com/',
    locator(selector) {
      return {
        first() {
          return {
            async waitFor(options = {}) {
              assert.equal(selector, 'input[type="email"], input[name="email"]');
              assert.equal(options.state, 'visible');
            },
            async isVisible() {
              return true;
            },
          };
        },
      };
    },
    getByRole(_role, options) {
      return {
        first() {
          return {
            async waitFor() {
              clicks.push(['unexpected-wait', options?.name]);
              throw new Error('entry buttons should not be queried when email input is already visible');
            },
            async click() {
              clicks.push(['unexpected-click', options?.name]);
            },
          };
        },
      };
    },
  };

  const result = await prepareChatGptEmailEntry(page, { timeoutMs: 100 });

  assert.deepEqual(result, { status: 'email-input-ready', source: 'existing-email-input' });
  assert.deepEqual(clicks, []);
});
