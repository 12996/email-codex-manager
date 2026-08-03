'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { deriveAgeFromBirthday } = require('../src/auto/roxy_register_openai.js');

test('deriveAgeFromBirthday honors a configured birthday on the recorded age-only profile page', () => {
  const now = new Date('2026-08-03T12:00:00Z');

  assert.equal(deriveAgeFromBirthday('2000-08-03', now), '26');
  assert.equal(deriveAgeFromBirthday('2000-08-04', now), '25');
});

test('deriveAgeFromBirthday rejects an invalid or underage configured birthday', () => {
  const now = new Date('2026-08-03T12:00:00Z');

  assert.throws(
    () => deriveAgeFromBirthday('2000-02-30', now),
    (error) => error?.code === 'REGISTRATION_BIRTHDAY_INVALID',
  );
  assert.throws(
    () => deriveAgeFromBirthday('2010-08-03', now),
    (error) => error?.code === 'REGISTRATION_BIRTHDAY_INVALID',
  );
});
