import assert from 'node:assert/strict';
import test from 'node:test';

import { extractVerificationCode } from '../src/verificationCodeService.js';

test('extractVerificationCode ignores six digit CSS color values and extracts body code from HTML', () => {
  const html = `
    <html>
      <head>
        <style>
          .button { color: #123456; background: #654321; }
        </style>
        <script>window.testCode = "111111";</script>
      </head>
      <body>
        <p>Your OpenAI verification code is <strong>789012</strong>.</p>
      </body>
    </html>
  `;

  assert.equal(extractVerificationCode(html), '789012');
});

test('extractVerificationCode reads common JSON code fields before plain text fallback', () => {
  assert.equal(extractVerificationCode({ otp: '234567' }), '234567');
  assert.equal(extractVerificationCode({ verificationCode: '345678' }), '345678');
  assert.equal(extractVerificationCode({ data: { verification_code: '456789' } }), '456789');
});

test('extractVerificationCode reads parsed mail body before subject', () => {
  assert.equal(extractVerificationCode({
    subject: 'Old code 111111',
    bodyHtml: '<style>.x{color:#222222}</style><p>New code 567890</p>',
  }), '567890');
});

test('extractVerificationCode ignores invalid HTML numeric entities', () => {
  assert.equal(extractVerificationCode('<p>&#999999999999; code 678901</p>'), '678901');
});
