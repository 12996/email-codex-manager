import assert from 'node:assert/strict';
import test from 'node:test';

import { createCpaRepairQueue } from '../src/cpaRepairQueue.js';

test('queue deduplicates accounts by id and drains one at a time', async () => {
  const events = [];
  const queue = createCpaRepairQueue({
    async worker(job) {
      events.push(`start:${job.account.id}`);
      await Promise.resolve();
      events.push(`end:${job.account.id}`);
    },
  });

  queue.enqueue({ account: { id: 1, email: 'a@example.com' }, reason: 'expired' });
  queue.enqueue({ account: { id: 1, email: 'a@example.com' }, reason: 'expired' });
  queue.enqueue({ account: { id: 2, email: 'b@example.com' }, reason: 'expired' });

  await queue.drain();

  assert.deepEqual(events, ['start:1', 'end:1', 'start:2', 'end:2']);
});
