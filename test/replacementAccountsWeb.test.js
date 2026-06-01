import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import signature from 'cookie-signature';

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

function createTestApp() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-service-'));
  return createApp({
    db: createDatabase(join(dir, 'test.db')),
    accounts: {
      listAccounts() {
        return [];
      },
      getAccountByGmailEmail() {
        return null;
      },
    },
  });
}

test('GET /replacement-ui requires login and serves the replacement account frontend', async () => {
  const app = createTestApp();
  const server = await startTestServer(app);

  try {
    const unauthenticated = await fetch(`${server.baseUrl}/replacement-ui`, {
      redirect: 'manual',
    });
    assert.equal(unauthenticated.status, 302);
    assert.equal(unauthenticated.headers.get('location'), '/login');

    const authenticated = await fetch(`${server.baseUrl}/replacement-ui`, {
      headers: { cookie: authCookie() },
    });
    const html = await authenticated.text();

    assert.equal(authenticated.status, 200);
    assert.match(html, /补号列表/);
    assert.match(html, /一键补号/);
    assert.match(html, /新增账号/);
    assert.match(html, /web\/styles.css/);
    assert.match(html, /web\/app.js/);
  } finally {
    await server.close();
  }
});

test('web frontend calls replacement account APIs and labels screenshot actions correctly', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');

  for (const endpoint of [
    '/replacement-accounts',
    '/fetch-sms-code',
    '/fetch-json',
    '/replace',
    '/status',
  ]) {
    assert.match(appJs, new RegExp(endpoint.replaceAll('/', '\\/')));
  }

  assert.match(html, /一键补号/);
  assert.match(html, /新增账号/);
  assert.match(appJs, /获取验证码/);
  assert.match(appJs, /获取 JSON/);
  assert.match(appJs, /执行补号/);
  assert.match(appJs, /状态设置/);
  assert.match(appJs, /删除账号/);
});
