import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchReplacementEmailMessages } from '../src/replacementEmailApiService.js';

function account(emailCodeApi = 'https://mail.example.test/code?email=target%40icloud.com') {
  return {
    email: 'target@icloud.com',
    email_code_api: emailCodeApi,
  };
}

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

test('fetchReplacementEmailMessages normalizes a complete JSON mail response', async () => {
  const calls = [];
  const messages = await fetchReplacementEmailMessages(account(), {
    fetchImpl: async (url, options) => {
      calls.push([url, options.method]);
      return response({
        email: 'target@icloud.com',
        subject: 'ChatGPT - Your new plan',
        received_at: '2026-07-14T10:23:21Z',
        body: '<p>You\'ve successfully subscribed to ChatGPT Plus.</p>',
      });
    },
  });

  assert.deepEqual(calls, [[account().email_code_api, 'GET']]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].subject, 'ChatGPT - Your new plan');
  assert.equal(messages[0].date, '2026-07-14T10:23:21Z');
  assert.deepEqual(messages[0].toAddresses, ['target@icloud.com']);
  assert.match(messages[0].bodyHtml, /subscribed to ChatGPT Plus/);
});

test('fetchReplacementEmailMessages rejects a response without full mail content', async () => {
  await assert.rejects(
    fetchReplacementEmailMessages(account(), {
      fetchImpl: async () => response({ email: 'target@icloud.com', code: null }),
    }),
    /未返回完整邮件内容/,
  );
});

test('fetchReplacementEmailMessages reports HTTP failures without returning mail', async () => {
  await assert.rejects(
    fetchReplacementEmailMessages(account(), {
      fetchImpl: async () => response('upstream error', { ok: false, status: 502 }),
    }),
    /HTTP 502/,
  );
});
