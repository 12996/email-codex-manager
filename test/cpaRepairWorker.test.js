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
