import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { RoxyBrowserClient } = require('../src/auto/roxy-browser-client.cjs');

test('RoxyBrowserClient 读取代理列表时使用 token 并且不返回代理密码', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init]);
    return new Response(JSON.stringify({
      code: 0,
      data: {
        rows: [{
          id: 12,
          ipType: 'IPV4',
          protocol: 'SOCKS5',
          host: 'us.arxlabs.io',
          port: '3010',
          proxyUserName: 'sttj1150537-region-JP-sid-Ab12Cd34-t-5',
          proxyPassword: 'must-not-leak',
          checkChannel: 'arx',
          refreshUrl: 'https://proxy.example/refresh',
          remark: 'JP template',
        }],
      },
      msg: '成功',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const client = new RoxyBrowserClient({
      apiBaseUrl: 'http://127.0.0.1:9999',
      token: 'test-token',
      workspaceId: 7,
    });

    const proxies = await client.listProxies();

    assert.deepEqual(proxies, [{
      id: 12,
      ipType: 'IPV4',
      protocol: 'SOCKS5',
      host: 'us.arxlabs.io',
      port: '3010',
      username: 'sttj1150537-region-JP-sid-Ab12Cd34-t-5',
      checkChannel: 'arx',
      refreshUrl: 'https://proxy.example/refresh',
      remark: 'JP template',
      passwordConfigured: true,
    }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'http://127.0.0.1:9999/proxy/list?workspaceId=7&pageIndex=1&pageSize=100');
    assert.equal(calls[0][1].method, 'GET');
    assert.equal(calls[0][1].headers.token, 'test-token');
    assert.equal(calls[0][1].body, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('RoxyBrowserClient 读取代理检测渠道', async () => {
  const calls = [];
  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    token: 'test-token',
    request: async (method, path, body) => {
      calls.push([method, path, body]);
      return { code: 0, data: [{ label: 'ARX', value: 'arx' }], msg: '成功' };
    },
  });

  assert.deepEqual(await client.detectProxyChannels(), [{ label: 'ARX', value: 'arx' }]);
  assert.deepEqual(calls, [['GET', '/proxy/detect_channel', {}]]);
});

test('RoxyBrowserClient 创建代理时校验必填字段并发送完整 Roxy 请求体', async () => {
  const calls = [];
  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    workspaceId: 7,
    request: async (method, path, body) => {
      calls.push([method, path, body]);
      return {
        code: 0,
        data: { ...body, id: 12, proxyPassword: 'must-not-leak' },
        msg: '成功',
      };
    },
  });
  const payload = {
    checkChannel: 'arx',
    ipType: 'IPV4',
    protocol: 'SOCKS5',
    host: 'us.arxlabs.io',
    port: '3010',
    proxyUserName: 'sttj1150537-region-JP-sid-Ab12Cd34-t-5',
    proxyPassword: 'secret',
    refreshUrl: 'https://proxy.example/refresh',
    remark: 'JP template',
  };

  const created = await client.createProxy(payload);

  assert.deepEqual(calls, [['POST', '/proxy/create', { workspaceId: 7, ...payload }]]);
  assert.deepEqual(created, {
    id: 12,
    ipType: 'IPV4',
    protocol: 'SOCKS5',
    host: 'us.arxlabs.io',
    port: '3010',
    username: 'sttj1150537-region-JP-sid-Ab12Cd34-t-5',
    checkChannel: 'arx',
    refreshUrl: 'https://proxy.example/refresh',
    remark: 'JP template',
    passwordConfigured: true,
  });

  await assert.rejects(
    () => client.createProxy({ ...payload, proxyPassword: '' }),
    /缺少必要参数: proxyPassword/
  );
  assert.equal(calls.length, 1);
});

test('RoxyBrowserClient 修改指定 proxyId，且不会把密码回显到返回值', async () => {
  const calls = [];
  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    workspaceId: 7,
    request: async (method, path, body) => {
      calls.push([method, path, body]);
      return { code: 0, data: { ...body }, msg: '成功' };
    },
  });
  const payload = {
    checkChannel: 'arx',
    ipType: 'IPV4',
    protocol: 'SOCKS5',
    host: 'us.arxlabs.io',
    port: '3010',
    proxyUserName: 'sttj1150537-region-JP-sid-Zy98Xw76-t-5',
    proxyPassword: 'secret',
    refreshUrl: '',
    remark: 'JP refreshed',
  };

  const modified = await client.modifyProxy(12, payload);

  assert.deepEqual(calls, [['POST', '/proxy/modify', { workspaceId: 7, id: 12, ...payload }]]);
  assert.deepEqual(modified, {
    id: 12,
    ipType: 'IPV4',
    protocol: 'SOCKS5',
    host: 'us.arxlabs.io',
    port: '3010',
    username: 'sttj1150537-region-JP-sid-Zy98Xw76-t-5',
    checkChannel: 'arx',
    refreshUrl: '',
    remark: 'JP refreshed',
    passwordConfigured: true,
  });
});

