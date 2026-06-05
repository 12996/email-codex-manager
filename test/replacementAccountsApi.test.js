import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import signature from 'cookie-signature';

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

function createTestContext(replacementServices = successfulServices(), overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-service-'));
  const db = createDatabase(join(dir, 'test.db'));
  const replacementAccounts = createReplacementAccountRepository(db);
  const replacementAutomationRuns = createReplacementAutomationRunRepository(db);
  const app = createApp({
    db,
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

  return { app, replacementAccounts, replacementAutomationRuns, dir };
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

test('replacement account CRUD API creates, lists, reads, updates, and soft deletes accounts', async () => {
  const { app } = createTestContext();
  const server = await startTestServer(app);

  try {
    const created = await jsonRequest(server, 'POST', '/replacement-accounts', {
      email: ' User@Example.COM ',
      phone: '123',
      status: 'pending',
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.ok, true);
    assert.equal(created.body.account.email, 'User@Example.COM');
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
      status: 'active',
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.account.email, 'updated@example.com');
    assert.equal(updated.body.account.phone, '456');
    assert.equal(updated.body.account.status, 'active');

    const deleted = await jsonRequest(server, 'DELETE', `/replacement-accounts/${created.body.account.id}`);
    assert.equal(deleted.response.status, 200);
    assert.deepEqual(deleted.body, { ok: true });

    const emptyList = await jsonRequest(server, 'GET', '/replacement-accounts');
    assert.deepEqual(emptyList.body.accounts, []);
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
    assert.equal(replaced.body.account.status, 'replaced');
    assert.equal(replaced.body.account.replacement_count, 1);
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
          status: 'replaced',
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
    assert.equal(response.body.account.status, 'replaced');
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
      return { ok: true, run: { id: 88, status: 'running' } };
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
    assert.deepEqual(response.body.run, { id: 88, status: 'running' });
    assert.deepEqual(events, [['register', created.id, 'user@example.com']]);
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
    assert.equal(replacementAccounts.getAccount(created.id).last_error, 'json failed');

    const replace = await jsonRequest(server, 'POST', `/replacement-accounts/${created.id}/replace`);
    assert.equal(replace.response.status, 502);
    assert.equal(replace.body.account.status, 'failed');
    assert.equal(replace.body.account.replacement_count, 0);
    assert.equal(replacementAccounts.getAccount(created.id).last_error, 'replace failed');
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
