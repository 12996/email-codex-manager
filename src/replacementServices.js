import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { codedError } from './replacementAccounts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const DEFAULT_ROXY_OAUTH_SCRIPT = join(__dirname, 'auto', 'roxy_oauth_login.js');
const DEFAULT_ROXY_2FA_AUTH_SCRIPT = join(__dirname, 'auto', 'roxy_2fa_auth_login.js');
const DEFAULT_ROXY_2FA_LOGIN_SCRIPT = join(__dirname, 'auto', 'roxy_2fa_login.js');
const DEFAULT_ROXY_REGISTER_SCRIPT = join(__dirname, 'auto', 'roxy_register_openai.js');
const DEFAULT_PROTOCOL_PROJECT_DIR = join(__dirname, 'auto', 'protocol_registration');
const DEFAULT_PROTOCOL_MAIN_PATH = join(DEFAULT_PROTOCOL_PROJECT_DIR, 'main.py');
const DEFAULT_PROTOCOL_TWO_FA_PROJECT_DIR = join(__dirname, 'auto');
const DEFAULT_PROTOCOL_TWO_FA_MAIN_PATH = join(DEFAULT_PROTOCOL_TWO_FA_PROJECT_DIR, 'protocol_cpa_replacement.py');
const DEFAULT_PROTOCOL_PYTHON_PATH = 'F:\\anaconda\\anaconda3\\envs\\tilian\\python.exe';
const DEFAULT_REGISTRATION_TOKEN_OUTPUT_DIR = join(__dirname, 'auto', 'product_files', 'registration');
const DEFAULT_LOG_DIR = join(__dirname, '..', 'data', 'automation-logs');
const activeChildren = new Map();
const ROXY_TARGET_ENV_KEYS = [
  'ROXY_BROWSER_DIR_ID',
  'ROXY_BROWSER_SORT_NUM',
  'ROXY_BROWSER_WINDOW_NAME',
  'ROXY_CDP_ENDPOINT',
];