test('RoxyBrowserClient 只接受浏览器记录显式提供的 proxyId', async () => {
  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    workspaceId: 7,
    request: async () => ({
      code: 0,
      data: [{
        dirId: 'dir-1',
        sortNum: 10,
        windowName: 'JP window',
        proxyInfo: { id: 12, host: 'us.arxlabs.io', port: '3010' },
      }],
      msg: '成功',
    }),
  });

  await assert.rejects(
    () => client.getBrowserProfile('dir-1'),
    /dir-1.*无法识别 proxyId.*不能安全建立绑定/
  );
});

test('RoxyBrowserClient 保留 listBrowsers 的原始 proxyInfo 响应契约', async () => {
  const response = {
    code: 0,
    data: [{
      dirId: 'dir-1',
      proxyInfo: { lastIp: '203.0.113.10', host: 'us.arxlabs.io' },
    }],
    msg: '成功',
  };
  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    workspaceId: 7,
    request: async () => response,
  });

  assert.equal(await client.listBrowsers(), response);
});

test('RoxyBrowserClient 返回浏览器的显式 proxyId 和脱敏代理关联信息', async () => {
  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    workspaceId: 7,
    request: async () => ({
      code: 0,
      data: [{
        dirId: 'dir-1',
        sortNum: 10,
        windowName: 'JP window',
        proxyId: 12,
        proxyInfo: {
          host: 'us.arxlabs.io',
          port: '3010',
          protocol: 'SOCKS5',
          proxyUserName: 'sttj1150537-region-JP-sid-Ab12Cd34-t-5',
          proxyPassword: 'must-not-leak',
          lastIp: '203.0.113.10',
        },
      }],
      msg: '成功',
    }),
  });

  assert.deepEqual(await client.getBrowserProfile('dir-1'), {
    dirId: 'dir-1',
    sortNum: 10,
    windowName: 'JP window',
    proxyId: 12,
    proxy: {
      host: 'us.arxlabs.io',
      port: '3010',
      protocol: 'SOCKS5',
      username: 'sttj1150537-region-JP-sid-Ab12Cd34-t-5',
      lastIp: '203.0.113.10',
      passwordConfigured: true,
    },
  });
});

test('launchAndConnect 按清缓存、随机指纹、打开、取 CDP、连接 Playwright 的顺序执行', async () => {
  const calls = [];
  const fakeBrowser = { close: async () => calls.push(['playwright.close']) };
  const fakeContext = { pages: () => [] };
  const fakePage = { marker: 'new-page' };
  fakeContext.newPage = async () => {
    calls.push(['context.newPage']);
    return fakePage;
  };

  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    token: 'test-token',
    workspaceId: 1,
    dirId: 'dir-1',
    request: async (method, path, body) => {
      calls.push([method, path, body]);
      if (path === '/browser/open') {
        return { code: 0, data: { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }, msg: '成功' };
      }
      if (path === '/browser/connection_info') {
        return {
          code: 0,
          data: [{ dirId: 'dir-1', ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }],
          msg: '成功',
        };
      }
      return { code: 0, msg: '成功' };
    },
    playwright: {
      chromium: {
        connectOverCDP: async (ws) => {
          calls.push(['connectOverCDP', ws]);
          return {
            contexts: () => [fakeContext],
            newContext: async () => fakeContext,
            close: fakeBrowser.close,
          };
        },
      },
    },
  });

  const session = await client.launchAndConnect();

  assert.equal(session.cdpEndpoint, 'ws://127.0.0.1:9222/devtools/browser/abc');
  assert.equal(session.page, fakePage);
  assert.deepEqual(calls, [
    ['POST', '/browser/close', { dirId: 'dir-1' }],
    ['POST', '/browser/clear_local_cache', { dirIds: ['dir-1'] }],
    ['POST', '/browser/clear_server_cache', { workspaceId: 1, dirIds: ['dir-1'] }],
    ['POST', '/browser/random_env', { workspaceId: 1, dirId: 'dir-1' }],
    ['POST', '/browser/open', { workspaceId: 1, dirId: 'dir-1', dirIds: ['dir-1'] }],
    ['GET', '/browser/connection_info', { dirIds: 'dir-1' }],
    ['connectOverCDP', 'ws://127.0.0.1:9222/devtools/browser/abc'],
    ['context.newPage'],
  ]);
});

