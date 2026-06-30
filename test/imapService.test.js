import assert from 'node:assert/strict';
import test from 'node:test';

import { config } from '../src/config.js';
import {
  classifyImapError,
  createMessageSummary,
  deriveMainGmailAccount,
  extractSixDigitCode,
  findLatestVerificationCode,
  mergeSortAndLimitMessages,
  normalizeAppPassword,
  shouldIncludeMessage,
  toUserFacingImapError,
  createClient,
} from '../src/imapService.js';

test('createMessageSummary shapes parsed mail into UI summary', () => {
  const summary = createMessageSummary({
    parsed: {
      subject: 'Hello',
      from: { text: 'Alice <alice@example.com>', value: [{ address: 'alice@example.com' }] },
      to: { text: 'Alias <jregkolpig+s2@gmail.com>', value: [{ address: 'jregkolpig+s2@gmail.com' }] },
      cc: { text: 'Support <support@example.com>', value: [{ address: 'support@example.com' }] },
      headers: new Map([['delivered-to', 'jregkolpig+s2@gmail.com']]),
      date: new Date('2026-05-22T10:00:00Z'),
      text: 'Long message body',
      html: '<p>Long message body</p>',
      messageId: '<id@example.com>',
    },
    sourceMailbox: 'INBOX',
    uid: 123,
  });

  assert.deepEqual(summary, {
    uid: 123,
    sourceMailbox: 'INBOX',
    subject: 'Hello',
    from: 'Alice <alice@example.com>',
    fromAddress: 'alice@example.com',
    toAddresses: ['jregkolpig+s2@gmail.com'],
    ccAddresses: ['support@example.com'],
    deliveredToAddresses: ['jregkolpig+s2@gmail.com'],
    date: '2026-05-22T10:00:00.000Z',
    preview: 'Long message body',
    bodyText: 'Long message body',
    bodyHtml: '<p>Long message body</p>',
    messageId: '<id@example.com>',
  });
});

test('createMessageSummary preserves sanitized HTML body for rendered email detail', () => {
  const summary = createMessageSummary({
    parsed: {
      subject: 'Security alert',
      from: { text: 'Google <no-reply@accounts.google.com>', value: [{ address: 'no-reply@accounts.google.com' }] },
      date: new Date('2026-05-23T10:00:00Z'),
      text: 'Plain fallback',
      html: '<div><h1>Google</h1><a href="https://accounts.google.com">查看活动</a><script>alert(1)</script><p onclick="x()">正文</p></div>',
      messageId: '<google@example.com>',
    },
    sourceMailbox: 'INBOX',
    uid: 456,
  });

  assert.match(summary.bodyHtml, /<h1>Google<\/h1>/);
  assert.match(summary.bodyHtml, /href="https:\/\/accounts.google.com"/);
  assert.doesNotMatch(summary.bodyHtml, /<script/);
  assert.doesNotMatch(summary.bodyHtml, /onclick=/);
});

test('shouldIncludeMessage filters self-sent messages for all mail', () => {
  const message = { from: { address: 'user@gmail.com' } };

  assert.equal(shouldIncludeMessage(message, 'user@gmail.com', true), false);
  assert.equal(shouldIncludeMessage(message, 'user@gmail.com', false), true);
});

test('shouldIncludeMessage filters self-sent parsed summaries by fromAddress', () => {
  const message = {
    from: 'User <user@gmail.com>',
    fromAddress: 'user@gmail.com',
  };

  assert.equal(shouldIncludeMessage(message, 'user@gmail.com', true), false);
});

test('mergeSortAndLimitMessages sorts newest first and applies limit', () => {
  const messages = [
    { subject: 'old', date: '2026-05-20T00:00:00.000Z' },
    { subject: 'new', date: '2026-05-22T00:00:00.000Z' },
    { subject: 'middle', date: '2026-05-21T00:00:00.000Z' },
  ];

  assert.deepEqual(
    mergeSortAndLimitMessages(messages, 2).map((message) => message.subject),
    ['new', 'middle'],
  );
});

test('classifyImapError detects authentication failures', () => {
  assert.equal(classifyImapError(new Error('AUTHENTICATIONFAILED Invalid credentials')), 'AUTH_FAILED');
  assert.equal(classifyImapError({ authenticationFailed: true, message: 'Command failed' }), 'AUTH_FAILED');
  assert.equal(classifyImapError({ serverResponseCode: 'AUTHENTICATIONFAILED', message: 'Command failed' }), 'AUTH_FAILED');
  assert.equal(classifyImapError(new Error('Connection timeout')), 'IMAP_ERROR');
});

