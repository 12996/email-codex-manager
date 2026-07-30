import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const PASSWORD_CIPHER_VERSION = 'v1';
const PASSWORD_CIPHER_ALGORITHM = 'aes-256-gcm';

/**
 * Stores the singleton Roxy proxy template and browser-to-proxy bindings.
 * Public methods return safe DTOs; only the explicitly named credentials method decrypts a password.
 */
export function createRoxyProxySettingsRepository(db, { env = process.env } = {}) {
  return {
    getRoxyProxyTemplate() {
      return toPublicTemplate(getTemplateRecord(db));
    },

    // For the server-side proxy refresh service only. Never expose this result through an API response.
    getRoxyProxyTemplateCredentials() {
      const record = getTemplateRecord(db);
      if (!record) return undefined;
      return {
        ...toPublicTemplate(record),
        password: record.encrypted_password
          ? decryptPassword(record.encrypted_password, env)
          : null,
      };
    },

    saveRoxyProxyTemplate(input = {}) {
      const existing = getTemplateRecord(db);
      const normalized = normalizeTemplateInput(input, existing);
      const password = normalizePasswordInput(input);
      const encryptedPassword = password === null
        ? existing?.encrypted_password || null
        : encryptPassword(password, env);
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO roxy_proxy_templates (
          id, workspace_id, host, port, account_prefix, encrypted_password,
          country, ttl_minutes, protocol, ip_type, check_channel, refresh_url, remark,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          host = excluded.host,
          port = excluded.port,
          account_prefix = excluded.account_prefix,
          encrypted_password = excluded.encrypted_password,
          country = excluded.country,
          ttl_minutes = excluded.ttl_minutes,
          protocol = excluded.protocol,
          ip_type = excluded.ip_type,
          check_channel = excluded.check_channel,
          refresh_url = excluded.refresh_url,
          remark = excluded.remark,
          updated_at = excluded.updated_at
      `).run(
        1,
        normalized.workspaceId,
        normalized.host,
        normalized.port,
        normalized.accountPrefix,
        encryptedPassword,
        normalized.country,
        normalized.ttlMinutes,
        normalized.protocol,
        normalized.ipType,
        normalized.checkChannel,
        normalized.refreshUrl,
        normalized.remark,
        existing?.created_at || now,
        now,
      );

      return this.getRoxyProxyTemplate();
    },

    listRoxyProxyBindings() {
      return db.prepare(`
        SELECT * FROM roxy_browser_proxy_bindings
        ORDER BY sort_num ASC, window_name ASC, dir_id ASC
      `).all().map(toPublicBinding);
    },

    getRoxyProxyBinding(dirId) {
      const normalizedDirId = normalizeRequired(dirId, 'DIR_ID_REQUIRED', 'dirId is required');
      return toPublicBinding(db.prepare(`
        SELECT * FROM roxy_browser_proxy_bindings WHERE dir_id = ?
      `).get(normalizedDirId));
    },

    upsertRoxyProxyBinding(input = {}) {
      const dirId = normalizeRequired(input.dirId ?? input.dir_id, 'DIR_ID_REQUIRED', 'dirId is required');
      const existing = db.prepare(`
        SELECT * FROM roxy_browser_proxy_bindings WHERE dir_id = ?
      `).get(dirId);
      const normalized = normalizeBindingInput(input, existing);
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO roxy_browser_proxy_bindings (
          dir_id, proxy_id, sort_num, window_name, template_id,
          last_generated_username, last_refresh_ip, last_refreshed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dir_id) DO UPDATE SET
          proxy_id = excluded.proxy_id,
          sort_num = excluded.sort_num,
          window_name = excluded.window_name,
          template_id = excluded.template_id,
          updated_at = excluded.updated_at
      `).run(
        dirId,
        normalized.proxyId,
        normalized.sortNum,
        normalized.windowName,
        normalized.templateId,
        existing?.last_generated_username || null,
        existing?.last_refresh_ip || null,
        existing?.last_refreshed_at || null,
        existing?.created_at || now,
        now,
      );

      return this.getRoxyProxyBinding(dirId);
    },

    deleteRoxyProxyBinding(dirId) {
      const normalizedDirId = normalizeRequired(dirId, 'DIR_ID_REQUIRED', 'dirId is required');
      return db.prepare(`DELETE FROM roxy_browser_proxy_bindings WHERE dir_id = ?`).run(normalizedDirId).changes > 0;
    },

    recordRoxyProxyRefresh(dirId, result = {}) {
      const existing = this.getRoxyProxyBinding(dirId);
      if (!existing) {
        throw codedError('ROXY_PROXY_BINDING_NOT_FOUND', 'Roxy proxy binding not found');
      }
      const now = new Date().toISOString();
      const refreshedAt = normalizeOptional(result.refreshedAt ?? result.refreshed_at) || now;
      db.prepare(`
        UPDATE roxy_browser_proxy_bindings
        SET
          last_generated_username = ?,
          last_refresh_ip = ?,
          last_refreshed_at = ?,
          updated_at = ?
        WHERE dir_id = ?
      `).run(
        normalizeOptional(result.username ?? result.lastGeneratedUsername ?? result.last_generated_username),
        normalizeOptional(result.ip ?? result.lastRefreshIp ?? result.last_refresh_ip),
        refreshedAt,
        now,
        existing.dirId,
      );
      return this.getRoxyProxyBinding(existing.dirId);
    },
  };
}

function getTemplateRecord(db) {
  return db.prepare(`SELECT * FROM roxy_proxy_templates WHERE id = 1`).get();
}

