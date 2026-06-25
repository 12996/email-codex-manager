import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codedError } from './replacementAccounts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROXY_OAUTH_SCRIPT = join(__dirname, 'auto', 'roxy_oauth_login.js');
const DEFAULT_ROXY_REGISTER_SCRIPT = join(__dirname, 'auto', 'roxy_register_openai.js');
const DEFAULT_LOG_DIR = join(__dirname, '..', 'data', 'automation-logs');
const activeChildren = new Map();

export function createReplacementServices({
  fetchImpl = fetch,
  replacementAutomation,
  spawnImpl = spawn,
  nodePath = process.execPath,
  scriptPath = DEFAULT_ROXY_OAUTH_SCRIPT,
  registerScriptPath = DEFAULT_ROXY_REGISTER_SCRIPT,
  baseEnv = process.env,
  automationRuns,
  logDir = DEFAULT_LOG_DIR,
} = {}) {
  const defaultAutomation = createRoxyChildProcessAutomation({
    spawnImpl,
    nodePath,
    scriptPath,
    registerScriptPath,
    baseEnv,
    automationRuns,
    logDir,
  });
  const automation = replacementAutomation || defaultAutomation;

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

    async replaceAccount(account, options) {
      if (!automation?.replaceAccount) {
        throw codedError('REPLACE_NOT_CONFIGURED', 'replacement automation is not configured');
      }
      return automation.replaceAccount(account, options);
    },

    async registerAccount(account) {
      if (automation?.registerAccount) {
        return automation.registerAccount(account);
      }
      return defaultAutomation.registerAccount(account);
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
  return createRoxyChildProcessAutomation({
    spawnImpl,
    nodePath,
    scriptPath,
    registerScriptPath: DEFAULT_ROXY_REGISTER_SCRIPT,
    baseEnv,
    automationRuns,
    logDir,
  });
}

export function createRoxyChildProcessAutomation({
  spawnImpl = spawn,
  nodePath = process.execPath,
  scriptPath = DEFAULT_ROXY_OAUTH_SCRIPT,
  registerScriptPath = DEFAULT_ROXY_REGISTER_SCRIPT,
  baseEnv = process.env,
  automationRuns,
  logDir = DEFAULT_LOG_DIR,
} = {}) {
  return {
    replaceAccount(account, options = {}) {
      const email = normalizeRequired(account?.email, 'REPLACE_FAILED', 'replacement account email is required');
      const phone = normalizeOptional(account?.phone);
      const smsApi = normalizeOptional(account?.sms_api);
      const emailCodeApi = normalizeOptional(account?.email_code_api);
      const env = {
        ...baseEnv,
        ROXY_OAUTH_EMAIL: email,
        ...(phone ? { ROXY_OAUTH_PHONE: phone } : {}),
        ...(smsApi ? { PHONE_VERIFICATION_SMS_API_URL: smsApi } : {}),
        ...(emailCodeApi ? { VERIFICATION_CODE_API_URL: emailCodeApi } : {}),
      };
      if (!emailCodeApi) {
        delete env.VERIFICATION_CODE_API_URL;
      }

      return runChildProcess({
        spawnImpl,
        command: nodePath,
        args: [scriptPath],
        env,
        account,
        automationRuns,
        logDir,
        kind: 'replacement',
        failureCode: 'REPLACE_FAILED',
        envSummaryKeys: ['ROXY_OAUTH_EMAIL', 'ROXY_OAUTH_PHONE', 'PHONE_VERIFICATION_SMS_API_URL', 'VERIFICATION_CODE_API_URL'],
        cpaTriggerDetails: options?.cpaTriggerDetails,
      });
    },

    registerAccount(account) {
      const email = normalizeRequired(account?.email, 'REGISTER_FAILED', 'registration account email is required');
      const emailCodeApi = normalizeOptional(account?.email_code_api);
      const env = {
        ...baseEnv,
        ROXY_REGISTER_EMAIL: email,
        ROXY_OAUTH_EMAIL: email,
        ...(emailCodeApi ? { REGISTRATION_EMAIL_CODE_API_URL: emailCodeApi } : {}),
      };
      delete env.PHONE_VERIFICATION_SMS_API_URL;
      if (!emailCodeApi) {
        delete env.REGISTRATION_EMAIL_CODE_API_URL;
      }

      return runChildProcess({
        spawnImpl,
        command: nodePath,
        args: [registerScriptPath],
        env,
        account: { ...account, email },
        automationRuns,
        logDir,
        kind: 'registration',
        failureCode: 'REGISTER_FAILED',
        envSummaryKeys: ['ROXY_REGISTER_EMAIL', 'ROXY_OAUTH_EMAIL', 'VERIFICATION_CODE_API_URL', 'REGISTRATION_EMAIL_CODE_API_URL'],
      });
    },
  };
}

function runChildProcess({
  spawnImpl,
  command,
  args,
  env,
  account,
  automationRuns,
  logDir,
  kind = 'replacement',
  failureCode = 'REPLACE_FAILED',
  envSummaryKeys = [],
  cpaTriggerDetails = '',
}) {
  return new Promise((resolve, reject) => {
    const logPath = createLogPath(logDir, account, kind);
    writeLog(logPath, [
      `[${new Date().toISOString()}] Starting ${kind} automation`,
      `account_id=${account?.id ?? ''}`,
      `email=${normalizeOptional(account?.email)}`,
      `command=${command} ${args.join(' ')}`,
      '',
    ].join('\n'));
    writeStepLog(logPath, 'validate-account', 'validated replacement account', `account_id=${account?.id ?? ''} email=${normalizeOptional(account?.email)}`);
    if (cpaTriggerDetails) {
      writeStepLog(logPath, 'cpa-trigger', '记录 CPA 自动补号触发原因', cpaTriggerDetails);
    }
    writeStepLog(logPath, 'prepare-env', 'prepared child process environment', summarizeEnv(env, envSummaryKeys));
    writeStepLog(logPath, 'spawn-child', 'spawning automation child process', `command=${command} args=${args.join(' ')}`);

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
      writeStepLog(logPath, 'create-run', 'created automation run', `run_id=${run.id} pid=${child.pid || ''}`);
    } else {
      writeStepLog(logPath, 'create-run', 'skipped automation run persistence', 'automationRuns.createRun not configured');
    }
    let stdout = '';
    let stderr = '';
    let stopRequested = false;

    writeStepLog(logPath, 'stream-output', 'attached stdout and stderr log listeners');
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
    writeStepLog(logPath, 'wait-child', 'waiting for automation child process to finish');
    child.on('error', (error) => {
      if (run?.id) {
        activeChildren.delete(run.id);
        automationRuns.markFailed?.(run.id, { errorMessage: error.message });
        writeStepLog(logPath, 'mark-failed', 'marked automation run failed', `run_id=${run.id} error=${error.message}`);
      }
      writeStepLog(logPath, 'child-error', 'child process emitted error', `error=${error.message}`);
      reject(codedError(failureCode, error.message));
    });
    child.on('exit', (_exitCode, signal) => {
      if (signal) {
        stopRequested = true;
        writeStepLog(logPath, 'child-exit', 'child process received stop signal', `signal=${signal}`);
      }
    });
    child.on('close', (exitCode) => {
      if (run?.id) {
        activeChildren.delete(run.id);
      }
      if (exitCode === 0) {
        if (run?.id) {
          automationRuns?.markSucceeded?.(run.id, { exitCode });
          writeStepLog(logPath, 'mark-succeeded', 'marked automation run succeeded', `exit_code=${exitCode}`);
        }
        writeStepLog(logPath, 'child-close', 'child process completed successfully', `exit_code=${exitCode}`);
        resolve({ ok: true, exitCode, stdout, stderr, ...(cpaTriggerDetails ? { cpaTriggerLogged: true } : {}), ...(run ? { run } : {}) });
        return;
      }
      const details = stderr || stdout || `child process exited with code ${exitCode}`;
      if (run?.id) {
        if (stopRequested) {
          automationRuns?.markStopped?.(run.id, { exitCode, errorMessage: 'Stopped by user' });
          writeStepLog(logPath, 'mark-stopped', 'marked automation run stopped', `exit_code=${exitCode}`);
        } else {
          automationRuns?.markFailed?.(run.id, { exitCode, errorMessage: details.trim() });
          writeStepLog(logPath, 'mark-failed', 'marked automation run failed', `exit_code=${exitCode}`);
        }
      }
      writeStepLog(logPath, 'child-close', 'child process finished with failure', `exit_code=${exitCode}`);
      reject(codedError(failureCode, details.trim()));
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

function createLogPath(logDir, account, kind = 'replacement') {
  mkdirSync(logDir, { recursive: true });
  const accountId = String(account?.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeKind = String(kind || 'automation').replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(logDir, `${safeKind}-${accountId}-${timestamp}.log`);
}

function writeLog(logPath, text) {
  const safeText = sanitizeLogText(text);
  mkdirSync(dirname(logPath), { recursive: true });
  try {
    appendFileSync(logPath, safeText, 'utf8');
  } catch {
    writeFileSync(logPath, safeText, 'utf8');
  }
}

function writeStepLog(logPath, step, action, details = '') {
  const suffix = details ? ` ${details}` : '';
  writeLog(logPath, `[${new Date().toISOString()}] step=${step} action=${action}${suffix}\n`);
}

function summarizeEnv(env, keys) {
  return keys.map((key) => `${key}=${env[key] ? 'set' : 'unset'}`).join(' ');
}

function sanitizeLogText(text) {
  return String(text)
    .replace(/(Cookie:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(admin_auth=)[^\s;]+/gi, '$1[redacted]')
    .replace(/(accessToken["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/(access[_-]?token["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/(refresh[_-]?token["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/(id[_-]?token["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/(proxyPassword["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/\b(code=)\d{6}\b/gi, '$1[redacted-code]')
    .replace(/(验证码[:：]?\s*)\d{6}/g, '$1[redacted-code]')
    .replace(/(verification code[:：]?\s*)\d{6}/gi, '$1[redacted-code]')
    .replace(/(提交验证码[:：]?\s*)\d{6}/g, '$1[redacted-code]');
}
