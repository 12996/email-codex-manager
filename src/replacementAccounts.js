import { randomBytes } from 'node:crypto';

const SYSTEM_STATUSES = new Set(['pending', 'active', 'banned', 'replacing', 'replaced', 'failed']);
const MANUAL_STATUSES = new Set(['pending', 'active', 'banned', 'replaced', 'failed']);
const REPLACEMENT_FAILURE_BREAKER_THRESHOLD = 5;

export function createReplacementAccountRepository(db) {
  return {
    createAccount(input) {
      const data = normalizeAccountInput(input, { requireEmail: true });
      data.public_code_key ||= generatePublicCodeKey();
      validateStatus(data.status, { allowReplacing: false });
      assertEmailAvailable(db, data.email);
      const now = new Date().toISOString();
      data.activated_at ||= now;
      const result = db.prepare(`
        INSERT INTO replacement_accounts (
          email,
          phone,
          sms_api,
          activation_method,
          activated_at,
          status,
          status_updated_at,
          status_note,
          remark,
          public_code_enabled,
          public_code_key,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.email,
        data.phone,
        data.sms_api,
        data.activation_method,
        data.activated_at,
        data.status,
        now,
        data.status_note,
        data.remark,
        data.public_code_enabled,
        data.public_code_key,
        now,
        now,
      );

      return this.getAccount(result.lastInsertRowid);
    },

    listAccounts() {
      return db.prepare(`
        SELECT * FROM replacement_accounts
        WHERE deleted_at IS NULL
        ORDER BY id DESC
      `).all();
    },

    listAccountsPage(options = {}) {
      const query = normalizeListQuery(options);
      const { whereSql, params } = buildReplacementAccountListWhere(query);
      const total = db.prepare(`
        SELECT COUNT(*) AS total FROM replacement_accounts
        ${whereSql}
      `).get(...params).total;
      const pagination = buildPagination(total, query);
      const accounts = db.prepare(`
        SELECT * FROM replacement_accounts
        ${whereSql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `).all(...params, pagination.pageSize, (pagination.page - 1) * pagination.pageSize);

      return { accounts, pagination };
    },

    getAccount(id) {
      return db.prepare(`
        SELECT * FROM replacement_accounts
        WHERE id = ? AND deleted_at IS NULL
      `).get(Number(id));
    },

    getAccountByEmail(email) {
      const normalized = normalizeOptional(email);
      if (!normalized) return undefined;
      return db.prepare(`
        SELECT * FROM replacement_accounts
        WHERE lower(trim(email)) = lower(trim(?))
          AND deleted_at IS NULL
        LIMIT 1
      `).get(normalized);
    },

    updateAccount(id, input) {
      const existing = assertAccountExists(this.getAccount(id));
      const data = normalizeAccountInput(input, { requireEmail: true });
      if (Object.hasOwn(input || {}, 'public_code_key')) {
        data.public_code_key ||= generatePublicCodeKey();
      } else {
        data.public_code_key = existing.public_code_key || generatePublicCodeKey();
      }
      validateStatus(data.status, { allowReplacing: false });
      assertEmailAvailable(db, data.email, existing.id);
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE replacement_accounts
        SET
          email = ?,
          phone = ?,
          sms_api = ?,
          activation_method = ?,
          activated_at = ?,
          status = ?,
          status_note = ?,
          remark = ?,
          public_code_enabled = ?,
          public_code_key = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        data.email,
        data.phone,
        data.sms_api,
        data.activation_method,
        data.activated_at,
        data.status,
        data.status_note,
        data.remark,
        data.public_code_enabled,
        data.public_code_key,
        now,
        existing.id,
      );

      return this.getAccount(existing.id);
    },

    getPublicCodeAccountByKey(key) {
      const normalizedKey = normalizeOptional(key);
      if (!normalizedKey) {
        return undefined;
      }
      return db.prepare(`
        SELECT * FROM replacement_accounts
        WHERE public_code_key = ?
          AND public_code_enabled = 1
          AND deleted_at IS NULL
        LIMIT 1
      `).get(normalizedKey);
    },

    updatePublicCodeAccess(id, input) {
      const existing = assertAccountExists(this.getAccount(id));
      const enabled = normalizeBooleanFlag(input?.enabled);
      const publicCodeKey = normalizeOptional(input?.public_code_key) || existing.public_code_key || generatePublicCodeKey();
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE replacement_accounts
        SET
          public_code_enabled = ?,
          public_code_key = ?,
          updated_at = ?
        WHERE id = ?
      `).run(enabled, publicCodeKey, now, existing.id);

      return this.getAccount(existing.id);
    },

    deleteAccount(id) {
      const existing = assertAccountExists(this.getAccount(id));
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE replacement_accounts
        SET deleted_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, existing.id);
    },

    updateStatus(id, input) {
      const existing = assertAccountExists(this.getAccount(id));
      const status = normalizeRequired(input?.status, 'STATUS_INVALID', 'status is required');
      validateStatus(status, { allowReplacing: false });
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE replacement_accounts
        SET
          status = ?,
          status_note = ?,
          status_updated_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        status,
        normalizeOptional(input?.status_note),
        now,
        now,
        existing.id,
      );

      return this.getAccount(existing.id);
    },

    recordSmsFailure(id, errorMessage) {
      const existing = assertAccountExists(this.getAccount(id));
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE replacement_accounts
        SET sms_last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(normalizeErrorMessage(errorMessage), now, existing.id);
      return this.getAccount(existing.id);
    },

    recordJsonFetchSuccess(id, payload) {
      const existing = assertAccountExists(this.getAccount(id));
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE replacement_accounts
        SET
          json_payload = ?,
          json_fetched_at = ?,
          last_error = NULL,
          updated_at = ?
        WHERE id = ?
      `).run(String(payload), now, now, existing.id);
      return this.getAccount(existing.id);
    },

    recordJsonFetchFailure(id, errorMessage) {
      const existing = assertAccountExists(this.getAccount(id));
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE replacement_accounts
        SET last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(normalizeErrorMessage(errorMessage), now, existing.id);
      return this.getAccount(existing.id);
    },

    markReplacementStarted(id) {
      const existing = assertAccountExists(this.getAccount(id));
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE replacement_accounts
        SET
          status = 'replacing',
          status_updated_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(now, now, existing.id);
      return this.getAccount(existing.id);
    },

    markReplacementSuccess(id) {
      const existing = assertAccountExists(this.getAccount(id));
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE replacement_accounts
        SET
          status = 'replaced',
          status_updated_at = ?,
          replacement_count = replacement_count + 1,
          consecutive_replace_failures = 0,
          circuit_breaker_at = NULL,
          circuit_breaker_reason = NULL,
          last_replace_at = ?,
          last_error = NULL,
          updated_at = ?
        WHERE id = ?
      `).run(now, now, now, existing.id);
      return this.getAccount(existing.id);
    },

    markReplacementFailure(id, errorMessage) {
      const existing = assertAccountExists(this.getAccount(id));
      const now = new Date().toISOString();
      const nextFailures = Number(existing.consecutive_replace_failures || 0) + 1;
      const shouldBan = nextFailures >= REPLACEMENT_FAILURE_BREAKER_THRESHOLD;
      const breakerReason = shouldBan
        ? `连续补号失败 ${REPLACEMENT_FAILURE_BREAKER_THRESHOLD} 次，自动熔断`
        : null;
      db.prepare(`
        UPDATE replacement_accounts
        SET
          status = ?,
          status_updated_at = ?,
          status_note = CASE WHEN ? IS NULL THEN status_note ELSE ? END,
          consecutive_replace_failures = ?,
          circuit_breaker_at = ?,
          circuit_breaker_reason = ?,
          last_error = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        shouldBan ? 'banned' : 'failed',
        now,
        breakerReason,
        breakerReason,
        nextFailures,
        shouldBan ? now : null,
        breakerReason,
        normalizeErrorMessage(errorMessage),
        now,
        existing.id,
      );
      return this.getAccount(existing.id);
    },

    resetCircuitBreaker(id) {
      const existing = assertAccountExists(this.getAccount(id));
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE replacement_accounts
        SET
          status = 'pending',
          status_note = ?,
          status_updated_at = ?,
          consecutive_replace_failures = 0,
          circuit_breaker_at = NULL,
          circuit_breaker_reason = NULL,
          updated_at = ?
        WHERE id = ?
      `).run('管理员手动解除熔断', now, now, existing.id);
      return this.getAccount(existing.id);
    },
  };
}

