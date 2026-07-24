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
    assert.match(html, /一键验活/);
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

test('protocol registration queue keeps failure details in the dedicated log panel', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');

  assert.match(appJs, /job\.state === 'succeeded' \? '完成' : '失败'/);
  assert.doesNotMatch(appJs, /失败：\$\{job\.error/);
  assert.match(appJs, /function renderCurrentProtocolRegistrationLog\(\)/);
  assert.match(appJs, /job\.logs/);
  assert.match(html, /web\/app\.js\?v=registration-token-copy/);
});

test('web frontend calls replacement account APIs and labels screenshot actions correctly', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');

  for (const endpoint of [
    '/replacement-accounts',
    '/fetch-sms-code',
    '/fetch-json',
    '/replace',
    '/replace-2fa',
    '/replace-2fa-protocol',
    '/login-2fa',
    '/register-protocol',
    '/healthcheck-banned',
    '/check-plus-status',
    '/status',
  ]) {
    assert.match(appJs, new RegExp(endpoint.replaceAll('/', '\\/')));
  }

  assert.match(html, /一键补号/);
  assert.match(html, /一键验活/);
  assert.match(html, /查询 Plus 状态/);
  assert.match(html, /id="progressDialog"/);
  assert.match(html, /执行进度/);
  assert.match(html, /id="protocolLivePanel"/);
  assert.match(html, /id="protocolLiveLog"/);
  assert.match(html, /src="web\/app\.js\?v=registration-token-copy"/);
  assert.ok(html.indexOf('id="protocolLivePanel"') < html.indexOf('快捷操作'));
  assert.match(html, /id="protocolReplacementLivePanel"/);
  assert.match(html, /id="protocolReplacementLiveLog"/);
  assert.ok(html.indexOf('id="protocolReplacementLivePanel"') < html.indexOf('id="protocolLivePanel"'));
  assert.match(html, /新增账号/);
  assert.match(html, /name="password"/);
  assert.match(appJs, /获取验证码/);
  assert.match(appJs, /获取 JSON/);
  assert.match(appJs, /执行补号/);
  assert.match(appJs, /2FA补号/);
  assert.match(appJs, /协议补号/);
  assert.match(appJs, /2FA登录/);
  assert.match(appJs, /协议注册/);
  const protocolReplaceStart = appJs.indexOf('async function replaceAccountWith2FAProtocol');
  const protocolReplaceStream = appJs.indexOf('await streamProtocolReplacement', protocolReplaceStart);
  const protocolReplaceStarted = appJs.indexOf("addActivity('协议补号已启动'", protocolReplaceStart);
  assert.ok(protocolReplaceStarted > protocolReplaceStart);
  assert.ok(protocolReplaceStarted < protocolReplaceStream);
  assert.match(appJs, /replaceAccountWith2FAProtocol/);
  assert.match(appJs, /registerProtocolAccount/);
  assert.match(appJs, /text\/event-stream/);
  assert.match(appJs, /protocolLiveLog/);
  assert.match(appJs, /protocolReplacementLiveLog/);
  assert.match(appJs, /job\.logs/);
  assert.match(appJs, /renderCurrentProtocolRegistrationLog/);
  assert.doesNotMatch(appJs, /protocol-queue-log/);
  assert.match(appJs, /handleProtocolReplacementLiveEvent/);
  assert.match(appJs, /streamProtocolReplacement/);
  assert.match(appJs, /protocol-log/);
  assert.match(appJs, /protocol-step/);
  assert.doesNotMatch(appJs, /addActivity\('协议注册/);
  assert.match(appJs, /一键验活/);
  assert.match(appJs, /healthcheckBannedAccounts/);
  assert.match(appJs, /\/replacement-accounts\/healthcheck-banned/);
  assert.match(appJs, /registered、plus_active、cpa_mounted、for_sale、sold/);
  assert.match(appJs, /checkPlusStatusAccounts/);
  assert.match(appJs, /\/replacement-accounts\/check-plus-status/);
  assert.match(appJs, /只查询.*已注册/);
  assert.match(appJs, /showProgressDialog/);
  assert.match(appJs, /streamProgress/);
  assert.match(appJs, /text\/event-stream/);
  assert.match(appJs, /account-start/);
  assert.match(appJs, /account-result/);
  assert.match(appJs, /状态已更新/);
  assert.match(appJs, /删除账号/);
});

test('replacement protocol live log panel is placed below the replacement table', () => {
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
  const tablePanel = html.indexOf('<tbody id="accountsBody">');
  const replacementLogPanel = html.indexOf('id="protocolReplacementLivePanel"');
  const registrationLogPanel = html.indexOf('id="protocolLivePanel"');

  assert.ok(tablePanel >= 0);
  assert.ok(replacementLogPanel > tablePanel);
  assert.ok(registrationLogPanel > replacementLogPanel);
});

test('protocol registration queue refreshes account rows after a job completes', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const queueLoader = appJs.indexOf('async function loadProtocolRegistrationQueue()');
  const queueLoaderEnd = appJs.indexOf('\n}\n\nfunction renderProtocolRegistrationQueue', queueLoader);
  const queueLoaderSource = appJs.slice(queueLoader, queueLoaderEnd);

  assert.ok(queueLoader >= 0);
  assert.match(queueLoaderSource, /completedJobs/);
  assert.match(queueLoaderSource, /if \(completedJobs\.length\) await loadAccounts\(\)/);
});

