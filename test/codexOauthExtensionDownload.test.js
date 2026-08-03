import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadRefreshToken } from '../extensions/codex-oauth-login/lib/rt-download.js';

test('RT download creates a neutral text file containing only the refresh token', async () => {
  const observed = { blobs: [], downloads: [] };
  const result = await downloadRefreshToken({
    refreshToken: 'rt-test-value',
    downloadsApi: {
      async download(options) {
        observed.downloads.push(options);
        return 42;
      },
    },
    blobFactory(parts, options) {
      observed.blobs.push({ parts, options });
      return { parts };
    },
    urlApi: {
      createObjectURL() {
        return 'blob:extension-value';
      },
      revokeObjectURL() {},
    },
    nowMs: Date.UTC(2026, 7, 3, 1, 2, 3),
  });

  assert.deepEqual(observed.blobs, [{
    parts: ['rt-test-value'],
    options: { type: 'text/plain;charset=utf-8' },
  }]);
  assert.deepEqual(observed.downloads, [{
    url: 'blob:extension-value',
    filename: 'codex-refresh-token-20260803-010203.txt',
    saveAs: true,
    conflictAction: 'uniquify',
  }]);
  assert.deepEqual(result, {
    downloadId: 42,
    filename: 'codex-refresh-token-20260803-010203.txt',
    objectUrl: 'blob:extension-value',
  });
});

test('empty RT is rejected without echoing a credential value', async () => {
  await assert.rejects(
    () => downloadRefreshToken({ refreshToken: '' }),
    error => error.code === 'refresh_token_missing' && !error.message.includes('rt-test-value'),
  );
});

test('failed browser download revokes the temporary Blob URL', async () => {
  const revoked = [];
  await assert.rejects(
    () => downloadRefreshToken({
      refreshToken: 'rt-test-value',
      downloadsApi: {
        async download() {
          throw new Error('download failure');
        },
      },
      blobFactory() {
        return {};
      },
      urlApi: {
        createObjectURL() {
          return 'blob:extension-value';
        },
        revokeObjectURL(value) {
          revoked.push(value);
        },
      },
      nowMs: Date.UTC(2026, 7, 3, 1, 2, 3),
    }),
    error => error.code === 'refresh_token_download_failed',
  );
  assert.deepEqual(revoked, ['blob:extension-value']);
});
