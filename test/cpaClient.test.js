import assert from 'node:assert/strict';
import test from 'node:test';

import { createCpaClient } from '../src/cpaClient.js';

test('listAuthFiles calls CPA auth-files endpoint with bearer key', async () => {
  const calls = [];
  const client = createCpaClient({
    authFilesUrl: 'http://cpa.local/v0/management/auth-files',
    managementKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { files: [{ email: 'user@example.com', status: 'ready' }] };
        },
      };
    },
  });

  const files = await client.listAuthFiles();

  assert.deepEqual(files, [{ email: 'user@example.com', status: 'ready' }]);
  assert.equal(calls[0].url, 'http://cpa.local/v0/management/auth-files');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
});

test('listAuthFiles throws non-secret error on CPA failure', async () => {
  const client = createCpaClient({
    authFilesUrl: 'http://cpa.local/v0/management/auth-files',
    managementKey: 'secret',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() {
        return '{"error":"invalid management key"}';
      },
    }),
  });

  await assert.rejects(() => client.listAuthFiles(), /CPA_AUTH_FILES_FAILED/);
});

test('uploadAuthFile posts generated CPA JSON with file name', async () => {
  const calls = [];
  const client = createCpaClient({
    authFilesUrl: 'http://cpa.local/v0/management/auth-files',
    managementKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: 'ok' };
        },
      };
    },
  });

  const result = await client.uploadAuthFile({
    name: 'user@example.com.json',
    payload: '{"type":"openai"}',
  });

  assert.deepEqual(result, { status: 'ok' });
  assert.equal(calls[0].url, 'http://cpa.local/v0/management/auth-files?name=user%40example.com.json');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].options.body, '{"type":"openai"}');
});
