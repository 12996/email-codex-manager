import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCpaRepairWorker } from '../src/cpaRepairWorker.js';

test('repair worker replaces account, uploads CPA JSON, and verifies health', async () => {
  const events = [];
  const worker = createCpaRepairWorker({
    cpaOutputDir: 'src/auto/product_files/cpa',
    readFileImpl(path, encoding) {
      assert.equal(path, 'src\\auto\\product_files\\cpa\\user@example.com.json');
      assert.equal(encoding, 'utf8');
      return '{"type":"openai"}';
    },
    cpaClient: {
      async uploadAuthFile(input) {
        events.push(['upload', input.name, input.payload]);
        return { status: 'ok' };
      },
      async listAuthFiles() {
        return [{ provider: 'codex', email: 'user@example.com', status: 'ready', status_message: 'ok' }];
      },
    },
    replacementAccounts: {
      markReplacementStarted(id) { events.push(['started', id]); },
      markReplacementSuccess(id) { events.push(['success', id]); return { id, status: 'cpa_mounted' }; },
      markReplacementFailure() { throw new Error('not expected'); },
    },
    replacementServices: {
      async replaceAccount(account) {
        events.push(['replace', account.id]);
        return { ok: true };
      },
    },
  });

  const result = await worker.repair({ account: { id: 7, email: 'user@example.com' } });

  assert.equal(result.ok, true);
  assert.deepEqual(events, [
    ['started', 7],
    ['replace', 7],
    ['upload', 'codex-user@example.com-plus.json', '{"type":"openai"}'],
    ['success', 7],
  ]);
});

test('repair worker can run 2FA replacement before uploading CPA JSON', async () => {
  const events = [];
  const worker = createCpaRepairWorker({
    cpaOutputDir: 'src/auto/product_files/cpa',
    readFileImpl(path, encoding) {
      assert.equal(path, 'src\\auto\\product_files\\cpa\\user@example.com.json');
      assert.equal(encoding, 'utf8');
      return '{"type":"openai"}';
    },
    cpaClient: {
      async uploadAuthFile(input) {
        events.push(['upload', input.name, input.payload]);
        return { status: 'ok' };
      },
      async listAuthFiles() {
        return [{ provider: 'codex', email: 'user@example.com', status: 'active', status_message: '' }];
      },
    },
    replacementAccounts: {
      markReplacementStarted(id) { events.push(['started', id]); },
      markReplacementSuccess(id) { events.push(['success', id]); return { id, status: 'cpa_mounted' }; },
      markReplacementFailure() { throw new Error('not expected'); },
    },
    replacementServices: {
      async replaceAccount() {
        events.push('replace');
        throw new Error('plain replacement should not run');
      },
      async replaceAccountWith2FA(account, options) {
        events.push(['replace-2fa', account.id, options.cpaTriggerDetails]);
        return { ok: true, run: { id: 808 } };
      },
    },
  });

  const result = await worker.repair({
    account: { id: 7, email: 'user@example.com' },
    mode: '2fa',
    credential: { provider: 'codex', email: 'user@example.com', status: 'error' },
    reasons: ['auth_expired'],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(events, [
    ['started', 7],
    ['replace-2fa', 7, 'provider=codex email=user@example.com status=error unavailable=false disabled=false reasons=auth_expired status_message='],
    ['upload', 'codex-user@example.com-plus.json', '{"type":"openai"}'],
    ['success', 7],
  ]);
});

test('repair worker appends CPA upload steps to replacement run log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cpa-repair-worker-'));
  const logPath = join(dir, 'replacement.log');
  const worker = createCpaRepairWorker({
    cpaOutputDir: 'src/auto/product_files/cpa',
    readFileImpl() {
      return '{"type":"openai"}';
    },
    cpaClient: {
      async uploadAuthFile() {
        return { status: 'ok' };
      },
      async listAuthFiles() {
        return [{ provider: 'codex', email: 'user@example.com', status: 'active', status_message: '' }];
      },
    },
    replacementAccounts: {
      markReplacementStarted() {},
      markReplacementSuccess(id) { return { id, status: 'cpa_mounted' }; },
      markReplacementFailure() { throw new Error('not expected'); },
    },
    replacementServices: {
      async replaceAccount() {
        return { ok: true, run: { log_path: logPath } };
      },
    },
  });

  const result = await worker.repair({ account: { id: 7, email: 'user@example.com' } });
  const log = readFileSync(logPath, 'utf8');

  assert.equal(result.ok, true);
  assert.match(log, /step=cpa-read-file action=读取本地 CPA JSON/);
  assert.match(log, /step=cpa-upload action=上传 CPA auth file/);
  assert.match(log, /step=cpa-verify action=复查 CPA 凭证健康/);
  assert.match(log, /step=cpa-success action=CPA repair 完成/);
});

