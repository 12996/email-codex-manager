import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createReplacementServices } from '../src/replacementServices.js';

function okResponse(body) {
  return {
    ok: true,
    status: 200,
    async text() {
      return body;
    },
  };
}

function errorResponse(status, body = '') {
  return {
    ok: false,
    status,
    async text() {
      return body;
    },
  };
}

test('fetchSmsCode extracts code from top-level JSON code field', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('{"code":"123456"}'),
  });

  assert.equal(await services.fetchSmsCode('https://example.invalid/sms'), '123456');
});

test('fetchSmsCode extracts code from nested JSON data.code field', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('{"data":{"code":"234567"}}'),
  });

  assert.equal(await services.fetchSmsCode('https://example.invalid/sms'), '234567');
});

test('fetchSmsCode extracts first six digit code from text', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('Your code is 345678.'),
  });

  assert.equal(await services.fetchSmsCode('https://example.invalid/sms'), '345678');
});

test('fetchSmsCode rejects responses without a verification code', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('no code here'),
  });

  await assert.rejects(
    () => services.fetchSmsCode('https://example.invalid/sms'),
    /SMS_FETCH_FAILED/,
  );
});

test('fetchJson returns raw JSON string and rejects non-2xx', async () => {
  const services = createReplacementServices({
    fetchImpl: async (url) => {
      if (url.includes('fail')) return errorResponse(500);
      return okResponse('{"ok":true}');
    },
  });

  assert.equal(await services.fetchJson('https://example.invalid/account.json'), '{"ok":true}');
  await assert.rejects(
    () => services.fetchJson('https://example.invalid/fail.json'),
    /JSON_FETCH_FAILED/,
  );
});

test('replaceAccount uses injected automation when provided', async () => {
  const configured = createReplacementServices({
    replacementAutomation: {
      async replaceAccount(account) {
        return { ok: true, email: account.email };
      },
    },
  });

  assert.deepEqual(await configured.replaceAccount({ email: 'user@example.com' }), {
    ok: true,
    email: 'user@example.com',
  });
});

test('replaceAccount runs roxy oauth script in a child process with account env', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    scriptPath: 'src/auto/roxy_oauth_login.js',
    baseEnv: {
      EXISTING_ENV: '1',
      ROXY_OAUTH_EMAIL: 'old@example.com',
      ROXY_OAUTH_PHONE: '+10000000000',
      PHONE_VERIFICATION_SMS_API_URL: 'https://old.example/sms',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit('data', 'ok');
        child.emit('close', 0);
      });
      return child;
    },
  });

  const result = await services.replaceAccount({
    email: ' user@example.com ',
    phone: ' +13523282595 ',
    sms_api: ' https://example.invalid/sms ',
  });

  assert.deepEqual(result, {
    ok: true,
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'node-bin');
  assert.deepEqual(calls[0].args, ['src/auto/roxy_oauth_login.js']);
  assert.equal(calls[0].options.env.EXISTING_ENV, '1');
  assert.equal(calls[0].options.env.ROXY_OAUTH_EMAIL, 'user@example.com');
  assert.equal(calls[0].options.env.ROXY_OAUTH_PHONE, '+13523282595');
  assert.equal(calls[0].options.env.PHONE_VERIFICATION_SMS_API_URL, 'https://example.invalid/sms');
});

