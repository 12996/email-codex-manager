/**
 * Refreshes a bound Roxy proxy before an automation task starts.
 * Passwords are deliberately confined to the Roxy modify request.
 */
export function createRoxyProxyService({
  settingsRepository,
  roxyClientFactory,
  isTaskActive = () => false,
  generateSid = generateProxySid,
  now = () => new Date(),
} = {}) {
  if (!settingsRepository) throw new TypeError('settingsRepository is required');
  if (typeof roxyClientFactory !== 'function') throw new TypeError('roxyClientFactory is required');

  const leases = new Map();

  async function refreshBrowserProxy({ dirId, env = {}, openArgs = [] } = {}) {
    const targetDirId = requireText(dirId, 'DIR_ID_REQUIRED', 'dirId is required');
    if (isTaskActive(targetDirId)) throw busyError(targetDirId);
    const client = await roxyClientFactory(buildClientEnv(env, targetDirId));
    return refreshBoundBrowser({
      dirId: targetDirId,
      client,
      openArgs,
      keepLease: false,
      ignoreTaskActivity: false,
    });
  }

  /**
   * Used only by the protocol child-process preparation path. If no binding
   * exists, it performs no mutation so the caller can use its legacy prepare path.
   */
  async function prepareBoundBrowser({ env = {}, openArgs = [] } = {}) {
    const client = await roxyClientFactory(buildClientEnv(env));
    const targetDirId = requireText(
      await client.resolveDirId(),
      'DIR_ID_REQUIRED',
      'Roxy client did not resolve a browser dirId',
    );
    const binding = settingsRepository.getRoxyProxyBinding(targetDirId);
    if (!binding) return undefined;

    return refreshBoundBrowser({
      dirId: targetDirId,
      binding,
      client,
      openArgs,
      keepLease: true,
      // This task owns its own pre-spawn preparation. The queue may already
      // report it as current, which must not block its initial refresh.
      ignoreTaskActivity: true,
    });
  }

  async function refreshBoundBrowser({
    dirId,
    client,
    binding = settingsRepository.getRoxyProxyBinding(dirId),
    openArgs,
    keepLease,
    ignoreTaskActivity,
  }) {
    if (!binding) {
      throw codedError('ROXY_PROXY_BINDING_NOT_FOUND', `Roxy proxy binding not found for dirId=${dirId}`);
    }

    const release = acquireLease(dirId, { ignoreTaskActivity });
    try {
      const template = settingsRepository.getRoxyProxyTemplateCredentials();
      const payload = buildProxyPayload(template, generateUsername(template, generateSid()));
      const refreshedAt = normalizeDate(now());

      await runStep('modifyProxy', () => client.modifyProxy(binding.proxyId, payload));
      await runStep('closeBrowser', () => client.closeBrowser());
      await runStep('clearLocalCache', () => client.clearLocalCache());
      await runStep('clearServerCache', () => client.clearServerCache());
      await runStep('randomFingerprint', () => client.randomFingerprint());
      await runStep('openBrowser', () => client.openBrowser(openArgs));
      const connection = await runStep('getConnectionInfo', () => client.getConnectionInfo());
      const cdpEndpoint = requireText(
        connection?.ws,
        'ROXY_PROXY_REFRESH_FAILED',
        'getConnectionInfo did not return a CDP endpoint',
      );
      const lastRefreshIp = normalizeOptional(connection?.ip ?? connection?.lastIp ?? connection?.proxyInfo?.lastIp);

      // The repository only persists safe refresh metadata; the endpoint and
      // password remain in memory for the immediate child-process launch.
      settingsRepository.recordRoxyProxyRefresh(dirId, {
        username: payload.proxyUserName,
        ip: lastRefreshIp,
        refreshedAt,
      });

      const result = {
        dirId,
        proxyId: binding.proxyId,
        username: payload.proxyUserName,
        cdpEndpoint,
        ...(lastRefreshIp ? { lastRefreshIp } : {}),
        refreshedAt,
      };
      if (keepLease) return { ...result, release };
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  }

  function acquireLease(dirId, { ignoreTaskActivity = false } = {}) {
    if (!ignoreTaskActivity && isTaskActive(dirId)) {
      throw busyError(dirId);
    }
    if (leases.has(dirId)) throw busyError(dirId);

    const token = Symbol(dirId);
    leases.set(dirId, token);
    return () => {
      if (leases.get(dirId) === token) leases.delete(dirId);
    };
  }

  function buildClientEnv(env, dirId) {
    const template = settingsRepository.getRoxyProxyTemplate?.();
    return {
      ...env,
      ...(template?.workspaceId ? { ROXY_WORKSPACE_ID: String(template.workspaceId) } : {}),
      ...(dirId ? { ROXY_BROWSER_DIR_ID: dirId } : {}),
    };
  }

  return {
    refreshBrowserProxy,
    prepareBoundBrowser,
    isLeased(dirId) {
      return leases.has(String(dirId || '').trim());
    },
  };
}

export function generateProxySid() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let sid = '';
  for (let index = 0; index < 8; index += 1) {
    sid += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return sid;
}

function generateUsername(template, sid) {
  const normalizedSid = requireText(sid, 'ROXY_PROXY_SID_INVALID', 'proxy SID is required');
  if (!/^[A-Za-z0-9]{8}$/.test(normalizedSid)) {
    throw codedError('ROXY_PROXY_SID_INVALID', 'proxy SID must contain exactly 8 letters or digits');
  }
  return `${requireTemplateValue(template, 'accountPrefix')}-region-${requireTemplateValue(template, 'country')}-sid-${normalizedSid}-t-${requireTemplateValue(template, 'ttlMinutes')}`;
}

function buildProxyPayload(template, username) {
  if (!template) {
    throw codedError('ROXY_PROXY_TEMPLATE_NOT_CONFIGURED', 'Roxy proxy template is not configured');
  }
  return {
    workspaceId: requirePositiveInteger(template?.workspaceId, 'workspaceId'),
    checkChannel: requireTemplateValue(template, 'checkChannel'),
    ipType: requireTemplateValue(template, 'ipType'),
    protocol: requireTemplateValue(template, 'protocol'),
    host: requireTemplateValue(template, 'host'),
    port: requireTemplateValue(template, 'port'),
    proxyUserName: username,
    proxyPassword: requireTemplateValue(template, 'password'),
    refreshUrl: normalizeOptional(template.refreshUrl),
    remark: normalizeOptional(template.remark),
  };
}

function requireTemplateValue(template, field) {
  return requireText(template?.[field], 'ROXY_PROXY_TEMPLATE_INVALID', `Roxy proxy template field ${field} is required`);
}

function requirePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw codedError('ROXY_PROXY_TEMPLATE_INVALID', `Roxy proxy template field ${field} must be a positive integer`);
  }
  return number;
}

async function runStep(name, action) {
  try {
    return await action();
  } catch (error) {
    if (error?.code === 'ROXY_PROXY_REFRESH_BUSY') throw error;
    throw codedError('ROXY_PROXY_REFRESH_FAILED', `${name} failed: ${error?.message || error}`);
  }
}

function busyError(dirId) {
  return codedError('ROXY_PROXY_REFRESH_BUSY', `窗口正被任务使用，不能切换代理: dirId=${dirId}`);
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw codedError('ROXY_PROXY_REFRESH_FAILED', 'refresh timestamp is invalid');
  }
  return date.toISOString();
}

function requireText(value, code, message) {
  const normalized = normalizeOptional(value);
  if (!normalized) throw codedError(code, message);
  return normalized;
}

function normalizeOptional(value) {
  const normalized = String(value ?? '').trim();
  return normalized || '';
}

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
