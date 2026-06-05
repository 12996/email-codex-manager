import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import signature from 'cookie-signature';

import { createAccountRepository } from '../src/accounts.js';
import { config } from '../src/config.js';
import { createDatabase } from '../src/db.js';
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

function createTestContext(mailService = successfulMailService()) {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-service-'));
  const db = createDatabase(join(dir, 'test.db'));
  const accounts = createAccountRepository(db);
  const app = createApp({ db, accounts, mailService });
  return { app, accounts };
}

function successfulMailService() {
  return {
    async testConnection() {},
    async fetchMessages() {
      return [{
        subject: 'Verification',
        from: 'Sender <sender@example.com>',
        date: '2026-06-01T10:00:00.000Z',
        preview: 'Your code is 123456',
        sourceMailbox: 'INBOX',
      }];
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

function accountInput(overrides = {}) {
  return {
    display_name: 'Main',
    gmail_email: 'user@gmail.com',
    gmail_password: 'password',
    gmail_2fa: '123456',
    gmail_app_password: 'abcdefghijklmnop',
    ...overrides,
  };
}

test('GET /accounts requires login and serves web accounts frontend', async () => {
  const { app } = createTestContext();
  const server = await startTestServer(app);

  try {
    const unauthenticated = await fetch(`${server.baseUrl}/accounts`, {
      redirect: 'manual',
    });
    assert.equal(unauthenticated.status, 302);
    assert.equal(unauthenticated.headers.get('location'), '/login');

    const authenticated = await fetch(`${server.baseUrl}/accounts`, {
      headers: { cookie: authCookie() },
    });
    const html = await authenticated.text();

    assert.equal(authenticated.status, 200);
    assert.match(html, /邮箱账号/);
    assert.match(html, /账号管理系统/);
    assert.match(html, /web\/styles.css/);
    assert.match(html, /web\/accounts.js/);
  } finally {
    await server.close();
  }
});

test('accounts web frontend uses JSON account APIs and current visual labels', () => {
  const htmlPath = join(process.cwd(), 'web', 'accounts.html');
  const jsPath = join(process.cwd(), 'web', 'accounts.js');
  const html = readFileSync(htmlPath, 'utf8');
  const appJs = readFileSync(jsPath, 'utf8');

  assert.match(html, /邮箱账号/);
  assert.match(html, /新增邮箱/);
  assert.match(appJs, /\/api\/accounts/);
  assert.match(appJs, /获取邮件/);
  assert.match(appJs, /测试连接/);
  assert.match(appJs, /编辑/);
  assert.match(appJs, /删除/);
});

test('accounts web frontend preserves mail fetch controls and immediate feedback', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'accounts.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'accounts.html'), 'utf8');
  const sidebar = html.match(/<aside class="sidebar">[\s\S]*?<\/aside>/)?.[0] || '';

  assert.match(html, /Gmail 密码/);
  assert.match(html, /2FA/);
  assert.match(html, /App Password/);
  assert.doesNotMatch(sidebar, /IMAP 设置/);
  assert.doesNotMatch(sidebar, /邮件结果/);
  assert.doesNotMatch(sidebar, /系统设置/);
  assert.match(html, /账号详情/);
  assert.match(appJs, /gmail_password/);
  assert.match(appJs, /gmail_2fa/);
  assert.match(appJs, /gmail_app_password/);
  assert.match(appJs, /openDetailDialog/);
  assert.match(appJs, /formatErrorSummary/);
  assert.match(appJs, /data-read-location/);
  assert.match(appJs, /data-fetch-limit/);
  assert.match(appJs, /收件箱/);
  assert.match(appJs, /全部邮件/);
  assert.match(appJs, /垃圾箱/);
  assert.match(appJs, /value="5"/);
  assert.match(appJs, /limit = Number\(.*\|\| 5\)/s);
  assert.match(appJs, /mail-result-scroll/);
  assert.match(appJs, /mail-row-summary/);
  assert.match(appJs, /正在获取邮件/);
  assert.match(appJs, /正在测试连接/);
});

test('accounts web frontend exposes real pagination controls and query params', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'accounts.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'accounts.html'), 'utf8');

  for (const id of ['pageSizeSelect', 'prevPageButton', 'nextPageButton', 'pageText']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(appJs, new RegExp(`#${id}`));
  }

  assert.match(appJs, /URLSearchParams/);
  assert.match(appJs, /page/);
  assert.match(appJs, /pageSize/);
  assert.match(appJs, /keyword/);
  assert.match(appJs, /status/);
});

test('accounts web frontend includes mail detail dialog used by fetched mail rows', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'accounts.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'accounts.html'), 'utf8');

  for (const id of [
    'mailDetailDialog',
    'mailDetailSubject',
    'mailDetailSenderName',
    'mailDetailSenderEmail',
    'mailDetailDate',
    'mailDetailSource',
    'mailDetailBody',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(appJs, new RegExp(`#${id}`));
  }
});

test('accounts JSON API returns paginated accounts with filters', async () => {
  const { app, accounts } = createTestContext();
  const first = accounts.createAccount(accountInput({ gmail_email: 'first@gmail.com', display_name: 'First' }));
  const second = accounts.createAccount(accountInput({ gmail_email: 'second@gmail.com', display_name: 'Second' }));
  accounts.createAccount(accountInput({ gmail_email: 'third@gmail.com', display_name: 'Third' }));
  accounts.markFetchFailure(first.id, 'auth_failed', 'Invalid first credentials');
  const server = await startTestServer(app);

  try {
    const page = await jsonRequest(server, 'GET', '/api/accounts?page=2&pageSize=1&keyword=gmail.com');
    assert.equal(page.response.status, 200);
    assert.deepEqual(page.body.accounts.map((account) => account.id), [second.id]);
    assert.deepEqual(page.body.pagination, {
      page: 2,
      pageSize: 1,
      total: 3,
      totalPages: 3,
    });

    const filtered = await jsonRequest(server, 'GET', '/api/accounts?status=auth_failed&keyword=first');
    assert.deepEqual(filtered.body.accounts.map((account) => account.id), [first.id]);
    assert.equal(filtered.body.pagination.total, 1);
  } finally {
    await server.close();
  }
});

test('accounts JSON API creates, lists, updates, tests, fetches, and deletes accounts', async () => {
  const calls = [];
  const { app } = createTestContext({
    async testConnection(account) {
      calls.push(['testConnection', account.gmail_email]);
    },
    async fetchMessages(account, options) {
      calls.push(['fetchMessages', account.gmail_email, options]);
      return [{ subject: 'Code', preview: '123456', from: 'Sender', date: '2026-06-01T10:00:00.000Z' }];
    },
  });
  const server = await startTestServer(app);

  try {
    const created = await jsonRequest(server, 'POST', '/api/accounts', accountInput());
    assert.equal(created.response.status, 201);
    assert.equal(created.body.account.gmail_email, 'user@gmail.com');

    const listed = await jsonRequest(server, 'GET', '/api/accounts');
    assert.equal(listed.response.status, 200);
    assert.deepEqual(listed.body.accounts.map((account) => account.id), [created.body.account.id]);

    const updated = await jsonRequest(server, 'PUT', `/api/accounts/${created.body.account.id}`, accountInput({
      display_name: 'Updated',
      gmail_email: 'updated@gmail.com',
    }));
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.account.display_name, 'Updated');

    const tested = await jsonRequest(server, 'POST', `/api/accounts/${created.body.account.id}/test`);
    assert.equal(tested.response.status, 200);
    assert.equal(tested.body.account.last_fetch_status, 'success');

    const fetched = await jsonRequest(server, 'POST', `/api/accounts/${created.body.account.id}/fetch`, {
      readLocation: 'inbox',
      limit: 10,
    });
    assert.equal(fetched.response.status, 200);
    assert.equal(fetched.body.messages.length, 1);
    assert.deepEqual(calls, [
      ['testConnection', 'updated@gmail.com'],
      ['fetchMessages', 'updated@gmail.com', { readLocation: 'inbox', limit: 10 }],
    ]);

    const deleted = await jsonRequest(server, 'DELETE', `/api/accounts/${created.body.account.id}`);
    assert.equal(deleted.response.status, 200);
    assert.deepEqual(deleted.body, { ok: true });
    const empty = await jsonRequest(server, 'GET', '/api/accounts');
    assert.deepEqual(empty.body.accounts, []);
  } finally {
    await server.close();
  }
});
