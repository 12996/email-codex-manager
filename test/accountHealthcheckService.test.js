import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  messageIndicatesChatGptDeactivation,
  runBannedEmailHealthcheck,
} from '../src/accountHealthcheckService.js';
import { createDatabase } from '../src/db.js';
import { createAccountRepository } from '../src/accounts.js';
import { createReplacementAccountRepository } from '../src/replacementAccounts.js';

function createRepos() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-healthcheck-'));
  const db = createDatabase(join(dir, 'test.db'));
  return {
    accounts: createAccountRepository(db),
    replacementAccounts: createReplacementAccountRepository(db),
  };
}

function createGmailAccount(accounts, gmailEmail = 'receiver@gmail.com') {
  return accounts.createAccount({
    display_name: 'Receiver',
    gmail_email: gmailEmail,
    gmail_password: 'login-password',
    gmail_2fa: '2fa',
    gmail_app_password: 'abcdefghijklmnop',
  });
}

function emailApi(email) {
  return `https://mail.example.test/code?email=${encodeURIComponent(email)}`;
}

function deactivationMessage(email) {
  return {
    subject: 'Important update about your ChatGPT account',
    from: 'OpenAI <noreply@tm.openai.com>',
    date: '2026-07-10T01:00:00.000Z',
    bodyText: `We’re writing with an important update about your ChatGPT account associated with ${email} (User ID: user-test).

Your account has been deactivated because recent activity violated our Terms and Usage Policies.

This means your account can no longer be used.`,
  };
}

test('messageIndicatesChatGptDeactivation requires target email and deactivation phrases', () => {
  assert.equal(messageIndicatesChatGptDeactivation(deactivationMessage('user@example.com'), 'user@example.com'), true);
  assert.equal(messageIndicatesChatGptDeactivation(deactivationMessage('other@example.com'), 'user@example.com'), false);
  assert.equal(messageIndicatesChatGptDeactivation({
    subject: 'Your code',
    bodyText: 'Your verification code for user@example.com is 123456',
  }, 'user@example.com'), false);
  assert.equal(messageIndicatesChatGptDeactivation({
    subject: 'Important update about your ChatGPT account',
    toAddresses: ['user@example.com'],
    bodyText: 'Your account has been deactivated because recent activity violated our Terms and Usage Policies. This means your account can no longer be used.',
  }, 'user@example.com'), true);
});

test('runBannedEmailHealthcheck marks eligible matching accounts as banned', async () => {
  const { accounts, replacementAccounts } = createRepos();
  const mailbox = createGmailAccount(accounts, 'receiver@gmail.com');
  const plus = replacementAccounts.createAccount({
    email: 'receiver+plus@gmail.com',
    email_code_api: emailApi('receiver+plus@gmail.com'),
    status: 'plus_active',
  });
  const sold = replacementAccounts.createAccount({
    email: 'sold@icloud.com',
    email_code_api: emailApi('sold@icloud.com'),
    status: 'sold',
  });
  const registered = replacementAccounts.createAccount({ email: 'registered@icloud.com', status: 'registered' });
  const skipped = replacementAccounts.createAccount({ email: 'no-api@icloud.com', status: 'sold' });
  const calls = [];

  const result = await runBannedEmailHealthcheck({
    accounts,
    replacementAccounts,
    emailApiService: {
      async fetchMessages(account, options) {
        calls.push([account.email_code_api, options]);
        if (options.targetEmail === 'receiver+plus@gmail.com') return [deactivationMessage('receiver+plus@gmail.com')];
        if (options.targetEmail === 'sold@icloud.com') return [deactivationMessage('sold@icloud.com')];
        throw new Error(`unexpected target ${options.targetEmail}`);
      },
    },
    mailService: {
      async fetchMessages() {
        throw new Error('IMAP should not be called');
      },
    },
    icloudCodeDefaultGmailAccount: mailbox.gmail_email,
  });

  assert.equal(result.checked, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.banned, 2);
  assert.equal(result.clean, 0);
  assert.equal(result.failed, 0);
  assert.equal(replacementAccounts.getAccount(plus.id).status, 'banned');
  assert.equal(replacementAccounts.getAccount(sold.id).status, 'banned');
  assert.equal(replacementAccounts.getAccount(registered.id).status, 'registered');
  assert.equal(replacementAccounts.getAccount(skipped.id).status, 'sold');
  assert.match(replacementAccounts.getAccount(plus.id).status_note, /一键验活检测到 ChatGPT deactivation 邮件/);
  assert.deepEqual(
    calls.map(([apiUrl, options]) => [apiUrl, options.limit, options.targetEmail])
      .sort((left, right) => left[2].localeCompare(right[2])),
    [
      [emailApi('receiver+plus@gmail.com'), 5, 'receiver+plus@gmail.com'],
      [emailApi('sold@icloud.com'), 5, 'sold@icloud.com'],
    ],
  );
});