export function createReplacementServices({
  fetchImpl = fetch,
  replacementAutomation,
  spawnImpl = spawn,
  nodePath = process.execPath,
  scriptPath = DEFAULT_ROXY_OAUTH_SCRIPT,
  twoFaScriptPath = DEFAULT_ROXY_2FA_AUTH_SCRIPT,
  twoFaLoginScriptPath = DEFAULT_ROXY_2FA_LOGIN_SCRIPT,
  registerScriptPath = DEFAULT_ROXY_REGISTER_SCRIPT,
  protocolPythonPath,
  protocolProjectPath,
  protocolMainPath,
  protocolTwoFaPythonPath,
  protocolTwoFaProjectPath,
  protocolTwoFaMainPath,
  prepareProtocolRoxyImpl,
  roxyClientFactory,
  baseEnv = process.env,
  automationRuns,
  logDir = DEFAULT_LOG_DIR,
} = {}) {
  const defaultAutomation = createRoxyChildProcessAutomation({
    spawnImpl,
    nodePath,
    scriptPath,
    twoFaScriptPath,
    twoFaLoginScriptPath,
    registerScriptPath,
    protocolPythonPath,
    protocolProjectPath,
    protocolMainPath,
    protocolTwoFaPythonPath,
    protocolTwoFaProjectPath,
    protocolTwoFaMainPath,
    prepareProtocolRoxyImpl,
    roxyClientFactory,
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

    async replaceAccountWith2FA(account, options) {
      if (isEnabledFlag(options?.protocol) || isEnabledFlag(baseEnv.REPLACEMENT_2FA_PROTOCOL_ENABLED)) {
        return this.replaceAccountWith2FAProtocol(account, options);
      }
      if (automation?.replaceAccountWith2FA) {
        return automation.replaceAccountWith2FA(account, options);
      }
      if (!defaultAutomation?.replaceAccountWith2FA) {
        throw codedError('REPLACE_2FA_NOT_CONFIGURED', '2fa replacement automation is not configured');
      }
      return defaultAutomation.replaceAccountWith2FA(account, options);
    },

    async replaceAccountWith2FAProtocol(account, options) {
      if (automation?.replaceAccountWith2FAProtocol) {
        return automation.replaceAccountWith2FAProtocol(account, options);
      }
      if (!defaultAutomation?.replaceAccountWith2FAProtocol) {
        throw codedError('REPLACE_2FA_PROTOCOL_NOT_CONFIGURED', '2fa replacement protocol is not configured');
      }
      return defaultAutomation.replaceAccountWith2FAProtocol(account, options);
    },

    async loginAccountWith2FA(account, options) {
      if (automation?.loginAccountWith2FA) {
        return automation.loginAccountWith2FA(account, options);
      }
      if (!defaultAutomation?.loginAccountWith2FA) {
        throw codedError('LOGIN_2FA_NOT_CONFIGURED', '2fa login automation is not configured');
      }
      return defaultAutomation.loginAccountWith2FA(account, options);
    },

    async registerAccount(account) {
      if (automation?.registerAccount) {
        return automation.registerAccount(account);
      }
      return defaultAutomation.registerAccount(account);
    },

    async registerProtocolAccount(account, options) {
      if (automation?.registerProtocolAccount) {
        return automation.registerProtocolAccount(account, options);
      }
      if (!defaultAutomation?.registerProtocolAccount) {
        throw codedError('PROTOCOL_REGISTER_NOT_CONFIGURED', 'protocol registration is not configured');
      }
      return defaultAutomation.registerProtocolAccount(account, options);
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
  twoFaScriptPath = DEFAULT_ROXY_2FA_AUTH_SCRIPT,
  twoFaLoginScriptPath = DEFAULT_ROXY_2FA_LOGIN_SCRIPT,
  protocolPythonPath,
  protocolProjectPath,
  protocolMainPath,
  protocolTwoFaPythonPath,
  protocolTwoFaProjectPath,
  protocolTwoFaMainPath,
  prepareProtocolRoxyImpl,
  roxyClientFactory,
  baseEnv = process.env,
  automationRuns,
  logDir = DEFAULT_LOG_DIR,
} = {}) {
  return createRoxyChildProcessAutomation({
    spawnImpl,
    nodePath,
    scriptPath,
    twoFaScriptPath,
    twoFaLoginScriptPath,
    registerScriptPath: DEFAULT_ROXY_REGISTER_SCRIPT,
    protocolPythonPath,
    protocolProjectPath,
    protocolMainPath,
    protocolTwoFaPythonPath,
    protocolTwoFaProjectPath,
    protocolTwoFaMainPath,
    prepareProtocolRoxyImpl,
    roxyClientFactory,
    baseEnv,
    automationRuns,
    logDir,
  });
}

export function createRoxyChildProcessAutomation({
  spawnImpl = spawn,
  nodePath = process.execPath,
  scriptPath = DEFAULT_ROXY_OAUTH_SCRIPT,
  twoFaScriptPath = DEFAULT_ROXY_2FA_AUTH_SCRIPT,
  twoFaLoginScriptPath = DEFAULT_ROXY_2FA_LOGIN_SCRIPT,
  registerScriptPath = DEFAULT_ROXY_REGISTER_SCRIPT,
  protocolPythonPath = normalizeOptional(process.env.PROTOCOL_PYTHON_PATH) || DEFAULT_PROTOCOL_PYTHON_PATH,
  protocolProjectPath = normalizeOptional(process.env.PROTOCOL_PROJECT_PATH) || DEFAULT_PROTOCOL_PROJECT_DIR,
  protocolMainPath = normalizeOptional(process.env.PROTOCOL_MAIN_PATH) || join(protocolProjectPath, 'main.py'),
  protocolTwoFaPythonPath = normalizeOptional(process.env.PROTOCOL_2FA_PYTHON_PATH) || protocolPythonPath,
  protocolTwoFaProjectPath = normalizeOptional(process.env.PROTOCOL_2FA_PROJECT_PATH) || DEFAULT_PROTOCOL_TWO_FA_PROJECT_DIR,
  protocolTwoFaMainPath = normalizeOptional(process.env.PROTOCOL_2FA_MAIN_PATH)
    || (protocolTwoFaProjectPath === DEFAULT_PROTOCOL_TWO_FA_PROJECT_DIR
      ? DEFAULT_PROTOCOL_TWO_FA_MAIN_PATH
      : join(protocolTwoFaProjectPath, 'protocol_cpa_replacement.py')),
  prepareProtocolRoxyImpl = prepareProtocolRoxy,
  roxyClientFactory = createDefaultProtocolRoxyClient,
  baseEnv = process.env,
  automationRuns,
  logDir = DEFAULT_LOG_DIR,
} = {}) {
  let protocolRegistrationInFlight = false;

  return {
    replaceAccount(account, options = {}) {
      const email = normalizeRequired(account?.email, 'REPLACE_FAILED', 'replacement account email is required');
      const phone = normalizeOptional(account?.phone);
      const smsApi = normalizeOptional(account?.sms_api);
      const emailCodeApi = normalizeEmailCodeApiForAccount(account);
      const env = applyActionRoxyTargetEnv({
        ...baseEnv,
        ROXY_OAUTH_EMAIL: email,
        ...(phone ? { ROXY_OAUTH_PHONE: phone } : {}),
        ...(smsApi ? { PHONE_VERIFICATION_SMS_API_URL: smsApi } : {}),
        ...(emailCodeApi ? { VERIFICATION_CODE_API_URL: emailCodeApi } : {}),
      }, 'ROXY_REPLACE');
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
        envSummaryKeys: [
          'ROXY_OAUTH_EMAIL',
          'ROXY_OAUTH_PHONE',
          'PHONE_VERIFICATION_SMS_API_URL',
          'VERIFICATION_CODE_API_URL',
          ...ROXY_TARGET_ENV_KEYS,
        ],
        cpaTriggerDetails: options?.cpaTriggerDetails,
      });
    },

    replaceAccountWith2FA(account, options = {}) {
      const email = normalizeRequired(account?.email, 'REPLACE_FAILED', 'replacement account email is required');
      const phone = normalizeOptional(account?.phone);
      const smsApi = normalizeOptional(account?.sms_api);
      const emailCodeApi = normalizeEmailCodeApiForAccount(account);
      const password = normalizeOptional(account?.password);
      const codex2fa = normalizeOptional(account?.codex_2fa);
      const env = applyActionRoxyTargetEnv({
        ...baseEnv,
        ROXY_OAUTH_EMAIL: email,
        ...(phone ? { ROXY_OAUTH_PHONE: phone } : {}),
        ...(smsApi ? { PHONE_VERIFICATION_SMS_API_URL: smsApi } : {}),
        ...(emailCodeApi ? { VERIFICATION_CODE_API_URL: emailCodeApi } : {}),
        ...(password ? { ROXY_OAUTH_PASSWORD: password } : {}),
      }, 'ROXY_REPLACE_2FA');

      if (!emailCodeApi) {
        delete env.VERIFICATION_CODE_API_URL;
      }
      if (codex2fa) {
        if (/^\d{6,8}$/.test(codex2fa)) {
          env.ROXY_OAUTH_2FA_CODE = codex2fa;
          delete env.ROXY_OAUTH_TOTP_SECRET;
        } else {
          env.ROXY_OAUTH_TOTP_SECRET = codex2fa;
          delete env.ROXY_OAUTH_2FA_CODE;
        }
      } else {
        delete env.ROXY_OAUTH_2FA_CODE;
        delete env.ROXY_OAUTH_TOTP_SECRET;
      }

      return runChildProcess({
        spawnImpl,
        command: nodePath,
        args: [twoFaScriptPath],
        env,
        account,
        automationRuns,
        logDir,
        kind: 'replacement-2fa',
        failureCode: 'REPLACE_FAILED',
        envSummaryKeys: [
          'ROXY_OAUTH_EMAIL',
          'ROXY_OAUTH_PHONE',
          'PHONE_VERIFICATION_SMS_API_URL',
          'VERIFICATION_CODE_API_URL',
          'ROXY_OAUTH_PASSWORD',
          'ROXY_OAUTH_2FA_CODE',
          'ROXY_OAUTH_TOTP_SECRET',
          ...ROXY_TARGET_ENV_KEYS,
        ],
        cpaTriggerDetails: options?.cpaTriggerDetails,
      });
    },

    async replaceAccountWith2FAProtocol(account, options = {}) {
      const accountId = normalizeRequired(account?.id, 'REPLACE_FAILED', 'replacement account id is required');
      const env = {
        ...baseEnv,
        REPLACEMENT_ACCOUNT_ID: accountId,
        ROXY_CDP_ENABLED: '1',
        // Protocol replacement needs a fresh Roxy profile before Auth navigation.
        ROXY_CDP_PREPARE: '1',
        ROXY_KEEP_OPEN: '1',
        CPA_OUTPUT_DIR: normalizeOptional(baseEnv.CPA_OUTPUT_DIR)
          || join(__dirname, 'auto', 'product_files', 'cpa'),
      };
      const adminPassword = normalizeOptional(baseEnv.REPLACEMENT_ADMIN_PASSWORD)
        || normalizeOptional(baseEnv.ADMIN_PASSWORD);
      if (adminPassword) {
        env.REPLACEMENT_ADMIN_PASSWORD = adminPassword;
      }
      env.ROXY_PROTOCOL_BROWSER_SORT_NUM = normalizeOptional(baseEnv.ROXY_PROTOCOL_BROWSER_SORT_NUM) || '3';
      env.ROXY_PROTOCOL_BROWSER_WINDOW_NAME = normalizeOptional(baseEnv.ROXY_PROTOCOL_BROWSER_WINDOW_NAME) || 'test';
      // Always select the action-specific profile so a stale global CDP endpoint cannot bypass refresh.
      applyActionRoxyTargetEnv(env, 'ROXY_PROTOCOL');

      notifyAutomationLog(options?.onLog, {
        type: 'step',
        step: 'prepare-roxy',
        message: '正在刷新协议补号使用的 Roxy 浏览器环境',
      });
      const prepared = await prepareProtocolRoxyImpl({
        env,
        account,
        clientFactory: roxyClientFactory,
      });
      notifyAutomationLog(options?.onLog, {
        type: 'step',
        step: 'roxy-ready',
        message: '协议补号 Roxy 指纹、IP 和 CDP 已准备完成',
      });
      const cdpEndpoint = normalizeRequired(
        prepared?.cdpEndpoint,
        'REPLACE_FAILED',
        'Roxy CDP endpoint is unavailable after fingerprint refresh',
      );
      env.ROXY_CDP_ENDPOINT = cdpEndpoint;
      // The profile is already refreshed above; the child must not refresh it a second time.
      env.ROXY_CDP_PREPARE = '0';

      return runChildProcess({
        spawnImpl,
        command: protocolTwoFaPythonPath,
        args: [protocolTwoFaMainPath, '--account-id', accountId],
        cwd: protocolTwoFaProjectPath,
        env,
        account,
        automationRuns,
        logDir,
        kind: 'replacement-2fa-protocol',
        failureCode: 'REPLACE_FAILED',
        envSummaryKeys: [
          'REPLACEMENT_ACCOUNT_ID',
          'ROXY_CDP_ENABLED',
          'ROXY_CDP_PREPARE',
          'ROXY_KEEP_OPEN',
          'SMS_API_PROXY',
          'OPENAI_WORKSPACE_ID',
          'REPLACEMENT_API_BASE',
          'CPA_OUTPUT_DIR',
          ...ROXY_TARGET_ENV_KEYS,
        ],
        onLog: options?.onLog,
        cpaTriggerDetails: options?.cpaTriggerDetails,
      });
    },

    loginAccountWith2FA(account) {
      const email = normalizeRequired(account?.email, 'LOGIN_2FA_FAILED', '2fa login account email is required');
      const password = normalizeOptional(account?.password);
      const codex2fa = normalizeOptional(account?.codex_2fa);
      const env = applyActionRoxyTargetEnv({
        ...baseEnv,
        ROXY_2FA_EMAIL: email,
        ROXY_OAUTH_EMAIL: email,
        ...(password ? { ROXY_OAUTH_PASSWORD: password } : {}),
      }, 'ROXY_2FA_LOGIN');

      if (!password) {
        delete env.ROXY_OAUTH_PASSWORD;
      }
      if (codex2fa) {
        if (/^\d{6,8}$/.test(codex2fa)) {
          env.ROXY_OAUTH_2FA_CODE = codex2fa;
          delete env.ROXY_OAUTH_TOTP_SECRET;
        } else {
          env.ROXY_OAUTH_TOTP_SECRET = codex2fa;
          delete env.ROXY_OAUTH_2FA_CODE;
        }
      } else {
        delete env.ROXY_OAUTH_2FA_CODE;
        delete env.ROXY_OAUTH_TOTP_SECRET;
      }

      return runChildProcess({
        spawnImpl,
        command: nodePath,
        args: [twoFaLoginScriptPath],
        env,
        account: { ...account, email },
        automationRuns,
        logDir,
        kind: 'login-2fa',
        failureCode: 'LOGIN_2FA_FAILED',
        envSummaryKeys: [
          'ROXY_2FA_EMAIL',
          'ROXY_OAUTH_EMAIL',
          'ROXY_OAUTH_PASSWORD',
          'ROXY_OAUTH_2FA_CODE',
          'ROXY_OAUTH_TOTP_SECRET',
          ...ROXY_TARGET_ENV_KEYS,
        ],
      });
    },

    registerProtocolAccount(account, options = {}) {
      if (protocolRegistrationInFlight) {
        return Promise.reject(codedError('PROTOCOL_REGISTER_BUSY', 'protocol registration is already running for the shared Roxy profile'));
      }

      const email = normalizeRequired(account?.email, 'PROTOCOL_REGISTER_FAILED', 'protocol registration account email is required');
      const accountId = normalizeRequired(account?.id, 'PROTOCOL_REGISTER_FAILED', 'protocol registration account id is required');
      if (!/^\d+$/.test(accountId)) {
        return Promise.reject(codedError('PROTOCOL_REGISTER_FAILED', 'protocol registration account id is invalid'));
      }

      protocolRegistrationInFlight = true;
      return (async () => {
        notifyAutomationLog(options?.onLog, {
          type: 'step',
          step: 'prepare-roxy',
          message: '正在准备 Roxy 浏览器环境',
        });
        const env = buildProtocolRegistrationEnv({
          baseEnv,
          account,
          email,
          accountId,
        });
        const prepared = await prepareProtocolRoxyImpl({
          env,
          account,
          clientFactory: roxyClientFactory,
        });
        notifyAutomationLog(options?.onLog, {
          type: 'step',
          step: 'roxy-ready',
          message: 'Roxy 指纹、IP 和 CDP 已准备完成',
        });
        const cdpEndpoint = normalizeRequired(
          prepared?.cdpEndpoint,
          'PROTOCOL_REGISTER_FAILED',
          'Roxy CDP endpoint is unavailable after fingerprint refresh',
        );
        env.ROXY_CDP_ENDPOINT = cdpEndpoint;
        env.ROXY_CDP_PREPARE = '0';

        return runChildProcess({
          spawnImpl,
          command: protocolPythonPath,
          args: [protocolMainPath, '--count', '1', '--workers', '1'],
          cwd: protocolProjectPath,
          env,
          account: { ...account, email },
          automationRuns,
          logDir,
          kind: 'protocol-registration',
          failureCode: 'PROTOCOL_REGISTER_FAILED',
          envSummaryKeys: [
            'OTP_PROVIDER',
            'EMAIL_SOURCE',
            'REPLACEMENT_ACCOUNT_ID',
            'REPLACEMENT_API_BASE',
            'ROXY_REGISTER_PASSWORD',
            'ROXY_CDP_ENABLED',
            'ROXY_IP_CHECK_ENABLED',
            'ROXY_CDP_ORIGIN_ISOLATION',
            'REGISTRATION_RESULT_JSON',
            'ROXY_CDP_ENDPOINT',
            'REGISTRATION_EMAIL_CODE_API_URL',
            'REGISTRATION_TOKEN_OUTPUT_DIR',
            ...ROXY_TARGET_ENV_KEYS,
          ],
          onLog: options?.onLog,
          cpaTriggerDetails: options?.cpaTriggerDetails,
        });
      })().finally(() => {
        protocolRegistrationInFlight = false;
      });
    },

    registerAccount(account) {
      const email = normalizeRequired(account?.email, 'REGISTER_FAILED', 'registration account email is required');
      const emailCodeApi = normalizeEmailCodeApiForAccount(account);
      const password = normalizeOptional(account?.password);
      const env = applyActionRoxyTargetEnv({
        ...baseEnv,
        ROXY_REGISTER_EMAIL: email,
        ROXY_OAUTH_EMAIL: email,
        ...(password ? { ROXY_REGISTER_PASSWORD: password } : {}),
        ...(emailCodeApi ? { REGISTRATION_EMAIL_CODE_API_URL: emailCodeApi } : {}),
      }, 'ROXY_REGISTER');
      delete env.PHONE_VERIFICATION_SMS_API_URL;
      if (!password) {
        delete env.ROXY_REGISTER_PASSWORD;
      }
      if (!emailCodeApi) {
        delete env.REGISTRATION_EMAIL_CODE_API_URL;
        delete env.VERIFICATION_CODE_API_URL;
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
        envSummaryKeys: [
          'ROXY_REGISTER_EMAIL',
          'ROXY_OAUTH_EMAIL',
          'ROXY_REGISTER_PASSWORD',
          'VERIFICATION_CODE_API_URL',
          'REGISTRATION_EMAIL_CODE_API_URL',
          ...ROXY_TARGET_ENV_KEYS,
        ],
      });
    },
  };
}

