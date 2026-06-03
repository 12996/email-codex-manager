import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCpaAuthFile, buildCredentialKey } from '../src/cpaCredentialHealth.js';

test('buildCredentialKey uses provider and normalized email', () => {
  assert.equal(buildCredentialKey({ provider: 'Claude', email: ' User@Example.COM ' }), 'claude:user@example.com');
});

test('classifyCpaAuthFile marks ready credential healthy', () => {
  assert.deepEqual(classifyCpaAuthFile({
    provider: 'claude',
    email: 'user@example.com',
    status: 'ready',
    status_message: 'ok',
    disabled: false,
    unavailable: false,
  }), {
    healthy: true,
    category: 'healthy',
    reasons: [],
  });
});

test('classifyCpaAuthFile marks active credential healthy', () => {
  assert.deepEqual(classifyCpaAuthFile({
    provider: 'codex',
    email: 'user@example.com',
    status: 'active',
    status_message: '',
    disabled: false,
    unavailable: false,
  }), {
    healthy: true,
    category: 'healthy',
    reasons: [],
  });
});

test('classifyCpaAuthFile detects auth-expired token errors', () => {
  const result = classifyCpaAuthFile({
    status: 'error',
    status_message: '{"error":{"message":"Your authentication token has been invalidated","type":"authentication_error","code":"auth_unavailable"}}',
    disabled: false,
    unavailable: true,
  });

  assert.equal(result.healthy, false);
  assert.equal(result.category, 'auth_expired');
  assert.deepEqual(result.reasons, ['unavailable', 'status:error', 'message:auth_expired']);
});

test('classifyCpaAuthFile detects quota limited without replacement', () => {
  const result = classifyCpaAuthFile({
    status: 'error',
    status_message: '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached"}}',
    next_retry_after: '2026-06-08T16:09:37+08:00',
    unavailable: true,
  });

  assert.equal(result.healthy, false);
  assert.equal(result.category, 'quota_limited');
  assert.deepEqual(result.reasons, ['quota_limited', 'unavailable', 'status:error']);
});

test('classifyCpaAuthFile detects disabled without replacement', () => {
  const result = classifyCpaAuthFile({
    status: 'disabled',
    disabled: true,
  });

  assert.equal(result.healthy, false);
  assert.equal(result.category, 'disabled');
  assert.deepEqual(result.reasons, ['disabled', 'status:disabled']);
});

test('classifyCpaAuthFile detects banned without replacement', () => {
  const result = classifyCpaAuthFile({
    status: 'banned',
    status_message: 'refresh token expired',
    disabled: false,
    unavailable: true,
  });

  assert.equal(result.healthy, false);
  assert.equal(result.category, 'banned');
  assert.deepEqual(result.reasons, ['banned', 'unavailable', 'status:banned', 'message:auth_expired']);
});
