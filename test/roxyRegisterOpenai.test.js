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

  assert.equal(require('node:path').basename(result.path), 'user+tag@example.com.json');
  assert.deepEqual(JSON.parse(require('node:fs').readFileSync(result.path, 'utf8')), {
    email: 'user+tag@example.com',
    access_token: 'secret-access-token',
    created_at: '2026-06-24T00:00:00.000Z',
    source: 'chatgpt_api_auth_session',
  });
  assert.equal(logs.some((line) => line.includes('secret-access-token')), false);
  assert.equal(logs.some((line) => line.includes(result.path)), true);
});