function applyActionRoxyTargetEnv(env, prefix) {
  const dirId = normalizeOptional(env[`${prefix}_BROWSER_DIR_ID`]);
  const sortNum = normalizeOptional(env[`${prefix}_BROWSER_SORT_NUM`]);
  const windowName = normalizeOptional(env[`${prefix}_BROWSER_WINDOW_NAME`]);
  const cdpEndpoint = normalizeOptional(env[`${prefix}_CDP_ENDPOINT`]);
  const hasBrowserTarget = Boolean(dirId || sortNum || windowName);

  if (hasBrowserTarget || cdpEndpoint) {
    for (const key of ROXY_TARGET_ENV_KEYS) {
      delete env[key];
    }
  }

  if (dirId) env.ROXY_BROWSER_DIR_ID = dirId;
  if (sortNum) env.ROXY_BROWSER_SORT_NUM = sortNum;
  if (windowName) env.ROXY_BROWSER_WINDOW_NAME = windowName;
  if (cdpEndpoint) env.ROXY_CDP_ENDPOINT = cdpEndpoint;

  return env;
}

function buildProtocolRegistrationEnv({ baseEnv, account, email, accountId }) {
  const password = normalizeOptional(account?.password);
  const configuredServiceBaseUrl = normalizeOptional(baseEnv.REPLACEMENT_API_BASE);
  const configuredPort = Number(baseEnv.PORT);
  const localServicePort = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : 3000;
  const env = {
    ...baseEnv,
    OTP_PROVIDER: 'replacement',
    EMAIL_SOURCE: 'replacement',
    REPLACEMENT_ACCOUNT_ID: accountId,
    // The protocol child calls back into this service to claim the selected account.
    REPLACEMENT_API_BASE: configuredServiceBaseUrl || `http://127.0.0.1:${localServicePort}`,
    ROXY_CDP_ENABLED: '1',
    ROXY_IP_CHECK_ENABLED: normalizeOptional(baseEnv.ROXY_IP_CHECK_ENABLED) || '1',
    // Keep ChatGPT, Auth, and Sentinel pages separate while sharing one context.
    // A single page lets Sentinel navigation replace the registration password page.
    ROXY_CDP_ORIGIN_ISOLATION: '1',
    REGISTRATION_RESULT_JSON: '1',
    REGISTRATION_TOKEN_OUTPUT_DIR:
      normalizeOptional(baseEnv.REGISTRATION_TOKEN_OUTPUT_DIR) || DEFAULT_REGISTRATION_TOKEN_OUTPUT_DIR,
    ROXY_PROTOCOL_BROWSER_SORT_NUM: normalizeOptional(baseEnv.ROXY_PROTOCOL_BROWSER_SORT_NUM) || '3',
    ROXY_PROTOCOL_BROWSER_WINDOW_NAME: normalizeOptional(baseEnv.ROXY_PROTOCOL_BROWSER_WINDOW_NAME) || 'test',
    ROXY_REGISTER_EMAIL: email,
    ...(password ? { ROXY_REGISTER_PASSWORD: password } : {}),
    ...(normalizeOptional(account?.email_code_api)
      ? { REGISTRATION_EMAIL_CODE_API_URL: normalizeOptional(account.email_code_api) }
      : {}),
  };

  delete env.ROXY_CDP_ENDPOINT;
  delete env.ROXY_PROTOCOL_CDP_ENDPOINT;
  delete env.ROXY_OAUTH_PASSWORD;
  if (!password) delete env.ROXY_REGISTER_PASSWORD;
  return applyActionRoxyTargetEnv(env, 'ROXY_PROTOCOL');
}

