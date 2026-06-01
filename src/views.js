import { config } from './config.js';

export function layout(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="container">
      ${body}
    </main>
  </body>
</html>`;
}

export function loginPage(error = '') {
  return layout('登录', `
    <section class="card narrow">
      <h1>Gmail IMAP 后台</h1>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="/login">
        <label>
          后台密码
          <input type="password" name="password" required autofocus>
        </label>
        <button type="submit">登录</button>
      </form>
    </section>
  `);
}

export function accountsPage({ accounts, result, error }) {
  return layout('邮箱账号', `
    <header class="topbar">
      <h1>Gmail IMAP 邮箱账号</h1>
      <form method="post" action="/logout">
        <button type="submit" class="secondary">退出</button>
      </form>
    </header>

    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}

    <section class="card">
      <h2>添加邮箱</h2>
      ${accountForm({ action: '/accounts', account: {} })}
    </section>

    <section class="card">
      <h2>邮箱列表</h2>
      ${accounts.length ? renderAccountsTable(accounts) : '<p>暂无邮箱账号。</p>'}
    </section>

    ${result ? renderFetchResult(result) : ''}
  `);
}

export function editAccountPage(account) {
  return layout('编辑邮箱', `
    <p><a href="/accounts">← 返回列表</a></p>
    <section class="card">
      <h1>编辑邮箱</h1>
      ${accountForm({ action: `/accounts/${account.id}`, account })}
    </section>
  `);
}

function renderAccountsTable(accounts) {
  return `
    <div class="table-container">
      <table class="data-table account-table">
        <thead>
          <tr>
            <th width="360px">操作</th>
            <th width="230px">Gmail</th>
            <th width="180px">Gmail 密码</th>
            <th width="240px">2FA</th>
            <th width="190px">App Password</th>
            <th width="120px">状态</th>
            <th width="190px">上次获取</th>
            <th width="260px">最近错误</th>
          </tr>
        </thead>
        <tbody>
          ${accounts.map(renderAccountRow).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderAccountRow(account) {
  return `
    <tr>
      <td>
        <div class="account-actions">
          <form method="post" action="/accounts/${account.id}/fetch" class="fetch-form">
            <select name="readLocation">
              <option value="inbox">收件箱</option>
              <option value="all">全部邮件</option>
              <option value="trash">垃圾箱</option>
            </select>
            <input type="number" name="limit" min="1" max="50" value="${config.mailFetchLimit}">
            <button type="submit">获取邮件</button>
          </form>
          <form method="post" action="/accounts/${account.id}/test" class="inline-form">
            <button type="submit" class="secondary">测试连接</button>
          </form>
          <a class="button secondary" href="/accounts/${account.id}/edit">编辑</a>
          <form method="post" action="/accounts/${account.id}/delete" class="inline-form" onsubmit="return confirm('确定删除这个邮箱账号？')">
            <button type="submit" class="danger">删除</button>
          </form>
        </div>
      </td>
      <td>${readonlyCell(account.gmail_email)}</td>
      <td>${readonlyCell(account.gmail_password)}</td>
      <td>${readonlyCell(account.gmail_2fa)}</td>
      <td>${readonlyCell(account.gmail_app_password)}</td>
      <td>${readonlyCell(account.status)}</td>
      <td>${readonlyCell(account.last_fetch_at || '')}</td>
      <td>${readonlyCell(account.last_error || '')}</td>
    </tr>
  `;
}

function readonlyCell(value) {
  return `<div class="readonly-cell ${value ? '' : 'empty'}">${escapeHtml(value || '-')}</div>`;
}

function accountForm({ action, account }) {
  return `
    <form method="post" action="${action}" class="grid-form">
      <label>
        备注
        <input name="display_name" value="${escapeAttribute(account.display_name || '')}">
      </label>
      <label>
        Gmail 邮箱号 *
        <input name="gmail_email" type="email" required value="${escapeAttribute(account.gmail_email || '')}">
      </label>
      <label>
        Gmail 登录密码 *
        <input name="gmail_password" required value="${escapeAttribute(account.gmail_password || '')}">
      </label>
      <label>
        2FA *
        <input name="gmail_2fa" required value="${escapeAttribute(account.gmail_2fa || '')}">
      </label>
      <label>
        App Password *
        <input name="gmail_app_password" required value="${escapeAttribute(account.gmail_app_password || '')}">
      </label>
      <button type="submit">保存</button>
    </form>
  `;
}

function renderFetchResult(result) {
  return `
    <section class="card mail-result-panel">
      <h2>${escapeHtml(result.title)}</h2>
      ${result.messages?.length ? `
        <div class="gmail-mail-list">
          ${result.messages.map(renderMailRow).join('')}
        </div>
      ` : '<p>没有获取到邮件。</p>'}
    </section>
  `;
}

function renderMailRow(message) {
  const senderName = getSenderName(message.from);
  const time = formatMailTime(message.date);
  return `
    <details class="gmail-mail-row">
      <summary class="gmail-mail-summary">
        <span class="gmail-sender">${escapeHtml(senderName)}</span>
        <span class="gmail-main-line">
          <span class="gmail-subject">${escapeHtml(message.subject)}</span>
          <span class="gmail-separator">-</span>
          <span class="gmail-snippet">${escapeHtml(message.preview)}</span>
        </span>
        <span class="gmail-source">${escapeHtml(message.sourceMailbox)}</span>
        <span class="gmail-time">${escapeHtml(time)}</span>
      </summary>
      <article class="gmail-mail-detail">
        <h1>${escapeHtml(message.subject)}</h1>
        <div class="gmail-detail-meta">
          <strong>${escapeHtml(senderName)}</strong>
          <span>${escapeHtml(message.from)}</span>
        </div>
        <div class="gmail-detail-submeta">
          <span>${escapeHtml(message.date || '')}</span>
          <span>${escapeHtml(message.sourceMailbox)}</span>
        </div>
        ${renderMailBody(message)}
      </article>
    </details>
  `;
}

function renderMailBody(message) {
  if (message.bodyHtml) {
    return `<div class="gmail-body gmail-body-html">${message.bodyHtml}</div>`;
  }
  return `<div class="gmail-body">${escapeHtml(message.bodyText || message.preview || '')}</div>`;
}

function getSenderName(from) {
  const value = String(from || '').trim();
  const match = value.match(/^"?([^"<]+)"?\s*</);
  return (match?.[1] || value || 'Unknown').trim();
}

function formatMailTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
