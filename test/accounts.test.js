import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { createDatabase } from '../src/db.js';
import { createAccountRepository } from '../src/accounts.js';

function createTestRepository() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-service-'));
  const db = createDatabase(join(dir, 'test.db'));
  return createAccountRepository(db);
}

test('createAccount requires Gmail email, password, 2FA, and app password', () => {
  const accounts = createTestRepository();

  assert.throws(
    () => accounts.createAccount({ gmail_email: 'user@gmail.com' }),
    /gmail_password is required/,
  );
  assert.throws(
    () => accounts.createAccount({
      gmail_email: 'user@gmail.com',
      gmail_password: 'password',
      gmail_2fa: '123456',
    }),
    /gmail_app_password is required/,
  );
});

test('listAccounts returns created account rows', () => {
  const accounts = createTestRepository();

  const created = accounts.createAccount({
    display_name: 'Main',
    gmail_email: 'user@gmail.com',
    gmail_password: 'password',
    gmail_2fa: '123456',
    gmail_app_password: 'abcdefghijklmnop',
  });

  const rows = accounts.listAccounts();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, created.id);
  assert.equal(rows[0].display_name, 'Main');
  assert.equal(rows[0].gmail_email, 'user@gmail.com');
  assert.equal(rows[0].gmail_password, 'password');
  assert.equal(rows[0].gmail_2fa, '123456');
  assert.equal(rows[0].gmail_app_password, 'abcdefghijklmnop');
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].last_fetch_status, 'idle');
});

test('getAccountByGmailEmail finds main Gmail account case-insensitively', () => {
  const accounts = createTestRepository();

  const created = accounts.createAccount({
    display_name: 'Main',
    gmail_email: 'JregKolPig@gmail.com',
    gmail_password: 'password',
    gmail_2fa: '123456',
    gmail_app_password: 'abcdefghijklmnop',
  });

  const found = accounts.getAccountByGmailEmail('jregkolpig@gmail.com');

  assert.equal(found.id, created.id);
  assert.equal(found.gmail_email, 'JregKolPig@gmail.com');
});

test('markFetchSuccess and markFetchFailure persist account status', () => {
  const accounts = createTestRepository();
  const created = accounts.createAccount({
    gmail_email: 'user@gmail.com',
    gmail_password: 'password',
    gmail_2fa: '123456',
    gmail_app_password: 'abcdefghijklmnop',
  });

  accounts.markFetchFailure(created.id, 'auth_failed', 'Invalid credentials');
  const failed = accounts.getAccount(created.id);
  assert.equal(failed.status, 'auth_failed');
  assert.equal(failed.last_fetch_status, 'failed');
  assert.equal(failed.last_error, 'Invalid credentials');
  assert.ok(failed.last_fetch_at);

  accounts.markFetchSuccess(created.id);
  const successful = accounts.getAccount(created.id);
  assert.equal(successful.status, 'active');
  assert.equal(successful.last_fetch_status, 'success');
  assert.equal(successful.last_error, null);
  assert.ok(successful.last_fetch_at);
});
