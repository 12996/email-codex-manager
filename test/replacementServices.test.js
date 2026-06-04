import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createReplacementServices } from '../src/replacementServices.js';

function okResponse(body) {
  return {
    ok: true,
    status: 200,
    async text() {
      return body;
    },
  };
}

function errorResponse(status, body = '') {
  return {
    ok: false,
    status,
    async text() {
      return body;
    },
  };
}

test('fetchSmsCode extracts code from top-level JSON code field', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('{"code":"123456"}'),
  });

  assert.equal(await services.fetchSmsCode('https://example.invalid/sms'), '123456');
});

test('fetchSmsCode extracts code from nested JSON data.code field', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('{"data":{"code":"234567"}}'),
  });

  assert.equal(await services.fetchSmsCode('https://example.invalid/sms'), '234567');
});

test('fetchSmsCode extracts first six digit code from text', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('Your code is 345678.'),
  });

  assert.equal(await services.fetchSmsCode('https://example.invalid/sms'), '345678');
});

test('fetchSmsCode rejects responses without a verification code', async () => {
  const services = createReplacementServices({
    fetchImpl: async () => okResponse('no code here'),
  });

  await assert.rejects(
    () => services.fetchSmsCode('https://example.invalid/sms'),
    /SMS_FETCH_FAILED/,
  );
});

test('fetchJson returns raw JSON string and rejects non-2xx', async () => {
  const services = createReplacementServices({
    fetchImpl: async (url) => {
      if (url.includes('fail')) return errorResponse(500);
      return okResponse('{"ok":true}');
    },
  });

  assert.equal(await services.fetchJson('https://example.invalid/account.json'), '{"ok":true}');
  await assert.rejects(
    () => services.fetchJson('https://example.invalid/fail.json'),
    /JSON_FETCH_FAILED/,
  );
});

test('replaceAccount uses injected automation when provided', async () => {
  const configured = createReplacementServices({
    replacementAutomation: {
      async replaceAccount(account) {
        return { ok: true, email: account.email };
      },
    },
  });

  assert.deepEqual(await configured.replaceAccount({ email: 'user@example.com' }), {
    ok: true,
    email: 'user@example.com',
  });
});

test('replaceAccount runs roxy oauth script in a child process with account env', async () => {
  const calls = [];
  const services = createReplacementServices({
    nodePath: 'node-bin',
    scriptPath: 'src/auto/roxy_oauth_login.js',
    baseEnv: {
      EXISTING_ENV: '1',
      ROXY_OAUTH_EMAIL: 'old@example.com',
      PHONE_VERIFICATION_SMS_API_URL: 'https://old.example/sms',
    },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit('data', 'ok');
        child.emit('close', 0);
      });
      return child;
    },
  });

  const result = await services.replaceAccount({
    email: ' user@example.com ',
    sms_api: ' https://example.invalid/sms ',
  });

  assert.deepEqual(result, {
    ok: true,
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'node-bin');
  assert.deepEqual(calls[0].args, ['src/auto/roxy_oauth_login.js']);
  assert.equal(calls[0].options.env.EXISTING_ENV, '1');
  assert.equal(calls[0].options.env.ROXY_OAUTH_EMAIL, 'user@example.com');
  assert.equal(calls[0].options.env.PHONE_VERIFICATION_SMS_API_URL, 'https://example.invalid/sms');
});

test('replaceAccount creates automation run and writes child logs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-logs-'));
  const calls = [];
  const statuses = [];
  const services = createReplacementServices({
    logDir: dir,
    automationRuns: {
      createRun(input) {
        calls.push(input);
        return { id: 101, ...input };
      },
      markSucceeded(id, result) {
        statuses.push({ id, status: 'succeeded', result });
      },
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit('data', 'stdout line\n');
        child.stderr.emit('data', 'stderr line\n');
        child.emit('close', 0);
      });
      return child;
    },
  });

  const result = await services.replaceAccount({
    id: 7,
    email: 'user@example.com',
    sms_api: 'https://example.invalid/sms',
  });

  assert.equal(result.run.id, 101);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].account_id, 7);
  assert.equal(calls[0].email, 'user@example.com');
  assert.equal(calls[0].pid, 4242);
  assert.equal(existsSync(calls[0].log_path), true);
  const log = readFileSync(calls[0].log_path, 'utf8');
  assert.match(log, /Starting replacement automation/);
  assert.match(log, /stdout line/);
  assert.match(log, /stderr line/);
  assert.deepEqual(statuses, [{ id: 101, status: 'succeeded', result: { exitCode: 0 } }]);
});