export function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function normalizeAccountInput(input, { requireEmail }) {
  const email = requireEmail
    ? normalizeRequired(input?.email, 'EMAIL_REQUIRED', 'email is required')
    : normalizeOptional(input?.email);
  return {
    email,
    phone: normalizeOptional(input?.phone),
    sms_api: normalizeOptional(input?.sms_api),
    activation_method: normalizeOptional(input?.activation_method),
    activated_at: normalizeOptional(input?.activated_at),
    status: normalizeOptional(input?.status) || 'pending',
    status_note: normalizeOptional(input?.status_note),
    remark: normalizeOptional(input?.remark),
    public_code_enabled: normalizeBooleanFlag(input?.public_code_enabled),
    public_code_key: normalizeOptional(input?.public_code_key),
  };
}

function validateStatus(status, { allowReplacing }) {
  const allowed = allowReplacing ? SYSTEM_STATUSES : MANUAL_STATUSES;
  if (!allowed.has(status)) {
    throw codedError('STATUS_INVALID', 'status is invalid');
  }
}

function assertEmailAvailable(db, email, excludedId = null) {
  const duplicate = db.prepare(`
    SELECT id FROM replacement_accounts
    WHERE lower(trim(email)) = lower(trim(?))
      AND (? IS NULL OR id != ?)
    LIMIT 1
  `).get(email, excludedId, excludedId);

  if (duplicate) {
    throw codedError('EMAIL_DUPLICATE', 'email already exists');
  }
}

