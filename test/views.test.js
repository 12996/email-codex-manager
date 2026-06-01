import assert from 'node:assert/strict';
import test from 'node:test';

import { accountsPage } from '../src/views.js';

function sampleAccount() {
  return {
    id: 1,
    gmail_email: 'user@gmail.com',
    gmail_password: 'password',
    gmail_2fa: '123456',
    gmail_app_password: 'abcdefghijklmnop',
    status: 'active',
    last_fetch_at: null,
    last_error: null,
  };
}

test('accountsPage renders account list as a clear data table', () => {
  const html = accountsPage({
    accounts: [sampleAccount()],
  });

  assert.match(html, /class="table-container"/);
  assert.match(html, /class="data-table account-table"/);
  assert.doesNotMatch(html, /class="account-card"/);
  for (const heading of ['操作', 'Gmail', 'Gmail 密码', '2FA', 'App Password', '状态', '上次获取', '最近错误']) {
    assert.match(html, new RegExp(`<th[^>]*>${heading}</th>`));
  }
});

test('accountsPage keeps the three required read locations', () => {
  const html = accountsPage({
    accounts: [sampleAccount()],
  });

  assert.match(html, />收件箱</);
  assert.match(html, />全部邮件</);
  assert.match(html, />垃圾箱</);
});

test('accountsPage renders fetched mail below the account table as Gmail-style expandable rows', () => {
  const html = accountsPage({
    accounts: [sampleAccount()],
    result: {
      title: 'user@gmail.com 获取结果',
      messages: [{
        subject: 'Your temporary ChatGPT login code',
        from: 'ChatGPT <noreply@tm.openai.com>',
        fromAddress: 'noreply@tm.openai.com',
        date: '2026-05-23T02:44:00.000Z',
        preview: 'Enter this temporary verification code to continue: 756039',
        sourceMailbox: 'INBOX',
      }],
    },
  });

  assert.ok(html.indexOf('account-table') < html.indexOf('mail-result-panel'));
  assert.match(html, /class="gmail-mail-list"/);
  assert.match(html, /<details class="gmail-mail-row">/);
  assert.match(html, /class="gmail-mail-summary"/);
  assert.match(html, /class="gmail-sender"[^>]*>ChatGPT</);
  assert.match(html, /class="gmail-subject"[^>]*>Your temporary ChatGPT login code</);
  assert.match(html, /class="gmail-snippet"[^>]*>Enter this temporary verification code/);
  assert.match(html, /class="gmail-mail-detail"/);
});

test('accountsPage renders HTML mail body in the expanded detail instead of only escaped preview text', () => {
  const html = accountsPage({
    accounts: [sampleAccount()],
    result: {
      title: 'user@gmail.com 获取结果',
      messages: [{
        subject: 'Security alert',
        from: 'Google <no-reply@accounts.google.com>',
        date: '2026-05-23T02:44:00.000Z',
        preview: 'App password created',
        bodyText: 'Plain fallback',
        bodyHtml: '<div class="email-html"><h1>Google</h1><a href="https://accounts.google.com">查看活动</a></div>',
        sourceMailbox: 'INBOX',
      }],
    },
  });

  assert.match(html, /class="gmail-body gmail-body-html"/);
  assert.match(html, /<h1>Google<\/h1>/);
  assert.match(html, /<a href="https:\/\/accounts.google.com">查看活动<\/a>/);
  assert.doesNotMatch(html, /&lt;h1&gt;Google&lt;\/h1&gt;/);
});
