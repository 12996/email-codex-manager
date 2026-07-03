import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export function createDatabase(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  initializeSchema(db);
  return db;
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT,
      gmail_email TEXT NOT NULL,
      gmail_password TEXT NOT NULL,
      gmail_2fa TEXT NOT NULL,
      gmail_app_password TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_fetch_at TEXT,
      last_fetch_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS replacement_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      phone TEXT,
      sms_api TEXT,
      email_code_api TEXT,
      codex_2fa TEXT,
      password TEXT,
      sms_last_error TEXT,
      activation_method TEXT,
      activated_at TEXT,
      status TEXT NOT NULL DEFAULT 'for_sale',
      status_updated_at TEXT,
      status_note TEXT,
      replacement_count INTEGER NOT NULL DEFAULT 0,
      consecutive_replace_failures INTEGER NOT NULL DEFAULT 0,
      circuit_breaker_at TEXT,
      circuit_breaker_reason TEXT,
      json_payload TEXT,
      json_fetched_at TEXT,
      last_replace_at TEXT,
      last_error TEXT,
      remark TEXT,
      public_code_enabled INTEGER NOT NULL DEFAULT 0,
      public_code_key TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_replacement_accounts_email_unique
    ON replacement_accounts (lower(trim(email)));
  `);

  ensureColumn(db, 'replacement_accounts', 'public_code_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'replacement_accounts', 'public_code_key', 'TEXT');
  ensureColumn(db, 'replacement_accounts', 'consecutive_replace_failures', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'replacement_accounts', 'circuit_breaker_at', 'TEXT');
  ensureColumn(db, 'replacement_accounts', 'circuit_breaker_reason', 'TEXT');
  ensureColumn(db, 'replacement_accounts', 'email_code_api', 'TEXT');
  ensureColumn(db, 'replacement_accounts', 'codex_2fa', 'TEXT');
  ensureColumn(db, 'replacement_accounts', 'password', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_replacement_accounts_public_code_key_unique
    ON replacement_accounts (public_code_key)
    WHERE public_code_key IS NOT NULL AND public_code_key != '';
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS replacement_automation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      pid INTEGER,
      log_path TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      exit_code INTEGER,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_replacement_automation_runs_started_at
    ON replacement_automation_runs (started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_replacement_automation_runs_account_id
    ON replacement_automation_runs (account_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'info',
      severity TEXT NOT NULL DEFAULT 'warning',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      account_id INTEGER,
      email TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at
    ON admin_notifications (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_admin_notifications_read_at
    ON admin_notifications (read_at);
  `);
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
