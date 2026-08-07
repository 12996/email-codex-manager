'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_READY_FILE,
  DEFAULT_STOP_FILE,
  createTargetAttachGuard,
  sanitizeUrl,
  summarizeJsonResponse,
  summarizePostData,
} = require('../src/auto/roxy_register_openai_raw_cdp_network_recorder.cjs');

test('raw CDP recorder uses a separate ready marker', () => {
  assert.match(DEFAULT_READY_FILE, /\.ready$/);
  assert.notEqual(DEFAULT_READY_FILE, DEFAULT_STOP_FILE);
});

test('raw CDP recorder prevents concurrent attachment to the same target', () => {
  const guard = createTargetAttachGuard();

  assert.equal(guard.begin('target-1'), true);
  assert.equal(guard.begin('target-1'), false);
  guard.finish('target-1');
  assert.equal(guard.begin('target-1'), true);
});

test('raw CDP recorder redacts sensitive URL query values', () => {
  const url = sanitizeUrl('https://auth.example.test/path?email=user@example.test&state=secret&safe=ok');

  assert.match(url, /email=%3Credacted%3E/);
  assert.match(url, /state=%3Credacted%3E/);
  assert.match(url, /safe=ok/);
  assert.doesNotMatch(url, /user@example\.test|state=secret/);
});

test('raw CDP recorder keeps only request body schemas', () => {
  const summary = summarizePostData(JSON.stringify({ code: '123456', birthdate: '2000-01-01' }));

  assert.equal(summary.format, 'json');
  assert.deepEqual(summary.fields, ['birthdate', 'code']);
  assert.equal(typeof summary.length, 'number');
});

test('raw CDP recorder summarizes response shape without response values', () => {
  const summary = summarizeJsonResponse(JSON.stringify({
    page: { type: 'external_url' },
    continue_url: 'https://sensitive.example.test/callback?code=secret',
  }));

  assert.deepEqual(summary, {
    json_fields: ['continue_url', 'page.type'],
    page_type: 'external_url',
    method: null,
    has_continue_url: true,
    error_code: null,
  });
});
