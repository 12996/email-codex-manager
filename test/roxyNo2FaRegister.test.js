import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  assertNo2FaState,
  completeBrowserRegistration,
  createBrowserFlowDependencies,
  createReplacementAccountGateway,
  openPreparedRoxyBrowser,
  fillUsableInput,
  waitForOtpOutcome,
  submitNo2FaOtp,
  runCli,
  parseCliArgs,
  parsePreparedProfileOutput,
  persistTokenThenMarkRegistered,
  runNo2FaRegistrationFlow,
  readSessionAccessToken,
  waitForNo2FaState,
} = require('../src/auto/roxy_no_2fa_register.js');

test('no2fa state guard rejects a password stage instead of continuing with a password flow', () => {
  assert.throws(
    () => assertNo2FaState({ state: 'password-create' }, ['otp']),
    (error) => error?.code === 'NO2FA_PASSWORD_STAGE',
  );
  assert.equal(assertNo2FaState({ state: 'otp' }, ['otp']), true);
});

test('prepared Roxy output exposes only the prepared profile id', () => {
  const prepared = parsePreparedProfileOutput([
    'preparer diagnostic that is not forwarded',
    JSON.stringify({
      ok: true,
      dirId: 'profile-1',
      ws: 'ws://sensitive-cdp-endpoint',
      proxyPassword: 'sensitive-password',
    }),
  ].join('\n'));

  assert.deepEqual(prepared, { dirId: 'profile-1' });
  assert.doesNotMatch(JSON.stringify(prepared), /ws:|password/i);
});

test('prepared Roxy parser accepts the pretty-printed JSON emitted by the manual refresh script', () => {
  const prepared = parsePreparedProfileOutput([
    'manual refresh diagnostics',
    JSON.stringify({ ok: true, dirId: 'profile-2', ws: 'ws://sensitive-cdp-endpoint' }, null, 2),
  ].join('\n'));

  assert.deepEqual(prepared, { dirId: 'profile-2' });
});

test('access token is saved before the replacement account is marked registered', async () => {
  const calls = [];
  const result = await persistTokenThenMarkRegistered({
    email: 'new.user@example.test',
    accessToken: 'access-token',
    saveAccessToken: async ({ email, accessToken }) => {
      calls.push(`save:${email}:${accessToken}`);
      return { path: 'F:/tokens/new.user@example.test.txt' };
    },
    markRegistered: async () => {
      calls.push('mark');
    },
  });

  assert.deepEqual(calls, [
    'save:new.user@example.test:access-token',
    'mark',
  ]);
  assert.deepEqual(result, { registrationTokenFile: 'F:/tokens/new.user@example.test.txt' });
});

test('browser registration flow strips the access token from its public result', async () => {
  const calls = [];
  const result = await runNo2FaRegistrationFlow({
    email: 'new.user@example.test',
    name: 'Jane Doe',
    birthday: '2000-01-01',
    env: {},
    deps: {
      prepareReplacementAccount: async () => {
        calls.push('account');
        return { id: 7, email: 'new.user@example.test', emailCodeApiUrl: '' };
      },
      openPreparedRoxyBrowser: async () => {
        calls.push('roxy');
        return {
          page: {},
          async close() {
            calls.push('close');
          },
        };
      },
      completeBrowserRegistration: async ({ email, name, birthday }) => {
        calls.push(`browser:${email}:${name}:${birthday}`);
        return 'access-token';
      },
      saveAccessToken: async () => {
        calls.push('save');
        return { path: 'F:/tokens/new.user@example.test.txt' };
      },
      markReplacementAccountRegistered: async ({ account }) => {
        calls.push(`mark:${account.id}`);
      },
    },
  });

  assert.deepEqual(calls, [
    'account',
    'roxy',
    'browser:new.user@example.test:Jane Doe:2000-01-01',
    'save',
    'mark:7',
    'close',
  ]);
  assert.deepEqual(result, {
    email: 'new.user@example.test',
    registrationTokenFile: 'F:/tokens/new.user@example.test.txt',
  });
  assert.equal(Object.hasOwn(result, 'accessToken'), false);
});

