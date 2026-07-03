import assert from 'node:assert/strict';
import test from 'node:test';

import { generateTotpCode, getTotpCodeInfo } from '../src/totpService.js';

test('generateTotpCode matches standard 2fa.fun-compatible TOTP parameters', () => {
  const code = generateTotpCode('ANA6DKOETWQDNSF2O6UGJ6VNJI2WYBSJ', {
    timestampMs: 1782993169067,
  });

  assert.equal(code, '454976');
});

test('getTotpCodeInfo returns code and remaining lifetime', () => {
  const info = getTotpCodeInfo('ANA6DKOETWQDNSF2O6UGJ6VNJI2WYBSJ', {
    timestampMs: 1782993169067,
  });

  assert.deepEqual(info, {
    code: '454976',
    expiresIn: 11,
    step: 30,
    digits: 6,
    algorithm: 'sha1',
  });
});

test('generateTotpCode rejects invalid base32 secrets', () => {
  assert.throws(
    () => generateTotpCode('not-valid-***', { timestampMs: 1782993169067 }),
    /TOTP secret/
  );
});
