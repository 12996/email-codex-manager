'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { RoxyBrowserClient } = require('../src/auto/roxy-browser-client.cjs');

function createClient({ request, playwright } = {}) {
  return new RoxyBrowserClient({
    apiBaseUrl: 'http://roxy.invalid',
    workspaceId: 1,
    dirId: 'profile-1',
    request,
    playwright,
  });
}

function connectedBrowser() {
  const page = { id: 'page-1' };
  const context = {
    pages() {
      return [page];
    },
  };
  return {
    contexts() {
      return [context];
    },
    async close() {},
    context,
    page,
  };
}

test('waitForConnectionInfo polls an empty Roxy response until a websocket exists', async () => {
  let requests = 0;
  const client = createClient({
    request: async () => {
      requests += 1;
      return requests === 1
        ? { code: 0, data: [] }
        : { code: 0, data: [{ dirId: 'profile-1', ws: 'ws://fresh-endpoint' }] };
    },
  });

  const info = await client.waitForConnectionInfo({ attempts: 2, intervalMs: 0 });

  assert.equal(info.ws, 'ws://fresh-endpoint');
  assert.equal(requests, 2);
});

test('connectPlaywright forwards an explicit bounded timeout', async () => {
  const calls = [];
  const browser = connectedBrowser();
  const client = createClient({
    playwright: {
      chromium: {
        async connectOverCDP(endpoint, options) {
          calls.push({ endpoint, options });
          return browser;
        },
      },
    },
  });

  const connected = await client.connectPlaywright('ws://test-endpoint', { timeoutMs: 1234 });

  assert.equal(connected.page, browser.page);
  assert.deepEqual(calls, [{ endpoint: 'ws://test-endpoint', options: { timeout: 1234 } }]);
});

test('connectReadyPlaywright refreshes connection info after a failed attach', async () => {
  let connectionReads = 0;
  const endpoints = [];
  const browser = connectedBrowser();
  const client = createClient({
    request: async () => {
      connectionReads += 1;
      return {
        code: 0,
        data: [{
          dirId: 'profile-1',
          ws: connectionReads === 1 ? 'ws://stale-endpoint' : 'ws://fresh-endpoint',
        }],
      };
    },
    playwright: {
      chromium: {
        async connectOverCDP(endpoint) {
          endpoints.push(endpoint);
          if (endpoints.length === 1) throw new Error('transport closed');
          return browser;
        },
      },
    },
  });

  const connected = await client.connectReadyPlaywright({
    connectionInfoAttempts: 1,
    connectionInfoIntervalMs: 0,
    connectAttempts: 2,
    retryDelayMs: 0,
  });

  assert.equal(connected.page, browser.page);
  assert.deepEqual(endpoints, ['ws://stale-endpoint', 'ws://fresh-endpoint']);
  assert.equal(connectionReads, 2);
});

test('exhausted attach attempts return a safe classified error', async () => {
  const endpoint = 'ws://sensitive-cdp-endpoint';
  const client = createClient({
    request: async () => ({ code: 0, data: [{ dirId: 'profile-1', ws: endpoint }] }),
    playwright: {
      chromium: {
        async connectOverCDP() {
          throw new Error(`cannot reach ${endpoint}`);
        },
      },
    },
  });

  await assert.rejects(
    () => client.connectReadyPlaywright({
      connectionInfoAttempts: 1,
      connectionInfoIntervalMs: 0,
      connectAttempts: 2,
      retryDelayMs: 0,
    }),
    (error) => error?.code === 'ROXY_CDP_ATTACH_FAILED'
      && !String(error.message).includes(endpoint),
  );
});
