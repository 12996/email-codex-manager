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
      sms_last_error TEXT,
      activation_method TEXT,
      activated_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      status_updated_at TEXT,
      status_note TEXT,
      replacement_count INTEGER NOT NULL DEFAULT 0,
      json_payload TEXT,
      json_fetched_at TEXT,
      last_replace_at TEXT,
      last_error TEXT,
      remark TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_replacement_accounts_email_unique
    ON replacement_accounts (lower(trim(email)));
  `);
}
