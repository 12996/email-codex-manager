import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { RoxyCdpBridge } = require('../src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs');

test('Roxy CDP origin warmup waits only for the document response commit', async () => {
  const calls = [];
  const bridge = new RoxyCdpBridge();
  bridge.page = {
    isClosed: () => false,
    url: () => 'about:blank',
    async goto(url, options) {
      calls.push(['goto', url, options.waitUntil]);
    },
    async waitForLoadState(state) {
      calls.push(['waitForLoadState', state]);
    },
  };

  await bridge.ensureOrigin('https://chatgpt.com/api/auth/providers', 30000);

  assert.deepEqual(calls, [
    ['goto', 'https://chatgpt.com/', 'commit'],
  ]);
});

test('Roxy CDP request retries a transient page fetch failure', async () => {
  const bridge = new RoxyCdpBridge();
  let attempts = 0;
  bridge.page = {
    isClosed: () => false,
    url: () => 'https://chatgpt.com/',
    async evaluate() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('page.evaluate: TypeError: Failed to fetch');
      }
      return {
        status_code: 200,
        status_text: 'OK',
        url: 'https://chatgpt.com/api/auth/providers',
        headers: {},
        text: '{}',
      };
    },
  };

  const result = await bridge.request({
    url: 'https://chatgpt.com/api/auth/providers',
    method: 'GET',
    timeout_ms: 1,
  });

  assert.equal(result.status_code, 200);
  assert.equal(attempts, 2);
});

test('Roxy CDP navigation retries transient timeout failures before succeeding', async () => {
  const bridge = new RoxyCdpBridge();
  let attempts = 0;
  bridge.page = {
    isClosed: () => false,
    url: () => 'https://chatgpt.com/',
    async goto(url) {
      attempts += 1;
      if (attempts < 3) throw new Error('page.goto: Timeout 30000ms exceeded');
      return {
        status: () => 200,
        statusText: () => 'OK',
        url: () => url,
        headers: () => ({}),
      };
    },
  };

  const result = await bridge.navigate({ url: 'https://chatgpt.com/', timeout_ms: 1 });

  assert.equal(result.status_code, 200);
  assert.equal(attempts, 3);
});

test('Roxy CDP navigation returns the committed redirect chain without waiting for DOM load', async () => {
  let gotoOptions;
  const initialRequest = {
    redirectedFrom: () => null,
    response: async () => initialResponse,
  };
  const initialResponse = {
    status: () => 302,
    statusText: () => 'Found',
    url: () => 'https://auth.openai.com/api/accounts/email-otp/send',
    headers: () => ({ location: '/email-verification' }),
    request: () => initialRequest,
  };
  const finalRequest = {
    redirectedFrom: () => initialRequest,
    response: async () => finalResponse,
  };
  const finalResponse = {
    status: () => 200,
    statusText: () => 'OK',
    url: () => 'https://auth.openai.com/email-verification',
    headers: () => ({}),
    request: () => finalRequest,
  };
  const bridge = new RoxyCdpBridge();
  bridge.page = {
    isClosed: () => false,
    url: () => 'https://auth.openai.com/email-verification',
    async goto(_url, options) {
      gotoOptions = options;
      return finalResponse;
    },
  };

  const result = await bridge.navigate({
    url: 'https://auth.openai.com/api/accounts/email-otp/send',
    timeout_ms: 30_000,
  });

  assert.equal(gotoOptions.waitUntil, 'commit');
  assert.equal(result.response_committed, true);
  assert.deepEqual(result.redirect_chain, [
    {
      status_code: 302,
      status_text: 'Found',
      url: 'https://auth.openai.com/api/accounts/email-otp/send',
    },
    {
      status_code: 200,
      status_text: 'OK',
      url: 'https://auth.openai.com/email-verification',
    },
  ]);
});

