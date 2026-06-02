import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codedError } from './replacementAccounts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROXY_OAUTH_SCRIPT = join(__dirname, 'auto', 'roxy_oauth_login.js');
const DEFAULT_LOG_DIR = join(__dirname, '..', 'data', 'automation-logs');
const activeChildren = new Map();

export function createReplacementServices({
  fetchImpl = fetch,
  replacementAutomation,
  spawnImpl = spawn,
  nodePath = process.execPath,
  scriptPath = DEFAULT_ROXY_OAUTH_SCRIPT,
  baseEnv = process.env,
  automationRuns,
  logDir = DEFAULT_LOG_DIR,
} = {}) {
  const automation = replacementAutomation || createRoxyOAuthChildProcessAutomation({
    spawnImpl,
    nodePath,
    scriptPath,
    baseEnv,
    automationRuns,
    logDir,
  });

  return {
    async fetchSmsCode(smsApi) {
      const url = normalizeUrl(smsApi, 'SMS_API_REQUIRED', 'sms_api is required');
      const response = await fetchImpl(url);
      const text = await response.text();
      if (!response.ok) {
        throw codedError('SMS_FETCH_FAILED', `SMS API returned ${response.status}`);
      }
      return extractSmsCode(text);
    },

    async fetchJson(url) {
      const normalizedUrl = normalizeUrl(url, 'JSON_URL_REQUIRED', 'url is required');
      const response = await fetchImpl(normalizedUrl);
      const text = await response.text();
      if (!response.ok) {
        throw codedError('JSON_FETCH_FAILED', `JSON API returned ${response.status}`);
      }

      try {
        JSON.parse(text);
      } catch {
        throw codedError('JSON_FETCH_FAILED', 'JSON API returned invalid JSON');
      }

      return text;
    },

    async replaceAccount(account) {
      if (!automation?.replaceAccount) {
        throw codedError('REPLACE_NOT_CONFIGURED', 'replacement automation is not configured');
      }
      return automation.replaceAccount(account);
    },

    stopReplacementRun(runId) {
      return stopReplacementRun(runId);
    },
  };
}

export function createRoxyOAuthChildProcessAutomation({
  spawnImpl = spawn,
  nodePath = process.execPath,
  scriptPath = DEFAULT_ROXY_OAUTH_SCRIPT,
  baseEnv = process.env,
  automationRuns,
  logDir = DEFAULT_LOG_DIR,
} = {}) {
  return {
    replaceAccount(account) {
      const email = normalizeRequired(account?.email, 'REPLACE_FAILED', 'replacement account email is required');
      const smsApi = normalizeOptional(account?.sms_api);
      const env = {
        ...baseEnv,
        ROXY_OAUTH_EMAIL: email,
        ...(smsApi ? { PHONE_VERIFICATION_SMS_API_URL: smsApi } : {}),
      };

      return runChildProcess({
        spawnImpl,
        command: nodePath,
        args: [scriptPath],
        env,
        account,
        automationRuns,
        logDir,
      });
    },
  };
}

function runChildProcess({ spawnImpl, command, args, env, account, automationRuns, logDir }) {
  return new Promise((resolve, reject) => {
    const logPath = createLogPath(logDir, account);
    writeLog(logPath, [
      `[${new Date().toISOString()}] Starting replacement automation`,
      `account_id=${account?.id ?? ''}`,
      `email=${normalizeOptional(account?.email)}`,
      `command=${command} ${args.join(' ')}`,
      '',
    ].join('\n'));

    const child = spawnImpl(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const run = automationRuns?.createRun
      ? automationRuns.createRun({
        account_id: account?.id,
        email: normalizeOptional(account?.email),
        pid: child.pid,
        log_path: logPath,
      })
      : null;
    if (run?.id) {
      activeChildren.set(run.id, child);
    }
    let stdout = '';
    let stderr = '';
    let stopRequested = false;

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      writeLog(logPath, text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      writeLog(logPath, text);
    });
    child.on('error', (error) => {
      if (run?.id) {
        activeChildren.delete(run.id);
        automationRuns.markFailed?.(run.id, { errorMessage: error.message });
      }
      writeLog(logPath, `\n[${new Date().toISOString()}] Child process error: ${error.message}\n`);
      reject(codedError('REPLACE_FAILED', error.message));
    });
    child.on('exit', (_exitCode, signal) => {
      if (signal) {
        stopRequested = true;
      }
    });
    child.on('close', (exitCode) => {
      if (run?.id) {
        activeChildren.delete(run.id);
      }
      if (exitCode === 0) {
        if (run?.id) {
          automationRuns?.markSucceeded?.(run.id, { exitCode });
        }
        writeLog(logPath, `\n[${new Date().toISOString()}] Child process completed with code 0\n`);
        resolve({ ok: true, exitCode, stdout, stderr, ...(run ? { run } : {}) });
        return;
      }
      const details = stderr || stdout || `child process exited with code ${exitCode}`;
      if (run?.id) {
        if (stopRequested) {
          automationRuns?.markStopped?.(run.id, { exitCode, errorMessage: 'Stopped by user' });
        } else {
          automationRuns?.markFailed?.(run.id, { exitCode, errorMessage: details.trim() });
        }
      }
      writeLog(logPath, `\n[${new Date().toISOString()}] Child process failed with code ${exitCode}\n`);
      reject(codedError('REPLACE_FAILED', details.trim()));
    });
  });
}

export function stopReplacementRun(runId) {
  const normalizedRunId = Number(runId);
  const child = activeChildren.get(normalizedRunId);
  if (!child) {
    throw codedError('RUN_NOT_ACTIVE', 'automation run is not active in this server session');
  }
  const killed = child.kill();
  if (!killed) {
    throw codedError('RUN_STOP_FAILED', 'failed to stop automation child process');
  }
  return { ok: true, runId: normalizedRunId };
}

export function extractSmsCode(text) {
  const raw = String(text || '');
  try {
    const parsed = JSON.parse(raw);
    const directCode = normalizeCode(parsed?.code);
    if (directCode) return directCode;
    const nestedCode = normalizeCode(parsed?.data?.code);
    if (nestedCode) return nestedCode;
  } catch {
    // Non-JSON SMS providers are supported by scanning the response text.
  }

  const match = raw.match(/\b\d{6}\b/);
  if (match) return match[0];

  throw codedError('SMS_FETCH_FAILED', 'verification code not found');
}

function normalizeUrl(value, code, message) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw codedError(code, message);
  }
  return normalized;
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
  return normalized || '';
}

function normalizeCode(value) {
  const normalized = String(value || '').trim();
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

function createLogPath(logDir, account) {
  mkdirSync(logDir, { recursive: true });
  const accountId = String(account?.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(logDir, `replacement-${accountId}-${timestamp}.log`);
}

function writeLog(logPath, text) {
  mkdirSync(dirname(logPath), { recursive: true });
  try {
    appendFileSync(logPath, text, 'utf8');
  } catch {
    writeFileSync(logPath, text, 'utf8');
  }
}
