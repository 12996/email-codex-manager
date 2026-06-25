import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import signature from 'cookie-signature';

import { config } from '../src/config.js';
import { createDatabase } from '../src/db.js';
import { createApp } from '../src/server.js';

async function startTestServer(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function authCookie() {
  return `admin_auth=${encodeURIComponent(`s:${signature.sign('1', config.sessionSecret)}`)}`;
}

function createTestApp() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-service-'));
  return createApp({
    db: createDatabase(join(dir, 'test.db')),
    accounts: {
      listAccounts() {
        return [];
      },
      getAccountByGmailEmail() {
        return null;
      },
    },
  });
}

test('GET /replacement-ui requires login and serves the replacement account frontend', async () => {
  const app = createTestApp();
  const server = await startTestServer(app);

  try {
    const unauthenticated = await fetch(`${server.baseUrl}/replacement-ui`, {
      redirect: 'manual',
    });
    assert.equal(unauthenticated.status, 302);
    assert.equal(unauthenticated.headers.get('location'), '/login');

    const authenticated = await fetch(`${server.baseUrl}/replacement-ui`, {
      headers: { cookie: authCookie() },
    });
    const html = await authenticated.text();

    assert.equal(authenticated.status, 200);
    assert.match(html, /补号列表/);
    assert.match(html, /一键补号/);
    assert.match(html, /新增账号/);
    assert.match(html, /web\/styles.css/);
    assert.match(html, /web\/app.js/);
  } finally {
    await server.close();
  }
});

test('GET /replacement-automation-logs requires login and serves the automation log frontend', async () => {
  const app = createTestApp();
  const server = await startTestServer(app);

  try {
    const unauthenticated = await fetch(`${server.baseUrl}/replacement-automation-logs`, {
      redirect: 'manual',
    });
    assert.equal(unauthenticated.status, 302);
    assert.equal(unauthenticated.headers.get('location'), '/login');

    const authenticated = await fetch(`${server.baseUrl}/replacement-automation-logs`, {
      headers: { cookie: authCookie() },
    });
    const html = await authenticated.text();

    assert.equal(authenticated.status, 200);
    assert.match(html, /补号子进程日志/);
    assert.match(html, /停止子进程/);
    assert.match(html, /web\/automation-logs\.js/);
    assert.match(html, /id="nav-automation-logs" class="active"/);
  } finally {
    await server.close();
  }
});

test('web frontend calls replacement account APIs and labels screenshot actions correctly', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');

  for (const endpoint of [
    '/replacement-accounts',
    '/fetch-sms-code',
    '/fetch-json',
    '/replace',
    '/status',
  ]) {
    assert.match(appJs, new RegExp(endpoint.replaceAll('/', '\\/')));
  }

  assert.match(html, /一键补号/);
  assert.match(html, /新增账号/);
  assert.match(appJs, /获取验证码/);
  assert.match(appJs, /获取 JSON/);
  assert.match(appJs, /执行补号/);
  assert.match(appJs, /状态设置/);
  assert.match(appJs, /删除账号/);
});

test('web frontend exposes public verification code key controls and copy action', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');

  assert.match(html, /name="public_code_enabled"/);
  assert.match(html, /name="public_code_key"/);
  assert.match(html, /公开验证码/);
  assert.match(appJs, /public_code_enabled/);
  assert.match(appJs, /public_code_key/);
  assert.match(appJs, /data-action="edit"/);
  assert.match(appJs, /复制公开验证码 URL/);
  assert.match(appJs, /启用公开验证码/);
  assert.match(appJs, /停用公开验证码/);
  assert.match(appJs, /\/replacement-accounts\/\$\{account\.id\}\/public-code/);
  assert.match(appJs, /\/api\/verification-code\/public\/latest\?key=/);
});

test('web frontend exposes circuit breaker reset action', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');

  assert.match(appJs, /解除熔断/);
  assert.match(appJs, /data-action="reset-circuit-breaker"/);
  assert.match(appJs, /account\.status === 'banned'/);
  assert.match(appJs, /\/replacement-accounts\/\$\{account\.id\}\/circuit-breaker\/reset/);
});

test('replacement account table fully displays required runtime fields', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'web', 'styles.css'), 'utf8');

  for (const label of [
    '邮箱',
    '手机号',
    'SMS API',
    '备注',
    '开通方式',
    '开通时间',
    '状态',
    '状态更新时间',
    '公开验证码 Key',
    '补号次数',
  ]) {
    assert.match(html, new RegExp(label));
  }

  for (const field of [
    'account.email',
    'account.phone',
    'account.sms_api',
    'account.remark',
    'account.activation_method',
    'account.activated_at',
    'account.status_updated_at',
    'account.public_code_key',
    'account.replacement_count',
  ]) {
    assert.match(appJs, new RegExp(field.replaceAll('.', '\\.')));
  }

  assert.doesNotMatch(appJs, /maskPhone\(account\.phone\)/);
  assert.doesNotMatch(html, /SMS 错误/);
  assert.doesNotMatch(css, /\.table-wrap\s*{[^}]*max-height/s);
  assert.match(css, /\.table-wrap\s*{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /table\s*{[^}]*min-width:\s*2[0-9]{3}px/s);
});

test('replacement account table truncates long cells and exposes field copy action', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'web', 'styles.css'), 'utf8');

  assert.match(appJs, /tableFieldLimits/);
  assert.match(appJs, /renderLimitedField/);
  assert.match(appJs, /data-action="copy-field"/);
  assert.match(appJs, /copyAccountField/);
  assert.match(appJs, /navigator\.clipboard\.writeText\(text\)/);

  for (const field of ['email', 'phone', 'sms_api', 'email_code_api', 'remark', 'public_code_key']) {
    assert.match(appJs, new RegExp(`${field}:\\s*\\d+`));
  }

  assert.match(css, /\.limited-field-text\s*{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(css, /\.copy-field-button\s*{/);
});

test('replacement account frontend exposes real pagination controls and query params', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');

  for (const id of ['pageSizeSelect', 'prevPageButton', 'nextPageButton', 'pageText']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(appJs, new RegExp(`#${id}`));
  }

  assert.match(appJs, /URLSearchParams/);
  assert.match(appJs, /page/);
  assert.match(appJs, /pageSize/);
  assert.match(appJs, /keyword/);
  assert.match(appJs, /status/);
});

test('automation log frontend calls run APIs and exposes stop action', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'automation-logs.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'automation-logs.html'), 'utf8');
  const sidebar = readFileSync(join(process.cwd(), 'web', 'sidebar.html'), 'utf8');

  assert.match(appJs, /\/replacement-automation-runs/);
  assert.match(appJs, /\/stop/);
  assert.match(appJs, /stopSelectedRun/);
  assert.match(html, /id="stopButton"/);
  assert.match(sidebar, /补号日志/);
});

test('mail account and automation log tables render visible empty states', () => {
  const accountsJs = readFileSync(join(process.cwd(), 'web', 'accounts.js'), 'utf8');
  const logsJs = readFileSync(join(process.cwd(), 'web', 'automation-logs.js'), 'utf8');

  assert.match(accountsJs, /暂无邮箱账号/);
  assert.match(accountsJs, /colspan="9"/);
  assert.match(logsJs, /暂无补号运行日志/);
  assert.match(logsJs, /colspan="8"/);
});