function createDefaultProtocolRoxyClient(env) {
  const { RoxyBrowserClient } = nodeRequire('./auto/roxy-browser-client.cjs');
  return new RoxyBrowserClient({
    apiBaseUrl: normalizeOptional(env.ROXY_API_BASE_URL) || undefined,
    apiPort: normalizeOptional(env.ROXY_API_PORT) || undefined,
    token: normalizeOptional(env.ROXY_API_TOKEN),
    workspaceId: Number(env.ROXY_WORKSPACE_ID || 0),
    dirId: normalizeOptional(env.ROXY_BROWSER_DIR_ID),
    windowName: normalizeOptional(env.ROXY_BROWSER_WINDOW_NAME),
    windowSortNum: normalizeOptional(env.ROXY_BROWSER_SORT_NUM),
  });
}

async function prepareProtocolRoxy({ env, clientFactory = createDefaultProtocolRoxyClient }) {
  const client = await clientFactory(env);
  await client.resolveDirId();

  if (String(env.ROXY_PROTOCOL_ENSURE_CLOSED ?? env.ROXY_ENSURE_CLOSED ?? '1') !== '0') {
    try {
      await client.closeBrowser();
    } catch (error) {
      // Roxy reports an error when the target is already closed; preparation can continue.
      console.warn(`[protocol-registration] close Roxy window ignored: ${error.message || error}`);
    }
  }

  await client.clearLocalCache();
  await client.clearServerCache();
  await client.randomFingerprint();
  await client.openBrowser();
  const connection = await client.getConnectionInfo();
  return {
    cdpEndpoint: connection?.ws,
    dirId: client.dirId,
  };
}

