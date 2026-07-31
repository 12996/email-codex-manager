import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  manualConfig,
  buildManualTemplate,
  dotenvPath,
  parseArgs,
  roxyProxyServiceModuleUrl,
  shouldRunCli,
  validateConfig,
} = require('./manual-roxy-proxy-refresh.cjs');

test('manual Roxy refresh runner exposes the configured live target', () => {
  assert.deepEqual(manualConfig, {
    confirm: true,
    dirId: '6fad0c799da9c1751d00cbf741127691',
    proxyId: 989971,
    host: 'us.arxlabs.io',
    port: '3010',
    accountPrefix: 'sttj1150537',
    country: 'JP',
    ttl: 5,
    proxyPassword: '4jvxcsadse',
    workspaceId: undefined,
    apiBaseUrl: undefined,
    apiToken: undefined,
  });
});

test('manual Roxy refresh runner maps the CLI ttl to the service ttlMinutes field', () => {
  const template = buildManualTemplate(
    manualConfig,
    { workspaceId: 1 },
    { protocol: 'SOCKS5', ipType: 'IPV4', checkChannel: 'channel' },
  );

  assert.equal(template.ttlMinutes, 5);
  assert.equal(template.ttl, undefined);
});

test('manual Roxy refresh runner parses required runtime configuration', () => {
  const config = parseArgs([
    '--confirm',
    '--dir-id', 'browser-10',
    '--proxy-id', '989971',
    '--host', 'us.arxlabs.io',
    '--port', '3010',
    '--account-prefix', 'sttj1150537',
    '--country', 'JP',
    '--ttl', '5',
    '--proxy-password', 'test-password',
  ]);

  assert.deepEqual(config, {
    confirm: true,
    dirId: 'browser-10',
    proxyId: 989971,
    host: 'us.arxlabs.io',
    port: '3010',
    accountPrefix: 'sttj1150537',
    country: 'JP',
    ttl: 5,
    proxyPassword: 'test-password',
    workspaceId: undefined,
    apiBaseUrl: undefined,
    apiToken: undefined,
  });
  assert.doesNotThrow(() => validateConfig(config));
});

test('manual Roxy refresh runner rejects mutation without --confirm', () => {
  const config = parseArgs([
    '--dir-id', 'browser-10',
    '--proxy-id', '989971',
    '--host', 'us.arxlabs.io',
    '--port', '3010',
    '--account-prefix', 'sttj1150537',
    '--country', 'JP',
    '--ttl', '5',
    '--proxy-password', 'test-password',
  ]);

  assert.throws(() => validateConfig(config), /--confirm/);
});

test('manual Roxy refresh runner stays inert under node --test discovery', () => {
  assert.equal(shouldRunCli({}), true);
  assert.equal(shouldRunCli({ NODE_TEST_CONTEXT: 'child-v8' }), false);
});

test('manual Roxy refresh runner converts the ESM module path to a file URL on Windows', () => {
  assert.match(roxyProxyServiceModuleUrl(), /^file:/);
});

test('manual Roxy refresh runner loads the repository .env independently of cwd', () => {
  assert.equal(path.basename(dotenvPath()), '.env');
  assert.equal(path.dirname(dotenvPath()), process.cwd());
});
