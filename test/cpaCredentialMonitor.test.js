import assert from 'node:assert/strict';
import test from 'node:test';

import { createCpaCredentialMonitor } from '../src/cpaCredentialMonitor.js';

test('runOnce triggers replacement for unhealthy matching account', async () => {
  const enqueued = [];
  const monitor = createCpaCredentialMonitor({
    cpaClient: {
      async listAuthFiles() {
        return [{
          provider: 'claude',
          email: 'user@example.com',
          status: 'error',
          status_message: 'refresh token expired',
          unavailable: true,
          disabled: false,
        }];
      },
    },
    replacementAccounts: {
      getAccountByEmail(email) {
        assert.equal(email, 'user@example.com');
        return { id: 7, email, status: 'plus_active' };
      },
    },
    repairQueue: {
      enqueue(job) {
        enqueued.push(job.account.id);
        return true;
      },
    },
  });

  const result = await monitor.runOnce();

  assert.deepEqual(enqueued, [7]);
  assert.equal(result.checked, 1);
  assert.equal(result.unhealthy.length, 1);
  assert.equal(result.enqueued.length, 1);
});

test('runOnce skips healthy and already replacing credentials', async () => {
  const monitor = createCpaCredentialMonitor({
    cpaClient: {
      async listAuthFiles() {
        return [
          { provider: 'claude', email: 'ok@example.com', status: 'ready', status_message: 'ok' },
          { provider: 'claude', email: 'busy@example.com', status: 'error', unavailable: true, status_message: 'token expired' },
        ];
      },
    },
    replacementAccounts: {
      getAccountByEmail(email) {
        if (email === 'busy@example.com') return { id: 8, email, status: 'replacing' };
        return undefined;
      },
    },
    repairQueue: {
      enqueue() {
        throw new Error('not expected');
      },
    },
  });

  const result = await monitor.runOnce();

  assert.equal(result.checked, 2);
  assert.equal(result.unhealthy.length, 1);
  assert.equal(result.enqueued.length, 0);
  assert.equal(result.skipped.length, 1);
});

test('runOnce treats email healthy when any matching CPA credential is healthy', async () => {
  const monitor = createCpaCredentialMonitor({
    cpaClient: {
      async listAuthFiles() {
        return [
          {
            provider: 'codex',
            email: 'user@example.com',
            status: 'error',
            unavailable: true,
            status_message: 'authentication token invalidated',
          },
          { provider: 'codex', email: 'user@example.com', status: 'active', status_message: '' },
        ];
      },
    },
    replacementAccounts: {
      getAccountByEmail() {
        throw new Error('healthy email should not look up replacement account');
      },
    },
    repairQueue: {
      enqueue() {
        throw new Error('healthy email should not be enqueued');
      },
    },
  });

  const result = await monitor.runOnce();

  assert.equal(result.checked, 2);
  assert.equal(result.unhealthy.length, 0);
  assert.equal(result.enqueued.length, 0);
  assert.equal(result.skipped.length, 0);
});

test('runOnce skips auth-expired credential when replacement account is banned', async () => {
  const monitor = createCpaCredentialMonitor({
    cpaClient: {
      async listAuthFiles() {
        return [{
          provider: 'codex',
          email: 'banned@example.com',
          status: 'error',
          unavailable: true,
          status_message: 'refresh token expired',
        }];
      },
    },
    replacementAccounts: {
      getAccountByEmail(email) {
        assert.equal(email, 'banned@example.com');
        return { id: 9, email, status: 'banned' };
      },
    },
    repairQueue: {
      enqueue() {
        throw new Error('banned account should not be enqueued');
      },
    },
  });

  const result = await monitor.runOnce();

  assert.equal(result.checked, 1);
  assert.equal(result.unhealthy.length, 1);
  assert.equal(result.enqueued.length, 0);
  assert.deepEqual(result.skipped.map((item) => item.reason), ['account_banned']);
});

test('runOnce skips auth-expired credential when replacement account circuit breaker is active', async () => {
  const monitor = createCpaCredentialMonitor({
    cpaClient: {
      async listAuthFiles() {
        return [{
          provider: 'codex',
          email: 'broken@example.com',
          status: 'error',
          unavailable: true,
          status_message: 'refresh token expired',
        }];
      },
    },
    replacementAccounts: {
      getAccountByEmail(email) {
        assert.equal(email, 'broken@example.com');
        return {
          id: 10,
          email,
          status: 'failed',
          circuit_breaker_at: '2026-06-30T00:00:00.000Z',
        };
      },
    },
    repairQueue: {
      enqueue() {
        throw new Error('circuit-broken account should not be enqueued');
      },
    },
  });

  const result = await monitor.runOnce();

  assert.equal(result.checked, 1);
  assert.equal(result.unhealthy.length, 1);
  assert.equal(result.enqueued.length, 0);
  assert.deepEqual(result.skipped.map((item) => item.reason), ['account_circuit_breaker']);
});