test('RoxyBrowserClient 在 Roxy API 返回失败时抛出包含接口路径的错误', async () => {
  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    workspaceId: 1,
    dirId: 'dir-1',
    request: async () => ({ code: 500, msg: '失败' }),
  });

  await assert.rejects(
    () => client.randomFingerprint(),
    /\/browser\/random_env 调用失败: 失败/
  );
});

test('RoxyBrowserClient updateBrowserConfig 调用 Roxy profile 修改接口', async () => {
  const calls = [];
  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    workspaceId: 1,
    dirId: 'dir-1',
    request: async (method, path, body) => {
      calls.push([method, path, body]);
      return { code: 0, msg: '成功' };
    },
  });

  await client.updateBrowserConfig({
    fingerInfo: {
      openWidth: '1600',
      openHeight: '900',
    },
  });

  assert.deepEqual(calls, [[
    'POST',
    '/browser/mdf',
    {
      workspaceId: 1,
      dirId: 'dir-1',
      fingerInfo: {
        openWidth: '1600',
        openHeight: '900',
      },
    },
  ]]);
});

test('RoxyBrowserClient 在 Roxy API 连接失败时抛出包含地址和底层原因的错误', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new TypeError('fetch failed');
    error.cause = { code: 'ECONNREFUSED', address: '127.0.0.1', port: 50000 };
    throw error;
  };

  try {
    const client = new RoxyBrowserClient({
      apiBaseUrl: 'http://127.0.0.1:50000',
      workspaceId: 1,
      dirId: 'dir-1',
    });

    await assert.rejects(
      () => client.listBrowsers(),
      /Roxy API 请求失败: GET http:\/\/127\.0\.0\.1:50000\/browser\/list\?workspaceId=1&pageIndex=1&pageSize=100; 原因=ECONNREFUSED/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('launchAndConnect 未传 dirId 时可按窗口序号解析目标窗口', async () => {
  const calls = [];
  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    workspaceId: 1,
    windowSortNum: 88,
    request: async (method, path, body) => {
      calls.push([method, path, body]);
      if (path === '/browser/list') {
        return {
          code: 0,
          data: {
            list: [
              { dirId: 'other-dir', sortNum: 77, windowName: '其它窗口' },
              { dirId: 'target-dir', sortNum: 88, windowName: '补号窗口' },
            ],
          },
          msg: '成功',
        };
      }
      if (path === '/browser/connection_info') {
        return {
          code: 0,
          data: [{ dirId: 'target-dir', ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }],
          msg: '成功',
        };
      }
      return { code: 0, data: { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }, msg: '成功' };
    },
    playwright: {
      chromium: {
        connectOverCDP: async () => ({
          contexts: () => [{ pages: () => [{ marker: 'existing-page' }] }],
          close: async () => {},
        }),
      },
    },
  });

  const session = await client.launchAndConnect();

  assert.equal(session.dirId, 'target-dir');
  assert.deepEqual(calls.slice(0, 2), [
    ['GET', '/browser/list', { workspaceId: 1, pageIndex: 1, pageSize: 100 }],
    ['POST', '/browser/close', { dirId: 'target-dir' }],
  ]);
});

test('launchAndConnect 未传 dirId 时可按窗口名称解析目标窗口', async () => {
  const client = new RoxyBrowserClient({
    apiBaseUrl: 'http://127.0.0.1:9999',
    workspaceId: 1,
    windowName: '补号窗口',
    request: async (method, path) => {
      if (path === '/browser/list') {
        return {
          code: 0,
          data: [{ dirId: 'target-dir', sortNum: 88, windowName: '补号窗口' }],
          msg: '成功',
        };
      }
      if (path === '/browser/connection_info') {
        return {
          code: 0,
          data: [{ dirId: 'target-dir', ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }],
          msg: '成功',
        };
      }
      return { code: 0, data: { ws: 'ws://127.0.0.1:9222/devtools/browser/abc' }, msg: '成功' };
    },
    playwright: {
      chromium: {
        connectOverCDP: async () => ({
          contexts: () => [{ pages: () => [{ marker: 'existing-page' }] }],
          close: async () => {},
        }),
      },
    },
  });

  const session = await client.launchAndConnect();

  assert.equal(session.dirId, 'target-dir');
});
