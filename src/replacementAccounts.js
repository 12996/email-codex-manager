const SYSTEM_STATUSES = new Set(['pending', 'active', 'banned', 'replacing', 'replaced', 'failed']);
const MANUAL_STATUSES = new Set(['pending', 'active', 'banned', 'replaced', 'failed']);

export function createReplacementAccountRepository(db) {
  return {
    createAccount(input) {
      const data = normalizeAccountInput(input, { requireEmail: true });
      validateStatus(data.status, { allowReplacing: false });
      assertEmailAvailable(db, data.email);
      const now = new Date().toISOString();
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
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    getAccount(id) {
      return db.prepare(`
        SELECT * FROM replacement_accounts
        WHERE id = ? AND deleted_at IS NULL
      `).get(Number(id));
    },

    updateAccount(id, input) {
      const existing = assertAccountExists(this.getAccount(id));
      const data = normalizeAccountInput(input, { requireEmail: true });
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
        now,
        existing.id,
      );

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
      db.prepare(`
        UPDATE replacement_accounts
        SET
          status = 'failed',
          status_updated_at = ?,
          last_error = ?,
          updated_at = ?
        WHERE id = ?
      `).run(now, normalizeErrorMessage(errorMessage), now, existing.id);
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

function normalizeErrorMessage(value) {
  return String(value || 'Unknown error');
}