test('Roxy CDP keeps separate pages for ChatGPT, Auth, and Sentinel origins', async () => {
  const pages = [];
  const createPage = (name) => {
    let currentUrl = 'about:blank';
    const page = {
      name,
      gotoCalls: [],
      isClosed: () => false,
      url: () => currentUrl,
      async goto(url) {
        page.gotoCalls.push(url);
        currentUrl = url;
        return {
          status: () => 200,
          statusText: () => 'OK',
          url: () => url,
          headers: () => ({}),
          text: async () => '',
        };
      },
      async waitForLoadState() {},
    };
    pages.push(page);
    return page;
  };
  const context = {
    async newPage() {
      return createPage(`page-${pages.length + 1}`);
    },
    pages: () => pages,
  };
  const bridge = new RoxyCdpBridge();
  bridge.ensureConnected = async function ensureConnectedForTest() {
    this.context = context;
    if (!this.page) {
      this.page = await context.newPage();
      this.ownsPage = true;
    }
  };

  const chatPage = await bridge.ensureOrigin('https://chatgpt.com/api/auth/providers', 30000);
  const authPage = await bridge.ensureOrigin('https://auth.openai.com/email-verification', 30000);
  const sentinelPage = await bridge.ensureOrigin('https://sentinel.openai.com/', 30000);
  const authAgain = await bridge.ensureOrigin('https://auth.openai.com/api/accounts/email-otp/validate', 30000);

  assert.notEqual(chatPage, authPage);
  assert.notEqual(authPage, sentinelPage);
  assert.equal(authAgain, authPage);
  assert.equal(authPage.gotoCalls.length, 1);

  await bridge.navigate({
    url: 'https://auth.openai.com/api/accounts/authorize?state=redacted',
    timeout_ms: 30000,
  });

  assert.equal(authPage.gotoCalls.at(-1), 'https://auth.openai.com/api/accounts/authorize?state=redacted');
  assert.equal(sentinelPage.gotoCalls.length, 1);
});

test('Roxy CDP runs OAuth continue navigation on the ChatGPT page', async () => {
  const pages = [];
  const createPage = (name) => {
    let currentUrl = 'about:blank';
    const page = {
      name,
      gotoCalls: [],
      isClosed: () => false,
      url: () => currentUrl,
      async goto(url) {
        page.gotoCalls.push(url);
        currentUrl = url;
        return {
          status: () => 200,
          statusText: () => 'OK',
          url: () => url,
          headers: () => ({}),
          text: async () => '',
        };
      },
      async waitForLoadState() {},
    };
    pages.push(page);
    return page;
  };
  const context = {
    async newPage() {
      return createPage(`page-${pages.length + 1}`);
    },
    pages: () => pages,
  };
  const bridge = new RoxyCdpBridge();
  bridge.ensureConnected = async function ensureConnectedForTest() {
    this.context = context;
    if (!this.page) {
      this.page = await context.newPage();
      this.ownsPage = true;
    }
  };

  const chatPage = await bridge.ensureOrigin('https://chatgpt.com/api/auth/providers', 30000);
  const authPage = await bridge.ensureOrigin('https://auth.openai.com/email-verification', 30000);
  const callbackUrl = 'https://auth.openai.com/authorize/continue?code=redacted';

  await bridge.navigate({
    url: callbackUrl,
    page_origin: 'https://chatgpt.com',
    timeout_ms: 30000,
  });

  assert.equal(chatPage.gotoCalls.at(-1), callbackUrl);
  assert.equal(authPage.gotoCalls.length, 1);
});

test('Roxy CDP navigation does not wait for a navigation response body to finish', async () => {
  const page = {
    isClosed: () => false,
    url: () => 'about:blank',
    async goto(url) {
      return {
        status: () => 200,
        statusText: () => 'OK',
        url: () => url,
        headers: () => ({}),
        text: async () => new Promise(() => {}),
      };
    },
    async waitForLoadState() {},
  };
  const context = {
    async newPage() { return page; },
    pages: () => [page],
  };
  const bridge = new RoxyCdpBridge();
  bridge.ensureConnected = async function ensureConnectedForTest() {
    this.context = context;
    this.page = page;
  };

  const result = await Promise.race([
    bridge.navigate({
      url: 'https://auth.openai.com/oauth/authorize?state=redacted',
      timeout_ms: 1000,
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('navigation response body blocked')), 100)),
  ]);

  assert.equal(result.status_code, 200);
});

test('Roxy CDP navigation goes directly to the requested Auth URL without origin warmup', async () => {
  const gotoCalls = [];
  const page = {
    isClosed: () => false,
    url: () => 'about:blank',
    async goto(url) {
      gotoCalls.push(url);
      return {
        status: () => 200,
        statusText: () => 'OK',
        url: () => url,
        headers: () => ({}),
        text: async () => '',
      };
    },
    async waitForLoadState() {},
  };
  const bridge = new RoxyCdpBridge();
  bridge.page = page;
  bridge.ensureConnected = async function ensureConnectedForTest() {};

  await bridge.navigate({
    url: 'https://auth.openai.com/oauth/authorize?state=redacted',
    timeout_ms: 30000,
  });

  assert.deepEqual(gotoCalls, [
    'https://auth.openai.com/oauth/authorize?state=redacted',
  ]);
});