function normalizeEmailCodeApiForAccount(account) {
  return normalizeOptional(account?.email_code_api);
}

function runChildProcess({
  spawnImpl,
  command,
  args,
  cwd,
  env,
  account,
  automationRuns,
  logDir,
  kind = 'replacement',
  failureCode = 'REPLACE_FAILED',
  envSummaryKeys = [],
  onLog,
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
      ...(cwd ? { cwd } : {}),
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
    let stdoutLogRemainder = '';
    let stderrLogRemainder = '';

    const forwardChildLog = (stream, text) => {
      const previousRemainder = stream === 'stdout' ? stdoutLogRemainder : stderrLogRemainder;
      const combined = previousRemainder + text;
      const newlineIndex = combined.lastIndexOf('\n');
      if (newlineIndex < 0) {
        if (stream === 'stdout') stdoutLogRemainder = combined;
        else stderrLogRemainder = combined;
        return;
      }

      const completeText = combined.slice(0, newlineIndex + 1);
      if (stream === 'stdout') stdoutLogRemainder = combined.slice(newlineIndex + 1);
      else stderrLogRemainder = combined.slice(newlineIndex + 1);

      const safeText = sanitizeLogText(completeText);
      writeLog(logPath, safeText);
      notifyAutomationLog(onLog, {
        type: 'log',
        stream,
        text: safeText,
      });
    };

    const flushChildLogRemainders = () => {
      if (stdoutLogRemainder) {
        forwardChildLog('stdout', '\n');
      }
      if (stderrLogRemainder) {
        forwardChildLog('stderr', '\n');
      }
    };

    writeStepLog(logPath, 'stream-output', 'attached stdout and stderr log listeners');
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      forwardChildLog('stdout', text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      forwardChildLog('stderr', text);
    });
    writeStepLog(logPath, 'wait-child', 'waiting for automation child process to finish');
    child.on('error', (error) => {
      flushChildLogRemainders();
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
      flushChildLogRemainders();
      if (run?.id) {
        activeChildren.delete(run.id);
      }
      if (exitCode === 0) {
        const childResult = parseChildResult(stdout);
        if (run?.id) {
          automationRuns?.markSucceeded?.(run.id, { exitCode });
          writeStepLog(logPath, 'mark-succeeded', 'marked automation run succeeded', `exit_code=${exitCode}`);
        }
        writeStepLog(logPath, 'child-close', 'child process completed successfully', `exit_code=${exitCode}`);
        resolve({
          ok: true,
          exitCode,
          stdout,
          stderr,
          ...(childResult ? { childResult } : {}),
          ...(cpaTriggerDetails ? { cpaTriggerLogged: true } : {}),
          ...(run ? { run } : {}),
        });
        return;
      }
      const details = sanitizeLogText(
        stderr || stdout || `child process exited with code ${exitCode}`,
      );
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

function notifyAutomationLog(onLog, event) {
  if (typeof onLog !== 'function') return;
  try {
    onLog(event);
  } catch {
    // A disconnected or faulty live-log consumer must not affect the child process.
  }
}

function parseChildResult(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/^ROXY_REGISTER_RESULT_JSON=(.+)$/);
    if (!match) continue;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
  return null;
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

function isEnabledFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
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
    .replace(/(["'](?:secret|totp_secret)\s*["']?\s*:\s*["'])[A-Z2-7]{16,}(["'])/gi, '$1[redacted-secret]$2')
    .replace(/\b(secret(?:\s+已获取)?\s*[:=]\s*)[A-Z2-7]{16,}\b/gi, '$1[redacted-secret]')
    .replace(/\b(code=)\d{6}\b/gi, '$1[redacted-code]')
    .replace(/(验证码[:：]?\s*)\d{6}/g, '$1[redacted-code]')
    .replace(/(verification code[:：]?\s*)\d{6}/gi, '$1[redacted-code]')
    .replace(/(提交验证码[:：]?\s*)\d{6}/g, '$1[redacted-code]');
}
