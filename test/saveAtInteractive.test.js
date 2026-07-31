import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { saveAccessTokenFile } from './save——at.js';

test('interactive AT saver writes the supplied token to an email-named file', () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'interactive-at-'));
  try {
    const savedPath = saveAccessTokenFile({
      email: 'test.user@icloud.com',
      accessToken: 'at-test-value',
      outputDir,
    });

    assert.equal(path.basename(savedPath), 'test.user@icloud.com.txt');
    assert.equal(readFileSync(savedPath, 'utf8'), 'at-test-value');
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('interactive AT saver rejects an empty email or AT', () => {
  assert.throws(
    () => saveAccessTokenFile({ email: '', accessToken: 'at-value', outputDir: tmpdir() }),
    /邮箱不能为空/,
  );
  assert.throws(
    () => saveAccessTokenFile({ email: 'user@example.com', accessToken: '', outputDir: tmpdir() }),
    /AT 不能为空/,
  );
});
