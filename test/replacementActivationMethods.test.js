import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDatabase } from '../src/db.js';
import { createReplacementActivationMethodRepository } from '../src/replacementActivationMethods.js';

function createTestRepository() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-service-'));
  return createReplacementActivationMethodRepository(createDatabase(join(dir, 'test.db')));
}

test('new databases seed the initial replacement activation methods in order', () => {
  const repo = createTestRepository();

  assert.deepEqual(repo.listMethods().map((method) => method.name), [
    '越南直卡',
    'upi',
    'ideal',
    '波兰',
    '瑞士',
    'pix 直卡',
  ]);
});

test('createMethod trims names and rejects empty or case-insensitive duplicates', () => {
  const repo = createTestRepository();

  const created = repo.createMethod({ name: ' 新方式 ' });

  assert.equal(created.name, '新方式');
  assert.throws(() => repo.createMethod({ name: '   ' }), /ACTIVATION_METHOD_REQUIRED/);
  assert.throws(() => repo.createMethod({ name: 'UPI' }), /ACTIVATION_METHOD_DUPLICATE/);
});

test('hasMethod accepts blank values and matches names case-insensitively', () => {
  const repo = createTestRepository();

  assert.equal(repo.hasMethod(''), true);
  assert.equal(repo.hasMethod(' UPI '), true);
  assert.equal(repo.hasMethod('not configured'), false);
});