function assertAccountExists(account) {
  if (!account) {
    throw codedError('ACCOUNT_NOT_FOUND', 'replacement account not found');
  }
  return account;
}

function normalizeRequired(value, code, message) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw codedError(code, message);
  }
  return normalized;
}

function normalizeOptional(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeBooleanFlag(value) {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') {
    return 1;
  }
  return 0;
}

function generatePublicCodeKey() {
  return `vc_${randomBytes(24).toString('base64url')}`;
}

function normalizeErrorMessage(value) {
  return String(value || 'Unknown error');
}

function normalizeListQuery(options) {
  return {
    page: normalizePositiveInteger(options?.page, 1, Number.MAX_SAFE_INTEGER),
    pageSize: normalizePositiveInteger(options?.pageSize, 10, 100),
    status: normalizeOptional(options?.status),
    keyword: normalizeOptional(options?.keyword)?.toLowerCase() || null,
  };
}

function normalizePositiveInteger(value, defaultValue, maxValue) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return defaultValue;
  return Math.min(number, maxValue);
}

function buildReplacementAccountListWhere(query) {
  const filters = ['deleted_at IS NULL'];
  const params = [];
  if (query.status) {
    filters.push('status = ?');
    params.push(query.status);
  }
  if (query.keyword) {
    filters.push(`(
      lower(coalesce(email, '')) LIKE ?
      OR lower(coalesce(phone, '')) LIKE ?
      OR lower(coalesce(remark, '')) LIKE ?
      OR lower(coalesce(status, '')) LIKE ?
    )`);
    const keyword = `%${query.keyword}%`;
    params.push(keyword, keyword, keyword, keyword);
  }

  return {
    whereSql: `WHERE ${filters.join(' AND ')}`,
    params,
  };
}

function buildPagination(total, query) {
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  return {
    page: Math.min(query.page, totalPages),
    pageSize: query.pageSize,
    total,
    totalPages,
  };
}