test('CLI parser takes only email, name, and birthday for the no2fa browser flow', () => {
  assert.deepEqual(
    parseCliArgs([
      '--email', 'new.user@example.test',
      '--name', 'Jane Doe',
      '--birthday', '2000-01-01',
    ], {}),
    {
      email: 'new.user@example.test',
      name: 'Jane Doe',
      birthday: '2000-01-01',
    },
  );
});

test('no2fa state wait does not treat email-verification URL alone as an OTP success', async () => {
  let classifications = 0;
  const state = await waitForNo2FaState({}, ['otp'], {
    timeoutMs: 100,
    intervalMs: 0,
    classifyPage: async () => {
      classifications += 1;
      if (classifications === 1) {
        return {
          state: 'unknown',
          evidence: { url: 'https://auth.openai.com/email-verification' },
        };
      }
      return { state: 'otp', evidence: { url: 'https://auth.openai.com/email-verification' } };
    },
    wait: async () => {},
  });

  assert.equal(state.state, 'otp');
  assert.equal(classifications, 2);
});

test('session access token reader retries an empty session instead of treating ChatGPT URL as success', async () => {
  let requests = 0;
  const page = {
    url() {
      return 'https://chatgpt.com/';
    },
    async evaluate() {
      requests += 1;
      return requests === 1
        ? { status: 200, body: '{}' }
        : { status: 200, body: '{"accessToken":"access-token"}' };
    },
    async waitForTimeout() {},
  };

  const accessToken = await readSessionAccessToken(page, { attempts: 2, intervalMs: 0 });
  assert.equal(accessToken, 'access-token');
  assert.equal(requests, 2);
});

test('session access token reader retries a transient browser fetch failure', async () => {
  let requests = 0;
  const page = {
    url() {
      return 'https://chatgpt.com/';
    },
    async evaluate() {
      requests += 1;
      if (requests === 1) throw new Error('net::ERR_CONNECTION_RESET');
      return { status: 200, body: '{"accessToken":"access-token"}' };
    },
    async waitForTimeout() {},
  };

  const accessToken = await readSessionAccessToken(page, { attempts: 2, intervalMs: 0 });
  assert.equal(accessToken, 'access-token');
  assert.equal(requests, 2);
});

test('Roxy browser connection uses the ready connection entrypoint without returning its CDP endpoint', async () => {
  const calls = [];
  const session = await openPreparedRoxyBrowser({
    env: {},
    deps: {
      async buildLiveDependencies() {
        calls.push('build');
        return {
          client: {
            async connectReadyPlaywright() {
              calls.push('ready-connect');
              return {
                browser: {
                  async disconnect() {
                    calls.push('disconnect');
                  },
                },
                context: {},
                page: { id: 'page-1' },
                cdpEndpoint: 'ws://sensitive-cdp-endpoint',
              };
            },
          },
          close() {
            calls.push('db-close');
          },
        };
      },
      async prepareRoxyNo2FA({ client }) {
        calls.push(`prepare:${Boolean(client)}`);
        return { dirId: 'profile-1' };
      },
    },
  });

  assert.deepEqual(session.page, { id: 'page-1' });
  assert.doesNotMatch(JSON.stringify(session), /ws:|sensitive-cdp-endpoint/i);
  await session.close();
  assert.deepEqual(calls, [
    'build',
    'prepare:true',
    'ready-connect',
    'disconnect',
    'db-close',
  ]);
});

test('configured manual Roxy preparer supplies the only profile used for the CDP connection', async () => {
  const calls = [];
  const session = await openPreparedRoxyBrowser({
    env: { ROXY_NO_2FA_PREPARER: 'test/manual-roxy-proxy-refresh.cjs' },
    deps: {
      async runConfiguredRoxyPreparer() {
        calls.push('manual-prepare');
        return { dirId: 'fresh-profile' };
      },
      async buildLiveDependencies(env) {
        calls.push(`build:${env.ROXY_NO_2FA_BROWSER_DIR_ID}`);
        return {
          client: {
            async connectReadyPlaywright() {
              calls.push('ready-connect');
              return {
                browser: { async disconnect() { calls.push('disconnect'); } },
                page: { id: 'page-1' },
                cdpEndpoint: 'ws://sensitive-cdp-endpoint',
              };
            },
          },
          close() { calls.push('db-close'); },
        };
      },
    },
  });

  assert.deepEqual(session.page, { id: 'page-1' });
  await session.close();
  assert.deepEqual(calls, [
    'manual-prepare',
    'build:fresh-profile',
    'ready-connect',
    'disconnect',
    'db-close',
  ]);
});

