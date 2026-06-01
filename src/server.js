import cookieParser from 'cookie-parser';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { createAccountRepository } from './accounts.js';
import { createAuthMiddleware, clearAuthCookie, setAuthCookie } from './auth.js';
import { createDatabase } from './db.js';
import {
  deriveMainGmailAccount,
  fetchMessages,
  findLatestVerificationCode,
  testConnection,
} from './imapService.js';
import { accountsPage, editAccountPage, loginPage } from './views.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp({
  accounts = createAccountRepository(createDatabase(config.databasePath)),
  mailService = { fetchMessages, testConnection },
} = {}) {
  const app = express();
  const requireAuth = createAuthMiddleware();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(cookieParser(config.sessionSecret));
  app.use(express.static(join(__dirname, '..', 'public')));

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

  app.post('/api/verification-code/latest', requireAuth, async (req, res) => {
    const account = String(req.body?.account || '').trim().toLowerCase();
    if (!account) {
      res.status(400).json({
        ok: false,
        error: 'ACCOUNT_REQUIRED',
        message: 'account is required',
      });
      return;
    }

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
  });

  app.get('/', requireAuth, (req, res) => {
    res.redirect('/accounts');
  });

  app.get('/accounts', requireAuth, (req, res) => {
    res.send(accountsPage({ accounts: accounts.listAccounts() }));
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => {
    console.log(`Listening on http://localhost:${port}`);
  });
}
