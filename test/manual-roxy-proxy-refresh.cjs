#!/usr/bin/env node

// Manual live Roxy refresh runner. It performs no mutation unless --confirm is supplied.
const { createRequire } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const requireFromHere = createRequire(__filename);
const { RoxyBrowserClient } = requireFromHere('../src/auto/roxy-browser-client.cjs');

// Edit this block before a live manual refresh. `node --test` never executes it.
const manualConfig = Object.freeze({
  confirm: true,
  dirId: '6fad0c799da9c1751d00cbf741127691',
  proxyId: 989971,
  host: 'us.arxlabs.io',
  port: '3010',
  accountPrefix: 'sttj1150537',
  country: 'JP',
  ttl: 10,
  proxyPassword: '4jvxcsadse',
  workspaceId: undefined,
  apiBaseUrl: undefined,
  apiToken: undefined,
});

function parseArgs(argv) {
  const values = {
    confirm: false,
    dirId: '',
    proxyId: undefined,
    host: '',
    port: '',
    accountPrefix: '',
    country: '',
    ttl: undefined,
    proxyPassword: '',
    workspaceId: undefined,
    apiBaseUrl: undefined,
    apiToken: undefined,
  };
  const names = {
    '--dir-id': 'dirId',
    '--proxy-id': 'proxyId',
    '--host': 'host',
    '--port': 'port',
    '--account-prefix': 'accountPrefix',
    '--country': 'country',
    '--ttl': 'ttl',
    '--proxy-password': 'proxyPassword',
    '--workspace-id': 'workspaceId',
    '--api-base-url': 'apiBaseUrl',
    '--api-token': 'apiToken',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--confirm') {
      values.confirm = true;
      continue;
    }
    const name = names[item];
    if (!name) throw new Error(`未知参数: ${item}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${item} 缺少值`);
    values[name] = value;
    index += 1;
  }

  if (values.proxyId !== undefined) values.proxyId = Number(values.proxyId);
  if (values.ttl !== undefined) values.ttl = Number(values.ttl);
  if (values.workspaceId !== undefined) values.workspaceId = Number(values.workspaceId);
  return values;
}

function validateConfig(config) {
  if (!config.confirm) throw new Error('真实刷新必须显式传入 --confirm');
  for (const [field, value] of Object.entries({
    'dir-id': config.dirId,
    'proxy-id': config.proxyId,
    host: config.host,
    port: config.port,
    'account-prefix': config.accountPrefix,
    country: config.country,
    ttl: config.ttl,
    'proxy-password': config.proxyPassword,
  })) {
    if (value === undefined || value === null || value === '' || Number.isNaN(value)) {
      throw new Error(`缺少或无效参数: --${field}`);
    }
  }
  if (!Number.isInteger(config.proxyId) || config.proxyId <= 0) {
    throw new Error('--proxy-id 必须是正整数');
  }
  if (!Number.isInteger(config.ttl) || config.ttl <= 0) {
    throw new Error('--ttl 必须是正整数分钟');
  }
  if (config.workspaceId !== undefined && (!Number.isInteger(config.workspaceId) || config.workspaceId <= 0)) {
    throw new Error('--workspace-id 必须是正整数');
  }
}

function generateSid() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = require('node:crypto').randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function run(config) {
  const { createRoxyProxyService } = await import(roxyProxyServiceModuleUrl());
  const clientOptions = {
    dirId: config.dirId,
    ...(config.workspaceId ? { workspaceId: config.workspaceId } : {}),
    ...(config.apiBaseUrl ? { apiBaseUrl: config.apiBaseUrl } : {}),
    ...(config.apiToken ? { token: config.apiToken } : {}),
  };
  const client = new RoxyBrowserClient(clientOptions);
  const browsers = await client.listBrowsers();
  const browserRows = extractRows(browsers);
  if (!browserRows.some((item) => String(item?.dirId) === config.dirId)) {
    throw new Error(`未找到目标窗口 dirId=${config.dirId}`);
  }

  const proxy = (await client.listProxies()).find((item) => Number(item.id) === config.proxyId);
  if (!proxy) throw new Error(`未找到 Roxy proxyId=${config.proxyId}`);
  if (!proxy.checkChannel || !proxy.ipType || !proxy.protocol) {
    throw new Error(`proxyId=${config.proxyId} 缺少 Roxy 刷新必需字段`);
  }

  const refreshRecords = [];
  const settingsRepository = {
    getRoxyProxyBinding(dirId) {
      return String(dirId) === config.dirId ? { dirId: config.dirId, proxyId: config.proxyId } : null;
    },
    getRoxyProxyTemplateCredentials() {
      return buildManualTemplate(config, client, proxy);
    },
    getRoxyProxyTemplate() {
      return { workspaceId: client.workspaceId };
    },
    recordRoxyProxyRefresh(dirId, result) {
      refreshRecords.push({ dirId, ...result });
    },
    recordRoxyProxyStatus(dirId, status) {
      refreshRecords.push({ dirId, cdpStatus: status });
    },
  };

  const service = createRoxyProxyService({
    settingsRepository,
    roxyClientFactory: async () => client,
    generateSid,
  });
  const result = await service.refreshBrowserProxy({ dirId: config.dirId });
  console.log(JSON.stringify({
    ok: true,
    dirId: result.dirId,
    proxyId: result.proxyId,
    username: result.username,
    lastRefreshIp: result.lastRefreshIp || null,
    refreshedAt: result.refreshedAt,
    cdpReady: Boolean(result.cdpEndpoint),
    status: refreshRecords.at(-1)?.cdpStatus || null,
  }, null, 2));
}

function extractRows(response) {
  const data = response?.data;
  if (Array.isArray(data)) return data;
  return data?.rows || data?.list || data?.data || [];
}

function buildManualTemplate(config, client, proxy) {
  return {
    workspaceId: client.workspaceId,
    host: config.host,
    port: config.port,
    accountPrefix: config.accountPrefix,
    password: config.proxyPassword,
    country: config.country,
    ttlMinutes: config.ttl,
    protocol: proxy.protocol,
    ipType: proxy.ipType,
    checkChannel: proxy.checkChannel,
    refreshUrl: proxy.refreshUrl || '',
    remark: proxy.remark || '',
  };
}

function roxyProxyServiceModuleUrl() {
  return pathToFileURL(path.resolve(__dirname, '../src/roxyProxyService.js')).href;
}

function dotenvPath() {
  return path.resolve(__dirname, '../.env');
}

function usage() {
  return [
    'Usage:',
    '  node test/manual-roxy-proxy-refresh.cjs',
    '',
    'Edit the manualConfig block at the top of this file before running it.',
    'Roxy API URL, token and workspace default to .env unless manualConfig overrides them.',
    'The script reads checkChannel, ipType and protocol from the specified proxy resource.',
  ].join('\n');
}

function shouldRunCli(env = process.env) {
  return !env.NODE_TEST_CONTEXT;
}

if (require.main === module && shouldRunCli()) {
  try {
    requireFromHere('dotenv').config({ path: dotenvPath() });
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      console.log(usage());
    } else {
      const config = { ...manualConfig };
      validateConfig(config);
      run(config).catch((error) => {
        console.error(`Roxy 刷新失败: ${error.message}`);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    console.error(`参数错误: ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  }
}

module.exports = {
  manualConfig,
  buildManualTemplate,
  dotenvPath,
  parseArgs,
  roxyProxyServiceModuleUrl,
  shouldRunCli,
  validateConfig,
};
