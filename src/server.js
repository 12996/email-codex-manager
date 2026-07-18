import cookieParser from 'cookie-parser';
import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { createAccountRepository } from './accounts.js';
import { createAdminNotificationRepository } from './adminNotifications.js';
import { createAuthMiddleware, clearAuthCookie, setAuthCookie } from './auth.js';
import { createCpaClient } from './cpaClient.js';
import { createCpaCredentialMonitor } from './cpaCredentialMonitor.js';
import { startCpaCredentialMonitor } from './cpaCredentialMonitorRunner.js';
import { createCpaRepairQueue } from './cpaRepairQueue.js';
import { createCpaRepairWorker } from './cpaRepairWorker.js';
import { createDatabase } from './db.js';
import { runBannedEmailHealthcheck } from './accountHealthcheckService.js';
import { runPlusStatusCheck } from './replacementPlusStatusService.js';
import { createReplacementAutomationRunRepository } from './replacementAutomationRuns.js';
import {
  deriveMainGmailAccount,
  fetchMessages,
  findLatestVerificationCode,
  testConnection,
} from './imapService.js';
import { createReplacementAccountRepository } from './replacementAccounts.js';
import { fetchReplacementEmailMessages } from './replacementEmailApiService.js';
import {
  activationMethodError,
  createReplacementActivationMethodRepository,
} from './replacementActivationMethods.js';
import { createReplacementServices } from './replacementServices.js';
import { getTotpCodeInfo } from './totpService.js';
import { accountsPage, editAccountPage, loginPage } from './views.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = join(__dirname, '..', 'web');