test('replacement account gateway patches registered only for the selected unregistered email', async () => {
  const calls = [];
  const gateway = createReplacementAccountGateway({
    env: {
      REPLACEMENT_API_BASE: 'http://replacement.local',
      ADMIN_PASSWORD: 'admin-password',
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/login')) {
        return new Response('', {
          status: 302,
          headers: { 'set-cookie': 'admin_auth=signed-cookie; Path=/; HttpOnly' },
        });
      }
      if (url.includes('/replacement-accounts?')) {
        return new Response(JSON.stringify({
          accounts: [{ id: 7, email: 'new.user@example.test', status: 'unregistered', email_code_api: 'https://mail.example.test/code' }],
        }), { status: 200 });
      }
      if (url.endsWith('/replacement-accounts/7/status')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  const account = await gateway.prepareReplacementAccount({ email: 'new.user@example.test' });
  await gateway.markReplacementAccountRegistered({ account });

  assert.deepEqual(account, {
    id: 7,
    email: 'new.user@example.test',
    emailCodeApiUrl: 'https://mail.example.test/code',
  });
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/login$/);
  assert.match(calls[1].url, /status=unregistered/);
  assert.equal(calls[2].options.method, 'PATCH');
  assert.equal(calls[2].options.headers.cookie, 'admin_auth=signed-cookie');
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    status: 'registered',
    status_note: '浏览器无2FA注册成功',
  });
  assert.equal(String(calls[2].options.body).includes('access-token'), false);
});

test('browser flow uses OTP and profile stages before requesting the session token', async () => {
  const calls = [];
  const page = {
    async goto(url) {
      calls.push(`goto:${url}`);
    },
  };
  const states = [
    { state: 'otp' },
    { state: 'profile' },
    { state: 'chatgpt-session' },
  ];

  const accessToken = await completeBrowserRegistration({
    page,
    email: 'new.user@example.test',
    name: 'Jane Doe',
    birthday: '2000-01-01',
    env: { OPENAI_REGISTRATION_ENTRY_URL: 'https://chatgpt.example.test/' },
    deps: {
      async prepareChatGptEmailEntry() {
        calls.push('entry');
      },
      async fillEmailInput({ email }) {
        calls.push(`email:${email}`);
      },
      async submitPrimaryAction({ stage }) {
        calls.push(`submit:${stage}`);
      },
      async waitForNo2FaState(_, allowedStates) {
        const state = states.shift();
        calls.push(`wait:${allowedStates.join(',')}:${state.state}`);
        return state;
      },
      async submitNo2FaOtp({ email }) {
        calls.push(`otp:${email}`);
      },
      async fillProfileFields({ name, birthday }) {
        calls.push(`profile:${name}:${birthday}`);
        return true;
      },
      async readSessionAccessToken() {
        calls.push('session');
        return 'access-token';
      },
    },
  });

  assert.equal(accessToken, 'access-token');
  assert.deepEqual(calls, [
    'goto:https://chatgpt.example.test/',
    'entry',
    'email:new.user@example.test',
    'submit:email',
    'wait:otp:otp',
    'otp:new.user@example.test',
    'wait:profile,chatgpt-session:profile',
    'profile:Jane Doe:2000-01-01',
    'submit:profile',
    'wait:chatgpt-session:chatgpt-session',
    'session',
  ]);
});

