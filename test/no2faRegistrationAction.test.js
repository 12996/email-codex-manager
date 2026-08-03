import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createProtocolRegistrationQueue } from '../src/protocolRegistrationQueue.js';
import { createReplacementServices, createRoxyChildProcessAutomation } from '../src/replacementServices.js';
import { createDatabase } from '../src/db.js';
import { createReplacementAccountRepository } from '../src/replacementAccounts.js';
import { createApp } from '../src/server.js';
import { config } from '../src/config.js';

test('no2fa registration is exposed through the replacement automation service', async () => {
  const calls = [];
  const services = createReplacementServices({
    replacementAutomation: {
      async registerNo2faAccount(account, options) {
        calls.push({ account, options });
        return { ok: true };
      },
    },
  });

  assert.equal(typeof services.registerNo2faAccount, 'function');
  const result = await services.registerNo2faAccount({ id: 9, email: 'new.user@example.test' }, { onLog() {} });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
});

test('no2fa automation launches the dedicated runner with the selected replacement account', async (t) => {
  const logDir = mkdtempSync(join(tmpdir(), 'no2fa-registration-action-'));
  t.after(() => rmSync(logDir, { recursive: true, force: true }));
  let launched;
  const spawnImpl = (command, args, options) => {
    launched = { command, args, options };
    const child = new EventEmitter();
    child.pid = 123;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stdout.end('[无2FA] 已保存 AT 文件\n');
      child.stderr.end();
      child.emit('close', 0);
    });
    return child;
  };
  const automation = createRoxyChildProcessAutomation({
    spawnImpl,
    protocolNo2faPythonPath: 'python-no2fa.exe',
    protocolNo2faProjectPath: 'C:/auto',
    protocolNo2faMainPath: 'C:/auto/protocol_no_2fa_registration.py',
    baseEnv: {
      PORT: '13400',
      ROXY_NO_2FA_PREPARER: 'C:/scripts/manual-roxy-refresh.cjs',
    },
    logDir,
  });

  const result = await automation.registerNo2faAccount({ id: 9, email: 'new.user@example.test' });

  assert.equal(result.ok, true);
  assert.equal(launched.command, 'python-no2fa.exe');
  assert.deepEqual(launched.args, [
    'C:/auto/protocol_no_2fa_registration.py',
    '--email',
    'new.user@example.test',
  ]);
  assert.equal(launched.options.cwd, 'C:/auto');
  assert.equal(launched.options.env.REPLACEMENT_ACCOUNT_ID, '9');
  assert.equal(launched.options.env.REPLACEMENT_API_BASE, 'http://127.0.0.1:13400');
  assert.equal(launched.options.env.ROXY_NO_2FA_PREPARER, 'C:/scripts/manual-roxy-refresh.cjs');
});

test('protocol queue retains a no2fa registration operation marker', async () => {
  const observed = [];
  const queue = createProtocolRegistrationQueue({
    worker: async (job) => observed.push(job.operation),
  });

  const job = queue.enqueue(
    { id: 9, email: 'new.user@example.test' },
    { operation: 'no2fa-registration' },
  );
  assert.equal(job.operation, 'no2fa-registration');

  await queue.whenIdle();
  assert.deepEqual(observed, ['no2fa-registration']);
});

test('no2fa registration API queues an unregistered account and verifies its registered status', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'no2fa-registration-api-'));
  const database = createDatabase(join(workspace, 'app.db'));
  const replacementAccounts = createReplacementAccountRepository(database);
  const account = replacementAccounts.createAccount({ email: 'new.user@example.test' });
  const calls = [];
  const replacementServices = {
    async registerNo2faAccount(target) {
      calls.push(target.id);
      replacementAccounts.markRegistrationSuccess(target.id);
      return { ok: true };
    },
  };
  const server = createApp({ db: database, replacementAccounts, replacementServices }).listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => {
    server.close();
    database.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  const loginResponse = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: config.adminPassword }),
    redirect: 'manual',
  });
  const cookie = String(loginResponse.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie);

  const response = await fetch(`${baseUrl}/replacement-accounts/${account.id}/register-no2fa`, {
    method: 'POST',
    headers: { cookie },
  });
  const payload = await response.json();

  assert.equal(response.status, 202);
  assert.equal(payload.job.operation, 'no2fa-registration');
  await waitFor(() => calls.length === 1);
  assert.equal(replacementAccounts.getAccount(account.id).status, 'registered');

  const repeatedResponse = await fetch(`${baseUrl}/replacement-accounts/${account.id}/register-no2fa`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(repeatedResponse.status, 409);
});

test('replacement action menu and server expose the no2fa registration endpoint', () => {
  const appSource = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const serverSource = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

  assert.equal(appSource.includes('data-action="register-no2fa"'), true);
  assert.equal(serverSource.includes('/replacement-accounts/:id/register-no2fa'), true);
});

async function waitFor(condition, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for no2fa registration queue');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
