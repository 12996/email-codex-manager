import dotenv from 'dotenv';

dotenv.config();

export function normalizeCpaConfig(env = process.env) {
  const baseUrl = String(env.CPA_URL || '').trim().replace(/\/+$/, '');
  const managementKey = String(env.CPA_MANAGEMENT_KEY || '').trim();
  const managementBase = baseUrl.endsWith('/v0/management') ? baseUrl : `${baseUrl}/v0/management`;
  return {
    baseUrl,
    managementKey,
    authFilesUrl: baseUrl ? `${managementBase}/auth-files` : '',
    monitorEnabled: String(env.CPA_HEALTH_MONITOR_ENABLED || 'false') === 'true',
    monitorIntervalMs: Number(env.CPA_HEALTH_MONITOR_INTERVAL_MS || 10 * 60 * 1000),
  };
}

export function normalizeAutomationLogMaxRuns(env = process.env) {
  const value = Number(env.REPLACEMENT_AUTOMATION_LOG_MAX_RUNS || 30);
  return Number.isInteger(value) && value > 0 ? value : 30;
}

export function normalizeImapConfig(env = process.env) {
  return {
    host: env.IMAP_HOST || 'imap.gmail.com',
    port: Number(env.IMAP_PORT || 993),
    secure: String(env.IMAP_SECURE || 'true') === 'true',
    proxy: String(env.IMAP_PROXY || '').trim(),
  };
}

export const config = {
  adminPassword: process.env.ADMIN_PASSWORD || 'change-me',
  sessionSecret: process.env.SESSION_SECRET || 'change-me-session-secret',
  databasePath: process.env.DATABASE_PATH || './data/app.db',
  imap: normalizeImapConfig(),
  icloudCodeDefaultGmailAccount: process.env.ICLOUD_CODE_GMAIL_ACCOUNT || 'rosannathornton1@gmail.com',
  mailFetchLimit: Number(process.env.MAIL_FETCH_LIMIT || 5),
  defaultReadLocation: process.env.DEFAULT_READ_LOCATION || 'inbox',
  replacementAutomationLogMaxRuns: normalizeAutomationLogMaxRuns(),
  cpa: normalizeCpaConfig(),
};
