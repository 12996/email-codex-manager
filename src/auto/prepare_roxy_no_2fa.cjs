'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const requireFromHere = createRequire(__filename);
const { RoxyBrowserClient } = requireFromHere('./roxy-browser-client.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function extractRows(response) {
  if (Array.isArray(response)) return response;
  const data = response?.data;
  if (Array.isArray(data)) return data;
  return data?.rows || data?.list || data?.data || [];
}

function requiredText(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function resolveTargetDirId(env = process.env) {
  return requiredText(
    env.ROXY_NO_2FA_BROWSER_DIR_ID || env.ROXY_PROTOCOL_BROWSER_DIR_ID,
    'ROXY_NO_2FA_BROWSER_DIR_ID or ROXY_PROTOCOL_BROWSER_DIR_ID',
  );
}

function resolveOpenArgs(env = process.env) {
  const headless = String(env.ROXY_HEADLESS || 'auto').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(headless)) return ['--headless=new'];
  if (['0', 'false', 'no', 'off'].includes(headless)) return [];
  return String(env.ROXY_KEEP_OPEN || '1') === '0' ? ['--headless=new'] : [];
}

async function prepareRoxyNo2FA({ env = process.env, client, proxyService, settingsRepository } = {}) {
  const dirId = resolveTargetDirId(env);
  if (!client) throw new TypeError('client is required');
  if (!proxyService) throw new TypeError('proxyService is required');
  if (!settingsRepository) throw new TypeError('settingsRepository is required');

  const browsers = extractRows(await client.listBrowsers());
  if (!browsers.some((browser) => String(browser?.dirId || '') === dirId)) {
    throw new Error('Roxy browser profile is unavailable');
  }

  const binding = settingsRepository.getRoxyProxyBinding(dirId);
  const proxyId = binding?.proxyId;
  if (!Number.isInteger(Number(proxyId)) || Number(proxyId) <= 0) {
    throw new Error('Roxy browser profile has no bound proxy');
  }

  const proxies = extractRows(await client.listProxies());
  const proxy = proxies.find((item) => Number(item?.id) === Number(proxyId));
  if (!proxy || !proxy.checkChannel || !proxy.ipType || !proxy.protocol) {
    throw new Error('Roxy bound proxy is unavailable');
  }

  await proxyService.refreshBrowserProxy({ dirId, openArgs: resolveOpenArgs(env) });
  return { dirId };
}

async function buildLiveDependencies(env = process.env) {
  requireFromHere('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });
  const activeEnv = { ...process.env, ...env };
  const [databaseModule, settingsModule, serviceModule] = await Promise.all([
    import(pathToFileURL(path.join(PROJECT_ROOT, 'src', 'db.js')).href),
    import(pathToFileURL(path.join(PROJECT_ROOT, 'src', 'roxyProxySettings.js')).href),
    import(pathToFileURL(path.join(PROJECT_ROOT, 'src', 'roxyProxyService.js')).href),
  ]);

  const databasePath = path.isAbsolute(activeEnv.DATABASE_PATH || '')
    ? activeEnv.DATABASE_PATH
    : path.resolve(PROJECT_ROOT, activeEnv.DATABASE_PATH || path.join('data', 'app.db'));
  const db = databaseModule.createDatabase(databasePath);
  const settingsRepository = settingsModule.createRoxyProxySettingsRepository(db, { env: activeEnv });
  const template = settingsRepository.getRoxyProxyTemplate();
  const dirId = resolveTargetDirId(activeEnv);
  const workspaceId = Number(
    activeEnv.ROXY_NO_2FA_WORKSPACE_ID
      || activeEnv.ROXY_WORKSPACE_ID
      || template?.workspaceId
      || 0,
  );
  const client = new RoxyBrowserClient({
    apiBaseUrl: activeEnv.ROXY_API_BASE_URL || undefined,
    apiPort: activeEnv.ROXY_API_PORT || undefined,
    token: activeEnv.ROXY_API_TOKEN || undefined,
    workspaceId,
    dirId,
  });
  const proxyService = serviceModule.createRoxyProxyService({
    settingsRepository,
    roxyClientFactory: async () => client,
  });
  return { client, proxyService, settingsRepository, close: () => db.close() };
}

function publicError(error) {
  const code = String(error?.code || '').trim();
  return code ? `Roxy preparation failed: ${code}` : 'Roxy preparation failed';
}

async function main() {
  const dependencies = await buildLiveDependencies();
  try {
    const result = await prepareRoxyNo2FA({
      client: dependencies.client,
      proxyService: dependencies.proxyService,
      settingsRepository: dependencies.settingsRepository,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, dirId: result.dirId })}\n`);
  } finally {
    dependencies.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${publicError(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildLiveDependencies,
  extractRows,
  prepareRoxyNo2FA,
  resolveOpenArgs,
  resolveTargetDirId,
};
