import assert from 'node:assert/strict';
import test from 'node:test';

import { createProtocolRegistrationQueue } from '../src/protocolRegistrationQueue.js';

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('protocol registration queue runs one FIFO job at a time', async () => {
  const first = createDeferred();
  const started = [];
  const queue = createProtocolRegistrationQueue({
    async worker(job) {
      started.push(job.account.id);
      if (job.account.id === 1) await first.promise;
    },
  });

  queue.enqueue({ id: 1, email: 'first@example.com' });
  queue.enqueue({ id: 2, email: 'second@example.com' });

  await Promise.resolve();
  assert.deepEqual(started, [1]);
  assert.deepEqual(queue.getSnapshot().waiting.map((job) => job.account.id), [2]);

  first.resolve();
  await queue.whenIdle();

  assert.deepEqual(started, [1, 2]);
  assert.equal(queue.getSnapshot().recent[0].account.id, 2);
  assert.equal(queue.getSnapshot().recent[0].state, 'succeeded');
});

test('protocol registration queue clears waiting jobs without cancelling the active job', async () => {
  const active = createDeferred();
  const queue = createProtocolRegistrationQueue({
    async worker(job) {
      if (job.account.id === 1) await active.promise;
    },
  });

  queue.enqueue({ id: 1, email: 'active@example.com' });
  queue.enqueue({ id: 2, email: 'waiting@example.com' });
  await Promise.resolve();

  assert.deepEqual(queue.clearPending().map((job) => job.account.id), [2]);
  assert.equal(queue.getSnapshot().current.account.id, 1);

  active.resolve();
  await queue.whenIdle();
  assert.equal(queue.getSnapshot().recent.some((job) => job.account.id === 2), false);
});
