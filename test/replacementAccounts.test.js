import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDatabase } from '../src/db.js';
import { createReplacementAutomationRunRepository } from '../src/replacementAutomationRuns.js';
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
  const statusColumn = db.prepare(`PRAGMA table_info(replacement_accounts)`).all()
    .find((column) => column.name === 'status');

  assert.equal(table.name, 'replacement_accounts');
  assert.equal(index.name, 'idx_replacement_accounts_email_unique');
  assert.equal(statusColumn.dflt_value, "'for_sale'");
});

test('replacement automation run repository creates and finishes runs', () => {
  const repo = createReplacementAutomationRunRepository(createTestDb());

  const run = repo.createRun({
    account_id: 1,
    email: 'user@example.com',
    pid: 1234,
    log_path: 'data/automation-logs/run.log',
  });

  assert.equal(run.status, 'running');
  assert.equal(run.pid, 1234);
  assert.equal(repo.listRuns()[0].id, run.id);

  const finished = repo.markSucceeded(run.id, { exitCode: 0 });
  assert.equal(finished.status, 'succeeded');
  assert.equal(finished.exit_code, 0);
  assert.ok(finished.finished_at);
});

test('replacement automation run repository prunes old finished runs and log files', () => {
  const db = createTestDb();
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-logs-'));
  const repo = createReplacementAutomationRunRepository(db, { maxRuns: 2, logDir: dir });
  const firstLog = join(dir, 'first.log');
  const secondLog = join(dir, 'second.log');
  const thirdLog = join(dir, 'third.log');
  writeFileSync(firstLog, 'first\n', 'utf8');
  writeFileSync(secondLog, 'second\n', 'utf8');
  writeFileSync(thirdLog, 'third\n', 'utf8');

  const first = repo.createRun({ account_id: 1, email: 'first@example.com', log_path: firstLog });
  repo.markSucceeded(first.id);
  const second = repo.createRun({ account_id: 2, email: 'second@example.com', log_path: secondLog });
  repo.markSucceeded(second.id);
  const third = repo.createRun({ account_id: 3, email: 'third@example.com', log_path: thirdLog });

  assert.deepEqual(repo.listRuns().map((run) => run.id), [third.id, second.id]);
  assert.equal(repo.getRun(first.id), undefined);
  assert.equal(existsSync(firstLog), false);
  assert.equal(existsSync(secondLog), true);
  assert.equal(existsSync(thirdLog), true);
});

test('replacement automation run pruning keeps running runs even beyond max', () => {
  const db = createTestDb();
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-logs-'));
  const repo = createReplacementAutomationRunRepository(db, { maxRuns: 1, logDir: dir });
  const runningLog = join(dir, 'running.log');
  const finishedLog = join(dir, 'finished.log');
  writeFileSync(runningLog, 'running\n', 'utf8');
  writeFileSync(finishedLog, 'finished\n', 'utf8');

  const running = repo.createRun({ account_id: 1, email: 'running@example.com', log_path: runningLog });
  const finished = repo.createRun({ account_id: 2, email: 'finished@example.com', log_path: finishedLog });

  assert.deepEqual(repo.listRuns().map((run) => run.id), [finished.id, running.id]);
  assert.equal(existsSync(runningLog), true);
  assert.equal(existsSync(finishedLog), true);
});

test('createAccount trims email and defaults status to for_sale', () => {
  const repo = createTestRepository();

  const account = repo.createAccount({ email: ' User@Example.COM ', phone: '123' });

  assert.equal(account.email, 'User@Example.COM');
  assert.equal(account.phone, '123');
  assert.equal(account.status, 'for_sale');
  assert.equal(account.replacement_count, 0);
  assert.equal(account.public_code_enabled, 0);
  assert.match(account.public_code_key, /^vc_[A-Za-z0-9_-]{32}$/);
  assert.ok(account.activated_at);
  assert.equal(account.deleted_at, null);
  assert.ok(account.created_at);
  assert.ok(account.updated_at);
});

test('createAccount and updateAccount store external email code API URL', () => {
  const repo = createTestRepository();

  const account = repo.createAccount({
    email: 'email-code-api@example.com',
    email_code_api: ' https://example.invalid/code ',
  });

  assert.equal(account.email_code_api, 'https://example.invalid/code');

  const updated = repo.updateAccount(account.id, {
    email: 'email-code-api@example.com',
    email_code_api: ' https://example.invalid/next-code ',
  });

  assert.equal(updated.email_code_api, 'https://example.invalid/next-code');
});

test('createAccount and updateAccount store Codex 2FA secret', () => {
  const repo = createTestRepository();

  const account = repo.createAccount({
    email: 'codex-2fa@example.com',
    codex_2fa: ' JBSWY3DPEHPK3PXP ',
  });

  assert.equal(account.codex_2fa, 'JBSWY3DPEHPK3PXP');

  const updated = repo.updateAccount(account.id, {
    email: 'codex-2fa@example.com',
    '2fa-codex': ' NEXTSECRET ',
  });

  assert.equal(updated.codex_2fa, 'NEXTSECRET');
});

