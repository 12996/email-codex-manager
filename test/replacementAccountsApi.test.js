import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import signature from 'cookie-signature';

import { createAdminNotificationRepository } from '../src/adminNotifications.js';
import { config } from '../src/config.js';
import { createDatabase } from '../src/db.js';
import { createReplacementAutomationRunRepository } from '../src/replacementAutomationRuns.js';
import { createReplacementAccountRepository } from '../src/replacementAccounts.js';
import { createApp } from '../src/server.js';

async function startTestServer(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function authCookie() {
  return `admin_auth=${encodeURIComponent(`s:${signature.sign('1', config.sessionSecret)}`)}`;
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createTestContext(replacementServices = successfulServices(), overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-service-'));
  const db = createDatabase(join(dir, 'test.db'));
  const adminNotifications = createAdminNotificationRepository(db);
  const replacementAccounts = createReplacementAccountRepository(db);
  const replacementAutomationRuns = createReplacementAutomationRunRepository(db);
  const app = createApp({
    db,
    adminNotifications,
    replacementAccounts,
    replacementAutomationRuns,
    replacementServices,
    accounts: {
      listAccounts() {
        return [];
      },
      getAccountByGmailEmail() {
        return null;
      },
    },
    ...overrides,
  });

  return { app, adminNotifications, replacementAccounts, replacementAutomationRuns, dir };
}

function successfulServices() {
  return {
    async fetchSmsCode() {
      return '123456';
    },
    async fetchJson() {
      return '{"ok":true}';
    },
    async replaceAccount() {
      return { ok: true };
    },
    async registerAccount() {
      return { ok: true, run: { id: 77 } };
    },
  };
}

async function jsonRequest(server, method, path, body) {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: authCookie(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    body: await response.json(),
  };
}

test('GET /replacement-accounts redirects unauthenticated requests to login', async () => {
  const { app } = createTestContext();
  const server = await startTestServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/replacement-accounts`, {
      redirect: 'manual',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  } finally {
    await server.close();
  }
});

test('GET /replacement-accounts/:id/registration-token returns the saved access token or reports it missing', async () => {
  const tokenDirectory = mkdtempSync(join(tmpdir(), 'registration-token-'));
  const { app, replacementAccounts } = createTestContext(undefined, {
    registrationTokenOutputDir: tokenDirectory,
  });
  const account = replacementAccounts.createAccount({ email: 'registered@example.com' });
  writeFileSync(join(tokenDirectory, 'registered@example.com.txt'), 'saved-access-token\n', 'utf8');
  const server = await startTestServer(app);

  try {
    const found = await jsonRequest(server, 'GET', `/replacement-accounts/${account.id}/registration-token`);
    assert.equal(found.response.status, 200);
    assert.equal(found.body.token, 'saved-access-token');

    const withoutToken = replacementAccounts.createAccount({ email: 'without-token@example.com' });
    const missing = await jsonRequest(server, 'GET', `/replacement-accounts/${withoutToken.id}/registration-token`);
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error, 'REGISTRATION_TOKEN_NOT_FOUND');
  } finally {
    await server.close();
  }
});

test('POST /api/2fa-code returns current TOTP code for local automation callers', async () => {
  const { app } = createTestContext();
  const server = await startTestServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/2fa-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: 'ANA6DKOETWQDNSF2O6UGJ6VNJI2WYBSJ',
        timestampMs: 1782993169067,
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      code: '454976',
      expiresIn: 11,
      step: 30,
      digits: 6,
      algorithm: 'sha1',
    });
  } finally {
    await server.close();
  }
});

test('POST /api/2fa-code rejects missing or invalid secrets', async () => {
  const { app } = createTestContext();
  const server = await startTestServer(app);

  try {
    const missing = await fetch(`${server.baseUrl}/api/2fa-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const missingBody = await missing.json();
    assert.equal(missing.status, 400);
    assert.equal(missingBody.error, 'TOTP_SECRET_REQUIRED');

    const invalid = await fetch(`${server.baseUrl}/api/2fa-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: 'not-valid-***' }),
    });
    const invalidBody = await invalid.json();
    assert.equal(invalid.status, 400);
    assert.equal(invalidBody.error, 'TOTP_SECRET_INVALID');
  } finally {
    await server.close();
  }
});

test('replacement account CRUD API creates, lists, reads, updates, and soft deletes accounts', async () => {
  const { app } = createTestContext();
  const server = await startTestServer(app);

  try {
    const created = await jsonRequest(server, 'POST', '/replacement-accounts', {
      email: ' User@Example.COM ',
      phone: '123',
      '2fa-codex': ' JBSWY3DPEHPK3PXP ',
      status: 'pending',
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.ok, true);
    assert.equal(created.body.account.email, 'User@Example.COM');
    assert.equal(created.body.account.codex_2fa, 'JBSWY3DPEHPK3PXP');
    assert.equal(created.body.account.status, 'for_sale');
    assert.match(created.body.account.password, /^[A-Za-z0-9!@#$%^&*_-]{12,16}$/);
    assert.ok(created.body.account.activated_at);

    const duplicate = await jsonRequest(server, 'POST', '/replacement-accounts', {
      email: 'user@example.com',
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.error, 'EMAIL_DUPLICATE');

    const listed = await jsonRequest(server, 'GET', '/replacement-accounts');
    assert.equal(listed.response.status, 200);
    assert.deepEqual(listed.body.accounts.map((account) => account.id), [created.body.account.id]);

    const read = await jsonRequest(server, 'GET', `/replacement-accounts/${created.body.account.id}`);
    assert.equal(read.response.status, 200);
    assert.equal(read.body.account.email, 'User@Example.COM');

    const updated = await jsonRequest(server, 'PUT', `/replacement-accounts/${created.body.account.id}`, {
      email: 'updated@example.com',
      phone: '456',
      codex_2fa: 'NEXTSECRET',
      status: 'active',
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.account.email, 'updated@example.com');
    assert.equal(updated.body.account.phone, '456');
    assert.equal(updated.body.account.codex_2fa, 'NEXTSECRET');
    assert.equal(updated.body.account.status, 'plus_active');
    assert.equal(updated.body.account.password, created.body.account.password);

    const passwordUpdated = await jsonRequest(server, 'PUT', `/replacement-accounts/${created.body.account.id}`, {
      email: 'updated@example.com',
      password: 'NewPass12!',
      status: 'active',
    });
    assert.equal(passwordUpdated.response.status, 200);
    assert.equal(passwordUpdated.body.account.password, 'NewPass12!');
    assert.equal(passwordUpdated.body.account.status, 'plus_active');

    const deleted = await jsonRequest(server, 'DELETE', `/replacement-accounts/${created.body.account.id}`);
    assert.equal(deleted.response.status, 200);
    assert.deepEqual(deleted.body, { ok: true });

    const emptyList = await jsonRequest(server, 'GET', '/replacement-accounts');
    assert.deepEqual(emptyList.body.accounts, []);

    const defaultStatus = await jsonRequest(server, 'POST', '/replacement-accounts', {
      email: 'default-status@example.com',
    });
    assert.equal(defaultStatus.response.status, 201);
    assert.equal(defaultStatus.body.account.status, 'unregistered');
  } finally {
    await server.close();
  }
});

test('replacement activation method API lists seeded methods and creates a custom method', async () => {
  const { app } = createTestContext();
  const server = await startTestServer(app);

  try {
    const listed = await jsonRequest(server, 'GET', '/replacement-activation-methods');
    assert.equal(listed.response.status, 200);
    assert.deepEqual(listed.body.methods.map((method) => method.name), [
      '越南直卡',
      'upi',
      'ideal',
      '波兰',
      '瑞士',
      'pix 直卡',
    ]);

    const created = await jsonRequest(server, 'POST', '/replacement-activation-methods', { name: ' 新方式 ' });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.method.name, '新方式');

    const duplicate = await jsonRequest(server, 'POST', '/replacement-activation-methods', { name: '新方式' });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.error, 'ACTIVATION_METHOD_DUPLICATE');

    const empty = await jsonRequest(server, 'POST', '/replacement-activation-methods', { name: ' ' });
    assert.equal(empty.response.status, 400);
    assert.equal(empty.body.error, 'ACTIVATION_METHOD_REQUIRED');
  } finally {
    await server.close();
  }
});

test('replacement account activation method API updates and validates the selected method', async () => {
  const { app, replacementAccounts } = createTestContext();
  const account = replacementAccounts.createAccount({ email: 'activation-method-api@example.com' });
  const server = await startTestServer(app);

  try {
    const updated = await jsonRequest(server, 'PATCH', `/replacement-accounts/${account.id}/activation-method`, {
      activation_method: ' upi ',
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.account.activation_method, 'upi');

    const cleared = await jsonRequest(server, 'PATCH', `/replacement-accounts/${account.id}/activation-method`, {
      activation_method: '',
    });
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.body.account.activation_method, null);

    const invalid = await jsonRequest(server, 'PATCH', `/replacement-accounts/${account.id}/activation-method`, {
      activation_method: 'not configured',
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error, 'ACTIVATION_METHOD_INVALID');
  } finally {
    await server.close();
  }
});

test('replacement account API returns paginated accounts with filters', async () => {
  const { app, replacementAccounts } = createTestContext();
  const first = replacementAccounts.createAccount({
    email: 'first@example.com',
    remark: 'first slot',
    status: 'plus_active',
  });
  const second = replacementAccounts.createAccount({
    email: 'second@example.com',
    remark: 'second slot',
    status: 'banned',
  });
  const third = replacementAccounts.createAccount({
    email: 'third@example.com',
    remark: 'third slot',
    status: 'pending',
  });
  const server = await startTestServer(app);

  try {
    const page = await jsonRequest(server, 'GET', '/replacement-accounts?page=2&pageSize=1&keyword=example.com');
    assert.equal(page.response.status, 200);
    assert.deepEqual(page.body.accounts.map((account) => account.id), [second.id]);
    assert.deepEqual(page.body.pagination, {
      page: 2,
      pageSize: 1,
      total: 3,
      totalPages: 3,
    });

    const filtered = await jsonRequest(server, 'GET', '/replacement-accounts?status=plus_active&keyword=first');
    assert.deepEqual(filtered.body.accounts.map((account) => account.id), [first.id]);
    assert.equal(filtered.body.pagination.total, 1);
  } finally {
    await server.close();
  }
});

test('replacement account API filters accounts with circuit breaker enabled', async () => {
  const { app, replacementAccounts } = createTestContext();
  const normal = replacementAccounts.createAccount({ email: 'normal@example.com' });
  const circuitBroken = replacementAccounts.createAccount({ email: 'broken@example.com' });
  for (let index = 0; index < 5; index += 1) {
    replacementAccounts.markReplacementStarted(circuitBroken.id);
    replacementAccounts.markReplacementFailure(circuitBroken.id, `automation failed ${index + 1}`, circuitBroken.status, '补号');
  }
  const server = await startTestServer(app);

  try {
    const filtered = await jsonRequest(server, 'GET', '/replacement-accounts?circuit_breaker=1');

    assert.equal(filtered.response.status, 200);
    assert.deepEqual(filtered.body.accounts.map((account) => account.id), [circuitBroken.id]);
    assert.equal(filtered.body.pagination.total, 1);
    assert.equal(filtered.body.accounts.some((account) => account.id === normal.id), false);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/healthcheck-banned marks matching Plus-related accounts as banned', async () => {
  const { app, replacementAccounts } = createTestContext(successfulServices(), {
    accounts: {
      listAccounts() {
        return [];
      },
      getAccountByGmailEmail(email) {
        return email === 'receiver@gmail.com'
          ? { id: 99, gmail_email: 'receiver@gmail.com', gmail_app_password: 'abcdefghijklmnop' }
          : null;
      },
    },
    mailService: {
      async fetchMessages(account, options) {
        assert.equal(account.gmail_email, 'receiver@gmail.com');
        assert.equal(options.limit, 5);
        return [{
          subject: 'Important update about your ChatGPT account',
          bodyText: `We’re writing with an important update about your ChatGPT account associated with ${options.targetEmail}.
Your account has been deactivated because recent activity violated our Terms and Usage Policies.
This means your account can no longer be used.`,
        }];
      },
    },
    replacementEmailApiService: {
      async fetchMessages(account, options) {
        assert.ok(['receiver+sold@gmail.com', 'receiver+registered@gmail.com'].includes(account.email));
        assert.equal(options.limit, 5);
        return [{
          subject: 'Important update about your ChatGPT account',
          bodyText: `We’re writing with an important update about your ChatGPT account associated with ${options.targetEmail}.
Your account has been deactivated because recent activity violated our Terms and Usage Policies.
This means your account can no longer be used.`,
        }];
      },
    },
  });
  const created = replacementAccounts.createAccount({
    email: 'receiver+sold@gmail.com',
    email_code_api: 'https://mail.example.test/code?sold',
    status: 'sold',
  });
  const registered = replacementAccounts.createAccount({
    email: 'receiver+registered@gmail.com',
    email_code_api: 'https://mail.example.test/code?registered',
    status: 'registered',
  });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', '/replacement-accounts/healthcheck-banned');

    assert.equal(response.response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.result.checked, 2);
    assert.equal(response.body.result.banned, 2);
    assert.equal(replacementAccounts.getAccount(created.id).status, 'banned');
    assert.equal(replacementAccounts.getAccount(registered.id).status, 'banned');
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/check-plus-status updates only registered accounts', async () => {
  const { app, replacementAccounts } = createTestContext(successfulServices(), {
    accounts: {
      listAccounts() {
        return [];
      },
      getAccountByGmailEmail(email) {
        return email === 'receiver@gmail.com'
          ? { id: 99, gmail_email: 'receiver@gmail.com', gmail_app_password: 'abcdefghijklmnop' }
          : null;
      },
    },
    mailService: {
      async fetchMessages(account, options) {
        assert.equal(account.gmail_email, 'receiver@gmail.com');
        assert.equal(options.limit, 30);
        if (options.targetEmail === 'receiver+plus@gmail.com') {
          return [{
            subject: "You've successfully subscribed to ChatGPT Plus.",
            toAddresses: ['receiver+plus@gmail.com'],
            bodyText: 'ChatGPT Plus Subscription The OpenAI Team',
          }];
        }
        if (options.targetEmail === 'receiver+clean@gmail.com') return [];
        throw new Error('IMAP temporary failure');
      },
    },
    replacementEmailApiService: {
      async fetchMessages(account, options) {
        assert.equal(account.email_code_api.startsWith('https://mail.example.test/code?'), true);
        assert.equal(options.limit, 30);
        if (options.targetEmail === 'receiver+plus@gmail.com') {
          return [{
            subject: "You've successfully subscribed to ChatGPT Plus.",
            toAddresses: ['receiver+plus@gmail.com'],
            bodyText: 'ChatGPT Plus Subscription The OpenAI Team',
          }];
        }
        if (options.targetEmail === 'receiver+clean@gmail.com') return [];
        throw new Error('EMAIL API temporary failure');
      },
    },
  });
  const plus = replacementAccounts.createAccount({
    email: 'receiver+plus@gmail.com',
    email_code_api: 'https://mail.example.test/code?plus',
    status: 'registered',
  });
  const clean = replacementAccounts.createAccount({
    email: 'receiver+clean@gmail.com',
    email_code_api: 'https://mail.example.test/code?clean',
    status: 'registered',
  });
  const failed = replacementAccounts.createAccount({
    email: 'receiver+failed@gmail.com',
    email_code_api: 'https://mail.example.test/code?failed',
    status: 'registered',
  });
  const ignored = replacementAccounts.createAccount({
    email: 'receiver+ignored@gmail.com',
    status: 'plus_active',
  });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', '/replacement-accounts/check-plus-status');

    assert.equal(response.response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.result.checked, 3);
    assert.equal(response.body.result.plus, 1);
    assert.equal(response.body.result.registered, 1);
    assert.equal(response.body.result.failed, 1);
    assert.equal(replacementAccounts.getAccount(plus.id).status, 'plus_active');
    assert.equal(replacementAccounts.getAccount(clean.id).status, 'registered');
    assert.equal(replacementAccounts.getAccount(failed.id).status, 'registered');
    assert.equal(replacementAccounts.getAccount(ignored.id).status, 'plus_active');
    assert.match(replacementAccounts.getAccount(failed.id).last_error, /Plus 状态查询失败/);
  } finally {
    await server.close();
  }
});

test('replacement status batch APIs stream account progress when requested', async () => {
  const { app, replacementAccounts } = createTestContext(successfulServices(), {
    accounts: {
      listAccounts() {
        return [];
      },
      getAccountByGmailEmail(email) {
        return email === 'receiver@gmail.com'
          ? { id: 99, gmail_email: 'receiver@gmail.com', gmail_app_password: 'abcdefghijklmnop' }
          : null;
      },
    },
    mailService: {
      async fetchMessages(account, options) {
        assert.equal(account.gmail_email, 'receiver@gmail.com');
        if (options.targetEmail === 'receiver+plus@gmail.com') {
          return [{
            subject: "You've successfully subscribed to ChatGPT Plus.",
            toAddresses: ['receiver+plus@gmail.com'],
            bodyText: 'ChatGPT Plus Subscription The OpenAI Team',
          }];
        }
        return [{
          subject: 'Important update about your ChatGPT account',
          bodyText: `This message concerns ${options.targetEmail}. Your account has been deactivated because recent activity violated our Terms and Usage Policies.`,
        }];
      },
    },
    replacementEmailApiService: {
      async fetchMessages(account, options) {
        assert.equal(account.email_code_api.startsWith('https://mail.example.test/code?'), true);
        if (options.targetEmail === 'receiver+plus@gmail.com') {
          return [{
            subject: "You've successfully subscribed to ChatGPT Plus.",
            toAddresses: ['receiver+plus@gmail.com'],
            bodyText: 'ChatGPT Plus Subscription The OpenAI Team',
          }];
        }
        return [{
          subject: 'Important update about your ChatGPT account',
          bodyText: `This message concerns ${options.targetEmail}. Your account has been deactivated because recent activity violated our Terms and Usage Policies.`,
        }];
      },
    },
  });
  replacementAccounts.createAccount({
    email: 'receiver+plus@gmail.com',
    email_code_api: 'https://mail.example.test/code?plus',
    status: 'registered',
  });
  replacementAccounts.createAccount({
    email: 'receiver+banned@gmail.com',
    email_code_api: 'https://mail.example.test/code?banned',
    status: 'for_sale',
  });
  const server = await startTestServer(app);

  async function stream(path) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        cookie: authCookie(),
      },
    });
    return { response, text: await response.text() };
  }

  try {
    const plus = await stream('/replacement-accounts/check-plus-status');
    assert.equal(plus.response.status, 200);
    assert.match(plus.response.headers.get('content-type'), /text\/event-stream/);
    assert.match(plus.text, /"type":"account-start"/);
    assert.match(plus.text, /"type":"account-step"/);
    assert.match(plus.text, /"type":"account-result"/);
    assert.match(plus.text, /"status":"plus_active"/);
    assert.match(plus.text, /"type":"complete"/);

    const banned = await stream('/replacement-accounts/healthcheck-banned');
    assert.equal(banned.response.status, 200);
    assert.match(banned.response.headers.get('content-type'), /text\/event-stream/);
    assert.match(banned.text, /"outcome":"banned"/);
    assert.match(banned.text, /"status":"banned"/);
    assert.match(banned.text, /"type":"complete"/);
  } finally {
    await server.close();
  }
});

test('replacement account action APIs update status and call injected services', async () => {
  const { app, replacementAccounts } = createTestContext();
  const created = replacementAccounts.createAccount({
    email: 'user@example.com',
    sms_api: 'https://example.invalid/sms',
  });
  const server = await startTestServer(app);

  try {
    const status = await jsonRequest(server, 'PATCH', `/replacement-accounts/${created.id}/status`, {
      status: 'banned',
      status_note: 'manual mark',
    });
    assert.equal(status.response.status, 200);
    assert.equal(status.body.account.status, 'banned');
    assert.equal(status.body.account.status_note, 'manual mark');

    const invalidStatus = await jsonRequest(server, 'PATCH', `/replacement-accounts/${created.id}/status`, {
      status: 'replacing',
    });
    assert.equal(invalidStatus.response.status, 400);
    assert.equal(invalidStatus.body.error, 'STATUS_INVALID');

    const sms = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/fetch-sms-code`);
    assert.equal(sms.response.status, 200);
    assert.deepEqual(sms.body, { ok: true, code: '123456' });
    const afterSms = replacementAccounts.getAccount(created.id);
    assert.equal(Object.hasOwn(afterSms, 'sms_code'), false);

    const json = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/fetch-json`, {
      url: 'https://example.invalid/account.json',
    });
    assert.equal(json.response.status, 200);
    assert.equal(json.body.account.json_payload, '{"ok":true}');

    const replaced = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace`);
    assert.equal(replaced.response.status, 200);
    assert.equal(replaced.body.account.status, 'cpa_mounted');
    assert.equal(replaced.body.account.replacement_count, 1);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/replace-2fa falls back to direct 2FA automation without CPA worker', async () => {
  const events = [];
  const services = {
    async fetchSmsCode() {
      return '123456';
    },
    async fetchJson() {
      return '{}';
    },
    async replaceAccount() {
      events.push('replace');
      return { ok: true };
    },
    async replaceAccountWith2FA(account) {
      events.push(['replace-2fa', account.id, account.email, account.password, account.codex_2fa]);
      return { ok: true, run: { id: 707 } };
    },
    async registerAccount() {
      return { ok: true };
    },
    stopReplacementRun() {
      return { ok: true };
    },
  };
  const { app, replacementAccounts } = createTestContext(services);
  const created = replacementAccounts.createAccount({
    email: 'user@example.com',
    password: 'account-password',
    codex_2fa: 'JBSWY3DPEHPK3PXP',
  });

  const server = await startTestServer(app);
  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace-2fa`);

    assert.equal(response.response.status, 200);
    assert.equal(response.body.account.status, 'cpa_mounted');
    assert.equal(response.body.account.replacement_count, 1);
    assert.equal(response.body.run.id, 707);
    assert.deepEqual(events, [['replace-2fa', created.id, 'user@example.com', 'account-password', 'JBSWY3DPEHPK3PXP']]);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/replace-2fa uses CPA repair worker when configured', async () => {
  const events = [];
  const services = {
    ...successfulServices(),
    async replaceAccount() {
      events.push('replace');
      return { ok: true };
    },
    async replaceAccountWith2FA() {
      events.push('direct-replace-2fa');
      return { ok: true };
    },
  };
  const cpaRepairWorker = {
    async repair({ account, source, mode }) {
      events.push(['cpa-repair', account.id, account.email, source, mode]);
      return {
        ok: true,
        account: {
          ...account,
          status: 'cpa_mounted',
          replacement_count: Number(account.replacement_count || 0) + 1,
        },
        run: { id: 909 },
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(services, { cpaRepairWorker });
  const created = replacementAccounts.createAccount({
    email: 'user@example.com',
    password: 'account-password',
    codex_2fa: 'JBSWY3DPEHPK3PXP',
  });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace-2fa`);

    assert.equal(response.response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.account.status, 'cpa_mounted');
    assert.equal(response.body.run.id, 909);
    assert.deepEqual(events, [['cpa-repair', created.id, 'user@example.com', 'manual', '2fa']]);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/replace-2fa returns worker failure with account', async () => {
  const events = [];
  const cpaRepairWorker = {
    async repair({ account, source, mode }) {
      events.push(['cpa-repair', account.id, source, mode]);
      return {
        ok: false,
        account: {
          ...account,
          status: 'unregistered',
          last_error: '2FA补号失败：CPA upload failed',
        },
        error: 'CPA upload failed',
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(successfulServices(), { cpaRepairWorker });
  const created = replacementAccounts.createAccount({ email: 'user@example.com' });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace-2fa`);

    assert.equal(response.response.status, 502);
    assert.equal(response.body.error, 'REPLACE_FAILED');
    assert.equal(response.body.account.status, 'unregistered');
    assert.equal(response.body.account.last_error, '2FA补号失败：CPA upload failed');
    assert.deepEqual(events, [['cpa-repair', created.id, 'manual', '2fa']]);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/replace-2fa-protocol uses the CPA worker protocol mode', async () => {
  const events = [];
  const cpaRepairWorker = {
    async repair({ account, source, mode }) {
      events.push(['cpa-repair', account.id, account.email, source, mode]);
      return {
        ok: true,
        account: {
          ...account,
          status: 'cpa_mounted',
          replacement_count: Number(account.replacement_count || 0) + 1,
        },
        run: { id: 910 },
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(successfulServices(), { cpaRepairWorker });
  const created = replacementAccounts.createAccount({ email: 'protocol-replace@example.com' });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace-2fa-protocol`);

    assert.equal(response.response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.account.status, 'cpa_mounted');
    assert.equal(response.body.account.replacement_count, 1);
    assert.equal(response.body.run.id, 910);
    assert.deepEqual(events, [['cpa-repair', created.id, 'protocol-replace@example.com', 'manual', '2fa-protocol']]);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/replace-2fa-protocol streams live logs when requested', async () => {
  const cpaRepairWorker = {
    async repair({ account, mode, onLog }) {
      assert.equal(mode, '2fa-protocol');
      onLog?.({ type: 'step', step: 'child-start', message: '协议补号子进程已启动' });
      onLog?.({ type: 'log', stream: 'stdout', text: 'child output\\n' });
      return {
        ok: true,
        account: { ...account, status: 'cpa_mounted' },
        run: { id: 912 },
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(successfulServices(), { cpaRepairWorker });
  const created = replacementAccounts.createAccount({ email: 'protocol-replace-live@example.com' });
  const server = await startTestServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/replacement-accounts/${created.id}/replace-2fa-protocol`, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        cookie: authCookie(),
      },
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(text, /协议补号子进程已启动/);
    assert.match(text, /child output/);
    assert.match(text, /"type":"complete"/);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/replace-2fa-protocol streams failure events when the worker fails', async () => {
  const cpaRepairWorker = {
    async repair({ account, onLog }) {
      onLog?.({ type: 'step', step: 'cpa-failure', message: '协议补号失败：CPA upload failed' });
      return {
        ok: false,
        account: { ...account, status: 'plus_active' },
        error: 'CPA upload failed',
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(successfulServices(), { cpaRepairWorker });
  const created = replacementAccounts.createAccount({ email: 'protocol-replace-live-failed@example.com', status: 'plus_active' });
  const server = await startTestServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/replacement-accounts/${created.id}/replace-2fa-protocol`, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        cookie: authCookie(),
      },
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /协议补号失败：CPA upload failed/);
    assert.match(text, /"type":"account-result"/);
    assert.match(text, /"outcome":"failed"/);
    assert.match(text, /"type":"error"/);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/replace-2fa-protocol preserves status on worker failure', async () => {
  const events = [];
  const cpaRepairWorker = {
    async repair({ account, source, mode }) {
      events.push(['cpa-repair', account.id, source, mode]);
      return {
        ok: false,
        account: {
          ...account,
          status: 'plus_active',
          last_error: '协议补号失败：CPA upload failed',
        },
        error: 'CPA upload failed',
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(successfulServices(), { cpaRepairWorker });
  const created = replacementAccounts.createAccount({ email: 'protocol-replace-failed@example.com', status: 'plus_active' });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace-2fa-protocol`);

    assert.equal(response.response.status, 502);
    assert.equal(response.body.error, 'PROTOCOL_REPLACE_FAILED');
    assert.equal(response.body.account.status, 'plus_active');
    assert.match(response.body.account.last_error, /协议补号失败/);
    assert.deepEqual(events, [['cpa-repair', created.id, 'manual', '2fa-protocol']]);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/replace-2fa-protocol falls back to the direct protocol child', async () => {
  const events = [];
  const services = {
    ...successfulServices(),
    async replaceAccountWith2FAProtocol(account) {
      events.push(['replace-2fa-protocol', account.id, account.email]);
      return { ok: true, run: { id: 911 } };
    },
  };
  const { app, replacementAccounts } = createTestContext(services);
  const created = replacementAccounts.createAccount({ email: 'protocol-replace-fallback@example.com' });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace-2fa-protocol`);

    assert.equal(response.response.status, 200);
    assert.equal(response.body.account.status, 'cpa_mounted');
    assert.equal(response.body.account.replacement_count, 1);
    assert.equal(response.body.run.id, 911);
    assert.deepEqual(events, [['replace-2fa-protocol', created.id, 'protocol-replace-fallback@example.com']]);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/login-2fa starts 2fa login automation without replacement state changes', async () => {
  const events = [];
  const services = {
    async fetchSmsCode() {
      return '123456';
    },
    async fetchJson() {
      return '{}';
    },
    async replaceAccount() {
      events.push('replace');
      return { ok: true };
    },
    async replaceAccountWith2FA() {
      events.push('replace-2fa');
      return { ok: true };
    },
    async loginAccountWith2FA(account) {
      events.push(['login-2fa', account.id, account.email, account.password, account.codex_2fa]);
      return { ok: true, run: { id: 808 } };
    },
    async registerAccount() {
      return { ok: true };
    },
    stopReplacementRun() {
      return { ok: true };
    },
  };
  const { app, replacementAccounts } = createTestContext(services);
  const created = replacementAccounts.createAccount({
    email: 'user@example.com',
    password: 'account-password',
    codex_2fa: 'JBSWY3DPEHPK3PXP',
    status: 'plus_active',
  });
  replacementAccounts.recordOperationFailure(created.id, '2FA登录', 'previous login failure');

  const server = await startTestServer(app);
  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/login-2fa`);

    assert.equal(response.response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.account.status, 'plus_active');
    assert.equal(response.body.account.replacement_count, 0);
    assert.equal(response.body.account.last_error, null);
    assert.equal(response.body.run.id, 808);
    assert.deepEqual(events, [['login-2fa', created.id, 'user@example.com', 'account-password', 'JBSWY3DPEHPK3PXP']]);
  } finally {
    await server.close();
  }
});

test('manual replacement uses CPA repair worker when configured', async () => {
  const events = [];
  const services = {
    ...successfulServices(),
    async replaceAccount() {
      events.push('direct-replace-service');
      return { ok: true };
    },
  };
  const cpaRepairWorker = {
    async repair({ account }) {
      events.push(['cpa-repair', account.id, account.email]);
      return {
        ok: true,
        account: {
          ...account,
          status: 'cpa_mounted',
          replacement_count: Number(account.replacement_count || 0) + 1,
        },
        upload: { status: 'ok' },
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(services, { cpaRepairWorker });
  const created = replacementAccounts.createAccount({ email: 'user@example.com' });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace`);

    assert.equal(response.response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.account.status, 'cpa_mounted');
    assert.deepEqual(events, [['cpa-repair', created.id, 'user@example.com']]);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/register starts registration automation', async () => {
  const events = [];
  const services = {
    ...successfulServices(),
    async registerAccount(account) {
      events.push(['register', account.id, account.email]);
      return {
        ok: true,
        run: { id: 88, status: 'running' },
        childResult: {
          registrationMfa: {
            secret: 'WAITOC2YTXEEBUXP2266NLIGOLYSNYWE',
            enabled: true,
          },
        },
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(services);
  const created = replacementAccounts.createAccount({ email: 'user@example.com' });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/register`);

    assert.equal(response.response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.account.id, created.id);
    assert.equal(response.body.account.codex_2fa, 'WAITOC2YTXEEBUXP2266NLIGOLYSNYWE');
    assert.equal(response.body.account.status, 'registered');
    assert.equal(replacementAccounts.getAccount(created.id).codex_2fa, 'WAITOC2YTXEEBUXP2266NLIGOLYSNYWE');
    assert.equal(replacementAccounts.getAccount(created.id).status, 'registered');
    assert.deepEqual(response.body.run, { id: 88, status: 'running' });
    assert.deepEqual(events, [['register', created.id, 'user@example.com']]);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/register-protocol queues protocol registration for the current row', async () => {
  const events = [];
  const services = {
    ...successfulServices(),
    async registerProtocolAccount(account) {
      events.push(['register-protocol', account.id, account.email]);
      return {
        ok: true,
        run: { id: 89, status: 'running' },
        childResult: {
          registrationMfa: {
            secret: 'JBSWY3DPEHPK3PXP',
            enabled: true,
          },
        },
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(services);
  const created = replacementAccounts.createAccount({ email: 'protocol@example.com' });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/register-protocol`);

    assert.equal(response.response.status, 202);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.job.account.id, created.id);
    assert.equal(response.body.job.state, 'running');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(replacementAccounts.getAccount(created.id).codex_2fa, 'JBSWY3DPEHPK3PXP');
    assert.equal(replacementAccounts.getAccount(created.id).status, 'registered');
    assert.deepEqual(events, [['register-protocol', created.id, 'protocol@example.com']]);
  } finally {
    await server.close();
  }
});

test('protocol registration queue records a child success without activated MFA as failed', async () => {
  const services = {
    ...successfulServices(),
    async registerProtocolAccount() {
      return {
        ok: true,
        childResult: {
          registrationMfa: null,
        },
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(services);
  const created = replacementAccounts.createAccount({ email: 'protocol-no-mfa@example.com' });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/register-protocol`);

    assert.equal(response.response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snapshot = await jsonRequest(server, 'GET', '/protocol-registration-queue');
    assert.equal(snapshot.body.recent[0].state, 'failed');
    assert.equal(replacementAccounts.getAccount(created.id).status, 'unregistered');
    assert.equal(replacementAccounts.getAccount(created.id).codex_2fa, null);
    assert.match(replacementAccounts.getAccount(created.id).last_error, /协议注册失败/);
  } finally {
    await server.close();
  }
});

test('protocol registration queue exposes live protocol logs for the running job', async () => {
  const started = createDeferred();
  const services = {
    ...successfulServices(),
    async registerProtocolAccount(account, { onLog }) {
      onLog({ type: 'step', message: '正在准备 Roxy 浏览器环境' });
      onLog({ type: 'log', stream: 'stdout', text: '等待邮箱验证码\n' });
      await started.promise;
      return {
        ok: true,
        childResult: {
          registrationMfa: { secret: 'JBSWY3DPEHPK3PXP', enabled: true },
        },
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(services);
  const created = replacementAccounts.createAccount({ email: 'protocol-logs@example.com' });
  const server = await startTestServer(app);

  try {
    assert.equal((await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/register-protocol`)).response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = await jsonRequest(server, 'GET', '/protocol-registration-queue');
    assert.deepEqual(snapshot.body.current.logs, [
      { level: 'muted', message: '正在准备 Roxy 浏览器环境' },
      { level: 'muted', message: '等待邮箱验证码' },
    ]);
  } finally {
    started.resolve();
    await server.close();
  }
});

test('protocol registration queue exposes queued jobs and clears only waiting jobs', async () => {
  const services = {
    ...successfulServices(),
    async registerProtocolAccount() {
      await new Promise(() => {});
      return {
        ok: true,
        run: { id: 90, status: 'running' },
        childResult: {
          registrationMfa: {
            secret: 'JBSWY3DPEHPK3PXP',
            enabled: true,
          },
        },
      };
    },
  };
  const { app, replacementAccounts } = createTestContext(services);
  const first = replacementAccounts.createAccount({ email: 'protocol-live@example.com' });
  const second = replacementAccounts.createAccount({ email: 'protocol-waiting@example.com' });
  const server = await startTestServer(app);

  try {
    assert.equal((await jsonRequest(server, 'POST', `/replacement-accounts/${first.id}/register-protocol`)).response.status, 202);
    assert.equal((await jsonRequest(server, 'POST', `/replacement-accounts/${second.id}/register-protocol`)).response.status, 202);
    const duplicate = await jsonRequest(server, 'POST', `/replacement-accounts/${second.id}/register-protocol`);
    assert.equal(duplicate.response.status, 409);
    const beforeClear = await jsonRequest(server, 'GET', '/protocol-registration-queue');
    assert.equal(beforeClear.body.current.account.id, first.id);
    assert.deepEqual(beforeClear.body.waiting.map((job) => job.account.id), [second.id]);
    const cleared = await jsonRequest(server, 'DELETE', '/protocol-registration-queue');
    assert.deepEqual(cleared.body.cleared.map((job) => job.account.id), [second.id]);
    assert.equal(cleared.body.current.account.id, first.id);
  } finally {
    await server.close();
  }
});

test('protocol registration queue preserves account status when a job fails', async () => {
  const services = {
    ...successfulServices(),
    async registerProtocolAccount() {
      throw Object.assign(new Error('protocol failed'), { code: 'PROTOCOL_REGISTER_FAILED' });
    },
  };
  const { app, replacementAccounts } = createTestContext(services);
  const created = replacementAccounts.createAccount({ email: 'protocol-failed@example.com' });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/register-protocol`);

    assert.equal(response.response.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(replacementAccounts.getAccount(created.id).status, 'unregistered');
    assert.match(replacementAccounts.getAccount(created.id).last_error, /协议注册失败/);
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/register returns ACCOUNT_NOT_FOUND for missing account', async () => {
  const { app } = createTestContext();
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', '/replacement-accounts/999/register');

    assert.equal(response.response.status, 404);
    assert.equal(response.body.error, 'ACCOUNT_NOT_FOUND');
  } finally {
    await server.close();
  }
});

test('POST /replacement-accounts/:id/register returns REGISTER_FAILED with account on failure', async () => {
  const services = {
    ...successfulServices(),
    async registerAccount() {
      throw Object.assign(new Error('registration failed'), { code: 'REGISTER_FAILED' });
    },
  };
  const { app, replacementAccounts } = createTestContext(services);
  const created = replacementAccounts.createAccount({ email: 'user@example.com' });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/register`);

    assert.equal(response.response.status, 502);
    assert.equal(response.body.error, 'REGISTER_FAILED');
    assert.equal(response.body.account.id, created.id);
  } finally {
    await server.close();
  }
});

test('replacement account API can enable public verification code access', async () => {
  const { app, replacementAccounts } = createTestContext();
  const created = replacementAccounts.createAccount({
    email: 'jregkolpig+s3@gmail.com',
    public_code_enabled: 0,
  });
  const server = await startTestServer(app);

  try {
    const updated = await jsonRequest(server, 'PUT', `/replacement-accounts/${created.id}`, {
      email: created.email,
      public_code_enabled: 1,
      public_code_key: created.public_code_key,
    });

    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.account.public_code_enabled, 1);
    assert.equal(
      replacementAccounts.getPublicCodeAccountByKey(created.public_code_key).id,
      created.id,
    );
  } finally {
    await server.close();
  }
});

test('replacement account public code API toggles access without editing the full account', async () => {
  const { app, replacementAccounts } = createTestContext();
  const created = replacementAccounts.createAccount({
    email: 'jregkolpig+s3@gmail.com',
    status: 'pending',
  });
  const server = await startTestServer(app);

  try {
    const enabled = await jsonRequest(server, 'PATCH', `/replacement-accounts/${created.id}/public-code`, {
      enabled: true,
    });

    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.account.public_code_enabled, 1);
    assert.equal(enabled.body.account.public_code_key, created.public_code_key);
    assert.equal(
      replacementAccounts.getPublicCodeAccountByKey(created.public_code_key).id,
      created.id,
    );

    const disabled = await jsonRequest(server, 'PATCH', `/replacement-accounts/${created.id}/public-code`, {
      enabled: false,
    });

    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.body.account.public_code_enabled, 0);
    assert.equal(replacementAccounts.getPublicCodeAccountByKey(created.public_code_key), undefined);
  } finally {
    await server.close();
  }
});

