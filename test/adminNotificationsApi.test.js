import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import signature from 'cookie-signature';

import { config } from '../src/config.js';
import { createAdminNotificationRepository } from '../src/adminNotifications.js';
import { createDatabase } from '../src/db.js';
import { createReplacementAccountRepository } from '../src/replacementAccounts.js';
import { createReplacementAutomationRunRepository } from '../src/replacementAutomationRuns.js';
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

function createTestContext() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-notifications-api-'));
  const db = createDatabase(join(dir, 'test.db'));
  const adminNotifications = createAdminNotificationRepository(db);
  const app = createApp({
    db,
    adminNotifications,
    replacementAccounts: createReplacementAccountRepository(db),
    replacementAutomationRuns: createReplacementAutomationRunRepository(db),
    accounts: {
      listAccounts() {
        return [];
      },
      getAccountByGmailEmail() {
        return null;
      },
    },
  });
  return { app, adminNotifications };
}

async function jsonRequest(server, method, path) {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: authCookie(),
    },
  });
  return {
    response,
    body: await response.json(),
  };
}

test('admin notification API lists unread count and marks notification read', async () => {
  const { app, adminNotifications } = createTestContext();
  const notification = adminNotifications.createNotification({
    title: '账号已触发补号熔断',
    message: 'user@example.com 连续自动补号失败 5 次',
    account_id: 7,
    email: 'user@example.com',
  });
  const server = await startTestServer(app);

  try {
    const listed = await jsonRequest(server, 'GET', '/admin-notifications?limit=5');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.unreadCount, 1);
    assert.deepEqual(listed.body.notifications.map((item) => item.id), [notification.id]);

    const read = await jsonRequest(server, 'PATCH', `/admin-notifications/${notification.id}/read`);
    assert.equal(read.response.status, 200);
    assert.ok(read.body.notification.read_at);

    const listedAgain = await jsonRequest(server, 'GET', '/admin-notifications?limit=5');
    assert.equal(listedAgain.body.unreadCount, 0);
  } finally {
    await server.close();
  }
});
