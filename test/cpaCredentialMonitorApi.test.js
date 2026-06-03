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

test('GET /cpa/auth-health returns sanitized monitor status', async () => {
  const app = createApp({
    accounts: {
      listAccounts() {
        return [];
      },
      getAccountByGmailEmail() {
        return null;
      },
    },
    cpaCredentialMonitor: {
      async runOnce() {
        return {
          checked: 1,
          unhealthy: [{ email: 'user@example.com', category: 'auth_expired' }],
          enqueued: [{ email: 'user@example.com', account_id: 7 }],
          skipped: [],
        };
      },
    },
  });
  const server = await startTestServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/cpa/auth-health`, {
      headers: { cookie: authCookie() },
    });
    const text = await response.text();
    const body = JSON.parse(text);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.result.checked, 1);
    assert.equal(Array.isArray(body.result.enqueued), true);
    assert.equal(text.includes('secret'), false);
    assert.equal(text.includes('CPA_MANAGEMENT_KEY'), false);
  } finally {
    await server.close();
  }
});