test('default browser helpers pass the requested profile data and require an operable submit button', async () => {
  const calls = [];
  const helpers = createBrowserFlowDependencies({
    legacy: {
      async fillProfileFieldsIfPresent(page, options) {
        calls.push({ type: 'profile', page, options });
        return true;
      },
      async clickContinueButtonReliably(page, options) {
        calls.push({ type: 'continue', page, options });
        return { ok: false };
      },
    },
  });
  const page = { url: () => 'https://auth.openai.com/about-you' };

  assert.equal(await helpers.fillProfileFields({ page, name: 'Jane Doe', birthday: '2000-01-01' }), true);
  await helpers.submitPrimaryAction({ page, stage: 'profile' });

  assert.deepEqual(calls, [
    {
      type: 'profile',
      page,
      options: {
        label: '无2FA资料页',
        waitMs: 15000,
        name: 'Jane Doe',
        birthday: '2000-01-01',
      },
    },
    {
      type: 'continue',
      page,
      options: {
        startUrl: 'https://auth.openai.com/about-you',
        maxAttempts: 3,
        confirmTimeoutMs: 20000,
        requireEnabled: true,
      },
    },
  ]);
});

test('browser flow refuses to type into a disabled input', async () => {
  const disabledInput = {
    first() { return this; },
    async waitFor() {},
    async isVisible() { return true; },
    async isEnabled() { return false; },
  };
  const page = {
    locator() {
      return disabledInput;
    },
  };

  await assert.rejects(
    fillUsableInput(page, 'input[type="email"]', 'new.user@example.test', 'email'),
    (error) => error?.code === 'NO2FA_INPUT_UNUSABLE',
  );
});

test('OTP outcome waits for a profile or session stage instead of accepting the still-visible OTP page', async () => {
  let classifications = 0;
  const outcome = await waitForOtpOutcome({}, {
    timeoutMs: 100,
    intervalMs: 0,
    readBody: async () => '',
    classifyPage: async () => {
      classifications += 1;
      return classifications === 1 ? { state: 'otp' } : { state: 'profile' };
    },
    wait: async () => {},
  });

  assert.equal(outcome.status, 'success');
  assert.equal(outcome.state.state, 'profile');
  assert.equal(classifications, 2);
});

test('OTP submission waits for a verified post-submit state and does not invoke a password helper', async () => {
  const calls = [];
  let value = '';
  const input = {
    first() { return this; },
    async waitFor() {},
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async evaluate() { return true; },
    async click() { calls.push('input-click'); },
    async fill(next) { value = next; calls.push(`fill:${next}`); },
    async inputValue() { return value; },
  };
  const page = { locator: () => input };
  await submitNo2FaOtp({
    page,
    email: 'new.user@example.test',
    name: 'Jane Doe',
    birthday: '2000-01-01',
    env: {},
    legacy: {
      async findVisibleOtpSelector() {
        calls.push('find-otp');
        return 'input[autocomplete="one-time-code"]';
      },
      async fetchRegistrationEmailVerificationCode(_, __, ___, excludedCode) {
        calls.push(`fetch:${excludedCode}`);
        return '123456';
      },
      async fillProfileFieldsIfPresent() {
        calls.push('profile');
        return false;
      },
      async clickContinueButtonReliably() {
        calls.push('continue');
      },
    },
    waitForOutcome: async () => {
      calls.push('outcome');
      return { status: 'success' };
    },
  });

  assert.deepEqual(calls, [
    'find-otp',
    'fetch:',
    'input-click',
    'fill:123456',
    'profile',
    'continue',
    'outcome',
  ]);
});

test('CLI reports only the email and token file, never the access token', async () => {
  const output = [];
  const proc = {
    argv: ['node', 'roxy_no_2fa_register.js', '--email', 'new.user@example.test'],
    env: {},
    stdout: { write: (line) => output.push(line) },
    stderr: { write: (line) => output.push(`stderr:${line}`) },
    exitCode: 0,
  };

  const exitCode = await runCli(proc, {
    loadEnv: () => {},
    generateProfileName: () => 'Jane Doe',
    runNo2FaRegistrationFlow: async () => ({
      email: 'new.user@example.test',
      registrationTokenFile: 'F:/tokens/new.user@example.test.txt',
      accessToken: 'must-not-be-printed',
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(proc.exitCode, 0);
  assert.equal(output.length, 1);
  assert.match(output[0], /new\.user@example\.test/);
  assert.match(output[0], /new\.user@example\.test\.txt/);
  assert.doesNotMatch(output[0], /must-not-be-printed/);
});