test('createAccount generates replacement password and updateAccount preserves it when omitted', () => {
  const repo = createTestRepository();

  const account = repo.createAccount({ email: 'password@example.com' });

  assert.match(account.password, /^[A-Za-z0-9!@#$%^&*_-]{12,16}$/);

  const preserved = repo.updateAccount(account.id, {
    email: 'password@example.com',
    phone: '456',
  });

  assert.equal(preserved.password, account.password);

  const updated = repo.updateAccount(account.id, {
    email: 'password@example.com',
    password: ' CustomPass12! ',
  });

  assert.equal(updated.password, 'CustomPass12!');
});

test('createAccount defaults activated_at to current time when omitted', () => {
  const repo = createTestRepository();
  const before = Date.now();

  const account = repo.createAccount({ email: 'time-default@example.com', activated_at: '' });

  const activatedAt = Date.parse(account.activated_at);
  assert.ok(Number.isFinite(activatedAt));
  assert.ok(activatedAt >= before - 1000);
  assert.ok(activatedAt <= Date.now() + 1000);
});

test('createAccount keeps explicit activated_at value', () => {
  const repo = createTestRepository();

  const account = repo.createAccount({
    email: 'time-explicit@example.com',
    activated_at: '2026-06-01T00:00:00.000Z',
  });

  assert.equal(account.activated_at, '2026-06-01T00:00:00.000Z');
});

test('createAccount and updateAccount store public verification code access fields', () => {
  const repo = createTestRepository();

  const account = repo.createAccount({
    email: 'user@example.com',
    public_code_enabled: true,
    public_code_key: ' vc_public_key ',
    remark: 'openai slot 1',
  });

  assert.equal(account.public_code_enabled, 1);
  assert.equal(account.public_code_key, 'vc_public_key');
  assert.equal(account.remark, 'openai slot 1');

  const updated = repo.updateAccount(account.id, {
    email: 'user@example.com',
    public_code_enabled: false,
    public_code_key: 'new_key',
  });

  assert.equal(updated.public_code_enabled, 0);
  assert.equal(updated.public_code_key, 'new_key');
});

test('createAccount automatically generates public verification key when omitted', () => {
  const repo = createTestRepository();

  const first = repo.createAccount({ email: 'first@example.com' });
  const second = repo.createAccount({ email: 'second@example.com' });

  assert.match(first.public_code_key, /^vc_[A-Za-z0-9_-]{32}$/);
  assert.match(second.public_code_key, /^vc_[A-Za-z0-9_-]{32}$/);
  assert.notEqual(first.public_code_key, second.public_code_key);
});

test('updateAccount generates public verification key when existing key is blank and public access is enabled', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({
    email: 'user@example.com',
    public_code_key: 'manual_key',
  });

  const updated = repo.updateAccount(account.id, {
    email: 'user@example.com',
    public_code_enabled: true,
    public_code_key: '',
  });

  assert.equal(updated.public_code_enabled, 1);
  assert.match(updated.public_code_key, /^vc_[A-Za-z0-9_-]{32}$/);
  assert.notEqual(updated.public_code_key, 'manual_key');
});

test('getPublicCodeAccountByKey returns only enabled non-deleted accounts', () => {
  const repo = createTestRepository();
  const enabled = repo.createAccount({
    email: 'enabled@example.com',
    public_code_enabled: true,
    public_code_key: 'enabled_key',
  });
  repo.createAccount({
    email: 'disabled@example.com',
    public_code_enabled: false,
    public_code_key: 'disabled_key',
  });
  const deleted = repo.createAccount({
    email: 'deleted@example.com',
    public_code_enabled: true,
    public_code_key: 'deleted_key',
  });

  repo.deleteAccount(deleted.id);

  assert.equal(repo.getPublicCodeAccountByKey('enabled_key').id, enabled.id);
  assert.equal(repo.getPublicCodeAccountByKey(' disabled_key '), undefined);
  assert.equal(repo.getPublicCodeAccountByKey('deleted_key'), undefined);
  assert.equal(repo.getPublicCodeAccountByKey(''), undefined);
});

test('getAccountByEmail finds non-deleted account case-insensitively', () => {
  const repo = createTestRepository();
  const created = repo.createAccount({ email: 'User@Example.COM' });

  assert.equal(repo.getAccountByEmail(' user@example.com ').id, created.id);
  repo.deleteAccount(created.id);
  assert.equal(repo.getAccountByEmail('user@example.com'), undefined);
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

test('listAccountsPage returns one replacement account page with pagination metadata', () => {
  const repo = createTestRepository();
  const first = repo.createAccount({ email: 'first@example.com' });
  const second = repo.createAccount({ email: 'second@example.com' });
  const third = repo.createAccount({ email: 'third@example.com' });

  const page = repo.listAccountsPage({ page: 2, pageSize: 1 });

  assert.deepEqual(page.accounts.map((account) => account.id), [second.id]);
  assert.deepEqual(page.pagination, {
    page: 2,
    pageSize: 1,
    total: 3,
    totalPages: 3,
  });
  assert.deepEqual(repo.listAccounts().map((account) => account.id), [third.id, second.id, first.id]);
});

test('listAccountsPage filters replacement accounts by status and keyword before pagination', () => {
  const repo = createTestRepository();
  const plusActive = repo.createAccount({
    email: 'alpha@example.com',
    phone: '111',
    remark: 'main alpha',
    status: 'plus_active',
  });
  const banned = repo.createAccount({
    email: 'beta@example.com',
    phone: '222',
    remark: 'needs replacement',
    status: 'banned',
  });

  const statusPage = repo.listAccountsPage({ status: 'banned' });
  const keywordPage = repo.listAccountsPage({ keyword: 'alpha' });

  assert.deepEqual(statusPage.accounts.map((account) => account.id), [banned.id]);
  assert.equal(statusPage.pagination.total, 1);
  assert.deepEqual(keywordPage.accounts.map((account) => account.id), [plusActive.id]);
  assert.equal(keywordPage.pagination.total, 1);
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
  assert.equal(updated.status, 'plus_active');
  assert.throws(
    () => repo.updateAccount(first.id, { email: 'second@example.com' }),
    /EMAIL_DUPLICATE/,
  );
});

test('legacy replacement account statuses normalize to the new status model', () => {
  const repo = createTestRepository();

  assert.equal(repo.createAccount({ email: 'pending@example.com', status: 'pending' }).status, 'for_sale');
  assert.equal(repo.createAccount({ email: 'active@example.com', status: 'active' }).status, 'plus_active');
  assert.equal(repo.createAccount({ email: 'replaced@example.com', status: 'replaced' }).status, 'cpa_mounted');

  const account = repo.createAccount({ email: 'updated@example.com' });
  assert.equal(repo.updateStatus(account.id, { status: 'pending' }).status, 'for_sale');
  assert.equal(repo.updateStatus(account.id, { status: 'active' }).status, 'plus_active');
  assert.equal(repo.updateStatus(account.id, { status: 'replaced' }).status, 'cpa_mounted');
});

test('updateStatus accepts manual business statuses and rejects replacing', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  for (const status of ['unregistered', 'pending_activation', 'plus_active', 'cpa_mounted', 'for_sale', 'sold', 'banned', 'failed']) {
    const updated = repo.updateStatus(account.id, {
      status,
      status_note: `manual ${status}`,
    });
    assert.equal(updated.status, status);
    assert.equal(updated.status_note, `manual ${status}`);
    assert.ok(updated.status_updated_at);
  }

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

  assert.equal(replaced.status, 'cpa_mounted');
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

test('markReplacementFailure tracks consecutive failures before circuit breaker threshold', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  let updated = account;
  for (let index = 0; index < 4; index += 1) {
    repo.markReplacementStarted(account.id);
    updated = repo.markReplacementFailure(account.id, `automation failed ${index + 1}`);
  }

  assert.equal(updated.status, 'failed');
  assert.equal(updated.consecutive_replace_failures, 4);
  assert.equal(updated.circuit_breaker_at, null);
  assert.equal(updated.circuit_breaker_reason, null);
});

test('markReplacementFailure marks failed and opens circuit breaker at fifth consecutive failure', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  let updated = account;
  for (let index = 0; index < 5; index += 1) {
    repo.markReplacementStarted(account.id);
    updated = repo.markReplacementFailure(account.id, `automation failed ${index + 1}`);
  }

  assert.equal(updated.status, 'failed');
  assert.equal(updated.consecutive_replace_failures, 5);
  assert.ok(updated.circuit_breaker_at);
  assert.match(updated.circuit_breaker_reason, /连续补号失败 5 次/);
  assert.equal(updated.last_error, 'automation failed 5');
});

test('markReplacementSuccess resets consecutive failure counter and circuit breaker fields', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  repo.markReplacementStarted(account.id);
  repo.markReplacementFailure(account.id, 'automation failed');
  repo.markReplacementStarted(account.id);
  const replaced = repo.markReplacementSuccess(account.id);

  assert.equal(replaced.status, 'cpa_mounted');
  assert.equal(replaced.consecutive_replace_failures, 0);
  assert.equal(replaced.circuit_breaker_at, null);
  assert.equal(replaced.circuit_breaker_reason, null);
});

test('resetCircuitBreaker clears breaker fields without changing status', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });
  for (let index = 0; index < 5; index += 1) {
    repo.markReplacementStarted(account.id);
    repo.markReplacementFailure(account.id, `automation failed ${index + 1}`);
  }

  const reset = repo.resetCircuitBreaker(account.id);

  assert.equal(reset.status, 'failed');
  assert.equal(reset.status_note, '管理员手动解除熔断');
  assert.equal(reset.consecutive_replace_failures, 0);
  assert.equal(reset.circuit_breaker_at, null);
  assert.equal(reset.circuit_breaker_reason, null);
  assert.ok(reset.status_updated_at);
});
