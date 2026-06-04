import cookieParser from 'cookie-parser';
import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { createAccountRepository } from './accounts.js';
import { createAuthMiddleware, clearAuthCookie, setAuthCookie } from './auth.js';
import { createCpaClient } from './cpaClient.js';
import { createCpaCredentialMonitor } from './cpaCredentialMonitor.js';
import { startCpaCredentialMonitor } from './cpaCredentialMonitorRunner.js';
import { createCpaRepairQueue } from './cpaRepairQueue.js';
import { createCpaRepairWorker } from './cpaRepairWorker.js';
import { createDatabase } from './db.js';
import { createReplacementAutomationRunRepository } from './replacementAutomationRuns.js';
import {
  deriveMainGmailAccount,
  fetchMessages,
  findLatestVerificationCode,
  testConnection,
} from './imapService.js';
import { createReplacementAccountRepository } from './replacementAccounts.js';
import { createReplacementServices } from './replacementServices.js';
import { accountsPage, editAccountPage, loginPage } from './views.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = join(__dirname, '..', 'web');

export function createApp({
  db = createDatabase(config.databasePath),
  accounts = createAccountRepository(db),
  replacementAccounts = createReplacementAccountRepository(db),
  replacementAutomationRuns = createReplacementAutomationRunRepository(db),
  replacementServices = createReplacementServices({ automationRuns: replacementAutomationRuns }),
  mailService = { fetchMessages, testConnection },
  cpaCredentialMonitor = null,
  cpaRepairWorker = null,
} = {}) {
  const app = express();
  const requireAuth = createAuthMiddleware();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(cookieParser(config.sessionSecret));
  app.use(express.static(join(__dirname, '..', 'public')));
  app.use('/web', requireAuth, express.static(webDir));

  app.get('/login', (req, res) => {
    res.send(loginPage());
  });

  app.post('/login', (req, res) => {
    if (req.body.password !== config.adminPassword) {
      res.status(401).send(loginPage('后台密码不正确'));
      return;
    }
    setAuthCookie(res);
    res.redirect('/accounts');
  });

  app.post('/logout', (req, res) => {
    clearAuthCookie(res);
    res.redirect('/login');
  });

  const requireAuthUnlessLocal = (req, res, next) => {
    if (isLocalRequest(req)) {
      next();
      return;
    }
    requireAuth(req, res, next);
  };

  app.post('/api/verification-code/latest', requireAuthUnlessLocal, async (req, res) => {
    const account = String(req.body?.account || '').trim().toLowerCase();
    if (!account) {
      res.status(400).json({
        ok: false,
        error: 'ACCOUNT_REQUIRED',
        message: 'account is required',
      });
      return;
    }

    await sendLatestVerificationCodeResponse(res, { account, accounts, mailService });
  });

  app.get('/api/verification-code/public/latest', async (req, res) => {
    const key = String(req.query?.key || '').trim();
    if (!key) {
      res.status(400).json({
        ok: false,
        error: 'KEY_REQUIRED',
        message: 'key is required',
      });
      return;
    }

    const publicAccount = replacementAccounts.getPublicCodeAccountByKey(key);
    if (!publicAccount) {
      res.status(403).json({
        ok: false,
        error: 'PUBLIC_ACCESS_DENIED',
        message: '验证码访问 key 无效或未启用',
      });
      return;
    }

    const account = String(publicAccount.email || '').trim().toLowerCase();
    await sendLatestVerificationCodeResponse(res, { account, accounts, mailService });
  });

  app.get('/replacement-ui', requireAuth, (req, res) => {
    const html = readFileSync(join(webDir, 'index.html'), 'utf8');
    const sidebar = readFileSync(join(webDir, 'sidebar.html'), 'utf8')
      .replace('id="nav-replacement"', 'id="nav-replacement" class="active"');
    res.send(html.replace('<!-- SIDEBAR_PLACEHOLDER -->', sidebar));
  });

  app.get('/replacement-automation-logs', requireAuth, (req, res) => {
    const html = readFileSync(join(webDir, 'automation-logs.html'), 'utf8');
    const sidebar = readFileSync(join(webDir, 'sidebar.html'), 'utf8')
      .replace('id="nav-automation-logs"', 'id="nav-automation-logs" class="active"');
    res.send(html.replace('<!-- SIDEBAR_PLACEHOLDER -->', sidebar));
  });

  app.get('/api/accounts', requireAuth, (req, res) => {
    res.json({ ok: true, accounts: accounts.listAccounts() });
  });

  app.get('/api/accounts/:id', requireAuth, (req, res) => {
    const account = accounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'account not found'));
      return;
    }
    res.json({ ok: true, account });
  });

  app.post('/api/accounts', requireAuth, (req, res) => {
    try {
      const account = accounts.createAccount(req.body);
      res.status(201).json({ ok: true, account });
    } catch (error) {
      sendAccountApiError(res, error);
    }
  });

  app.put('/api/accounts/:id', requireAuth, (req, res) => {
    try {
      const account = accounts.updateAccount(req.params.id, req.body);
      if (!account) {
        res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'account not found'));
        return;
      }
      res.json({ ok: true, account });
    } catch (error) {
      sendAccountApiError(res, error);
    }
  });

  app.delete('/api/accounts/:id', requireAuth, (req, res) => {
    accounts.deleteAccount(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/accounts/:id/test', requireAuth, async (req, res) => {
    const account = accounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'account not found'));
      return;
    }

    try {
      await mailService.testConnection(account);
      accounts.markFetchSuccess(account.id);
      res.json({ ok: true, account: accounts.getAccount(account.id) });
    } catch (error) {
      markAccountError(accounts, account.id, error);
      sendAccountApiError(res, error);
    }
  });

  app.post('/api/accounts/:id/fetch', requireAuth, async (req, res) => {
    const account = accounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'account not found'));
      return;
    }

    try {
      const messages = await mailService.fetchMessages(account, {
        readLocation: req.body.readLocation,
        limit: req.body.limit,
      });
      accounts.markFetchSuccess(account.id);
      res.json({
        ok: true,
        account: accounts.getAccount(account.id),
        result: { title: `${account.gmail_email} 获取结果`, messages },
        messages,
      });
    } catch (error) {
      markAccountError(accounts, account.id, error);
      sendAccountApiError(res, error);
    }
  });

  app.get('/replacement-accounts', requireAuth, (req, res) => {
    res.json({ ok: true, accounts: replacementAccounts.listAccounts() });
  });

  app.get('/replacement-accounts/:id', requireAuth, (req, res) => {
    const account = replacementAccounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
      return;
    }
    res.json({ ok: true, account });
  });

  app.post('/replacement-accounts', requireAuth, (req, res) => {
    try {
      const account = replacementAccounts.createAccount(req.body);
      res.status(201).json({ ok: true, account });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.put('/replacement-accounts/:id', requireAuth, (req, res) => {
    try {
      const account = replacementAccounts.updateAccount(req.params.id, req.body);
      res.json({ ok: true, account });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.delete('/replacement-accounts/:id', requireAuth, (req, res) => {
    try {
      replacementAccounts.deleteAccount(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.patch('/replacement-accounts/:id/status', requireAuth, (req, res) => {
    try {
      const account = replacementAccounts.updateStatus(req.params.id, req.body);
      res.json({ ok: true, account });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.patch('/replacement-accounts/:id/public-code', requireAuth, (req, res) => {
    try {
      const account = replacementAccounts.updatePublicCodeAccess(req.params.id, req.body);
      res.json({ ok: true, account });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.post('/replacement-accounts/:id/fetch-sms-code', requireAuth, async (req, res) => {
    const account = replacementAccounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
      return;
    }

    try {
      const code = await replacementServices.fetchSmsCode(account.sms_api);
      res.json({ ok: true, code });
    } catch (error) {
      replacementAccounts.recordSmsFailure(account.id, error.message);
      sendApiError(res, error);
    }
  });

  app.post('/replacement-accounts/:id/fetch-json', requireAuth, async (req, res) => {
    const account = replacementAccounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
      return;
    }

    try {
      const payload = await replacementServices.fetchJson(req.body?.url);
      const updated = replacementAccounts.recordJsonFetchSuccess(account.id, payload);
      res.json({ ok: true, account: updated });
    } catch (error) {
      replacementAccounts.recordJsonFetchFailure(account.id, error.message);
      sendApiError(res, error);
    }
  });

  app.post('/replacement-accounts/:id/replace', requireAuth, async (req, res) => {
    const account = replacementAccounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
      return;
    }

    if (cpaRepairWorker?.repair) {
      try {
        const result = await cpaRepairWorker.repair({ account, source: 'manual' });
        if (result?.ok === false) {
          const updated = result.account || replacementAccounts.getAccount(account.id);
          sendApiError(res, Object.assign(new Error(result.error || 'CPA repair failed'), { code: 'REPLACE_FAILED' }), { account: updated });
          return;
        }
        res.json({ ok: true, account: result.account || replacementAccounts.getAccount(account.id), ...(result?.run ? { run: result.run } : {}) });
      } catch (error) {
        const updated = replacementAccounts.getAccount(account.id);
        sendApiError(res, error, { account: updated });
      }
      return;
    }

    replacementAccounts.markReplacementStarted(account.id);
    try {
      const result = await replacementServices.replaceAccount(account);
      const updated = replacementAccounts.markReplacementSuccess(account.id);
      res.json({ ok: true, account: updated, ...(result?.run ? { run: result.run } : {}) });
    } catch (error) {
      const updated = replacementAccounts.markReplacementFailure(account.id, error.message);
      sendApiError(res, error, { account: updated });
    }
  });

  app.post('/replacement-accounts/:id/register', requireAuth, async (req, res) => {
    const account = replacementAccounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
      return;
    }

    try {
      const result = await replacementServices.registerAccount(account);
      const updated = replacementAccounts.getAccount(account.id) || account;
      res.json({ ok: true, account: updated, ...(result?.run ? { run: result.run } : {}) });
    } catch (error) {
      const updated = replacementAccounts.getAccount(account.id) || account;
      sendApiError(res, error, { account: updated });
    }
  });

  app.get('/cpa/auth-health', requireAuth, async (req, res) => {
    if (!cpaCredentialMonitor?.runOnce) {
      res.status(503).json(errorBody('CPA_MONITOR_NOT_CONFIGURED', 'CPA credential monitor is not configured'));
      return;
    }
    try {
      const result = await cpaCredentialMonitor.runOnce();
      res.json({ ok: true, result });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get('/replacement-automation-runs', requireAuth, (req, res) => {
    res.json({ ok: true, runs: replacementAutomationRuns.listRuns({ limit: req.query?.limit }) });
  });

  app.get('/replacement-automation-runs/:id', requireAuth, (req, res) => {
    const run = replacementAutomationRuns.getRun(req.params.id);
    if (!run) {
      res.status(404).json(errorBody('RUN_NOT_FOUND', 'automation run not found'));
      return;
    }

    let log = '';
    try {
      log = readFileSync(run.log_path, 'utf8');
    } catch (error) {
      log = `日志文件读取失败：${error.message}`;
    }
    res.json({ ok: true, run, log });
  });

  app.post('/replacement-automation-runs/:id/stop', requireAuth, (req, res) => {
    const run = replacementAutomationRuns.getRun(req.params.id);
    if (!run) {
      res.status(404).json(errorBody('RUN_NOT_FOUND', 'automation run not found'));
      return;
    }
    if (run.status !== 'running') {
      res.status(400).json(errorBody('RUN_NOT_RUNNING', 'automation run is not running'));
      return;
    }

    try {
      const result = replacementServices.stopReplacementRun(req.params.id);
      res.json({ ok: true, ...result });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get('/', requireAuth, (req, res) => {
    res.redirect('/accounts');
  });

  app.get('/accounts', requireAuth, (req, res) => {
    const html = readFileSync(join(webDir, 'accounts.html'), 'utf8');
    const sidebar = readFileSync(join(webDir, 'sidebar.html'), 'utf8')
      .replace('id="nav-accounts"', 'id="nav-accounts" class="active"');
    res.send(html.replace('<!-- SIDEBAR_PLACEHOLDER -->', sidebar));
  });

  app.post('/accounts', requireAuth, (req, res) => {
    try {
      accounts.createAccount(req.body);
      res.redirect('/accounts');
    } catch (error) {
      res.status(400).send(accountsPage({
        accounts: accounts.listAccounts(),
        error: error.message,
      }));
    }
  });

  app.get('/accounts/:id/edit', requireAuth, (req, res) => {
    const account = accounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).send('Account not found');
      return;
    }
    res.send(editAccountPage(account));
  });

  app.post('/accounts/:id', requireAuth, (req, res) => {
    try {
      accounts.updateAccount(req.params.id, req.body);
      res.redirect('/accounts');
    } catch (error) {
      res.status(400).send(accountsPage({
        accounts: accounts.listAccounts(),
        error: error.message,
      }));
    }
  });

  app.post('/accounts/:id/delete', requireAuth, (req, res) => {
    accounts.deleteAccount(req.params.id);
    res.redirect('/accounts');
  });

  app.post('/accounts/:id/test', requireAuth, async (req, res) => {
    const account = accounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).send('Account not found');
      return;
    }

    try {
      await mailService.testConnection(account);
      accounts.markFetchSuccess(account.id);
      res.send(accountsPage({
        accounts: accounts.listAccounts(),
        result: { title: `${account.gmail_email} 连接成功`, messages: [] },
      }));
    } catch (error) {
      markAccountError(accounts, account.id, error);
      res.status(400).send(accountsPage({
        accounts: accounts.listAccounts(),
        error: error.message,
      }));
    }
  });

  app.post('/accounts/:id/fetch', requireAuth, async (req, res) => {
    const account = accounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).send('Account not found');
      return;
    }

    try {
      const messages = await mailService.fetchMessages(account, {
        readLocation: req.body.readLocation,
        limit: req.body.limit,
      });
      accounts.markFetchSuccess(account.id);
      res.send(accountsPage({
        accounts: accounts.listAccounts(),
        result: { title: `${account.gmail_email} 获取结果`, messages },
      }));
    } catch (error) {
      markAccountError(accounts, account.id, error);
      res.status(400).send(accountsPage({
        accounts: accounts.listAccounts(),
        error: error.message,
      }));
    }
  });

  return app;
}

function markAccountError(accounts, accountId, error) {
  const status = error.code === 'AUTH_FAILED' ? 'auth_failed' : 'error';
  accounts.markFetchFailure(accountId, status, error.message);
}

async function sendLatestVerificationCodeResponse(res, { account, accounts, mailService }) {
  const mainAccountEmail = deriveMainGmailAccount(account);
  const mainAccount = accounts.getAccountByGmailEmail(mainAccountEmail);
  if (!mainAccount) {
    res.status(404).json({
      ok: false,
      account,
      mainAccount: mainAccountEmail,
      error: 'ACCOUNT_NOT_FOUND',
      message: '数据库中没有配置主 Gmail 账号',
    });
    return;
  }

  try {
    const messages = await mailService.fetchMessages(mainAccount, {
      readLocation: 'inbox',
      limit: 30,
      targetEmail: account,
    });
    const result = findLatestVerificationCode(messages);
    if (!result) {
      res.status(404).json({
        ok: false,
        account,
        mainAccount: mainAccountEmail,
        code: null,
        error: 'CODE_NOT_FOUND',
        message: '未找到最近的 6 位验证码邮件',
      });
      return;
    }

    res.json({
      ok: true,
      account,
      mainAccount: mainAccountEmail,
      code: result.code,
      from: result.message.from || '',
      subject: result.message.subject || '',
      date: result.message.date || '',
    });
  } catch (error) {
    const status = error.code === 'AUTH_FAILED' ? 401 : 502;
    res.status(status).json({
      ok: false,
      account,
      mainAccount: mainAccountEmail,
      error: error.code || 'IMAP_ERROR',
      message: error.message || 'IMAP 请求失败',
    });
  }
}

function isLocalRequest(req) {
  const remoteAddress = String(req.ip || req.socket?.remoteAddress || '').toLowerCase();
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress);
}

function sendAccountApiError(res, error) {
  const status = error.code === 'AUTH_FAILED' ? 401 : 400;
  res.status(status).json({
    ok: false,
    error: error.code || 'ACCOUNT_ERROR',
    message: error.message || 'account request failed',
  });
}

function sendApiError(res, error, extra = {}) {
  const code = error.code || inferErrorCode(error);
  const status = statusForApiError(code);
  res.status(status).json({
    ...errorBody(code, stripErrorCodePrefix(error.message || 'Request failed')),
    ...extra,
  });
}

function errorBody(error, message) {
  return { ok: false, error, message };
}

function inferErrorCode(error) {
  if (String(error.message || '').includes('EMAIL_DUPLICATE')) return 'EMAIL_DUPLICATE';
  if (String(error.message || '').includes('EMAIL_REQUIRED')) return 'EMAIL_REQUIRED';
  if (String(error.message || '').includes('ACCOUNT_NOT_FOUND')) return 'ACCOUNT_NOT_FOUND';
  if (String(error.message || '').includes('STATUS_INVALID')) return 'STATUS_INVALID';
  return 'VALIDATION_ERROR';
}

function statusForApiError(code) {
  if (code === 'EMAIL_DUPLICATE') return 409;
  if (code === 'ACCOUNT_NOT_FOUND') return 404;
  if (
    code === 'SMS_FETCH_FAILED'
    || code === 'JSON_FETCH_FAILED'
    || code === 'REPLACE_FAILED'
    || code === 'REPLACE_NOT_CONFIGURED'
    || code === 'REGISTER_FAILED'
    || code === 'RUN_NOT_ACTIVE'
    || code === 'RUN_STOP_FAILED'
  ) {
    return 502;
  }
  return 400;
}

function stripErrorCodePrefix(message) {
  return String(message).replace(/^[A-Z_]+:\s*/, '');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const db = createDatabase(config.databasePath);
  const replacementAccounts = createReplacementAccountRepository(db);
  const replacementAutomationRuns = createReplacementAutomationRunRepository(db);
  const replacementServices = createReplacementServices({ automationRuns: replacementAutomationRuns });
  const cpaClient = createCpaClient(config.cpa);
  const cpaRepairWorker = createCpaRepairWorker({
    cpaClient,
    replacementAccounts,
    replacementServices,
    cpaOutputDir: join(__dirname, 'auto', 'product_files', 'cpa'),
  });
  const cpaRepairQueue = createCpaRepairQueue({ worker: (job) => cpaRepairWorker.repair(job) });
  const cpaCredentialMonitor = createCpaCredentialMonitor({
    cpaClient,
    replacementAccounts,
    repairQueue: cpaRepairQueue,
  });
  startCpaCredentialMonitor({
    enabled: config.cpa.monitorEnabled,
    intervalMs: config.cpa.monitorIntervalMs,
    monitor: cpaCredentialMonitor,
  });
  createApp({
    db,
    replacementAccounts,
    replacementAutomationRuns,
    replacementServices,
    cpaCredentialMonitor,
    cpaRepairWorker,
  }).listen(port, () => {
    console.log(`Listening on http://localhost:${port}`);
  });
}
