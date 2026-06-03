import assert from 'node:assert/strict';
import test from 'node:test';

import { startCpaCredentialMonitor } from '../src/cpaCredentialMonitorRunner.js';

test('startCpaCredentialMonitor does nothing when disabled', () => {
  let scheduled = false;
  const handle = startCpaCredentialMonitor({
    enabled: false,
    setIntervalImpl() {
      scheduled = true;
    },
  });

  assert.equal(handle, null);
  assert.equal(scheduled, false);
});

test('startCpaCredentialMonitor schedules runOnce when enabled', async () => {
  const calls = [];
  const handle = startCpaCredentialMonitor({
    enabled: true,
    intervalMs: 60000,
    monitor: { async runOnce() { calls.push('run'); } },
    setIntervalImpl(fn, ms) {
      assert.equal(ms, 60000);
      fn();
      return 123;
    },
  });

  await Promise.resolve();

  assert.equal(handle, 123);
  assert.deepEqual(calls, ['run']);
});
