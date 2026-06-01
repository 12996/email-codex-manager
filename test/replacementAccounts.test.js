import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDatabase } from '../src/db.js';
import { createReplacementAccountRepository } from '../src/replacementAccounts.js';

function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-service-'));
  return createDatabase(join(dir, 'test.db'));
}

function createTestRepository() {
  return createReplacementAccountRepository(createTestDb());
}

test('initializeSchema creates replacement_accounts table and email unique index', () => {
  const db = createTestDb();

  const table = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'replacement_accounts'
  `).get();
  const index = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_replacement_accounts_email_unique'
  `).get();

  assert.equal(table.name, 'replacement_accounts');
  assert.equal(index.name, 'idx_replacement_accounts_email_unique');
});

test('createAccount trims email and defaults status to pending', () => {
  const repo = createTestRepository();

  const account = repo.createAccount({ email: ' User@Example.COM ', phone: '123' });

  assert.equal(account.email, 'User@Example.COM');
  assert.equal(account.phone, '123');
  assert.equal(account.status, 'pending');
  assert.equal(account.replacement_count, 0);
  assert.equal(account.deleted_at, null);
  assert.ok(account.created_at);
  assert.ok(account.updated_at);
});

test('createAccount rejects duplicate email case-insensitively', () => {
  const repo = createTestRepository();

  repo.createAccount({ email: 'user@example.com' });

  assert.throws(
    () => repo.createAccount({ email: ' USER@example.com ' }),
    /EMAIL_DUPLICATE/,
  );
});

test('createAccount rejects duplicate email even after soft delete', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  repo.deleteAccount(account.id);

  assert.throws(
    () => repo.createAccount({ email: ' USER@example.com ' }),
    /EMAIL_DUPLICATE/,
  );
});

test('listAccounts and getAccount exclude soft-deleted accounts', () => {
  const repo = createTestRepository();
  const deleted = repo.createAccount({ email: 'deleted@example.com' });
  const active = repo.createAccount({ email: 'active@example.com' });

  repo.deleteAccount(deleted.id);

  assert.deepEqual(repo.listAccounts().map((account) => account.id), [active.id]);
  assert.equal(repo.getAccount(deleted.id), undefined);
});

test('updateAccount enforces unique email excluding current row', () => {
  const repo = createTestRepository();
  const first = repo.createAccount({ email: 'first@example.com' });
  repo.createAccount({ email: 'second@example.com' });

  const updated = repo.updateAccount(first.id, {
    email: ' FIRST@example.com ',
    phone: '555',
    status: 'active',
  });

  assert.equal(updated.email, 'FIRST@example.com');
  assert.equal(updated.phone, '555');
  assert.equal(updated.status, 'active');
  assert.throws(
    () => repo.updateAccount(first.id, { email: 'second@example.com' }),
    /EMAIL_DUPLICATE/,
  );
});

test('updateStatus updates manual status and rejects replacing', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  const updated = repo.updateStatus(account.id, {
    status: 'banned',
    status_note: 'manual mark',
  });

  assert.equal(updated.status, 'banned');
  assert.equal(updated.status_note, 'manual mark');
  assert.ok(updated.status_updated_at);
  assert.throws(
    () => repo.updateStatus(account.id, { status: 'replacing' }),
    /STATUS_INVALID/,
  );
});

test('recordSmsFailure stores sms_last_error without storing code', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  const updated = repo.recordSmsFailure(account.id, 'SMS failed 123456');

  assert.equal(updated.sms_last_error, 'SMS failed 123456');
  assert.equal(Object.hasOwn(updated, 'sms_code'), false);
});

test('recordJsonFetchSuccess stores JSON payload and clears last_error', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  repo.recordJsonFetchFailure(account.id, 'previous error');
  const updated = repo.recordJsonFetchSuccess(account.id, '{"ok":true}');

  assert.equal(updated.json_payload, '{"ok":true}');
  assert.equal(updated.last_error, null);
  assert.ok(updated.json_fetched_at);
});

test('markReplacementSuccess increments replacement_count', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  repo.markReplacementStarted(account.id);
  const replaced = repo.markReplacementSuccess(account.id);

  assert.equal(replaced.status, 'replaced');
  assert.equal(replaced.replacement_count, 1);
  assert.equal(replaced.last_error, null);
  assert.ok(replaced.last_replace_at);
});

test('markReplacementFailure does not increment replacement_count', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  repo.markReplacementStarted(account.id);
  const failed = repo.markReplacementFailure(account.id, 'automation failed');

  assert.equal(failed.status, 'failed');
  assert.equal(failed.replacement_count, 0);
  assert.equal(failed.last_error, 'automation failed');
});