test('toUserFacingImapError explains Gmail authentication failures', () => {
  const error = {
    authenticationFailed: true,
    message: 'Command failed',
    responseText: 'Invalid credentials (Failure)',
  };

  const friendly = toUserFacingImapError(error);

  assert.equal(friendly.code, 'AUTH_FAILED');
  assert.match(friendly.message, /Gmail 认证失败/);
  assert.match(friendly.message, /App Password/);
});

test('normalizeAppPassword removes spaces from copied Gmail app passwords', () => {
  assert.equal(normalizeAppPassword('umkl qvqu xcqp buvh'), 'umklqvquxcqpbuvh');
});

test('deriveMainGmailAccount maps Gmail plus aliases to the base mailbox', () => {
  assert.equal(deriveMainGmailAccount('jregkolpig+s2@gmail.com'), 'jregkolpig@gmail.com');
  assert.equal(deriveMainGmailAccount('JregKolPig+abc@Gmail.com'), 'jregkolpig@gmail.com');
  assert.equal(deriveMainGmailAccount('jregkolpig+s2@googlemail.com'), 'jregkolpig@googlemail.com');
  assert.equal(deriveMainGmailAccount('user+tag@example.com'), 'user+tag@example.com');
});

test('createClient passes configured proxy to ImapFlow', () => {
  const previousProxy = config.imap.proxy;
  config.imap.proxy = 'socks5://127.0.0.1:11080';
  try {
    const client = createClient({
      gmail_email: 'user+tag@gmail.com',
      gmail_app_password: 'abcd efgh ijkl mnop',
    });

    assert.equal(client.options.proxy, 'socks5://127.0.0.1:11080');
  } finally {
    config.imap.proxy = previousProxy;
  }
});

test('shouldIncludeMessage filters Gmail plus alias recipients', () => {
  assert.equal(
    shouldIncludeMessage({
      fromAddress: 'sender@example.com',
      toAddresses: ['jregkolpig+s2@gmail.com'],
      ccAddresses: [],
      deliveredToAddresses: [],
    }, 'jregkolpig+s2@gmail.com', false),
    true,
  );
  assert.equal(
    shouldIncludeMessage({
      fromAddress: 'sender@example.com',
      toAddresses: ['jregkolpig+s3@gmail.com'],
      ccAddresses: [],
      deliveredToAddresses: [],
    }, 'jregkolpig+s2@gmail.com', false),
    false,
  );
});

test('shouldIncludeMessage accepts delivery headers for Gmail plus aliases', () => {
  assert.equal(
    shouldIncludeMessage({
      fromAddress: 'sender@example.com',
      toAddresses: [],
      ccAddresses: [],
      deliveredToAddresses: ['JregKolPig+S2@Gmail.com'],
    }, 'jregkolpig+s2@gmail.com', false),
    true,
  );
});

test('extractSixDigitCode returns the first standalone 6 digit code', () => {
  assert.equal(extractSixDigitCode({
    subject: 'Your code',
    bodyText: 'Use 123456 to continue. Ref: 1234567',
    bodyHtml: '<p>654321</p>',
  }), '123456');
  assert.equal(extractSixDigitCode({
    subject: 'Code 222333',
    bodyText: '',
    bodyHtml: '',
  }), '222333');
  assert.equal(extractSixDigitCode({ subject: 'No code', bodyText: 'abc12345', bodyHtml: '' }), null);
});

test('findLatestVerificationCode returns newest message containing a 6 digit code', () => {
  const result = findLatestVerificationCode([
    {
      from: 'old@example.com',
      subject: 'Old code',
      date: '2026-05-01T00:00:00.000Z',
      bodyText: '111111',
    },
    {
      from: 'new@example.com',
      subject: 'New code',
      date: '2026-05-02T00:00:00.000Z',
      bodyText: '222222',
    },
  ]);

  assert.deepEqual(result, {
    code: '222222',
    message: {
      from: 'new@example.com',
      subject: 'New code',
      date: '2026-05-02T00:00:00.000Z',
      bodyText: '222222',
    },
  });
});
