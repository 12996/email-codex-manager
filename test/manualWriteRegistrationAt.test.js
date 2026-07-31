import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { writeAccessTokens } = require('./manual-write-registration-at.cjs');

test('manual AT writer appends unique tokens to registration/at.txt', () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'manual-at-'));
  try {
    const first = writeAccessTokens({
      outputDir,
      tokens: ['token-one', 'token-two', 'token-one'],
    });
    const second = writeAccessTokens({
      outputDir,
      tokens: ['token-two', 'token-three'],
    });

    assert.equal(first.added, 2);
    assert.equal(second.added, 1);
    assert.equal(
      readFileSync(path.join(outputDir, 'at.txt'), 'utf8'),
      'token-one\ntoken-two\ntoken-three\n',
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('manual AT writer rejects an empty manual configuration', () => {
  assert.throws(
    () => writeAccessTokens({ outputDir: tmpdir(), tokens: ['   '] }),
    /至少填写一个 AT/,
  );
});
