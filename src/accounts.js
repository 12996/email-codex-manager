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