test('runBannedEmailHealthcheck reports clean and failed accounts without changing status', async () => {
  const { accounts, replacementAccounts } = createRepos();
  createGmailAccount(accounts, 'receiver@gmail.com');
  const clean = replacementAccounts.createAccount({
    email: 'receiver+clean@gmail.com',
    email_code_api: emailApi('receiver+clean@gmail.com'),
    status: 'for_sale',
  });
  const failed = replacementAccounts.createAccount({
    email: 'receiver+failed@gmail.com',
    email_code_api: emailApi('receiver+failed@gmail.com'),
    status: 'cpa_mounted',
  });
  const skipped = replacementAccounts.createAccount({ email: 'receiver+skipped@gmail.com', status: 'for_sale' });

  const result = await runBannedEmailHealthcheck({
    accounts,
    replacementAccounts,
    emailApiService: {
      async fetchMessages(account, options) {
        if (options.targetEmail === clean.email) return [deactivationMessage('someone-else@gmail.com')];
        throw Object.assign(new Error('EMAIL API temporary failure'), { code: 'EMAIL_API_ERROR' });
      },
    },
    mailService: {
      async fetchMessages() {
        throw new Error('IMAP should not be called');
      },
    },
  });

  assert.equal(result.checked, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.banned, 0);
  assert.equal(result.clean, 1);
  assert.equal(result.failed, 1);
  assert.equal(replacementAccounts.getAccount(clean.id).status, 'for_sale');
  assert.equal(replacementAccounts.getAccount(failed.id).status, 'cpa_mounted');
  assert.deepEqual(result.cleanAccounts.map((item) => item.email), [clean.email]);
  assert.deepEqual(result.failedAccounts.map((item) => item.email), [failed.email]);
  assert.match(result.failedAccounts[0].message, /EMAIL API temporary failure/);
});

test('runBannedEmailHealthcheck emits account progress events', async () => {
  const { accounts, replacementAccounts } = createRepos();
  const mailbox = createGmailAccount(accounts);
  const account = replacementAccounts.createAccount({
    email: 'receiver+clean@gmail.com',
    email_code_api: emailApi('receiver+clean@gmail.com'),
    status: 'for_sale',
  });
  const events = [];

  await runBannedEmailHealthcheck({
    accounts,
    replacementAccounts,
    emailApiService: {
      async fetchMessages() {
        return [];
      },
    },
    mailService: {
      async fetchMessages() {
        throw new Error('IMAP should not be called');
      },
    },
    icloudCodeDefaultGmailAccount: mailbox.gmail_email,
    onProgress: (event) => events.push(event),
  });

  assert.deepEqual(events.map((event) => event.type), [
    'start',
    'account-start',
    'account-step',
    'account-step',
    'account-result',
  ]);
  assert.equal(events[1].email, account.email);
  assert.match(events[2].message, /正在读取邮箱 API/);
  assert.equal(events.at(-1).outcome, 'clean');
  assert.match(events.at(-1).message, /未命中封禁邮件/);
});
