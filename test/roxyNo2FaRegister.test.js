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
  generateProfileBirthday,
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
const { deriveAgeFromBirthday } = require('../src/auto/roxy_register_openai.js');

test('no2fa state guard rejects a password stage instead of continuing with a password flow', () => {
  assert.throws(
    () => assertNo2FaState({ state: 'password-create' }, ['otp']),
    (error) => error?.code === 'NO2FA_PASSWORD_STAGE',
  );
  assert.equal(assertNo2FaState({ state: 'otp' }, ['otp']), true);
});

test('no2fa state guard rejects a ChatGPT auth error before AT extraction', () => {
  assert.throws(
    () => assertNo2FaState({ state: 'auth-error' }, ['chatgpt-session']),
    (error) => error?.code === 'NO2FA_AUTH_ERROR',
  );
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

test('CLI generates both profile name and birthday when no profile arguments are supplied', async () => {
  const output = [];
  let receivedProfile = null;
  const proc = {
    argv: ['node', 'roxy_no_2fa_register.js', '--email', 'new.user@example.test'],
    env: {},
    stdout: { write: (line) => output.push(line) },
    stderr: { write: (line) => output.push(`stderr:${line}`) },
    exitCode: 0,
  };

  const exitCode = await runCli(proc, {
    loadEnv: () => {},
    generateProfileName: () => 'Random Name',
    generateProfileBirthday: () => '1994-06-15',
    runNo2FaRegistrationFlow: async (profile) => {
      receivedProfile = profile;
      return {
        email: profile.email,
        registrationTokenFile: 'F:/tokens/new.user@example.test.txt',
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    { name: receivedProfile.name, birthday: receivedProfile.birthday },
    { name: 'Random Name', birthday: '1994-06-15' },
  );
});

test('generated no2fa profile birthday maps to a valid random adult age', () => {
  const now = new Date('2026-08-03T12:00:00.000Z');
  const birthday = generateProfileBirthday({ random: () => 0.5, now });
  const age = Number(deriveAgeFromBirthday(birthday, now));

  assert.match(birthday, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(age >= 20 && age <= 44);
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

test('session access token reader leaves the same-context session tab open after reading the token', async () => {
  const navigations = [];
  let sessionTabClosed = 0;
  let sessionTabOpened = 0;
  let mainPageEvaluateCalls = 0;
  let requests = 0;
  const sessionPage = {
    async goto(url, options) {
      navigations.push({ url, options });
      requests += 1;
      const body = requests === 1 ? '{}' : '{"accessToken":"access-token"}';
      return {
        status() { return 200; },
        async text() { return body; },
      };
    },
    async waitForTimeout() {},
    async close() { sessionTabClosed += 1; },
  };
  const context = {
    async newPage() {
      sessionTabOpened += 1;
      return sessionPage;
    },
  };
  const page = {
    context() { return context; },
    async goto() {
      throw new Error('the registration main page must not navigate to session');
    },
    async evaluate() {
      mainPageEvaluateCalls += 1;
      throw new Error('the registration main page must not fetch session');
    },
  };

  const accessToken = await readSessionAccessToken(page, { attempts: 2, intervalMs: 0 });
  assert.equal(accessToken, 'access-token');
  assert.equal(requests, 2);
  assert.equal(sessionTabOpened, 1);
  assert.equal(sessionTabClosed, 0);
  assert.equal(mainPageEvaluateCalls, 0);
  assert.deepEqual(navigations.map(({ url }) => url), [
    'https://chatgpt.com/api/auth/session',
    'https://chatgpt.com/api/auth/session',
  ]);
  assert.equal(navigations[0].options.waitUntil, 'domcontentloaded');
});

test('session access token reader retries a transient session navigation failure', async () => {
  let requests = 0;
  let sessionTabClosed = 0;
  const sessionPage = {
    async goto(url) {
      assert.equal(url, 'https://chatgpt.com/api/auth/session');
      requests += 1;
      if (requests === 1) throw new Error('net::ERR_CONNECTION_RESET');
      return {
        status() { return 200; },
        async text() { return '{"accessToken":"access-token"}'; },
      };
    },
    async waitForTimeout() {},
    async close() { sessionTabClosed += 1; },
  };
  const context = {
    async newPage() { return sessionPage; },
  };
  const page = {
    context() { return context; },
    async goto() {
      throw new Error('the registration main page must not navigate to session');
    },
  };

  const accessToken = await readSessionAccessToken(page, { attempts: 2, intervalMs: 0 });
  assert.equal(accessToken, 'access-token');
  assert.equal(requests, 2);
  assert.equal(sessionTabClosed, 0);
});

test('session access token reader refuses to navigate the main page when a same-context tab is unavailable', async () => {
  let mainPageNavigated = false;
  const page = {
    context() { return null; },
    async goto() { mainPageNavigated = true; },
  };

  await assert.rejects(
    readSessionAccessToken(page, { attempts: 1, intervalMs: 0 }),
    (error) => error?.code === 'NO2FA_SESSION_TAB_UNAVAILABLE',
  );
  assert.equal(mainPageNavigated, false);
});

test('session access token reader closes a newly opened unusable session tab', async () => {
  let sessionTabClosed = 0;
  const page = {
    context() {
      return {
        async newPage() {
          return { async close() { sessionTabClosed += 1; } };
        },
      };
    },
  };

  await assert.rejects(
    readSessionAccessToken(page, { attempts: 1, intervalMs: 0 }),
    (error) => error?.code === 'NO2FA_SESSION_TAB_UNAVAILABLE',
  );
  assert.equal(sessionTabClosed, 1);
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
  const profileResponse = {
    url() { return 'https://auth.openai.com/api/accounts/create_account'; },
    status() { return 200; },
    request() {
      return {
        method() { return 'POST'; },
        postData() { return 'name=Jane%20Doe&birthdate=2000-01-01'; },
      };
    },
    async text() {
      return JSON.stringify({ page: { type: 'external_url' } });
    },
  };
  const page = {
    async goto(url) {
      calls.push(`goto:${url}`);
    },
    async waitForResponse(predicate) {
      calls.push('wait-create-account');
      assert.equal(predicate(profileResponse), true);
      return profileResponse;
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
    'wait-create-account',
    'submit:profile',
    'wait:chatgpt-session:chatgpt-session',
    'session',
  ]);
});

test('browser flow retries profile field discovery once after a delayed about-you render', async () => {
  let profileFillAttempts = 0;
  const response = {
    url() { return 'https://auth.openai.com/api/accounts/create_account'; },
    status() { return 200; },
    request() {
      return {
        method() { return 'POST'; },
        postData() { return 'name=Jane%20Doe&birthdate=1994-06-15'; },
      };
    },
    async text() { return JSON.stringify({ page: { type: 'external_url' } }); },
  };
  const page = {
    async goto() {},
    async waitForResponse(predicate) {
      assert.equal(predicate(response), true);
      return response;
    },
  };
  const states = [
    { state: 'otp' },
    { state: 'profile' },
    { state: 'profile' },
    { state: 'chatgpt-session' },
  ];

  const accessToken = await completeBrowserRegistration({
    page,
    email: 'new.user@example.test',
    name: 'Jane Doe',
    birthday: '1994-06-15',
    env: {},
    deps: {
      async prepareChatGptEmailEntry() {},
      async fillEmailInput() {},
      async submitPrimaryAction() {},
      async waitForNo2FaState() { return states.shift(); },
      async submitNo2FaOtp() {},
      async fillProfileFields() {
        profileFillAttempts += 1;
        return profileFillAttempts === 2;
      },
      async readSessionAccessToken() { return 'access-token'; },
    },
  });

  assert.equal(accessToken, 'access-token');
  assert.equal(profileFillAttempts, 2);
});

test('browser flow assigns a stable stage code to an untyped profile-fill failure', async () => {
  const page = { async goto() {} };
  const states = [{ state: 'otp' }, { state: 'profile' }];

  await assert.rejects(
    completeBrowserRegistration({
      page,
      email: 'new.user@example.test',
      name: 'Jane Doe',
      birthday: '1994-06-15',
      env: {},
      logger: { error() {} },
      deps: {
        async prepareChatGptEmailEntry() {},
        async fillEmailInput() {},
        async submitPrimaryAction() {},
        async waitForNo2FaState() { return states.shift(); },
        async submitNo2FaOtp() {},
        async fillProfileFields() { throw new Error('detached profile input'); },
        async readSessionAccessToken() { return 'access-token'; },
      },
    }),
    (error) => error?.code === 'NO2FA_PROFILE_FILL_FAILED' && error?.no2faStage === 'profile-fill',
  );
});

test('browser flow rejects an about-you submission without a birthdate payload', async () => {
  const response = {
    url() { return 'https://auth.openai.com/api/accounts/create_account'; },
    status() { return 200; },
    request() {
      return {
        method() { return 'POST'; },
        postData() { return 'name=Jane%20Doe'; },
      };
    },
    async text() {
      return JSON.stringify({ page: { type: 'external_url' } });
    },
  };
  const page = {
    async goto() {},
    async waitForResponse(predicate) {
      assert.equal(predicate(response), true);
      return response;
    },
  };
  const states = [
    { state: 'otp' },
    { state: 'profile' },
  ];

  await assert.rejects(
    completeBrowserRegistration({
      page,
      email: 'new.user@example.test',
      name: 'Jane Doe',
      birthday: '2000-01-01',
      env: {},
      logger: { error() {} },
      deps: {
        async prepareChatGptEmailEntry() {},
        async fillEmailInput() {},
        async submitPrimaryAction() {},
        async waitForNo2FaState() {
          return states.shift();
        },
        async submitNo2FaOtp() {},
        async fillProfileFields() { return true; },
        async readSessionAccessToken() { return 'access-token'; },
      },
    }),
    (error) => error?.code === 'NO2FA_PROFILE_PAYLOAD_INVALID',
  );
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

test('OTP retry resends the email before accepting a replacement code', async () => {
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
  const resend = {
    first() { return this; },
    async isVisible() { return true; },
    async isEnabled() { return true; },
    async evaluate() { return true; },
    async click() { calls.push('resend-click'); },
  };
  const page = {
    locator(selector) {
      return selector.includes('value="resend"') ? resend : input;
    },
    async waitForTimeout() { calls.push('resend-wait'); },
  };
  let outcomes = 0;

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
      async fetchRegistrationEmailVerificationCode(_, __, options, excludedCode) {
        calls.push(`fetch:${excludedCode}`);
        if (excludedCode) {
          await options.onNoNewCodeFor30Seconds();
          return '222222';
        }
        return '111111';
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
      outcomes += 1;
      calls.push('outcome');
      return outcomes === 1 ? { status: 'incorrect' } : { status: 'success' };
    },
  });

  assert.deepEqual(calls, [
    'find-otp',
    'fetch:',
    'input-click',
    'fill:111111',
    'profile',
    'continue',
    'outcome',
    'find-otp',
    'fetch:111111',
    'resend-click',
    'resend-wait',
    'input-click',
    'fill:222222',
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

test('CLI reports a safe failed stage without printing the raw browser error', async () => {
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
    generateProfileBirthday: () => '1994-06-15',
    runNo2FaRegistrationFlow: async () => {
      const error = new Error('raw browser error must stay private');
      error.code = 'NO2FA_PROFILE_FILL_FAILED';
      error.no2faStage = 'profile-fill';
      throw error;
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(proc.exitCode, 1);
  assert.equal(output.length, 1);
  assert.match(output[0], /code=NO2FA_PROFILE_FILL_FAILED stage=profile-fill/);
  assert.doesNotMatch(output[0], /raw browser error/);
});