test('replacement account failure APIs persist errors without incrementing replacement count', async () => {
  const failingServices = {
    async fetchSmsCode() {
      throw Object.assign(new Error('sms failed'), { code: 'SMS_FETCH_FAILED' });
    },
    async fetchJson() {
      throw Object.assign(new Error('json failed'), { code: 'JSON_FETCH_FAILED' });
    },
    async replaceAccount() {
      throw Object.assign(new Error('replace failed'), { code: 'REPLACE_FAILED' });
    },
  };
  const { app, replacementAccounts } = createTestContext(failingServices);
  const created = replacementAccounts.createAccount({
    email: 'user@example.com',
    sms_api: 'https://example.invalid/sms',
  });
  const server = await startTestServer(app);

  try {
    const sms = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/fetch-sms-code`);
    assert.equal(sms.response.status, 502);
    assert.equal(replacementAccounts.getAccount(created.id).sms_last_error, 'sms failed');

    const json = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/fetch-json`, {
      url: 'https://example.invalid/account.json',
    });
    assert.equal(json.response.status, 502);
    assert.equal(replacementAccounts.getAccount(created.id).last_error, '获取 JSON失败：json failed');

    const replace = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace`);
    assert.equal(replace.response.status, 502);
    assert.equal(replace.body.account.status, 'unregistered');
    assert.equal(replace.body.account.replacement_count, 0);
    assert.equal(replacementAccounts.getAccount(created.id).last_error, '补号失败：replace failed');
  } finally {
    await server.close();
  }
});

test('replacement failure keeps the business status and exposes the operation failure', async () => {
  const failingServices = {
    async replaceAccount() {
      throw Object.assign(new Error('replace failed'), { code: 'REPLACE_FAILED' });
    },
  };
  const { app, replacementAccounts } = createTestContext(failingServices);
  const created = replacementAccounts.createAccount({
    email: 'plus-active-replace-failed@example.com',
    status: 'plus_active',
  });
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace`);

    assert.equal(response.response.status, 502);
    assert.equal(response.body.account.status, 'plus_active');
    assert.equal(response.body.account.last_error, '补号失败：replace failed');
  } finally {
    await server.close();
  }
});