test('replaceAccount writes orchestration step logs around child process execution', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-logs-'));
  let logPath;
  const services = createReplacementServices({
    logDir: dir,
    automationRuns: {
      createRun(input) {
        logPath = input.log_path;
        return { id: 303, ...input };
      },
      markSucceeded() {},
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.pid = 6363;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.emit('close', 0);
      });
      return child;
    },
  });

  await services.replaceAccount({
    id: 9,
    email: 'user@example.com',
    sms_api: 'https://example.invalid/sms',
  });

  const log = readFileSync(logPath, 'utf8');
  assert.match(log, /step=validate-account action=validated replacement account/);
  assert.match(log, /step=prepare-env action=prepared child process environment/);
  assert.match(log, /step=spawn-child action=spawning automation child process/);
  assert.match(log, /step=create-run action=created automation run run_id=303 pid=6363/);
  assert.match(log, /step=wait-child action=waiting for automation child process to finish/);
  assert.match(log, /step=mark-succeeded action=marked automation run succeeded exit_code=0/);
});

test('stopReplacementRun stops an active child created by the service', async () => {
  let killed = false;
  const services = createReplacementServices({
    automationRuns: {
      createRun(input) {
        return { id: 202, ...input };
      },
    },
    spawnImpl() {
      const child = new EventEmitter();
      child.pid = 5252;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        killed = true;
        return true;
      };
      return child;
    },
  });

  services.replaceAccount({
    id: 8,
    email: 'user@example.com',
    sms_api: 'https://example.invalid/sms',
  });

  assert.deepEqual(services.stopReplacementRun(202), { ok: true, runId: 202 });
  assert.equal(killed, true);
});

test('replaceAccount reports child process failure as REPLACE_FAILED', async () => {
  const services = createReplacementServices({
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stderr.emit('data', 'oauth failed');
        child.emit('close', 1);
      });
      return child;
    },
  });

  await assert.rejects(
    () => services.replaceAccount({
      email: 'user@example.com',
      sms_api: 'https://example.invalid/sms',
    }),
    (error) => error.code === 'REPLACE_FAILED' && /oauth failed/.test(error.message),
  );
});

test('registerAccount runs roxy registration script without SMS env and writes registration logs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-logs-'));
  const spawnCalls = [];
  const runCalls = [];
  let logPath;
  const services = createReplacementServices({
    nodePath: 'node-bin',
    registerScriptPath: 'src/auto/roxy_register_openai.js',
    logDir: dir,
    baseEnv: {
      EXISTING_ENV: '1',
      PHONE_VERIFICATION_SMS_API_URL: 'https://old.example/sms',
    },
    automationRuns: {
      createRun(input) {
        runCalls.push(input);
        logPath = input.log_path;
        return { id: 404, ...input };
      },
      markSucceeded() {},
    },
    spawnImpl(command, args, options) {
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter();
      child.pid = 7474;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit('data', '[roxy-register-openai] step=done code=received\n');
        child.emit('close', 0);
      });
      return child;
    },
  });

  const result = await services.registerAccount({
    id: 12,
    email: ' user@example.com ',
    sms_api: 'https://example.invalid/sms',
  });

  assert.equal(result.ok, true);
  assert.equal(result.run.id, 404);
  assert.equal(spawnCalls[0].command, 'node-bin');
  assert.deepEqual(spawnCalls[0].args, ['src/auto/roxy_register_openai.js']);
  assert.equal(spawnCalls[0].options.env.EXISTING_ENV, '1');
  assert.equal(spawnCalls[0].options.env.ROXY_REGISTER_EMAIL, 'user@example.com');
  assert.equal(spawnCalls[0].options.env.ROXY_OAUTH_EMAIL, 'user@example.com');
  assert.equal(Object.hasOwn(spawnCalls[0].options.env, 'PHONE_VERIFICATION_SMS_API_URL'), false);
  assert.equal(runCalls[0].email, 'user@example.com');
  const log = readFileSync(logPath, 'utf8');
  assert.match(log, /Starting registration automation/);
  assert.match(log, /step=prepare-env action=prepared child process environment/);
  assert.match(log, /ROXY_REGISTER_EMAIL=set/);
  assert.doesNotMatch(log, /https:\/\/example\.invalid\/sms/);
});

test('registerAccount reports child process failure as REGISTER_FAILED', async () => {
  const services = createReplacementServices({
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stderr.emit('data', 'registration failed');
        child.emit('close', 1);
      });
      return child;
    },
  });

  await assert.rejects(
    () => services.registerAccount({ email: 'user@example.com' }),
    (error) => error.code === 'REGISTER_FAILED' && /registration failed/.test(error.message),
  );
});
