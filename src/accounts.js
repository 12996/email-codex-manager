const REQUIRED_FIELDS = [
  'gmail_email',
  'gmail_password',
  'gmail_2fa',
  'gmail_app_password',
];

export function createAccountRepository(db) {
  return {
    createAccount(input) {
      validateRequiredFields(input);
      const now = new Date().toISOString();
      const result = db.prepare(`
        INSERT INTO email_accounts (
          display_name,
          gmail_email,
          gmail_password,
          gmail_2fa,
          gmail_app_password,
          status,
          last_fetch_status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'active', 'idle', ?, ?)
      `).run(
        normalizeOptional(input.display_name),
        input.gmail_email.trim(),
        input.gmail_password,
        input.gmail_2fa,
        input.gmail_app_password,
        now,
        now,
      );

      return this.getAccount(result.lastInsertRowid);
    },

    listAccounts() {
      return db.prepare(`
        SELECT * FROM email_accounts
        ORDER BY id DESC
      `).all();
    },

    listAccountsPage(options = {}) {
      const query = normalizeListQuery(options);
      const { whereSql, params } = buildAccountListWhere(query);
      const total = db.prepare(`
        SELECT COUNT(*) AS total FROM email_accounts
        ${whereSql}
      `).get(...params).total;
      const pagination = buildPagination(total, query);
      const accounts = db.prepare(`
        SELECT * FROM email_accounts
        ${whereSql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `).all(...params, pagination.pageSize, (pagination.page - 1) * pagination.pageSize);

      return { accounts, pagination };
    },

    getAccount(id) {
      return db.prepare(`
        SELECT * FROM email_accounts
        WHERE id = ?
      `).get(Number(id));
    },

    getAccountByGmailEmail(gmailEmail) {
      return db.prepare(`
        SELECT * FROM email_accounts
        WHERE lower(gmail_email) = lower(?)
        ORDER BY id DESC
        LIMIT 1
      `).get(String(gmailEmail || '').trim());
    },

    updateAccount(id, input) {
      validateRequiredFields(input);
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE email_accounts
        SET
          display_name = ?,
          gmail_email = ?,
          gmail_password = ?,
          gmail_2fa = ?,
          gmail_app_password = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        normalizeOptional(input.display_name),
        input.gmail_email.trim(),
        input.gmail_password,
        input.gmail_2fa,
        input.gmail_app_password,
        now,
        Number(id),
      );
      return this.getAccount(id);
    },

    deleteAccount(id) {
      db.prepare('DELETE FROM email_accounts WHERE id = ?').run(Number(id));
    },

    markFetchSuccess(id) {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE email_accounts
        SET
          status = 'active',
          last_fetch_status = 'success',
          last_fetch_at = ?,
          last_error = NULL,
          updated_at = ?
        WHERE id = ?
      `).run(now, now, Number(id));
    },

    markFetchFailure(id, status, errorMessage) {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE email_accounts
        SET
          status = ?,
          last_fetch_status = 'failed',
          last_fetch_at = ?,
          last_error = ?,
          updated_at = ?
        WHERE id = ?
      `).run(status, now, String(errorMessage || 'Unknown error'), now, Number(id));
    },
  };
}

function validateRequiredFields(input) {
  for (const field of REQUIRED_FIELDS) {
    if (!String(input?.[field] || '').trim()) {
      throw new Error(`${field} is required`);
    }
  }
}

function normalizeOptional(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
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

function buildAccountListWhere(query) {
  const filters = [];
  const params = [];
  if (query.status) {
    filters.push('status = ?');
    params.push(query.status);
  }
  if (query.keyword) {
    filters.push(`(
      lower(coalesce(gmail_email, '')) LIKE ?
      OR lower(coalesce(display_name, '')) LIKE ?
      OR lower(coalesce(status, '')) LIKE ?
      OR lower(coalesce(last_error, '')) LIKE ?
    )`);
    const keyword = `%${query.keyword}%`;
    params.push(keyword, keyword, keyword, keyword);
  }

  return {
    whereSql: filters.length ? `WHERE ${filters.join(' AND ')}` : '',
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
