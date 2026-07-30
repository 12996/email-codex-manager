import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoxyProxyService } from '../src/roxyProxyService.js';

function createSettings({ binding = defaultBinding, template = defaultTemplate } = {}) {
  const refreshes = [];
  const statuses = [];
  return {
    getRoxyProxyBinding(dirId) {
      return binding?.dirId === dirId ? binding : undefined;
    },
    getRoxyProxyTemplateCredentials() {
      return template;
    },
    recordRoxyProxyRefresh(dirId, result) {
      refreshes.push([dirId, result]);
    },
    recordRoxyProxyStatus(dirId, status) {
      statuses.push([dirId, status]);
    },
    refreshes,
    statuses,
  };
}

const defaultBinding = {
  dirId: 'dir-jp',
  proxyId: 12,
};

const defaultTemplate = {
  workspaceId: 7,
  host: 'us.arxlabs.io',
  port: '3010',
  accountPrefix: 'sttj1150537',
  password: 'proxy-password',
  country: 'JP',
  ttlMinutes: 5,
  protocol: 'SOCKS5',
  ipType: 'IPV4',
  checkChannel: 'arx',
  refreshUrl: 'https://proxy.example/refresh',
  remark: 'JP proxy',
};

function createClient(calls, { connection = { ws: 'ws://fresh-profile', ip: '203.0.113.10' } } = {}) {
  return {
    dirId: 'dir-jp',
    async resolveDirId() { calls.push('resolve'); return this.dirId; },
    async modifyProxy(proxyId, payload) { calls.push(['modify', proxyId, payload]); },
    async closeBrowser() { calls.push('close'); },
    async clearLocalCache() { calls.push('clear-local'); },
    async clearServerCache() { calls.push('clear-server'); },
    async randomFingerprint() { calls.push('random-fingerprint'); },
    async openBrowser(args) { calls.push(['open', args]); },
    async getConnectionInfo() { calls.push('connection-info'); return connection; },
  };
}

test('bound Roxy proxy refresh modifies only its proxyId, uses the strict order, and never returns a password', async () => {
  const calls = [];
  const settings = createSettings();
  const service = createRoxyProxyService({
    settingsRepository: settings,
    roxyClientFactory: async () => createClient(calls),
    generateSid: () => 'Ab12Cd34',
    now: () => new Date('2026-07-30T10:00:00.000Z'),
  });

  const result = await service.refreshBrowserProxy({ dirId: 'dir-jp', openArgs: ['--headless=new'] });

  assert.deepEqual(calls, [
    ['modify', 12, {
      workspaceId: 7,
      checkChannel: 'arx',
      ipType: 'IPV4',
      protocol: 'SOCKS5',
      host: 'us.arxlabs.io',
      port: '3010',
      proxyUserName: 'sttj1150537-region-JP-sid-Ab12Cd34-t-5',
      proxyPassword: 'proxy-password',
      refreshUrl: 'https://proxy.example/refresh',
      remark: 'JP proxy',
    }],
    'close',
    'clear-local',
    'clear-server',
    'random-fingerprint',
    ['open', ['--headless=new']],
    'connection-info',
  ]);
  assert.deepEqual(settings.refreshes, [[
    'dir-jp',
    {
      username: 'sttj1150537-region-JP-sid-Ab12Cd34-t-5',
      ip: '203.0.113.10',
      cdpStatus: 'ready',
      refreshedAt: '2026-07-30T10:00:00.000Z',
    },
  ]]);
  assert.deepEqual(result, {
    dirId: 'dir-jp',
    proxyId: 12,
    username: 'sttj1150537-region-JP-sid-Ab12Cd34-t-5',
    cdpEndpoint: 'ws://fresh-profile',
    lastRefreshIp: '203.0.113.10',
    refreshedAt: '2026-07-30T10:00:00.000Z',
  });
  assert.equal(JSON.stringify(result).includes('proxy-password'), false);
});

test('refresh stops at the failing operation and does not open the browser or persist a result', async () => {
  const calls = [];
  const settings = createSettings();
  const client = createClient(calls);
  client.clearServerCache = async () => {
    calls.push('clear-server');
    throw new Error('cache unavailable');
  };
  const service = createRoxyProxyService({ settingsRepository: settings, roxyClientFactory: async () => client });

  await assert.rejects(
    () => service.refreshBrowserProxy({ dirId: 'dir-jp' }),
    /ROXY_PROXY_REFRESH_FAILED.*clearServerCache.*cache unavailable/,
  );
  assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
    'modify', 'close', 'clear-local', 'clear-server',
  ]);
  assert.deepEqual(settings.refreshes, []);
  assert.deepEqual(settings.statuses, [['dir-jp', 'failed']]);
});

