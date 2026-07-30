import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

import { DEFAULT_ACTIVATION_METHODS } from './replacementActivationMethods.js';

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
      status TEXT NOT NULL DEFAULT 'unregistered',
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

  const statusMigrationNow = new Date().toISOString();
  db.prepare(`
    UPDATE replacement_accounts
    SET
      status = 'banned',
      status_note = CASE
        WHEN status_note IS NULL OR trim(status_note) = '' THEN '历史失败状态统一迁移为账号封禁'
        ELSE status_note
      END,
      status_updated_at = COALESCE(status_updated_at, ?),
      updated_at = ?
    WHERE status = 'failed'
  `).run(statusMigrationNow, statusMigrationNow);

  db.exec(`
    CREATE TABLE IF NOT EXISTS replacement_activation_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_replacement_activation_methods_name_unique
    ON replacement_activation_methods (lower(trim(name)));
  `);

  const seedMethod = db.prepare(`
    INSERT OR IGNORE INTO replacement_activation_methods (name, created_at, updated_at)
    VALUES (?, ?, ?)
  `);
  const seedMethods = db.transaction((methods) => {
    const now = new Date().toISOString();
    for (const method of methods) {
      seedMethod.run(method, now, now);
    }
  });
  seedMethods(DEFAULT_ACTIVATION_METHODS);

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS roxy_proxy_templates (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      workspace_id INTEGER,
      host TEXT NOT NULL,
      port TEXT NOT NULL,
      account_prefix TEXT NOT NULL,
      encrypted_password TEXT,
      country TEXT NOT NULL,
      ttl_minutes INTEGER NOT NULL,
      protocol TEXT NOT NULL,
      ip_type TEXT NOT NULL,
      check_channel TEXT,
      refresh_url TEXT,
      remark TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roxy_browser_proxy_bindings (
      dir_id TEXT PRIMARY KEY,
      proxy_id INTEGER NOT NULL,
      sort_num INTEGER,
      window_name TEXT,
      template_id INTEGER,
      last_generated_username TEXT,
      last_refresh_ip TEXT,
      last_cdp_status TEXT,
      last_refreshed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_roxy_browser_proxy_bindings_proxy_id
    ON roxy_browser_proxy_bindings (proxy_id);
  `);
  ensureColumn(db, 'roxy_browser_proxy_bindings', 'last_cdp_status', 'TEXT');
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
