import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  messageIndicatesChatGptPlusSubscription,
  runPlusStatusCheck,
} from '../src/replacementPlusStatusService.js';
import { createDatabase } from '../src/db.js';
import { createAccountRepository } from '../src/accounts.js';
import { createReplacementAccountRepository } from '../src/replacementAccounts.js';

function createRepos() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-plus-status-'));
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

function plusMessage(recipient) {
  return {
    subject: "You've successfully subscribed to ChatGPT Plus.",
    toAddresses: [recipient],
    bodyText: `Enjoy your first month free.\n\nChatGPT Plus Subscription\n\nThe OpenAI Team`,
    date: '2026-07-14T01:00:00.000Z',
  };
}

test('messageIndicatesChatGptPlusSubscription matches the approved OpenAI Plus email', () => {
  assert.equal(
    messageIndicatesChatGptPlusSubscription(plusMessage('registered@example.com'), 'registered@example.com'),
    true,
  );
  assert.equal(
    messageIndicatesChatGptPlusSubscription({
      ...plusMessage('registered@example.com'),
      subject: "You've successfully subscribed to ChatGPT Plus",
    }, 'other@example.com'),
    false,
  );
  assert.equal(
    messageIndicatesChatGptPlusSubscription({
      ...plusMessage('registered@example.com'),
      bodyText: 'ChatGPT Plus Subscription from another sender',
    }, 'registered@example.com'),
    false,
  );
});

test('messageIndicatesChatGptPlusSubscription matches HTML entities from the email API', () => {
  assert.equal(messageIndicatesChatGptPlusSubscription({
    subject: 'ChatGPT - Your new plan',
    toAddresses: ['registered@example.com'],
    bodyHtml: '<p>You&#39;ve successfully subscribed to ChatGPT Plus.</p><p>ChatGPT Plus Subscription</p><p>The OpenAI Team</p>',
  }, 'registered@example.com'), true);
});

test('runPlusStatusCheck only checks registered accounts and updates matching accounts', async () => {
  const { accounts, replacementAccounts } = createRepos();
  const mailbox = createGmailAccount(accounts);
  const plus = replacementAccounts.createAccount({
    email: 'receiver+plus@gmail.com',
    email_code_api: emailApi('receiver+plus@gmail.com'),
    status: 'registered',
  });
  const clean = replacementAccounts.createAccount({
    email: 'receiver+clean@gmail.com',
    email_code_api: emailApi('receiver+clean@gmail.com'),
    status: 'registered',
  });
  const skipped = replacementAccounts.createAccount({
    email: 'receiver+no-api@gmail.com',
    status: 'registered',
  });
  const alreadyPlus = replacementAccounts.createAccount({
    email: 'receiver+existing@gmail.com',
    status: 'plus_active',
  });
  replacementAccounts.recordPlusStatusCheckFailure(clean.id, 'previous query failure');
  const calls = [];

  const result = await runPlusStatusCheck({
    accounts,
    replacementAccounts,
    emailApiService: {
      async fetchMessages(account, options) {
        calls.push([account.email_code_api, options]);
        if (options.targetEmail === plus.email) return [plusMessage(plus.email)];
        if (options.targetEmail === clean.email) return [];
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
  assert.equal(result.plus, 1);
  assert.equal(result.registered, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.skippedAccounts.map((item) => item.email), [skipped.email]);
  assert.equal(replacementAccounts.getAccount(plus.id).status, 'plus_active');
  assert.equal(replacementAccounts.getAccount(clean.id).status, 'registered');
  assert.equal(replacementAccounts.getAccount(clean.id).last_error, null);
  assert.equal(replacementAccounts.getAccount(skipped.id).status, 'registered');
  assert.equal(replacementAccounts.getAccount(alreadyPlus.id).status, 'plus_active');
  assert.deepEqual(
    calls.map(([apiUrl, options]) => [apiUrl, options.limit, options.targetEmail])
      .sort((left, right) => left[2].localeCompare(right[2])),
    [
      [emailApi(clean.email), 30, clean.email],
      [emailApi(plus.email), 30, plus.email],
    ],
  );
});

test('runPlusStatusCheck records failures without changing registered status', async () => {
  const { accounts, replacementAccounts } = createRepos();
  createGmailAccount(accounts);
  const failed = replacementAccounts.createAccount({
    email: 'receiver+failed@gmail.com',
    email_code_api: emailApi('receiver+failed@gmail.com'),
    status: 'registered',
  });

  const result = await runPlusStatusCheck({
    accounts,
    replacementAccounts,
    emailApiService: {
      async fetchMessages() {
        throw new Error('EMAIL API temporary failure');
      },
    },
    mailService: {
      async fetchMessages() {
        throw new Error('IMAP should not be called');
      },
    },
  });

  assert.equal(result.checked, 1);
  assert.equal(result.plus, 0);
  assert.equal(result.registered, 0);
  assert.equal(result.failed, 1);
  assert.equal(replacementAccounts.getAccount(failed.id).status, 'registered');
  assert.match(replacementAccounts.getAccount(failed.id).last_error, /Plus 状态查询失败：EMAIL API temporary failure/);
  assert.deepEqual(result.failedAccounts.map((item) => item.email), [failed.email]);
});

test('runPlusStatusCheck emits account progress events', async () => {
  const { accounts, replacementAccounts } = createRepos();
  const mailbox = createGmailAccount(accounts);
  const account = replacementAccounts.createAccount({
    email: 'receiver+progress@gmail.com',
    email_code_api: emailApi('receiver+progress@gmail.com'),
    status: 'registered',
  });
  const events = [];

  await runPlusStatusCheck({
    accounts,
    replacementAccounts,
    emailApiService: {
      async fetchMessages() {
        return [plusMessage(account.email)];
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
  assert.equal(
    events[2].message,
    `正在读取邮箱 API：https://mail.example.test/code（账号邮箱：${account.email}）`,
  );
  assert.equal(events.at(-1).outcome, 'plus');
  assert.match(events.at(-1).message, /命中 Plus 订阅邮件/);
});
