import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSelfSentMessage,
  normalizeFetchLimit,
  resolveReadLocation,
} from '../src/readLocations.js';

test('resolveReadLocation maps inbox to INBOX', () => {
  assert.deepEqual(resolveReadLocation('inbox'), {
    label: '收件箱',
    targets: [{ role: 'inbox', fallbackPath: 'INBOX' }],
    filterSelfSent: false,
  });
});

test('resolveReadLocation maps all to all mail and filters self-sent messages', () => {
  assert.deepEqual(resolveReadLocation('all'), {
    label: '全部邮件',
    targets: [{ role: 'all', fallbackPath: '[Gmail]/All Mail' }],
    filterSelfSent: true,
  });
});

test('resolveReadLocation maps trash to spam and trash targets', () => {
  assert.deepEqual(resolveReadLocation('trash'), {
    label: '垃圾箱',
    targets: [
      { role: 'junk', fallbackPath: '[Gmail]/Spam' },
      { role: 'trash', fallbackPath: '[Gmail]/Trash' },
    ],
    filterSelfSent: false,
  });
});

test('resolveReadLocation rejects invalid values', () => {
  assert.throws(() => resolveReadLocation('sent'), /Invalid read location/);
});

test('normalizeFetchLimit defaults to configured limit and clamps to 50', () => {
  assert.equal(normalizeFetchLimit(undefined, 5), 5);
  assert.equal(normalizeFetchLimit('0', 5), 5);
  assert.equal(normalizeFetchLimit('9', 5), 9);
  assert.equal(normalizeFetchLimit('100', 5), 50);
});

test('isSelfSentMessage compares message from address to Gmail account case-insensitively', () => {
  assert.equal(
    isSelfSentMessage({ from: { address: 'User@Gmail.com' } }, 'user@gmail.com'),
    true,
  );
  assert.equal(
    isSelfSentMessage({ from: { address: 'other@example.com' } }, 'user@gmail.com'),
    false,
  );
});