test('registerAccount injects per-account external email code API URL', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    registerScriptPath: 'src/auto/roxy_register_openai.js',
    baseEnv: {
      REGISTRATION_EMAIL_CODE_API_URL: 'https://old.example/code',
      VERIFICATION_CODE_API_URL: 'http://127.0.0.1:3100/api/verification-code/latest',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.registerAccount({
    id: 12,
    email: ' user@example.com ',
    email_code_api: ' https://example.invalid/latest-code ',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['src/auto/roxy_register_openai.js']);
  assert.equal(calls[0].options.env.ROXY_REGISTER_EMAIL, 'user@example.com');
  assert.equal(calls[0].options.env.REGISTRATION_EMAIL_CODE_API_URL, 'https://example.invalid/latest-code');
});

test('protocol registration defaults to the self-contained source under src/auto', async () => {
  const calls = [];
  const services = createReplacementServices({
    prepareProtocolRoxyImpl: async () => ({ cdpEndpoint: 'ws://fresh' }),
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.registerProtocolAccount({ id: 41, email: 'protocol-path@example.com' });

  const expectedRoot = join(process.cwd(), 'src', 'auto', 'protocol_registration');
  assert.equal(calls[0].options.cwd, expectedRoot);
  assert.equal(calls[0].args[0], join(expectedRoot, 'main.py'));
});

test('registerProtocolAccount refreshes the selected Roxy profile before spawning tilian protocol', async () => {
  const calls = [];
  let preparedEnv;
  const protocolRoot = join(process.cwd(), 'src', 'auto', 'protocol_registration');
  const services = createReplacementServices({
    protocolPythonPath: 'F:/anaconda/anaconda3/envs/tilian/python.exe',
    protocolProjectPath: protocolRoot,
    protocolMainPath: join(protocolRoot, 'main.py'),
    baseEnv: {
      ROXY_API_BASE_URL: 'http://127.0.0.1:50000',
      ROXY_API_TOKEN: 'token',
      ROXY_CDP_ENDPOINT: 'ws://old-profile',
      ROXY_BROWSER_SORT_NUM: '8',
      ROXY_REGISTER_BROWSER_SORT_NUM: '8',
    },
    prepareProtocolRoxyImpl: async ({ env }) => {
      preparedEnv = { ...env };
      return { cdpEndpoint: 'ws://refreshed-profile' };
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.pid = 5173;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.registerProtocolAccount({
    id: 42,
    email: ' user@example.com ',
    email_code_api: 'https://example.invalid/code',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'F:/anaconda/anaconda3/envs/tilian/python.exe');
  assert.deepEqual(calls[0].args, [
    join(protocolRoot, 'main.py'),
    '--count', '1',
    '--workers', '1',
  ]);
  assert.equal(calls[0].options.cwd, protocolRoot);
  assert.equal(preparedEnv.ROXY_BROWSER_SORT_NUM, '3');
  assert.equal(preparedEnv.ROXY_BROWSER_WINDOW_NAME, 'test');
  assert.equal(calls[0].options.env.OTP_PROVIDER, 'replacement');
  assert.equal(calls[0].options.env.EMAIL_SOURCE, 'replacement');
  assert.equal(calls[0].options.env.REPLACEMENT_ACCOUNT_ID, '42');
  assert.equal(calls[0].options.env.ROXY_CDP_ENABLED, '1');
  assert.equal(calls[0].options.env.ROXY_IP_CHECK_ENABLED, '1');
  assert.equal(calls[0].options.env.ROXY_CDP_ORIGIN_ISOLATION, '1');
  assert.equal(calls[0].options.env.ROXY_CDP_ENDPOINT, 'ws://refreshed-profile');
  assert.equal(calls[0].options.env.ROXY_CDP_PREPARE, '0');
  assert.equal(calls[0].options.env.REGISTRATION_RESULT_JSON, '1');
  assert.equal(calls[0].options.env.REGISTRATION_EMAIL_CODE_API_URL, 'https://example.invalid/code');
  assert.equal(
    calls[0].options.env.REGISTRATION_TOKEN_OUTPUT_DIR,
    join(process.cwd(), 'src', 'auto', 'product_files', 'registration'),
  );
});

test('registerProtocolAccount holds a bound Roxy proxy lease through child completion and passes only the fresh CDP endpoint', async () => {
  const events = [];
  const calls = [];
  const services = createReplacementServices({
    protocolPythonPath: 'python.exe',
    protocolProjectPath: 'protocol-project',
    protocolMainPath: 'protocol-project/main.py',
    baseEnv: { ROXY_REGISTER_PROXY_PASSWORD: 'must-not-reach-child' },
    roxyProxyService: {
      async prepareBoundBrowser({ env, openArgs }) {
        events.push(['prepare-bound', env.ROXY_BROWSER_DIR_ID, openArgs]);
        return {
          cdpEndpoint: 'ws://bound-fresh-profile',
          release() { events.push('release'); },
        };
      },
    },
    spawnImpl(command, args, options) {
      events.push('spawn');
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        events.push('close');
        child.emit('close', 0);
      });
      return child;
    },
  });

  await services.registerProtocolAccount({ id: 142, email: 'bound@example.com' });

  assert.deepEqual(events, [
    ['prepare-bound', undefined, []],
    'spawn',
    'close',
    'release',
  ]);
  assert.equal(calls[0].options.env.ROXY_CDP_ENDPOINT, 'ws://bound-fresh-profile');
  assert.equal(Object.hasOwn(calls[0].options.env, 'ROXY_REGISTER_PROXY_PASSWORD'), false);
  assert.equal(Object.hasOwn(calls[0].options.env, 'proxyPassword'), false);
  assert.equal(JSON.stringify(calls[0].options.env).includes('proxy-password'), false);
});

test('registerProtocolAccount releases a bound Roxy proxy lease when child launch fails', async () => {
  const events = [];
  const services = createReplacementServices({
    protocolPythonPath: 'python.exe',
    protocolProjectPath: 'protocol-project',
    protocolMainPath: 'protocol-project/main.py',
    roxyProxyService: {
      async prepareBoundBrowser() {
        return {
          cdpEndpoint: 'ws://bound-fresh-profile',
          release() { events.push('release'); },
        };
      },
    },
    spawnImpl() {
      events.push('spawn');
      throw new Error('spawn unavailable');
    },
  });

  await assert.rejects(
    () => services.registerProtocolAccount({ id: 143, email: 'bound-failure@example.com' }),
    /spawn unavailable/,
  );
  assert.deepEqual(events, ['spawn', 'release']);
});

test('registerProtocolAccount passes its current local service port to the protocol child', async () => {
  const calls = [];
  const services = createReplacementServices({
    protocolPythonPath: 'python.exe',
    protocolProjectPath: 'protocol-project',
    protocolMainPath: 'protocol-project/main.py',
    baseEnv: { PORT: '13400' },
    prepareProtocolRoxyImpl: async () => ({ cdpEndpoint: 'ws://fresh' }),
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.registerProtocolAccount({ id: 45, email: 'port-sync@example.com' });

  assert.equal(calls[0].options.env.REPLACEMENT_API_BASE, 'http://127.0.0.1:13400');
});

test('registerProtocolAccount forces origin isolation for the password-before-OTP flow', async () => {
  const calls = [];
  const services = createReplacementServices({
    protocolPythonPath: 'python.exe',
    protocolProjectPath: 'protocol-project',
    protocolMainPath: 'protocol-project/main.py',
    baseEnv: { ROXY_CDP_ORIGIN_ISOLATION: '0' },
    prepareProtocolRoxyImpl: async () => ({ cdpEndpoint: 'ws://fresh' }),
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.registerProtocolAccount({ id: 44, email: 'protocol-isolation@example.com' });

  assert.equal(calls[0].options.env.ROXY_CDP_ORIGIN_ISOLATION, '1');
});

test('registerProtocolAccount passes the replacement password to the protocol child without exposing it in logs', async () => {
  const calls = [];
  const events = [];
  const services = createReplacementServices({
    protocolPythonPath: 'python.exe',
    protocolProjectPath: 'protocol-project',
    protocolMainPath: 'protocol-project/main.py',
    logDir: mkdtempSync(join(tmpdir(), 'gmail-imap-protocol-password-logs-')),
    baseEnv: { ROXY_OAUTH_PASSWORD: 'stale-global-password' },
    prepareProtocolRoxyImpl: async () => ({ cdpEndpoint: 'ws://fresh' }),
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.registerProtocolAccount(
    { id: 43, email: 'protocol-password@example.com', password: 'AccountPass12!' },
    { onLog: (event) => events.push(event) },
  );

  assert.equal(calls[0].options.env.ROXY_REGISTER_PASSWORD, 'AccountPass12!');
  assert.equal(Object.hasOwn(calls[0].options.env, 'ROXY_OAUTH_PASSWORD'), false);
  const liveText = events.map((event) => event.text || event.message || '').join('');
  assert.doesNotMatch(liveText, /AccountPass12!/);
});

test('registerProtocolAccount keeps MFA result parseable but redacts it from live and persisted logs', async () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const events = [];
  const logDir = mkdtempSync(join(tmpdir(), 'gmail-imap-protocol-logs-'));
  let logPath;
  const services = createReplacementServices({
    protocolPythonPath: 'python.exe',
    protocolProjectPath: 'protocol-project',
    protocolMainPath: 'protocol-project/main.py',
    logDir,
    automationRuns: {
      createRun(input) {
        logPath = input.log_path;
        return { id: 99, ...input };
      },
      markSucceeded() {},
    },
    prepareProtocolRoxyImpl: async () => ({ cdpEndpoint: 'ws://fresh' }),
    spawnImpl(command, args, options) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        const output = `ROXY_REGISTER_RESULT_JSON=${JSON.stringify({
            registrationMfa: { secret, enabled: true },
          })}\n`;
        const splitAt = output.indexOf(secret) + Math.floor(secret.length / 2);
        child.stdout.emit('data', output.slice(0, splitAt));
        child.stdout.emit('data', output.slice(splitAt));
        child.emit('close', 0);
      });
      return child;
    },
  });

  const result = await services.registerProtocolAccount(
    { id: 21, email: 'protocol-mfa@example.com' },
    { onLog: (event) => events.push(event) },
  );

  assert.equal(result.childResult.registrationMfa.secret, secret);
  assert.match(result.stdout, new RegExp(secret));
  const liveText = events
    .filter((event) => event.type === 'log')
    .map((event) => event.text)
    .join('');
  assert.doesNotMatch(liveText, new RegExp(secret));
  assert.match(liveText, /\[redacted-secret\]/);
  assert.doesNotMatch(readFileSync(logPath, 'utf8'), new RegExp(secret));
  assert.match(readFileSync(logPath, 'utf8'), /\[redacted-secret\]/);
});

test('registerProtocolAccount performs the Roxy refresh sequence before the protocol child', async () => {
  const steps = [];
  let openArgs;
  const services = createReplacementServices({
    baseEnv: { ROXY_KEEP_OPEN: '0' },
    protocolPythonPath: 'python.exe',
    protocolProjectPath: 'protocol-project',
    protocolMainPath: 'protocol-project/main.py',
    roxyClientFactory: async () => ({
      dirId: 'dir-3',
      async resolveDirId() { steps.push('resolve'); },
      async closeBrowser() { steps.push('close'); },
      async clearLocalCache() { steps.push('clear-local'); },
      async clearServerCache() { steps.push('clear-server'); },
      async randomFingerprint() { steps.push('random-fingerprint'); },
      async openBrowser(args) {
        steps.push('open');
        openArgs = args;
      },
      async getConnectionInfo() {
        steps.push('connection-info');
        return { ws: 'ws://fresh' };
      },
    }),
    spawnImpl(command, args) {
      steps.push('spawn');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.registerProtocolAccount({ id: 7, email: 'protocol@example.com' });

  assert.deepEqual(steps, [
    'resolve',
    'close',
    'clear-local',
    'clear-server',
    'random-fingerprint',
    'open',
    'connection-info',
    'spawn',
  ]);
  assert.deepEqual(openArgs, ['--headless=new']);
});

test('registerProtocolAccount forwards current preparation and child output to the live log callback', async () => {
  const events = [];
  const services = createReplacementServices({
    protocolPythonPath: 'python.exe',
    protocolProjectPath: 'protocol-project',
    protocolMainPath: 'protocol-project/main.py',
    prepareProtocolRoxyImpl: async () => ({ cdpEndpoint: 'ws://fresh' }),
    spawnImpl(command, args, options) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit('data', 'stdout line\n');
        child.stderr.emit('data', 'stderr line\n');
        child.emit('close', 0);
      });
      return child;
    },
  });

  await services.registerProtocolAccount(
    { id: 8, email: 'live-log@example.com' },
    { onLog: (event) => events.push(event) },
  );

  assert.equal(events.some((event) => event.type === 'step'), true);
  assert.deepEqual(
    events.filter((event) => event.type === 'log').map(({ stream, text }) => ({ stream, text })),
    [
      { stream: 'stdout', text: 'stdout line\n' },
      { stream: 'stderr', text: 'stderr line\n' },
    ],
  );
});

test('registerAccount injects replacement account password for OpenAI registration', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    registerScriptPath: 'src/auto/roxy_register_openai.js',
    baseEnv: {
      ROXY_REGISTER_PASSWORD: 'old-password',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.registerAccount({
    id: 12,
    email: ' user@example.com ',
    password: ' AccountPass12! ',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.env.ROXY_REGISTER_PASSWORD, 'AccountPass12!');
});

test('registerAccount injects per-account external email code API for iCloud account when configured', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    registerScriptPath: 'src/auto/roxy_register_openai.js',
    baseEnv: {
      REGISTRATION_EMAIL_CODE_API_URL: 'https://old.example/code',
      VERIFICATION_CODE_API_URL: 'http://127.0.0.1:3100/api/verification-code/latest',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.registerAccount({
    id: 12,
    email: ' target-user@icloud.com ',
    email_code_api: ' https://fucheng.dpdns.org/newApi/mevM17al ',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.env.ROXY_REGISTER_EMAIL, 'target-user@icloud.com');
  assert.equal(calls[0].options.env.REGISTRATION_EMAIL_CODE_API_URL, 'https://fucheng.dpdns.org/newApi/mevM17al');
});

test('replaceAccount injects per-account external email code API URL for oauth', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    scriptPath: 'src/auto/roxy_oauth_login.js',
    baseEnv: {
      VERIFICATION_CODE_API_URL: 'http://127.0.0.1:3100/api/verification-code/latest',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.replaceAccount({
    id: 18,
    email: ' user@example.com ',
    email_code_api: ' https://example.invalid/latest-code ',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['src/auto/roxy_oauth_login.js']);
  assert.equal(calls[0].options.env.ROXY_OAUTH_EMAIL, 'user@example.com');
  assert.equal(calls[0].options.env.VERIFICATION_CODE_API_URL, 'https://example.invalid/latest-code');
});

test('replaceAccount injects per-account external email code API for iCloud account when configured', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    scriptPath: 'src/auto/roxy_oauth_login.js',
    baseEnv: {
      VERIFICATION_CODE_API_URL: 'http://127.0.0.1:3100/api/verification-code/latest',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.replaceAccount({
    id: 18,
    email: ' target-user@icloud.com ',
    email_code_api: ' https://fucheng.dpdns.org/newApi/mevM17al ',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.env.ROXY_OAUTH_EMAIL, 'target-user@icloud.com');
  assert.equal(calls[0].options.env.VERIFICATION_CODE_API_URL, 'https://fucheng.dpdns.org/newApi/mevM17al');
});

test('replaceAccountWith2FA runs roxy 2fa auth script with password and codex 2fa env', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    twoFaScriptPath: 'src/auto/roxy_2fa_auth_login.js',
    baseEnv: {
      ROXY_OAUTH_PASSWORD: 'old-password',
      ROXY_OAUTH_TOTP_SECRET: 'OLDSECRET',
      ROXY_OAUTH_2FA_CODE: '111111',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.replaceAccountWith2FA({
    id: 19,
    email: ' user@example.com ',
    phone: ' +13523282595 ',
    sms_api: ' https://example.invalid/sms ',
    email_code_api: ' https://example.invalid/latest-code ',
    password: ' account-password ',
    codex_2fa: ' JBSWY3DPEHPK3PXP ',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['src/auto/roxy_2fa_auth_login.js']);
  assert.equal(calls[0].options.env.ROXY_OAUTH_EMAIL, 'user@example.com');
  assert.equal(calls[0].options.env.ROXY_OAUTH_PHONE, '+13523282595');
  assert.equal(calls[0].options.env.PHONE_VERIFICATION_SMS_API_URL, 'https://example.invalid/sms');
  assert.equal(calls[0].options.env.VERIFICATION_CODE_API_URL, 'https://example.invalid/latest-code');
  assert.equal(calls[0].options.env.ROXY_OAUTH_PASSWORD, 'account-password');
  assert.equal(calls[0].options.env.ROXY_OAUTH_TOTP_SECRET, 'JBSWY3DPEHPK3PXP');
  assert.equal(Object.hasOwn(calls[0].options.env, 'ROXY_OAUTH_2FA_CODE'), false);
});

test('replaceAccountWith2FAProtocol launches the protocol child with independent SMS transport settings', async () => {
  const calls = [];
  const services = createReplacementServices({
    protocolTwoFaPythonPath: 'python-protocol.exe',
    protocolTwoFaProjectPath: 'protocol-project',
    protocolTwoFaMainPath: 'protocol-project/replacement_2fa.py',
    baseEnv: {
      ROXY_CDP_ENDPOINT: 'ws://existing-profile',
      SMS_API_PROXY: 'http://127.0.0.1:7890',
    },
    prepareProtocolRoxyImpl: async () => ({ cdpEndpoint: 'ws://refreshed-profile' }),
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.pid = 9123;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.replaceAccountWith2FAProtocol({ id: 111, email: 'user@example.com' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'python-protocol.exe');
  assert.deepEqual(calls[0].args, ['protocol-project/replacement_2fa.py', '--account-id', '111']);
  assert.equal(calls[0].options.cwd, 'protocol-project');
  assert.equal(calls[0].options.env.ROXY_CDP_ENABLED, '1');
  assert.equal(calls[0].options.env.ROXY_CDP_PREPARE, '0');
  assert.equal(calls[0].options.env.ROXY_KEEP_OPEN, '1');
  assert.equal(calls[0].options.env.ROXY_CDP_ENDPOINT, 'ws://refreshed-profile');
  assert.equal(calls[0].options.env.SMS_API_PROXY, 'http://127.0.0.1:7890');
});

test('replaceAccountWith2FAProtocol defaults to the shared protocol Roxy target when no CDP endpoint is provided', async () => {
  const calls = [];
  const services = createReplacementServices({
    protocolTwoFaPythonPath: 'python-protocol.exe',
    protocolTwoFaProjectPath: 'protocol-project',
    protocolTwoFaMainPath: 'protocol-project/replacement_2fa.py',
    baseEnv: {},
    prepareProtocolRoxyImpl: async () => ({ cdpEndpoint: 'ws://refreshed-profile' }),
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.replaceAccountWith2FAProtocol({ id: 112, email: 'user@example.com' });

  assert.equal(calls[0].options.env.ROXY_BROWSER_SORT_NUM, '3');
  assert.equal(calls[0].options.env.ROXY_BROWSER_WINDOW_NAME, 'test');
  assert.equal(calls[0].options.env.ROXY_CDP_ENDPOINT, 'ws://refreshed-profile');
});

test('replaceAccountWith2FAProtocol defaults to the independent CPA replacement entrypoint', async () => {
  const calls = [];
  const services = createReplacementServices({
    baseEnv: {
      ROXY_CDP_ENDPOINT: 'ws://existing-profile',
      SMS_API_PROXY: 'http://127.0.0.1:7890',
    },
    prepareProtocolRoxyImpl: async () => ({ cdpEndpoint: 'ws://refreshed-profile' }),
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.replaceAccountWith2FAProtocol({ id: 113, email: 'user@example.com' });

  const expectedScript = join(process.cwd(), 'src', 'auto', 'protocol_cpa_replacement.py');
  assert.equal(calls[0].args[0], expectedScript);
  assert.equal(calls[0].args[1], '--account-id');
  assert.equal(calls[0].args[2], '113');
  assert.equal(calls[0].options.cwd, join(process.cwd(), 'src', 'auto'));
  assert.equal(calls[0].options.env.REPLACEMENT_ACCOUNT_ID, '113');
  assert.equal(calls[0].options.env.ROXY_CDP_ENDPOINT, 'ws://refreshed-profile');
  assert.equal(calls[0].options.env.SMS_API_PROXY, 'http://127.0.0.1:7890');
  assert.equal(
    calls[0].options.env.CPA_OUTPUT_DIR,
    join(process.cwd(), 'src', 'auto', 'product_files', 'cpa'),
  );
});

test('replaceAccountWith2FAProtocol refreshes the shared Roxy profile before spawning the child', async () => {
  const steps = [];
  const calls = [];
  const services = createReplacementServices({
    protocolTwoFaPythonPath: 'python-protocol.exe',
    protocolTwoFaProjectPath: 'protocol-project',
    protocolTwoFaMainPath: 'protocol-project/replacement_2fa.py',
    baseEnv: {
      ROXY_PROTOCOL_BROWSER_DIR_ID: 'dir-3',
      ROXY_PROTOCOL_BROWSER_SORT_NUM: '3',
      ROXY_PROTOCOL_BROWSER_WINDOW_NAME: 'test',
    },
    prepareProtocolRoxyImpl: async ({ env }) => {
      steps.push([
        'prepare',
        env.ROXY_BROWSER_DIR_ID,
        env.ROXY_BROWSER_SORT_NUM,
        env.ROXY_BROWSER_WINDOW_NAME,
      ]);
      return { cdpEndpoint: 'ws://fresh-profile' };
    },
    spawnImpl(command, args, options) {
      steps.push('spawn');
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.replaceAccountWith2FAProtocol({ id: 114, email: 'user@example.com' });

  assert.deepEqual(steps, [['prepare', 'dir-3', '3', 'test'], 'spawn']);
  assert.equal(calls[0].options.env.ROXY_CDP_ENDPOINT, 'ws://fresh-profile');
  assert.equal(calls[0].options.env.ROXY_CDP_PREPARE, '0');
});

test('replaceAccountWith2FA can switch to the protocol child without changing the DOM state machine', async () => {
  const calls = [];
  const services = createReplacementServices({
    baseEnv: { REPLACEMENT_2FA_PROTOCOL_ENABLED: '1' },
    replacementAutomation: {
      async replaceAccountWith2FA() {
        calls.push('dom');
      },
      async replaceAccountWith2FAProtocol() {
        calls.push('protocol');
      },
    },
  });

  await services.replaceAccountWith2FA({ id: 111, email: 'user@example.com' });

  assert.deepEqual(calls, ['protocol']);
});

test('replaceAccountWith2FA injects per-account external email code API for iCloud account when configured', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    twoFaScriptPath: 'src/auto/roxy_2fa_auth_login.js',
    baseEnv: {
      VERIFICATION_CODE_API_URL: 'http://127.0.0.1:3100/api/verification-code/latest',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.replaceAccountWith2FA({
    id: 19,
    email: ' target-user@icloud.com ',
    email_code_api: ' https://fucheng.dpdns.org/newApi/mevM17al ',
    password: ' account-password ',
    codex_2fa: ' JBSWY3DPEHPK3PXP ',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.env.ROXY_OAUTH_EMAIL, 'target-user@icloud.com');
  assert.equal(calls[0].options.env.VERIFICATION_CODE_API_URL, 'https://fucheng.dpdns.org/newApi/mevM17al');
});

test('replaceAccountWith2FA passes numeric codex_2fa as one-time 2fa code', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    twoFaScriptPath: 'src/auto/roxy_2fa_auth_login.js',
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.replaceAccountWith2FA({
    email: 'user@example.com',
    password: 'account-password',
    codex_2fa: '654321',
  });

  assert.equal(calls[0].options.env.ROXY_OAUTH_PASSWORD, 'account-password');
  assert.equal(calls[0].options.env.ROXY_OAUTH_2FA_CODE, '654321');
  assert.equal(Object.hasOwn(calls[0].options.env, 'ROXY_OAUTH_TOTP_SECRET'), false);
});

test('loginAccountWith2FA runs roxy 2fa login script with password and codex 2fa env', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    twoFaLoginScriptPath: 'src/auto/roxy_2fa_login.js',
    baseEnv: {
      ROXY_2FA_EMAIL: 'old@example.com',
      ROXY_OAUTH_EMAIL: 'old-oauth@example.com',
      ROXY_OAUTH_PASSWORD: 'old-password',
      ROXY_OAUTH_TOTP_SECRET: 'OLDSECRET',
      ROXY_OAUTH_2FA_CODE: '111111',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.loginAccountWith2FA({
    id: 20,
    email: ' user@example.com ',
    password: ' account-password ',
    codex_2fa: ' JBSWY3DPEHPK3PXP ',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['src/auto/roxy_2fa_login.js']);
  assert.equal(calls[0].options.env.ROXY_2FA_EMAIL, 'user@example.com');
  assert.equal(calls[0].options.env.ROXY_OAUTH_EMAIL, 'user@example.com');
  assert.equal(calls[0].options.env.ROXY_OAUTH_PASSWORD, 'account-password');
  assert.equal(calls[0].options.env.ROXY_OAUTH_TOTP_SECRET, 'JBSWY3DPEHPK3PXP');
  assert.equal(Object.hasOwn(calls[0].options.env, 'ROXY_OAUTH_2FA_CODE'), false);
});

test('loginAccountWith2FA passes numeric codex_2fa as one-time 2fa code', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    twoFaLoginScriptPath: 'src/auto/roxy_2fa_login.js',
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.loginAccountWith2FA({
    email: 'user@example.com',
    password: 'account-password',
    codex_2fa: '654321',
  });

  assert.equal(calls[0].options.env.ROXY_OAUTH_2FA_CODE, '654321');
  assert.equal(Object.hasOwn(calls[0].options.env, 'ROXY_OAUTH_TOTP_SECRET'), false);
});

test('automation actions can use separate Roxy browser targets from action-specific env', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    scriptPath: 'src/auto/roxy_oauth_login.js',
    twoFaScriptPath: 'src/auto/roxy_2fa_auth_login.js',
    twoFaLoginScriptPath: 'src/auto/roxy_2fa_login.js',
    registerScriptPath: 'src/auto/roxy_register_openai.js',
    baseEnv: {
      ROXY_BROWSER_DIR_ID: 'global-dir',
      ROXY_BROWSER_SORT_NUM: 'global-sort',
      ROXY_BROWSER_WINDOW_NAME: 'global-window',
      ROXY_CDP_ENDPOINT: 'ws://global-cdp',
      ROXY_REPLACE_BROWSER_WINDOW_NAME: 'replace-window',
      ROXY_REPLACE_2FA_BROWSER_SORT_NUM: '11',
      ROXY_2FA_LOGIN_BROWSER_DIR_ID: 'login-dir',
      ROXY_REGISTER_BROWSER_SORT_NUM: '8',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });

  await services.replaceAccount({ email: 'replace@example.com' });
  await services.replaceAccountWith2FA({ email: 'replace-2fa@example.com' });
  await services.loginAccountWith2FA({ email: 'login@example.com' });
  await services.registerAccount({ email: 'register@example.com' });

  assert.equal(calls[0].options.env.ROXY_BROWSER_WINDOW_NAME, 'replace-window');
  assert.equal(Object.hasOwn(calls[0].options.env, 'ROXY_BROWSER_DIR_ID'), false);
  assert.equal(Object.hasOwn(calls[0].options.env, 'ROXY_BROWSER_SORT_NUM'), false);
  assert.equal(Object.hasOwn(calls[0].options.env, 'ROXY_CDP_ENDPOINT'), false);

  assert.equal(calls[1].options.env.ROXY_BROWSER_SORT_NUM, '11');
  assert.equal(Object.hasOwn(calls[1].options.env, 'ROXY_BROWSER_DIR_ID'), false);
  assert.equal(Object.hasOwn(calls[1].options.env, 'ROXY_BROWSER_WINDOW_NAME'), false);
  assert.equal(Object.hasOwn(calls[1].options.env, 'ROXY_CDP_ENDPOINT'), false);

  assert.equal(calls[2].options.env.ROXY_BROWSER_DIR_ID, 'login-dir');
  assert.equal(Object.hasOwn(calls[2].options.env, 'ROXY_BROWSER_SORT_NUM'), false);
  assert.equal(Object.hasOwn(calls[2].options.env, 'ROXY_BROWSER_WINDOW_NAME'), false);
  assert.equal(Object.hasOwn(calls[2].options.env, 'ROXY_CDP_ENDPOINT'), false);

  assert.equal(calls[3].options.env.ROXY_BROWSER_SORT_NUM, '8');
  assert.equal(Object.hasOwn(calls[3].options.env, 'ROXY_BROWSER_DIR_ID'), false);
  assert.equal(Object.hasOwn(calls[3].options.env, 'ROXY_BROWSER_WINDOW_NAME'), false);
  assert.equal(Object.hasOwn(calls[3].options.env, 'ROXY_CDP_ENDPOINT'), false);
});

test('replaceAccount creates automation run and writes child logs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-logs-'));
  const calls = [];
  const statuses = [];
  const services = createReplacementServices({
    logDir: dir,
    automationRuns: {
      createRun(input) {
        calls.push(input);
        return { id: 101, ...input };
      },
      markSucceeded(id, result) {
        statuses.push({ id, status: 'succeeded', result });
      },
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit('data', 'stdout line\n');
        child.stderr.emit('data', 'stderr line\n');
        child.emit('close', 0);
      });
      return child;
    },
  });

  const result = await services.replaceAccount({
    id: 7,
    email: 'user@example.com',
    sms_api: 'https://example.invalid/sms',
  });

  assert.equal(result.run.id, 101);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].account_id, 7);
  assert.equal(calls[0].email, 'user@example.com');
  assert.equal(calls[0].pid, 4242);
  assert.equal(existsSync(calls[0].log_path), true);
  const log = readFileSync(calls[0].log_path, 'utf8');
  assert.match(log, /Starting replacement automation/);
  assert.match(log, /stdout line/);
  assert.match(log, /stderr line/);
  assert.deepEqual(statuses, [{ id: 101, status: 'succeeded', result: { exitCode: 0 } }]);
});

test('replaceAccount writes orchestration step logs around child process execution', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-logs-'));
  let logPath;
  const services = createReplacementServices({
    logDir: dir,
    automationRuns: {
      createRun(input) {
        logPath = input.log_path;
        return { id: 303, ...input };
      },
      markSucceeded() {},
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.pid = 6363;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.emit('close', 0);
      });
      return child;
    },
  });

  await services.replaceAccount({
    id: 9,
    email: 'user@example.com',
    sms_api: 'https://example.invalid/sms',
  });

  const log = readFileSync(logPath, 'utf8');
  assert.match(log, /step=validate-account action=validated replacement account/);
  assert.match(log, /step=prepare-env action=prepared child process environment/);
  assert.match(log, /step=spawn-child action=spawning automation child process/);
  assert.match(log, /step=create-run action=created automation run run_id=303 pid=6363/);
  assert.match(log, /step=wait-child action=waiting for automation child process to finish/);
  assert.match(log, /step=mark-succeeded action=marked automation run succeeded exit_code=0/);
});

test('stopReplacementRun stops an active child created by the service', async () => {
  let killed = false;
  const services = createReplacementServices({
    automationRuns: {
      createRun(input) {
        return { id: 202, ...input };
      },
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.pid = 5252;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        killed = true;
        return true;
      };
      return child;
    },
  });

  services.replaceAccount({
    id: 8,
    email: 'user@example.com',
    sms_api: 'https://example.invalid/sms',
  });

  assert.deepEqual(services.stopReplacementRun(202), { ok: true, runId: 202 });
  assert.equal(killed, true);
});

test('replaceAccount reports child process failure as REPLACE_FAILED', async () => {
  const services = createReplacementServices({
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stderr.emit('data', 'oauth failed');
        child.emit('close', 1);
      });
      return child;
    },
  });

  await assert.rejects(
    () => services.replaceAccount({
      email: 'user@example.com',
      sms_api: 'https://example.invalid/sms',
    }),
    (error) => error.code === 'REPLACE_FAILED' && /oauth failed/.test(error.message),
  );
});

test('registerAccount runs roxy registration script without SMS env and writes registration logs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-logs-'));
  const spawnCalls = [];
  const runCalls = [];
  let logPath;
  const services = createReplacementServices({
    nodePath: 'node-bin',
    registerScriptPath: 'src/auto/roxy_register_openai.js',
    logDir: dir,
    baseEnv: {
      EXISTING_ENV: '1',
      PHONE_VERIFICATION_SMS_API_URL: 'https://old.example/sms',
    },
    automationRuns: {
      createRun(input) {
        runCalls.push(input);
        logPath = input.log_path;
        return { id: 404, ...input };
      },
      markSucceeded() {},
    },
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter();
      child.pid = 7474;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit('data', '[roxy-register-openai] step=done code=received\n');
        child.emit('close', 0);
      });
      return child;
    },
  });

  const result = await services.registerAccount({
    id: 12,
    email: ' user@example.com ',
    sms_api: 'https://example.invalid/sms',
  });

  assert.equal(result.ok, true);
  assert.equal(result.run.id, 404);
  assert.equal(spawnCalls[0].command, 'node-bin');
  assert.deepEqual(spawnCalls[0].args, ['src/auto/roxy_register_openai.js']);
  assert.equal(spawnCalls[0].options.env.EXISTING_ENV, '1');
  assert.equal(spawnCalls[0].options.env.ROXY_REGISTER_EMAIL, 'user@example.com');
  assert.equal(spawnCalls[0].options.env.ROXY_OAUTH_EMAIL, 'user@example.com');
  assert.equal(Object.hasOwn(spawnCalls[0].options.env, 'PHONE_VERIFICATION_SMS_API_URL'), false);
  assert.equal(runCalls[0].email, 'user@example.com');
  const log = readFileSync(logPath, 'utf8');
  assert.match(log, /Starting registration automation/);
  assert.match(log, /step=prepare-env action=prepared child process environment/);
  assert.match(log, /ROXY_REGISTER_EMAIL=set/);
  assert.doesNotMatch(log, /https:\/\/example\.invalid\/sms/);
});

test('registerAccount parses registration MFA result from child stdout', async () => {
  const services = createReplacementServices({
    nodePath: 'node-bin',
    registerScriptPath: 'src/auto/roxy_register_openai.js',
    spawnImpl() {
      const child = new EventEmitter();
      child.pid = 7475;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit('data', 'ROXY_REGISTER_RESULT_JSON={"registrationMfa":{"secret":"WAITOC2YTXEEBUXP2266NLIGOLYSNYWE","enabled":true}}\n');
        child.emit('close', 0);
      });
      return child;
    },
  });

  const result = await services.registerAccount({ id: 13, email: 'user@example.com' });

  assert.equal(result.childResult.registrationMfa.secret, 'WAITOC2YTXEEBUXP2266NLIGOLYSNYWE');
  assert.equal(result.childResult.registrationMfa.enabled, true);
});

test('registerAccount reports child process failure as REGISTER_FAILED', async () => {
  const services = createReplacementServices({
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stderr.emit('data', 'registration failed');
        child.emit('close', 1);
      });
      return child;
    },
  });

  await assert.rejects(
    () => services.registerAccount({ email: 'user@example.com' }),
    (error) => error.code === 'REGISTER_FAILED' && /registration failed/.test(error.message),
  );
});