test('replacement action menu puts protocol registration and protocol replacement first', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const menuStart = appJs.indexOf('<div class="action-menu" hidden>');
  const protocolRegister = appJs.indexOf('data-action="register-protocol"', menuStart);
  const protocolReplace = appJs.indexOf('data-action="replace-2fa-protocol"', menuStart);
  const regularEdit = appJs.indexOf('data-action="edit"', menuStart);

  assert.ok(menuStart >= 0);
  assert.ok(protocolRegister > menuStart);
  assert.ok(protocolReplace > protocolRegister);
  assert.ok(regularEdit > protocolReplace);
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
  assert.match(appJs, /account\.circuit_breaker_at/);
  assert.doesNotMatch(appJs, /account\.status === 'banned'/);
  assert.match(appJs, /\/replacement-accounts\/\$\{account\.id\}\/circuit-breaker\/reset/);
});

test('replacement frontend exposes new Chinese status filters and inline status editing', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');

  for (const [value, label] of [
    ['unregistered', '未注册'],
    ['registered', '已注册'],
    ['pending_activation', '待开通'],
    ['plus_active', '开通 plus'],
    ['cpa_mounted', 'CPA 挂载'],
    ['for_sale', '待出售'],
    ['sold', '已售出'],
    ['banned', '账号封禁'],
    ['circuit_breaker', '已熔断'],
  ]) {
    assert.match(html, new RegExp(`value="${value}"[^>]*>${label}`));
  }

  assert.match(appJs, /const statusLabels = \{/);
  assert.match(appJs, /registered:\s*'已注册'/);
  assert.match(appJs, /plus_active:\s*'开通 plus'/);
  assert.match(appJs, /cpa_mounted:\s*'CPA 挂载'/);
  assert.match(appJs, /renderStatusSelect\(account\)/);
  assert.match(appJs, /class="status-select \$\{escapeHtml\(status\)\}"/);
  assert.match(appJs, /class="\$\{escapeHtml\(value\)\}"/);
  assert.match(appJs, /changeStatus/);
  assert.match(appJs, /applyStatusSelectClass/);
  assert.match(appJs, /\/replacement-accounts\/\$\{id\}\/status/);
  assert.match(appJs, /params\.set\('circuit_breaker', '1'\)/);
  assert.match(appJs, /已熔断/);
  assert.doesNotMatch(appJs, /value="replacing"/);
});

test('replacement frontend treats operation failure as a red hint, not an account status', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'web', 'styles.css'), 'utf8');

  assert.doesNotMatch(html, /value="failed"/);
  assert.doesNotMatch(appJs, /failed:\s*'失败'/);
  assert.match(appJs, /operationFailureLabel/);
  assert.match(appJs, /协议注册失败/);
  assert.match(appJs, /协议补号失败/);
  assert.match(css, /\.operation-failure/);
});

