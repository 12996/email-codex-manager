import assert from 'node:assert/strict';
import test from 'node:test';
import signature from 'cookie-signature';

import { config } from '../src/config.js';
import { createApp } from '../src/server.js';

async function startTestServer(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function authCookie() {
  return `admin_auth=${encodeURIComponent(`s:${signature.sign('1', config.sessionSecret)}`)}`;
}

test('POST /api/verification-code/latest routes alias to main Gmail account and returns newest code', async () => {
  const mainAccount = {
    id: 1,
    gmail_email: 'jregkolpig@gmail.com',
    gmail_app_password: 'abcdefghijklmnop',
  };
  const calls = [];
  const app = createApp({
    accounts: {
      getAccountByGmailEmail(email) {
        calls.push(['getAccountByGmailEmail', email]);
        return email === 'jregkolpig@gmail.com' ? mainAccount : null;
      },
    },
    mailService: {
      async fetchMessages(account, options) {
        calls.push(['fetchMessages', account, options]);
        return [
          {
            from: 'Google <no-reply@google.com>',
            subject: 'Verification',
            date: '2026-06-01T10:00:00.000Z',
            bodyText: 'Your code is 123456',
          },
        ];
      },
    },
  });
  const server = await startTestServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/verification-code/latest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: authCookie(),
      },
      body: JSON.stringify({ account: 'jregkolpig+s2@gmail.com' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      account: 'jregkolpig+s2@gmail.com',
      mainAccount: 'jregkolpig@gmail.com',
      code: '123456',
      from: 'Google <no-reply@google.com>',
      subject: 'Verification',
      date: '2026-06-01T10:00:00.000Z',
    });
    assert.deepEqual(calls, [
      ['getAccountByGmailEmail', 'jregkolpig@gmail.com'],
      ['fetchMessages', mainAccount, { readLocation: 'inbox', limit: 30, targetEmail: 'jregkolpig+s2@gmail.com' }],
    ]);
  } finally {
    await server.close();
  }
});

test('POST /api/verification-code/latest returns ACCOUNT_NOT_FOUND when main account is not configured', async () => {
  const app = createApp({
    accounts: {
      getAccountByGmailEmail() {
        return null;
      },
    },
    mailService: {
      async fetchMessages() {
        throw new Error('should not fetch without an account');
      },
    },
  });
  const server = await startTestServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/verification-code/latest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: authCookie(),
      },
      body: JSON.stringify({ account: 'missing+s1@gmail.com' }),
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      ok: false,
      account: 'missing+s1@gmail.com',
      mainAccount: 'missing@gmail.com',
      error: 'ACCOUNT_NOT_FOUND',
      message: '数据库中没有配置主 Gmail 账号',
    });
  } finally {
    await server.close();
  }
});

test('POST /api/verification-code/latest allows localhost requests without admin_auth cookie', async () => {
  const mainAccount = {
    id: 1,
    gmail_email: 'jregkolpig@gmail.com',
    gmail_app_password: 'abcdefghijklmnop',
  };
  const calls = [];
  const app = createApp({
    accounts: {
      getAccountByGmailEmail(email) {
        calls.push(['getAccountByGmailEmail', email]);
        return email === 'jregkolpig@gmail.com' ? mainAccount : null;
      },
    },
    mailService: {
      async fetchMessages(account, options) {
        calls.push(['fetchMessages', account, options]);
        return [
          {
            from: 'Google <no-reply@google.com>',
            subject: 'Verification 654321',
            date: '2026-06-01T10:00:00.000Z',
            bodyText: '',
          },
        ];
      },
    },
  });
  const server = await startTestServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/verification-code/latest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'jregkolpig+s2@gmail.com' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.code, '654321');
    assert.deepEqual(calls, [
      ['getAccountByGmailEmail', 'jregkolpig@gmail.com'],
      ['fetchMessages', mainAccount, { readLocation: 'inbox', limit: 30, targetEmail: 'jregkolpig+s2@gmail.com' }],
    ]);
  } finally {
    await server.close();
  }
});

test('GET /api/verification-code/public/latest resolves allowed replacement account by public key', async () => {
  const mainAccount = {
    id: 1,
    gmail_email: 'jregkolpig@gmail.com',
    gmail_app_password: 'abcdefghijklmnop',
  };
  const calls = [];
  const app = createApp({
    accounts: {
      getAccountByGmailEmail(email) {
        calls.push(['getAccountByGmailEmail', email]);
        return email === 'jregkolpig@gmail.com' ? mainAccount : null;
      },
    },
    replacementAccounts: {
      getPublicCodeAccountByKey(key) {
        calls.push(['getPublicCodeAccountByKey', key]);
        return key === 'vc_public_key' ? { email: 'jregkolpig+s2@gmail.com' } : null;
      },
    },
    mailService: {
      async fetchMessages(account, options) {
        calls.push(['fetchMessages', account, options]);
        return [
          {
            from: 'Google <no-reply@google.com>',
            subject: 'Verification',
            date: '2026-06-01T10:00:00.000Z',
            bodyText: 'Your code is 123456',
          },
        ];
      },
    },
  });
  const server = await startTestServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/verification-code/public/latest?key=vc_public_key`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      account: 'jregkolpig+s2@gmail.com',
      mainAccount: 'jregkolpig@gmail.com',
      code: '123456',
      from: 'Google <no-reply@google.com>',
      subject: 'Verification',
      date: '2026-06-01T10:00:00.000Z',
    });
    assert.deepEqual(calls, [
      ['getPublicCodeAccountByKey', 'vc_public_key'],
      ['getAccountByGmailEmail', 'jregkolpig@gmail.com'],
      ['fetchMessages', mainAccount, { readLocation: 'inbox', limit: 30, targetEmail: 'jregkolpig+s2@gmail.com' }],
    ]);
  } finally {
    await server.close();
  }
});

test('GET /api/verification-code/public/latest rejects missing or disabled public key', async () => {
  const app = createApp({
    accounts: {
      getAccountByGmailEmail() {
        throw new Error('should not resolve Gmail account without allowed public key');
      },
    },
    replacementAccounts: {
      getPublicCodeAccountByKey() {
        return null;
      },
    },
    mailService: {
      async fetchMessages() {
        throw new Error('should not fetch without allowed public key');
      },
    },
  });
  const server = await startTestServer(app);

  try {
    const missing = await fetch(`${server.baseUrl}/api/verification-code/public/latest`);
    assert.equal(missing.status, 400);
    assert.deepEqual(await missing.json(), {
      ok: false,
      error: 'KEY_REQUIRED',
      message: 'key is required',
    });

    const denied = await fetch(`${server.baseUrl}/api/verification-code/public/latest?key=disabled`);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), {
      ok: false,
      error: 'PUBLIC_ACCESS_DENIED',
      message: '验证码访问 key 无效或未启用',
    });
  } finally {
    await server.close();
  }
});
