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
      markReplacementSuccess(id) { events.push(['success', id]); return { id, status: 'replaced' }; },
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
    ['upload', 'user@example.com.json', '{"type":"openai"}'],
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
      markReplacementSuccess(id) { return { id, status: 'replaced' }; },
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
          status: 'banned',
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
  assert.equal(result.account.status, 'banned');
  assert.deepEqual(notifications, [{
    type: 'cpa_repair_circuit_breaker',
    severity: 'critical',
    title: '账号已触发补号熔断',
    message: 'user@example.com 连续自动补号失败 5 次，已自动标记为 banned，不再进入 CPA 自动补号队列。',
    account_id: 7,
    email: 'user@example.com',
  }]);
});