test('replacement status inline control is large and color-coded by status', () => {
  const css = readFileSync(join(process.cwd(), 'web', 'styles.css'), 'utf8');

  assert.match(css, /\.status-select\s*{[^}]*min-width:\s*128px/s);
  assert.match(css, /\.status-select\s*{[^}]*padding:\s*10px 14px/s);
  assert.match(css, /\.status-select\.for_sale\s*{[^}]*background:\s*#e7f0ff/s);
  assert.match(css, /\.status-select\.registered\s*{[^}]*background:\s*#e8efff/s);
  assert.match(css, /\.status-select\.plus_active\s*{[^}]*background:\s*#dff8ea/s);
  assert.match(css, /\.status-select\.cpa_mounted\s*{[^}]*background:\s*#e4fbf8/s);
  assert.match(css, /\.status-select\.banned\s*{[^}]*background:\s*#ffe6e9/s);
  assert.match(css, /\.status-select\.sold\s*{[^}]*background:\s*#f1ebff/s);
  assert.match(css, /\.status-select option\.for_sale\s*{[^}]*background:\s*#e7f0ff/s);
  assert.match(css, /\.status-select option\.registered\s*{[^}]*background:\s*#e8efff/s);
  assert.match(css, /\.status-select option\.banned\s*{[^}]*background:\s*#ffe6e9/s);
});

test('replacement frontend exposes dynamic activation method editing and management', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'web', 'styles.css'), 'utf8');

  assert.match(html, /id="manageActivationMethodsButton"/);
  assert.match(html, /id="activationMethodDialog"/);
  assert.match(html, /name="activation_method"/);
  assert.match(html, /name="name"/);
  assert.match(appJs, /replacement-activation-methods/);
  assert.match(appJs, /activationMethods/);
  assert.match(appJs, /renderActivationMethodSelect\(account\)/);
  assert.match(appJs, /changeActivationMethod/);
  assert.match(appJs, /\/replacement-accounts\/\$\{id\}\/activation-method/);
  assert.match(appJs, /历史值/);
  assert.match(css, /\.activation-method-select\s*{[^}]*min-width:\s*128px/s);
  assert.match(css, /\.activation-method-select\s*{[^}]*padding:\s*10px 14px/s);
});

test('replacement account table fully displays required runtime fields', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'web', 'styles.css'), 'utf8');

  for (const label of [
    '邮箱',
    '手机号',
    'SMS API',
    '密码',
    '备注',
    '2fa-codex',
    '开通方式',
    '开通时间',
    '状态',
    '公开验证码 Key',
    '补号次数',
  ]) {
    assert.match(html, new RegExp(label));
  }
  for (const hiddenLabel of ['状态更新时间', '最后操作', '更新时间']) {
    assert.doesNotMatch(html, new RegExp(`<th>${hiddenLabel}</th>`));
  }

  for (const field of [
    'account.email',
    'account.phone',
    'account.sms_api',
    'account.password',
    'account.remark',
    'account.codex_2fa',
    'account.activation_method',
    'account.activated_at',
    'account.public_code_key',
    'account.replacement_count',
  ]) {
    assert.match(appJs, new RegExp(field.replaceAll('.', '\\.')));
  }
  for (const hiddenField of ['status_updated_at', 'last_operation', 'updated_at']) {
    assert.doesNotMatch(appJs, new RegExp(`renderLimitedField\\(account, '${hiddenField}'`));
  }

  assert.doesNotMatch(appJs, /maskPhone\(account\.phone\)/);
  assert.doesNotMatch(html, /SMS 错误/);
  assert.doesNotMatch(css, /\.table-wrap\s*{[^}]*max-height/s);
  assert.match(css, /\.table-wrap\s*{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /table\s*{[^}]*width:\s*max-content/s);
  assert.match(css, /table\s*{[^}]*min-width:\s*100%/s);
  assert.doesNotMatch(css, /table\s*{[^}]*min-width:\s*1[0-9]{3}px/s);
});

test('replacement account table compacts non-email cells and exposes field copy action', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'web', 'styles.css'), 'utf8');

  assert.match(appJs, /tableFieldLimits/);
  assert.match(appJs, /renderLimitedField/);
  assert.match(appJs, /data-action="copy-field"/);
  assert.match(appJs, /copyAccountField/);
  assert.match(appJs, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(appJs, /compactFieldPreviewLength\s*=\s*6/);
  assert.match(appJs, /renderEmailField/);

  for (const field of ['phone', 'sms_api', 'email_code_api', 'codex_2fa', 'password', 'public_code_key']) {
    assert.match(appJs, new RegExp(`'${field}'`));
  }
  assert.match(appJs, /renderWrappedField\(account\.remark/);
  assert.match(appJs, /renderWrappedField\(account\.activated_at/);
  assert.doesNotMatch(appJs, /compactFields\s*=\s*\[[^\]]*'remark'/s);
  assert.doesNotMatch(appJs, /compactFields\s*=\s*\[[^\]]*'activated_at'/s);

  assert.match(css, /\.limited-field-text\s*{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(css, /\.wrapped-field\s*{[^}]*width:\s*12ch/s);
  assert.match(css, /\.wrapped-field\s*{[^}]*min-width:\s*12ch/s);
  assert.match(css, /\.wrapped-field-text\s*{[^}]*white-space:\s*normal/s);
  assert.match(css, /\.wrapped-field-text\s*{[^}]*word-break:\s*break-all/s);
  assert.doesNotMatch(css, /\.email-field-text\s*{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.copy-field-button\s*{/);
});

test('replacement email field exposes a saved registration AT copy action', () => {
  const appJs = readFileSync(join(process.cwd(), 'web', 'app.js'), 'utf8');

  assert.match(appJs, /data-action="copy-registration-token"/);
  assert.match(appJs, /copyRegistrationToken/);
  assert.match(appJs, /\/replacement-accounts\/\$\{account\.id\}\/registration-token/);
  assert.match(appJs, /AT 未找到/);
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
  assert.match(appJs, /circuit_breaker/);
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
