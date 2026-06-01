import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('roxy_oauth_login 默认导航 OAuth 授权页并保持 Roxy 窗口打开', async () => {
  const messages = [];
  const calls = [];

  class FakeRoxyBrowserClient {
    constructor() {
      calls.push(['constructor']);
      this.dirId = 'dir-1';
      this.workspaceId = 1;
    }

    async resolveDirId() {
      calls.push(['resolveDirId']);
      return 'dir-1';
    }

    async closeBrowser() {
      calls.push(['closeBrowser']);
    }

    async clearLocalCache() {
      calls.push(['clearLocalCache']);
    }

    async clearServerCache() {
      calls.push(['clearServerCache']);
    }

    async randomFingerprint() {
      calls.push(['randomFingerprint']);
    }

    async openBrowser() {
      calls.push(['openBrowser']);
    }

    async getConnectionInfo() {
      calls.push(['getConnectionInfo']);
      return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' };
    }

    async connectPlaywright(ws) {
      calls.push(['connectPlaywright', ws]);
      return {
        browser: {
          disconnect: async () => calls.push(['browser.disconnect']),
          close: async () => calls.push(['browser.close']),
        },
        page: {
          goto: async (url, options) => calls.push(['page.goto', url, options.waitUntil]),
          waitForLoadState: async (state) => calls.push(['page.waitForLoadState', state]),
          url: () => 'https://chatgpt.com/',
          title: async () => 'ChatGPT',
        },
      };
    }
  }

  const { run } = require('../src/auto/roxy_oauth_login.js');

  const result = await run([], {
    RoxyBrowserClient: FakeRoxyBrowserClient,
    dotenv: { config: () => calls.push(['dotenv.config']) },
    logger: {
      log: (message) => messages.push(String(message)),
      error: (message) => messages.push(String(message)),
      warn: (message) => messages.push(String(message)),
    },
    env: {
      ROXY_API_BASE_URL: 'http://127.0.0.1:59325',
      ROXY_WORKSPACE_ID: '1',
      ROXY_BROWSER_DIR_ID: 'dir-1',
    },
  });

  assert.match(result.targetUrl, /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
  assert.equal(result.keepOpen, true);
  assert.deepEqual(calls, [
    ['dotenv.config'],
    ['constructor'],
    ['resolveDirId'],
    ['closeBrowser'],
    ['clearLocalCache'],
    ['clearServerCache'],
    ['randomFingerprint'],
    ['openBrowser'],
    ['getConnectionInfo'],
    ['connectPlaywright', 'ws://127.0.0.1:9222/devtools/browser/abc'],
    calls[10],
    ['page.waitForLoadState', 'networkidle'],
    ['browser.disconnect'],
  ]);
  assert.equal(calls[10][0], 'page.goto');
  assert.match(calls[10][1], /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
  assert.equal(calls[10][2], 'domcontentloaded');
  assert.equal(calls.some((call) => call[0] === 'browser.close'), false);
  assert.match(messages.join('\n'), /读取配置/);
  assert.match(messages.join('\n'), /解析目标窗口/);
  assert.match(messages.join('\n'), /清缓存/);
  assert.match(messages.join('\n'), /随机指纹/);
  assert.match(messages.join('\n'), /打开窗口/);
  assert.match(messages.join('\n'), /获取 CDP/);
  assert.match(messages.join('\n'), /Playwright 连接/);
  assert.match(messages.join('\n'), /导航目标 URL/);
  assert.match(messages.join('\n'), /当前页面 URL/);
  assert.match(messages.join('\n'), /保持浏览器打开: 是/);
});

test('openRoxyBrowserForAutomation 打开 Roxy 窗口并返回 CDP 和 Playwright 对象', async () => {
  const calls = [];

  class FakeRoxyBrowserClient {
    constructor() {
      this.dirId = 'dir-1';
      this.workspaceId = 1;
    }
    async resolveDirId() { calls.push(['resolveDirId']); return 'dir-1'; }
    async closeBrowser() { calls.push(['closeBrowser']); }
    async clearLocalCache() { calls.push(['clearLocalCache']); }
    async clearServerCache() { calls.push(['clearServerCache']); }
    async randomFingerprint() { calls.push(['randomFingerprint']); }
    async openBrowser() { calls.push(['openBrowser']); }
    async getConnectionInfo() {
      calls.push(['getConnectionInfo']);
      return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' };
    }
    async connectPlaywright(ws) {
      calls.push(['connectPlaywright', ws]);
      return { browser: { disconnect: async () => {} }, page: { marker: 'page' }, context: { marker: 'context' } };
    }
  }

  const { openRoxyBrowserForAutomation } = require('../src/auto/roxy_oauth_login.js');

  const session = await openRoxyBrowserForAutomation({
    RoxyBrowserClient: FakeRoxyBrowserClient,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    env: {},
  });

  assert.equal(session.dirId, 'dir-1');
  assert.equal(session.workspaceId, 1);
  assert.equal(session.cdpEndpoint, 'ws://127.0.0.1:9222/devtools/browser/abc');
  assert.equal(session.page.marker, 'page');
  assert.deepEqual(calls, [
    ['resolveDirId'],
    ['closeBrowser'],
    ['clearLocalCache'],
    ['clearServerCache'],
    ['randomFingerprint'],
    ['openBrowser'],
    ['getConnectionInfo'],
    ['connectPlaywright', 'ws://127.0.0.1:9222/devtools/browser/abc'],
  ]);
});

test('closeRoxyBrowserSession 默认断开 Playwright 并保持 Roxy 窗口打开', async () => {
  const calls = [];
  const { closeRoxyBrowserSession } = require('../src/auto/roxy_oauth_login.js');

  const result = await closeRoxyBrowserSession({
    browser: { disconnect: async () => calls.push(['browser.disconnect']) },
    client: { closeBrowser: async () => calls.push(['client.closeBrowser']) },
  }, {
    keepOpen: true,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result, 'disconnect');
  assert.deepEqual(calls, [['browser.disconnect']]);
});

test('closeRoxyBrowserSession 可关闭 Playwright 和 Roxy 窗口', async () => {
  const calls = [];
  const { closeRoxyBrowserSession } = require('../src/auto/roxy_oauth_login.js');

  const result = await closeRoxyBrowserSession({
    browser: { close: async () => calls.push(['browser.close']) },
    client: { closeBrowser: async () => calls.push(['client.closeBrowser']) },
  }, {
    keepOpen: false,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  assert.equal(result, 'close');
  assert.deepEqual(calls, [['browser.close'], ['client.closeBrowser']]);
});

test('roxy_oauth_login 允许命令行第一个参数覆盖目标 URL', async () => {
  const navigatedUrls = [];

  class FakeRoxyBrowserClient {
    async resolveDirId() { return 'dir-1'; }
    async closeBrowser() {}
    async clearLocalCache() {}
    async clearServerCache() {}
    async randomFingerprint() {}
    async openBrowser() {}
    async getConnectionInfo() { return { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }; }
    async connectPlaywright() {
      return {
        browser: { disconnect: async () => {} },
        page: {
          goto: async (url) => navigatedUrls.push(url),
          waitForLoadState: async () => {},
          url: () => navigatedUrls[0],
          title: async () => 'Target',
        },
      };
    }
  }

  const { run } = require('../src/auto/roxy_oauth_login.js');

  await run(['https://example.test/path'], {
    RoxyBrowserClient: FakeRoxyBrowserClient,
    dotenv: { config: () => {} },
    logger: { log: () => {}, error: () => {}, warn: () => {} },
    env: {
      ROXY_API_BASE_URL: 'http://127.0.0.1:59325',
      ROXY_WORKSPACE_ID: '1',
      ROXY_BROWSER_DIR_ID: 'dir-1',
    },
  });

  assert.deepEqual(navigatedUrls, ['https://example.test/path']);
});

test('roxy_oauth_login 出错时打印清晰错误并设置退出码 1', async () => {
  const errors = [];

  class FailingRoxyBrowserClient {
    async resolveDirId() {
      throw new Error('missing window');
    }
  }

  const { runCli } = require('../src/auto/roxy_oauth_login.js');

  const fakeProcess = {
    argv: ['node', 'src/auto/roxy_oauth_login.js'],
    env: { ROXY_API_BASE_URL: 'http://127.0.0.1:59325', ROXY_WORKSPACE_ID: '1' },
    exitCode: 0,
    exit(code) {
      this.exitCode = code;
    },
  };

  await runCli(fakeProcess, {
    RoxyBrowserClient: FailingRoxyBrowserClient,
    dotenv: { config: () => {} },
    logger: { log: () => {}, warn: () => {}, error: (message) => errors.push(String(message)) },
  });

  assert.equal(fakeProcess.exitCode, 1);
  assert.match(errors.join('\n'), /roxy_oauth_login 失败/);
  assert.match(errors.join('\n'), /missing window/);
});

test('disconnectPlaywright 在 Browser 无 disconnect 时用 close 断开连接', async () => {
  const calls = [];
  const warnings = [];
  const { disconnectPlaywright } = require('../src/auto/roxy_oauth_login.js');

  const mode = await disconnectPlaywright({
    close: async (options) => calls.push(['close', options.reason]),
  }, {
    warn: (message) => warnings.push(String(message)),
  });

  assert.equal(mode, 'close-connection');
  assert.deepEqual(calls, [['close', 'roxy_oauth_login disconnect after navigation']]);
  assert.match(warnings.join('\n'), /断开连接/);
});
