import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { RoxyBrowserClient } = require('../src/auto/roxy-browser-client.cjs');

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
