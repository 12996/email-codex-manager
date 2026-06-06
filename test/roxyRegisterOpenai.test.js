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