export function createApp({
  db = createDatabase(config.databasePath),
  accounts = createAccountRepository(db),
  adminNotifications = createAdminNotificationRepository(db),
  replacementAccounts = createReplacementAccountRepository(db),
  replacementActivationMethods = createReplacementActivationMethodRepository(db),
  replacementAutomationRuns = createReplacementAutomationRunRepository(db, {
    maxRuns: config.replacementAutomationLogMaxRuns,
  }),
  replacementServices = createReplacementServices({ automationRuns: replacementAutomationRuns }),
  mailService = { fetchMessages, testConnection },
  replacementEmailApiService = { fetchMessages: fetchReplacementEmailMessages },
  cpaCredentialMonitor = null,
  cpaRepairWorker = null,
  icloudCodeDefaultGmailAccount = config.icloudCodeDefaultGmailAccount,
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

  app.post('/api/icloud-verification-code/latest', requireAuthUnlessLocal, async (req, res) => {
    const account = normalizeEmail(req.body?.account || req.body?.icloudAccount || '');
    const gmailAccount = normalizeEmail(
      req.body?.gmailAccount
      || req.body?.mailbox
      || req.body?.gmail
      || icloudCodeDefaultGmailAccount
    );
    if (!gmailAccount) {
      res.status(400).json({
        ok: false,
        error: 'GMAIL_ACCOUNT_REQUIRED',
        message: 'gmailAccount is required',
      });
      return;
    }

    await sendLatestIcloudVerificationCodeResponse(res, {
      account,
      gmailAccount,
      accounts,
      mailService,
    });
  });

  app.post('/api/2fa-code', requireAuthUnlessLocal, (req, res) => {
    try {
      const info = getTotpCodeInfo(req.body?.secret, {
        timestampMs: req.body?.timestampMs,
        step: req.body?.step,
        digits: req.body?.digits,
        algorithm: req.body?.algorithm,
      });
      res.json({ ok: true, ...info });
    } catch (error) {
      sendApiError(res, error);
    }
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
    const page = accounts.listAccountsPage({
      page: req.query?.page,
      pageSize: req.query?.pageSize,
      status: req.query?.status,
      keyword: req.query?.keyword,
    });
    res.json({ ok: true, ...page });
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
    const page = replacementAccounts.listAccountsPage({
      page: req.query?.page,
      pageSize: req.query?.pageSize,
      status: req.query?.status,
      keyword: req.query?.keyword,
      circuit_breaker: req.query?.circuit_breaker,
    });
    res.json({ ok: true, ...page });
  });

  app.get('/replacement-activation-methods', requireAuth, (req, res) => {
    res.json({ ok: true, methods: replacementActivationMethods.listMethods() });
  });

  app.post('/replacement-activation-methods', requireAuth, (req, res) => {
    try {
      const method = replacementActivationMethods.createMethod(req.body);
      res.status(201).json({ ok: true, method });
    } catch (error) {
      sendApiError(res, error);
    }
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

  app.post('/replacement-accounts/healthcheck-banned', requireAuth, async (req, res) => {
    const run = (onProgress) => runBannedEmailHealthcheck({
      accounts,
      replacementAccounts,
      emailApiService: replacementEmailApiService,
      onProgress,
    });
    if (wantsProgressStream(req)) {
      await streamProgressResponse(res, run);
      return;
    }
    try {
      const result = await run();
      res.json({ ok: true, result });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.post('/replacement-accounts/check-plus-status', requireAuth, async (req, res) => {
    const run = (onProgress) => runPlusStatusCheck({
      accounts,
      replacementAccounts,
      emailApiService: replacementEmailApiService,
      onProgress,
    });
    if (wantsProgressStream(req)) {
      await streamProgressResponse(res, run);
      return;
    }
    try {
      const result = await run();
      res.json({ ok: true, result });
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

  app.patch('/replacement-accounts/:id/activation-method', requireAuth, (req, res) => {
    try {
      const activationMethod = String(req.body?.activation_method || '').trim();
      if (activationMethod && !replacementActivationMethods.hasMethod(activationMethod)) {
        throw activationMethodError('ACTIVATION_METHOD_INVALID', 'activation method is not configured');
      }
      const account = replacementAccounts.updateActivationMethod(req.params.id, {
        activation_method: activationMethod,
      });
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

  app.patch('/replacement-accounts/:id/circuit-breaker/reset', requireAuth, (req, res) => {
    try {
      const account = replacementAccounts.resetCircuitBreaker(req.params.id);
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
      replacementAccounts.recordSmsSuccess(account.id);
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

    const previousStatus = account.status;
    replacementAccounts.markReplacementStarted(account.id);
    try {
      const result = await replacementServices.replaceAccount(account);
      const updated = replacementAccounts.markReplacementSuccess(account.id);
      res.json({ ok: true, account: updated, ...(result?.run ? { run: result.run } : {}) });
    } catch (error) {
      const updated = replacementAccounts.markReplacementFailure(account.id, error.message, previousStatus, '补号');
      notifyCircuitBreaker(adminNotifications, updated);
      sendApiError(res, error, { account: updated });
    }
  });

  app.post('/replacement-accounts/:id/replace-2fa', requireAuth, async (req, res) => {
    const account = replacementAccounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
      return;
    }

    if (cpaRepairWorker?.repair) {
      try {
        const result = await cpaRepairWorker.repair({ account, source: 'manual', mode: '2fa' });
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

    const previousStatus = account.status;
    replacementAccounts.markReplacementStarted(account.id);
    try {
      const result = await replacementServices.replaceAccountWith2FA(account);
      const updated = replacementAccounts.markReplacementSuccess(account.id);
      res.json({ ok: true, account: updated, ...(result?.run ? { run: result.run } : {}) });
    } catch (error) {
      const updated = replacementAccounts.markReplacementFailure(account.id, error.message, previousStatus, '2FA补号');
      notifyCircuitBreaker(adminNotifications, updated);
      sendApiError(res, error, { account: updated });
    }
  });

  app.post('/replacement-accounts/:id/login-2fa', requireAuth, async (req, res) => {
    const account = replacementAccounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
      return;
    }

    try {
      const result = await replacementServices.loginAccountWith2FA(account);
      replacementAccounts.recordOperationSuccess?.(account.id);
      const updated = replacementAccounts.getAccount(account.id) || account;
      res.json({ ok: true, account: updated, ...(result?.run ? { run: result.run } : {}) });
    } catch (error) {
      const updated = replacementAccounts.recordOperationFailure(account.id, '2FA登录', error.message);
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
      const mfaSecret = extractRegistrationMfaSecret(result);
      const updated = replacementAccounts.markRegistrationSuccess(account.id, { codex_2fa: mfaSecret });
      res.json({ ok: true, account: updated, ...(result?.run ? { run: result.run } : {}) });
    } catch (error) {
      const updated = replacementAccounts.recordOperationFailure(account.id, '注册', error.message);
      sendApiError(res, error, { account: updated });
    }
  });

  app.post('/replacement-accounts/:id/register-protocol', requireAuth, async (req, res) => {
    const account = replacementAccounts.getAccount(req.params.id);
    if (!account) {
      res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
      return;
    }

    const execute = async (onProgress) => {
      const liveLog = typeof onProgress === 'function'
        ? (event) => onProgress(toProtocolLogEvent(account, event))
        : undefined;

      try {
        const result = await replacementServices.registerProtocolAccount(account, {
          onLog: liveLog,
        });
        const mfaSecret = extractRegistrationMfaSecret(result);
        const updated = replacementAccounts.markRegistrationSuccess(account.id, { codex_2fa: mfaSecret });
        onProgress?.({
          type: 'account-result',
          operation: 'protocol-registration',
          accountId: account.id,
          email: account.email,
          outcome: 'success',
          message: '协议注册完成，账号状态已更新为 registered',
        });
        return { ok: true, account: updated, ...(result?.run ? { run: result.run } : {}) };
      } catch (error) {
        const updated = replacementAccounts.recordOperationFailure(account.id, '协议注册', error.message);
        error.account = updated;
        onProgress?.({
          type: 'account-result',
          operation: 'protocol-registration',
          accountId: account.id,
          email: account.email,
          outcome: 'failed',
          message: error.message || '协议注册失败',
        });
        throw error;
      }
    };

    if (wantsProgressStream(req)) {
      await streamProgressResponse(res, async (send) => {
        send({
          type: 'start',
          operation: 'protocol-registration',
          accountId: account.id,
          email: account.email,
          message: `开始协议注册：${account.email}`,
        });
        return execute(send);
      });
      return;
    }

    try {
      res.json(await execute());
    } catch (error) {
      const updated = error.account || replacementAccounts.getAccount(account.id) || account;
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

  app.get('/admin-notifications', requireAuth, (req, res) => {
    res.json({
      ok: true,
      unreadCount: adminNotifications.countUnread(),
      notifications: adminNotifications.listNotifications({ limit: req.query?.limit }),
    });
  });

  app.patch('/admin-notifications/:id/read', requireAuth, (req, res) => {
    try {
      const notification = adminNotifications.markRead(req.params.id);
      res.json({ ok: true, notification, unreadCount: adminNotifications.countUnread() });
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

function wantsProgressStream(req) {
  return String(req.headers.accept || '').includes('text/event-stream');
}

function toProtocolLogEvent(account, event = {}) {
  const { type: eventType, ...details } = event;
  return {
    ...details,
    type: eventType === 'log' ? 'protocol-log' : 'protocol-step',
    operation: 'protocol-registration',
    accountId: account.id,
    email: account.email,
  };
}

async function streamProgressResponse(res, run) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const send = (event) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const result = await run(send);
    send({ type: 'complete', result, message: '执行完成' });
  } catch (error) {
    send({ type: 'error', message: error.message || '执行失败' });
  } finally {
    res.end();
  }
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

async function sendLatestIcloudVerificationCodeResponse(res, { account, gmailAccount, accounts, mailService }) {
  const mainAccountEmail = deriveMainGmailAccount(gmailAccount);
  const mainAccount = accounts.getAccountByGmailEmail(mainAccountEmail);
  if (!mainAccount) {
    res.status(404).json({
      ok: false,
      account: account || null,
      gmailAccount,
      mainAccount: mainAccountEmail,
      error: 'GMAIL_ACCOUNT_NOT_FOUND',
      message: '数据库中没有配置用于接收 iCloud 验证码的 Gmail 账号',
    });
    return;
  }

  try {
    const messages = await mailService.fetchMessages(mainAccount, {
      readLocation: 'inbox',
      limit: 30,
      targetEmail: account || gmailAccount,
    });
    const result = findLatestVerificationCodeForTarget(messages, account);
    if (!result) {
      res.status(404).json({
        ok: false,
        account: account || null,
        gmailAccount,
        mainAccount: mainAccountEmail,
        code: null,
        error: 'CODE_NOT_FOUND',
        message: '未找到最近的 6 位 iCloud 验证码邮件',
      });
      return;
    }

    res.json({
      ok: true,
      account: account || null,
      gmailAccount,
      mainAccount: mainAccountEmail,
      code: result.code,
      targetMatched: result.targetMatched,
      from: result.message.from || '',
      subject: result.message.subject || '',
      date: result.message.date || '',
    });
  } catch (error) {
    const status = error.code === 'AUTH_FAILED' ? 401 : 502;
    res.status(status).json({
      ok: false,
      account: account || null,
      gmailAccount,
      mainAccount: mainAccountEmail,
      error: error.code || 'IMAP_ERROR',
      message: error.message || 'IMAP 请求失败',
    });
  }
}

function findLatestVerificationCodeForTarget(messages, targetEmail) {
  const target = normalizeEmail(targetEmail);
  if (target) {
    const targeted = messages.filter((message) => messageMatchesRecipient(message, target));
    const targetedResult = findLatestVerificationCode(targeted);
    if (targetedResult) {
      return { ...targetedResult, targetMatched: true };
    }
  }

  const fallbackResult = findLatestVerificationCode(messages);
  return fallbackResult ? { ...fallbackResult, targetMatched: false } : null;
}

function messageMatchesRecipient(message, targetEmail) {
  const recipients = [
    ...(message?.toAddresses || []),
    ...(message?.ccAddresses || []),
    ...(message?.deliveredToAddresses || []),
    message?.to,
    message?.cc,
    message?.from,
  ];
  return recipients.some((value) => String(value || '').toLowerCase().includes(targetEmail));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
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

function notifyCircuitBreaker(adminNotifications, account) {
  if (!adminNotifications?.createNotification) return;
  if (!account?.circuit_breaker_at || Number(account?.consecutive_replace_failures || 0) !== 5) return;
  const email = String(account.email || '').trim().toLowerCase();
  adminNotifications.createNotification({
    type: 'cpa_repair_circuit_breaker',
    severity: 'critical',
    title: '账号已触发补号熔断',
    message: `${email} 连续自动补号失败 5 次，账号已自动熔断，不再进入 CPA 自动补号队列。`,
    account_id: account.id,
    email,
  });
}

function errorBody(error, message) {
  return { ok: false, error, message };
}

function extractRegistrationMfaSecret(result) {
  const secret = String(
    result?.childResult?.registrationMfa?.secret
    || result?.registrationMfa?.secret
    || ''
  ).trim();
  return /^[A-Z2-7]{16,}$/.test(secret) ? secret : '';
}

function inferErrorCode(error) {
  if (String(error.message || '').includes('EMAIL_DUPLICATE')) return 'EMAIL_DUPLICATE';
  if (String(error.message || '').includes('EMAIL_REQUIRED')) return 'EMAIL_REQUIRED';
  if (String(error.message || '').includes('ACTIVATION_METHOD_REQUIRED')) return 'ACTIVATION_METHOD_REQUIRED';
  if (String(error.message || '').includes('ACTIVATION_METHOD_DUPLICATE')) return 'ACTIVATION_METHOD_DUPLICATE';
  if (String(error.message || '').includes('ACTIVATION_METHOD_INVALID')) return 'ACTIVATION_METHOD_INVALID';
  if (String(error.message || '').includes('ACCOUNT_NOT_FOUND')) return 'ACCOUNT_NOT_FOUND';
  if (String(error.message || '').includes('STATUS_INVALID')) return 'STATUS_INVALID';
  return 'VALIDATION_ERROR';
}

function statusForApiError(code) {
  if (code === 'EMAIL_DUPLICATE') return 409;
  if (code === 'ACTIVATION_METHOD_DUPLICATE') return 409;
  if (code === 'PROTOCOL_REGISTER_BUSY') return 409;
  if (code === 'ACCOUNT_NOT_FOUND') return 404;
  if (code === 'NOTIFICATION_NOT_FOUND') return 404;
  if (
    code === 'SMS_FETCH_FAILED'
    || code === 'JSON_FETCH_FAILED'
    || code === 'REPLACE_FAILED'
    || code === 'REPLACE_NOT_CONFIGURED'
    || code === 'REGISTER_FAILED'
    || code === 'PROTOCOL_REGISTER_FAILED'
    || code === 'PROTOCOL_REGISTER_NOT_CONFIGURED'
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
  const adminNotifications = createAdminNotificationRepository(db);
  const replacementAccounts = createReplacementAccountRepository(db);
  const replacementAutomationRuns = createReplacementAutomationRunRepository(db, {
    maxRuns: config.replacementAutomationLogMaxRuns,
  });
  const replacementServices = createReplacementServices({ automationRuns: replacementAutomationRuns });
  const cpaClient = createCpaClient(config.cpa);
  const cpaRepairWorker = createCpaRepairWorker({
    cpaClient,
    replacementAccounts,
    replacementServices,
    adminNotifications,
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
    adminNotifications,
    replacementAccounts,
    replacementAutomationRuns,
    replacementServices,
    cpaCredentialMonitor,
    cpaRepairWorker,
  }).listen(port, () => {
    console.log(`Listening on http://localhost:${port}`);
  });
}