test('direct replacement API creates notification when fifth failure opens circuit breaker', async () => {
  const failingServices = {
    async fetchSmsCode() {
      return '123456';
    },
    async fetchJson() {
      return '{}';
    },
    async replaceAccount() {
      throw Object.assign(new Error('replace failed'), { code: 'REPLACE_FAILED' });
    },
  };
  const { app, adminNotifications, replacementAccounts } = createTestContext(failingServices);
  const created = replacementAccounts.createAccount({ email: 'user@example.com' });
  const server = await startTestServer(app);

  try {
    let lastResponse;
    for (let index = 0; index < 5; index += 1) {
      lastResponse = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace`);
    }

    assert.equal(lastResponse.response.status, 502);
    assert.equal(lastResponse.body.account.status, 'unregistered');
    assert.equal(adminNotifications.countUnread(), 1);
    assert.match(adminNotifications.listNotifications()[0].message, /user@example.com 连续自动补号失败 5 次/);
    assert.doesNotMatch(adminNotifications.listNotifications()[0].message, /banned/);
  } finally {
    await server.close();
  }
});

test('replacement account API resets circuit breaker fields', async () => {
  const { app, replacementAccounts } = createTestContext();
  const created = replacementAccounts.createAccount({ email: 'user@example.com' });
  for (let index = 0; index < 5; index += 1) {
    replacementAccounts.markReplacementStarted(created.id);
    replacementAccounts.markReplacementFailure(created.id, `automation failed ${index + 1}`, created.status, '补号');
  }
  const server = await startTestServer(app);

  try {
    const response = await jsonRequest(server, 'PATCH', `/replacement-accounts/${created.id}/circuit-breaker/reset`);

    assert.equal(response.response.status, 200);
    assert.equal(response.body.account.status, 'unregistered');
    assert.equal(response.body.account.status_note, '管理员手动解除熔断');
    assert.equal(response.body.account.consecutive_replace_failures, 0);
    assert.equal(response.body.account.circuit_breaker_at, null);
    assert.equal(response.body.account.circuit_breaker_reason, null);
  } finally {
    await server.close();
  }
});

test('replacement automation run APIs list, read logs, and stop active runs', async () => {
  const stopped = [];
  const services = {
    ...successfulServices(),
    stopReplacementRun(runId) {
      stopped.push(Number(runId));
      return { ok: true, runId: Number(runId) };
    },
  };
  const { app, replacementAutomationRuns, dir } = createTestContext(services);
  const logPath = join(dir, 'run.log');
  writeFileSync(logPath, 'child log line\n', 'utf8');
  const run = replacementAutomationRuns.createRun({
    account_id: 1,
    email: 'user@example.com',
    pid: 1234,
    log_path: logPath,
  });
  const server = await startTestServer(app);

  try {
    const listed = await jsonRequest(server, 'GET', '/replacement-automation-runs');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.runs.length, 1);
    assert.equal(listed.body.runs[0].id, run.id);

    const detail = await jsonRequest(server, 'GET', `/replacement-automation-runs/${run.id}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.run.email, 'user@example.com');
    assert.equal(detail.body.log, 'child log line\n');

    const stoppedResponse = await jsonRequest(server, 'POST', `/replacement-automation-runs/${run.id}/stop`);
    assert.equal(stoppedResponse.response.status, 200);
    assert.deepEqual(stopped, [run.id]);
  } finally {
    await server.close();
  }
});
