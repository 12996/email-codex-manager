import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAdminNotificationRepository } from '../src/adminNotifications.js';
import { createDatabase } from '../src/db.js';

function createTestRepository() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-notifications-'));
  return createAdminNotificationRepository(createDatabase(join(dir, 'test.db')));
}

test('admin notification repository creates unread notifications and counts them', () => {
  const repo = createTestRepository();

  const notification = repo.createNotification({
    type: 'cpa_repair_circuit_breaker',
    severity: 'critical',
    title: '账号已触发补号熔断',
    message: 'user@example.com 连续自动补号失败 5 次',
    account_id: 7,
    email: 'user@example.com',
  });

  assert.equal(notification.type, 'cpa_repair_circuit_breaker');
  assert.equal(notification.severity, 'critical');
  assert.equal(notification.account_id, 7);
  assert.equal(notification.email, 'user@example.com');
  assert.equal(notification.read_at, null);
  assert.equal(repo.countUnread(), 1);
  assert.deepEqual(repo.listNotifications({ limit: 5 }).map((item) => item.id), [notification.id]);
});

test('admin notification repository marks one notification read', () => {
  const repo = createTestRepository();
  const first = repo.createNotification({ title: 'first', message: 'first message' });
  repo.createNotification({ title: 'second', message: 'second message' });

  const read = repo.markRead(first.id);

  assert.equal(read.id, first.id);
  assert.ok(read.read_at);
  assert.equal(repo.countUnread(), 1);
});