function normalizeTemplateInput(input, existing) {
  return {
    workspaceId: resolvePositiveInteger(
      pick(input, 'workspaceId', 'workspace_id') ?? existing?.workspace_id,
      'WORKSPACE_ID_INVALID',
      'workspaceId must be a positive integer',
    ),
    host: resolveRequiredInput(input, existing, 'host', 'host'),
    port: resolveRequiredInput(input, existing, 'port', 'port'),
    accountPrefix: resolveRequiredInput(input, existing, 'accountPrefix', 'account_prefix'),
    country: resolveRequiredInput(input, existing, 'country', 'country'),
    ttlMinutes: resolvePositiveInteger(
      pick(input, 'ttlMinutes', 'ttl_minutes', 'ttl') ?? existing?.ttl_minutes,
      'TTL_INVALID',
      'ttlMinutes must be a positive integer',
    ),
    protocol: resolveRequiredInput(input, existing, 'protocol', 'protocol').toUpperCase(),
    ipType: resolveRequiredInput(input, existing, 'ipType', 'ip_type').toUpperCase(),
    checkChannel: resolveRequiredInput(input, existing, 'checkChannel', 'check_channel'),
    refreshUrl: normalizeOptional(pick(input, 'refreshUrl', 'refresh_url'))
      ?? existing?.refresh_url
      ?? null,
    remark: normalizeOptional(input.remark) ?? existing?.remark ?? null,
  };
}

function normalizeBindingInput(input, existing) {
  return {
    proxyId: resolvePositiveInteger(
      pick(input, 'proxyId', 'proxy_id') ?? existing?.proxy_id,
      'PROXY_ID_INVALID',
      'proxyId must be a positive integer',
    ),
    sortNum: normalizeInteger(pick(input, 'sortNum', 'sort_num') ?? existing?.sort_num),
    windowName: normalizeOptional(pick(input, 'windowName', 'window_name')) ?? existing?.window_name ?? null,
    templateId: normalizePositiveInteger(pick(input, 'templateId', 'template_id') ?? existing?.template_id),
  };
}

function normalizePasswordInput(input) {
  const value = pick(input, 'password', 'proxyPassword', 'proxy_password');
  return normalizeOptional(value);
}

function toPublicTemplate(record) {
  if (!record) return undefined;
  return {
    id: record.id,
    workspaceId: record.workspace_id,
    host: record.host,
    port: record.port,
    accountPrefix: record.account_prefix,
    country: record.country,
    ttlMinutes: record.ttl_minutes,
    protocol: record.protocol,
    ipType: record.ip_type,
    checkChannel: record.check_channel,
    refreshUrl: record.refresh_url,
    remark: record.remark,
    passwordConfigured: Boolean(record.encrypted_password),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function toPublicBinding(record) {
  if (!record) return undefined;
  return {
    dirId: record.dir_id,
    proxyId: record.proxy_id,
    sortNum: record.sort_num,
    windowName: record.window_name,
    templateId: record.template_id,
    lastGeneratedUsername: record.last_generated_username,
    lastRefreshIp: record.last_refresh_ip,
    lastRefreshedAt: record.last_refreshed_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function encryptPassword(password, env) {
  const key = getPasswordEncryptionKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv(PASSWORD_CIPHER_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    PASSWORD_CIPHER_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

function decryptPassword(value, env) {
  const [version, ivBase64, authTagBase64, ciphertextBase64, ...unexpected] = String(value || '').split(':');
  if (
    version !== PASSWORD_CIPHER_VERSION
    || unexpected.length > 0
    || !ivBase64
    || !authTagBase64
    || !ciphertextBase64
  ) {
    throw codedError('ROXY_PROXY_PASSWORD_CIPHERTEXT_INVALID', 'Stored Roxy proxy password ciphertext is invalid');
  }
  try {
    const decipher = createDecipheriv(PASSWORD_CIPHER_ALGORITHM, getPasswordEncryptionKey(env), Buffer.from(ivBase64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextBase64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error?.code === 'ROXY_PROXY_SETTINGS_KEY_INVALID') throw error;
    throw codedError('ROXY_PROXY_PASSWORD_DECRYPT_FAILED', 'Unable to decrypt the stored Roxy proxy password');
  }
}

function getPasswordEncryptionKey(env) {
  const encoded = String(env?.ROXY_PROXY_SETTINGS_KEY || '').trim();
  const key = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) {
    throw codedError(
      'ROXY_PROXY_SETTINGS_KEY_INVALID',
      'ROXY_PROXY_SETTINGS_KEY must be a base64-encoded 32-byte key before saving a proxy password',
    );
  }
  return key;
}

function pick(input, ...keys) {
  for (const key of keys) {
    if (Object.hasOwn(input || {}, key)) return input[key];
  }
  return undefined;
}

function resolveRequiredInput(input, existing, publicName, databaseName) {
  const value = pick(input, publicName, databaseName);
  const codePrefix = publicName.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
  return normalizeRequired(value ?? existing?.[databaseName], `${codePrefix}_REQUIRED`, `${publicName} is required`);
}

function normalizeRequired(value, code, message) {
  const normalized = normalizeOptional(value);
  if (!normalized) throw codedError(code, message);
  return normalized;
}

function normalizeOptional(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function resolvePositiveInteger(value, code, message) {
  const normalized = normalizePositiveInteger(value);
  if (!normalized) throw codedError(code, message);
  return normalized;
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw codedError('SORT_NUM_INVALID', 'sortNum must be an integer');
  }
  return number;
}

export function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
