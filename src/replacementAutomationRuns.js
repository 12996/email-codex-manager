import { unlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codedError } from './replacementAccounts.js';

const STATUSES = new Set(['running', 'succeeded', 'failed', 'stopped']);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOG_DIR = join(__dirname, '..', 'data', 'automation-logs');

export function createReplacementAutomationRunRepository(db, { maxRuns = 30, logDir = DEFAULT_LOG_DIR } = {}) {
  return {
    createRun(input) {
      const accountId = Number(input?.account_id);
      if (!Number.isInteger(accountId) || accountId <= 0) {
        throw codedError('RUN_ACCOUNT_REQUIRED', 'account_id is required');
      }
      const email = normalizeRequired(input?.email, 'RUN_EMAIL_REQUIRED', 'email is required');
      const logPath = normalizeRequired(input?.log_path, 'RUN_LOG_PATH_REQUIRED', 'log_path is required');
      const now = new Date().toISOString();
      const result = db.prepare(`
        INSERT INTO replacement_automation_runs (
          account_id,
          email,
          status,
          pid,
          log_path,
          started_at
        )
        VALUES (?, ?, 'running', ?, ?, ?)
      `).run(
        accountId,
        email,
        normalizePid(input?.pid),
        logPath,
        now,
      );

      const run = this.getRun(result.lastInsertRowid);
      pruneRuns(db, { maxRuns, logDir });
      return run;
    },

    listRuns({ limit = 100 } = {}) {
      return db.prepare(`
        SELECT * FROM replacement_automation_runs
        ORDER BY datetime(started_at) DESC, id DESC
        LIMIT ?
      `).all(normalizeLimit(limit));
    },

    getRun(id) {
      return db.prepare(`
        SELECT * FROM replacement_automation_runs
        WHERE id = ?
      `).get(Number(id));
    },

    markSucceeded(id, { exitCode = 0 } = {}) {
      return finishRun(db, id, {
        status: 'succeeded',
        exitCode,
        errorMessage: null,
      });
    },

    markFailed(id, { exitCode = null, errorMessage } = {}) {
      return finishRun(db, id, {
        status: 'failed',
        exitCode,
        errorMessage: normalizeErrorMessage(errorMessage),
      });
    },

    markStopped(id, { exitCode = null, errorMessage = 'Stopped by user' } = {}) {
      return finishRun(db, id, {
        status: 'stopped',
        exitCode,
        errorMessage: normalizeErrorMessage(errorMessage),
      });
    },
  };
}

function pruneRuns(db, { maxRuns, logDir }) {
  const normalizedMaxRuns = normalizeMaxRuns(maxRuns);
  const runs = db.prepare(`
    SELECT * FROM replacement_automation_runs
    ORDER BY datetime(started_at) DESC, id DESC
  `).all();
  const deleteCandidates = runs
    .slice(normalizedMaxRuns)
    .filter((run) => run.status !== 'running');
  if (!deleteCandidates.length) return;

  const deleteRun = db.prepare(`
    DELETE FROM replacement_automation_runs
    WHERE id = ?
  `);
  const transaction = db.transaction((candidates) => {
    candidates.forEach((run) => deleteRun.run(run.id));
  });
  transaction(deleteCandidates);
  deleteCandidates.forEach((run) => deleteLogFile(run.log_path, logDir));
}

function finishRun(db, id, { status, exitCode, errorMessage }) {
  if (!STATUSES.has(status) || status === 'running') {
    throw codedError('RUN_STATUS_INVALID', 'run status is invalid');
  }
  const existing = db.prepare(`
    SELECT * FROM replacement_automation_runs
    WHERE id = ?
  `).get(Number(id));
  if (!existing) {
    throw codedError('RUN_NOT_FOUND', 'automation run not found');
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE replacement_automation_runs
    SET
      status = ?,
      finished_at = ?,
      exit_code = ?,
      error_message = ?
    WHERE id = ?
  `).run(status, now, normalizeExitCode(exitCode), errorMessage, existing.id);
  return db.prepare(`
    SELECT * FROM replacement_automation_runs
    WHERE id = ?
  `).get(existing.id);
}

function normalizeRequired(value, code, message) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw codedError(code, message);
  }
  return normalized;
}

function normalizePid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function normalizeExitCode(value) {
  if (value === null || value === undefined) return null;
  const exitCode = Number(value);
  return Number.isInteger(exitCode) ? exitCode : null;
}

function normalizeLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) return 100;
  return Math.min(limit, 500);
}

function normalizeMaxRuns(value) {
  const maxRuns = Number(value);
  return Number.isInteger(maxRuns) && maxRuns > 0 ? maxRuns : 30;
}

function normalizeErrorMessage(value) {
  const normalized = String(value || '').trim();
  return normalized || 'Unknown error';
}

function deleteLogFile(logPath, logDir) {
  const normalizedLogPath = String(logPath || '').trim();
  if (!normalizedLogPath) return;
  if (logDir && !isPathInside(normalizedLogPath, logDir)) return;
  try {
    unlinkSync(normalizedLogPath);
  } catch {
    // Missing or locked log files should not block database cleanup.
  }
}

function isPathInside(filePath, rootDir) {
  const root = resolve(rootDir);
  const target = resolve(filePath);
  return target === root || target.startsWith(`${root}${sep}`);
}
