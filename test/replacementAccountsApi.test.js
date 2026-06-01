import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import signature from 'cookie-signature';

import { config } from '../src/config.js';
import { createDatabase } from '../src/db.js';
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

function createTestContext(replacementServices = successfulServices()) {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-service-'));
  const db = createDatabase(join(dir, 'test.db'));
  const replacementAccounts = createReplacementAccountRepository(db);
  const app = createApp({
    db,
    replacementAccounts,
    replacementServices,
    accounts: {
      listAccounts() {
        return [];
      },
      getAccountByGmailEmail() {
        return null;
      },
    },
  });

  return { app, replacementAccounts };
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