test('refresh rejects an active task or an existing profile lease without modifying the proxy', async () => {
  const calls = [];
  const settings = createSettings();
  const service = createRoxyProxyService({
    settingsRepository: settings,
    roxyClientFactory: async () => createClient(calls),
    isTaskActive: (dirId) => dirId === 'dir-active',
  });

  await assert.rejects(
    () => service.refreshBrowserProxy({ dirId: 'dir-active' }),
    /ROXY_PROXY_REFRESH_BUSY.*窗口正被任务使用，不能切换代理/,
  );

  const held = await service.prepareBoundBrowser({
    env: { ROXY_BROWSER_DIR_ID: 'dir-jp' },
    owner: 'current-task',
  });
  await assert.rejects(
    () => service.refreshBrowserProxy({ dirId: 'dir-jp' }),
    /ROXY_PROXY_REFRESH_BUSY.*窗口正被任务使用，不能切换代理/,
  );
  held.release();
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === 'modify').length, 1);
});

test('preparing an unbound browser makes no proxy mutation and leaves the caller on the legacy path', async () => {
  const calls = [];
  const service = createRoxyProxyService({
    settingsRepository: createSettings({ binding: null }),
    roxyClientFactory: async () => createClient(calls),
  });

  const result = await service.prepareBoundBrowser({
    env: { ROXY_BROWSER_DIR_ID: 'dir-jp' },
    owner: 'current-task',
  });

  assert.equal(result, undefined);
  assert.deepEqual(calls, ['resolve']);
});

test('prepareBoundBrowser rejects an externally active task before proxy modification', async () => {
  const calls = [];
  const service = createRoxyProxyService({
    settingsRepository: createSettings(),
    roxyClientFactory: async () => createClient(calls),
    isTaskActive: () => true,
  });

  await assert.rejects(
    () => service.prepareBoundBrowser({
      env: { ROXY_BROWSER_DIR_ID: 'dir-jp' },
      owner: 'new-task',
    }),
    /ROXY_PROXY_REFRESH_BUSY.*窗口正被任务使用，不能切换代理/,
  );
  assert.deepEqual(calls, ['resolve']);
});

test('prepareBoundBrowser accepts only the matching active owner and keeps its lease until released', async () => {
  const calls = [];
  const owner = 'protocol-job-7';
  const service = createRoxyProxyService({
    settingsRepository: createSettings(),
    roxyClientFactory: async () => createClient(calls),
    isTaskActive: () => ({ active: true, owner }),
  });

  const prepared = await service.prepareBoundBrowser({
    env: { ROXY_BROWSER_DIR_ID: 'dir-jp' },
    owner,
  });
  assert.equal(service.isLeased('dir-jp'), true);
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === 'modify'), true);

  prepared.release();
  assert.equal(service.isLeased('dir-jp'), false);
});

test('prepareBoundBrowser rejects an active task with an unknown or mismatched owner', async () => {
  const calls = [];
  const service = createRoxyProxyService({
    settingsRepository: createSettings(),
    roxyClientFactory: async () => createClient(calls),
    isTaskActive: () => ({ active: true, owner: 'queue-job-8' }),
  });

  await assert.rejects(
    () => service.prepareBoundBrowser({
      env: { ROXY_BROWSER_DIR_ID: 'dir-jp' },
      owner: 'queue-job-7',
    }),
    /ROXY_PROXY_REFRESH_BUSY/,
  );
  assert.deepEqual(calls, ['resolve']);
});

test('missing CDP endpoint never persists a ready refresh state', async () => {
  const calls = [];
  const settings = createSettings();
  const service = createRoxyProxyService({
    settingsRepository: settings,
    roxyClientFactory: async () => createClient(calls, { connection: { ws: '' } }),
  });

  await assert.rejects(
    () => service.refreshBrowserProxy({ dirId: 'dir-jp' }),
    /ROXY_PROXY_REFRESH_FAILED.*CDP endpoint/,
  );
  assert.deepEqual(settings.refreshes, []);
  assert.deepEqual(settings.statuses, [['dir-jp', 'missing']]);
});

test('a persistence failure after a valid CDP endpoint never leaves a ready refresh state', async () => {
  const calls = [];
  const settings = createSettings();
  settings.recordRoxyProxyRefresh = () => {
    throw new Error('database unavailable');
  };
  const service = createRoxyProxyService({
    settingsRepository: settings,
    roxyClientFactory: async () => createClient(calls),
  });

  await assert.rejects(
    () => service.refreshBrowserProxy({ dirId: 'dir-jp' }),
    /database unavailable/,
  );
  assert.deepEqual(settings.refreshes, []);
  assert.deepEqual(settings.statuses, [['dir-jp', 'failed']]);
});
