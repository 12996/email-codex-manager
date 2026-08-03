import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { createRoxyProxyService } from '../src/roxyProxyService.js';

const require = createRequire(import.meta.url);
const { prepareRoxyNo2FA } = require('../src/auto/prepare_roxy_no_2fa.cjs');

test('prepares the selected Roxy profile in manual refresh order without returning secrets', async () => {
  const calls = [];
  const client = {
    async listBrowsers() {
      calls.push('listBrowsers');
      return { data: { rows: [{ dirId: 'profile-1' }] } };
    },
    async listProxies() {
      calls.push('listProxies');
      return [{ id: 42, checkChannel: 'channel', ipType: 'IPV4', protocol: 'SOCKS5' }];
    },
    async modifyProxy() { calls.push('modifyProxy'); },
    async closeBrowser() { calls.push('closeBrowser'); },
    async clearLocalCache() { calls.push('clearLocalCache'); },
    async clearServerCache() { calls.push('clearServerCache'); },
    async randomFingerprint() { calls.push('randomFingerprint'); },
    async openBrowser() { calls.push('openBrowser'); },
    async getConnectionInfo() {
      calls.push('getConnectionInfo');
      return { ws: 'ws://sensitive-cdp-endpoint' };
    },
  };
  const settingsRepository = {
    getRoxyProxyBinding(dirId) {
      return dirId === 'profile-1' ? { dirId, proxyId: 42 } : undefined;
    },
    getRoxyProxyTemplateCredentials() {
      return {
        workspaceId: 1,
        host: 'proxy.example.test',
        port: '3010',
        accountPrefix: 'account',
        password: 'sensitive-password',
        country: 'JP',
        ttlMinutes: 10,
        checkChannel: 'channel',
        ipType: 'IPV4',
        protocol: 'SOCKS5',
      };
    },
    getRoxyProxyTemplate() {
      return { workspaceId: 1 };
    },
    recordRoxyProxyRefresh() {},
    recordRoxyProxyStatus() {},
  };
  const proxyService = createRoxyProxyService({
    settingsRepository,
    roxyClientFactory: async () => client,
    generateSid: () => 'Abc123Xy',
  });

  const result = await prepareRoxyNo2FA({
    env: { ROXY_NO_2FA_BROWSER_DIR_ID: 'profile-1', ROXY_HEADLESS: 'false' },
    client,
    proxyService,
    settingsRepository,
  });

  assert.deepEqual(calls, [
    'listBrowsers',
    'listProxies',
    'modifyProxy',
    'closeBrowser',
    'clearLocalCache',
    'clearServerCache',
    'randomFingerprint',
    'openBrowser',
    'getConnectionInfo',
  ]);
  assert.deepEqual(result, { dirId: 'profile-1' });
  assert.doesNotMatch(JSON.stringify(result), /sensitive-password|ws:\/\//);
});

test('rejects an unbound Roxy profile before mutating it', async () => {
  await assert.rejects(
    prepareRoxyNo2FA({
      env: { ROXY_NO_2FA_BROWSER_DIR_ID: 'profile-1' },
      client: {
        async listBrowsers() { return { data: { rows: [{ dirId: 'profile-1' }] } }; },
        async listProxies() { return []; },
      },
      proxyService: { refreshBrowserProxy: async () => assert.fail('must not refresh') },
      settingsRepository: {
        getRoxyProxyBinding() { return { dirId: 'profile-1', proxyId: 42 }; },
      },
    }),
    /proxyId=42|绑定|proxy/i,
  );
});