test('repair worker appends CPA trigger reason to replacement run log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cpa-repair-worker-'));
  const logPath = join(dir, 'replacement.log');
  const worker = createCpaRepairWorker({
    cpaOutputDir: 'src/auto/product_files/cpa',
    readFileImpl() {
      return '{"type":"openai"}';
    },
    cpaClient: {
      async uploadAuthFile() {
        return { status: 'ok' };
      },
      async listAuthFiles() {
        return [{ provider: 'codex', email: 'user@example.com', status: 'active', status_message: '' }];
      },
    },
    replacementAccounts: {
      markReplacementStarted() {},
      markReplacementSuccess(id) { return { id, status: 'cpa_mounted' }; },
      markReplacementFailure() { throw new Error('not expected'); },
    },
    replacementServices: {
      async replaceAccount() {
        return { ok: true, run: { log_path: logPath } };
      },
    },
  });

  const result = await worker.repair({
    account: { id: 7, email: 'user@example.com' },
    credential: {
      provider: 'codex',
      email: 'user@example.com',
      status: 'error',
      unavailable: true,
      disabled: false,
      status_message: '{"error":{"type":"authentication_error","code":"auth_unavailable","message":"Your authentication token has been invalidated."}}',
    },
    reasons: ['unavailable', 'status:error', 'message:auth_expired'],
  });
  const log = readFileSync(logPath, 'utf8');

  assert.equal(result.ok, true);
  assert.match(log, /step=cpa-trigger action=记录 CPA 自动补号触发原因/);
  assert.match(log, /provider=codex/);
  assert.match(log, /email=user@example.com/);
  assert.match(log, /status=error/);
  assert.match(log, /unavailable=true/);
  assert.match(log, /disabled=false/);
  assert.match(log, /reasons=unavailable,status:error,message:auth_expired/);
  assert.match(log, /status_message=\{"error":\{"type":"authentication_error","code":"auth_unavailable","message":"Your authentication token has been invalidated\."\}\}/);
});

test('repair worker treats email healthy when any matching CPA credential is healthy', async () => {
  const events = [];
  const worker = createCpaRepairWorker({
    cpaOutputDir: 'src/auto/product_files/cpa',
    readFileImpl() {
      return '{"type":"openai"}';
    },
    cpaClient: {
      async uploadAuthFile(input) {
        events.push(['upload', input.name]);
        return { status: 'ok' };
      },
      async listAuthFiles() {
        return [
          {
            provider: 'codex',
            email: 'user@example.com',
            status: 'error',
            unavailable: true,
            status_message: '{"error":{"type":"authentication_error","code":"auth_unavailable"}}',
          },
          { provider: 'codex', email: 'user@example.com', status: 'active', status_message: '' },
        ];
      },
    },
    replacementAccounts: {
      markReplacementStarted(id) { events.push(['started', id]); },
      markReplacementSuccess(id) { events.push(['success', id]); return { id, status: 'cpa_mounted' }; },
      markReplacementFailure() { throw new Error('not expected'); },
    },
    replacementServices: {
      async replaceAccount(account) {
        events.push(['replace', account.id]);
        return { ok: true };
      },
    },
  });

  const result = await worker.repair({ account: { id: 7, email: 'user@example.com' } });

  assert.equal(result.ok, true);
  assert.deepEqual(events, [
    ['started', 7],
    ['replace', 7],
    ['upload', 'codex-user@example.com-plus.json'],
    ['success', 7],
  ]);
});

test('repair worker creates notification when replacement failure triggers circuit breaker', async () => {
  const notifications = [];
  const worker = createCpaRepairWorker({
    cpaOutputDir: 'src/auto/product_files/cpa',
    cpaClient: {},
    adminNotifications: {
      createNotification(input) {
        notifications.push(input);
      },
    },
    replacementAccounts: {
      markReplacementStarted() {},
      markReplacementSuccess() { throw new Error('not expected'); },
      markReplacementFailure(id, message) {
        assert.equal(id, 7);
        assert.equal(message, 'automation failed');
        return {
          id,
          email: 'user@example.com',
          status: 'failed',
          consecutive_replace_failures: 5,
          circuit_breaker_at: '2026-06-07T00:00:00.000Z',
          circuit_breaker_reason: '连续补号失败 5 次，自动熔断',
        };
      },
    },
    replacementServices: {
      async replaceAccount() {
        throw new Error('automation failed');
      },
    },
  });

  const result = await worker.repair({ account: { id: 7, email: 'user@example.com' } });

  assert.equal(result.ok, false);
  assert.equal(result.account.status, 'failed');
  assert.deepEqual(notifications, [{
    type: 'cpa_repair_circuit_breaker',
    severity: 'critical',
    title: '账号已触发补号熔断',
    message: 'user@example.com 连续自动补号失败 5 次，账号已自动熔断，不再进入 CPA 自动补号队列。',
    account_id: 7,
    email: 'user@example.com',
  }]);
});