test('Roxy CDP can reuse one page when origin isolation is disabled', async () => {
  const pages = [];
  const page = {
    gotoCalls: [],
    isClosed: () => false,
    url: () => page.currentUrl,
    currentUrl: 'about:blank',
    async goto(url) {
      page.gotoCalls.push(url);
      page.currentUrl = url;
      return {
        status: () => 200,
        statusText: () => 'OK',
        url: () => url,
        headers: () => ({}),
        text: async () => '',
      };
    },
    async waitForLoadState() {},
  };
  pages.push(page);
  const context = {
    async newPage() {
      throw new Error('single-page mode should not create another page');
    },
    pages: () => pages,
  };
  const bridge = new RoxyCdpBridge({ originIsolationEnabled: false });
  bridge.ensureConnected = async function ensureConnectedForTest() {
    this.context = context;
    this.page = page;
  };

  const chatPage = await bridge.ensureOrigin('https://chatgpt.com/api/auth/providers', 30000);
  const authPage = await bridge.ensureOrigin('https://auth.openai.com/email-verification', 30000);

  assert.equal(authPage, chatPage);
  assert.deepEqual(page.gotoCalls, ['https://chatgpt.com/', 'https://auth.openai.com/']);
});

test('Roxy CDP replaces a closed origin page without refreshing the profile', async () => {
  let evaluateCalls = 0;
  const closedPage = {
    isClosed: () => true,
    url: () => 'https://chatgpt.com/',
  };
  const livePage = {
    isClosed: () => false,
    url: () => 'about:blank',
    async goto() {},
    async waitForLoadState() {},
    async evaluate() {
      evaluateCalls += 1;
      return {
        status_code: 200,
        status_text: 'OK',
        url: 'https://chatgpt.com/api/auth/providers',
        headers: {},
        text: '{}',
      };
    },
  };
  const context = {
    pages: () => [closedPage],
    async newPage() {
      return livePage;
    },
  };
  const bridge = new RoxyCdpBridge();
  bridge.browser = {};
  bridge.context = context;
  bridge.page = closedPage;
  bridge.pagesByOrigin.set('https://chatgpt.com', closedPage);

  const result = await bridge.request({
    url: 'https://chatgpt.com/api/auth/providers',
    method: 'GET',
    timeout_ms: 10,
  });

  assert.equal(result.status_code, 200);
  assert.equal(evaluateCalls, 1);
  assert.equal(bridge.page, livePage);
});

test('Roxy CDP reads the selected profile exit IP without exposing proxy credentials', async () => {
  const bridge = new RoxyCdpBridge();
  bridge.roxyClient = {
    dirId: 'target-profile',
    windowSortNum: '3',
    windowName: 'test',
    async listBrowsers() {
      return {
        code: 0,
        data: {
          rows: [{
            dirId: 'target-profile',
            proxyInfo: {
              lastIp: '203.0.113.10',
              proxyUserName: 'private-user',
              proxyPassword: 'private-password',
            },
          }],
        },
      };
    },
  };

  assert.deepEqual(await bridge.ip(), { ip: '203.0.113.10' });
});

test('Roxy CDP extracts only OpenAI workspace metadata from the Auth session cookie', async () => {
  const encoded = Buffer.from(JSON.stringify({
    email: 'user@example.com',
    workspaces: [
      { id: 'personal-workspace', kind: 'personal', name: null },
      { id: 'team-workspace', kind: 'team', name: 'Team' },
    ],
  })).toString('base64url');
  const bridge = new RoxyCdpBridge();
  bridge.ensureConnected = async function ensureConnectedForTest() {
    this.context = {
      async cookies() {
        return [
          { name: 'oai-client-auth-session', value: `${encoded}.signature` },
          { name: 'unrelated', value: 'must-not-be-read-out' },
        ];
      },
    };
  };

  assert.deepEqual(await bridge.authWorkspaces(), [
    { id: 'personal-workspace', kind: 'personal', name: '' },
    { id: 'team-workspace', kind: 'team', name: 'Team' },
  ]);
});
