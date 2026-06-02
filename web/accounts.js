const state = {
  accounts: [],
  filtered: [],
  selectedId: null,
  activity: [],
  fetchedMessages: [],
};

const $ = (selector) => document.querySelector(selector);

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadAccounts();
});

function bindEvents() {
  $('#statusFilter').addEventListener('change', renderAccounts);
  $('#searchInput').addEventListener('input', renderAccounts);
  $('#filterButton').addEventListener('click', renderAccounts);
  $('#refreshButton').addEventListener('click', loadAccounts);
  $('#newAccountButton').addEventListener('click', () => openAccountDialog());
  $('#newAccountToolbarButton').addEventListener('click', () => openAccountDialog());
  $('#accountForm').addEventListener('submit', saveAccount);
  $('#clearMailResult').addEventListener('click', clearMailResult);
  $('#clearActivity').addEventListener('click', () => {
    state.activity = [];
    renderActivity();
  });
  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  document.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', () => runQuickAction(button.dataset.quick));
  });
}

async function loadAccounts() {
  try {
    const body = await api('/api/accounts');
    state.accounts = body.accounts || [];
    renderAccounts();
  } catch (error) {
    toast(error.message);
  }
}

function renderAccounts() {
  const status = $('#statusFilter').value;
  const keyword = $('#searchInput').value.trim().toLowerCase();
  state.filtered = state.accounts.filter((account) => {
    const matchesStatus = !status || account.status === status;
    const haystack = [account.gmail_email, account.display_name, account.status, account.last_error]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return matchesStatus && (!keyword || haystack.includes(keyword));
  });

  $('#accountsBody').innerHTML = state.filtered.map(accountRow).join('');
  $('#totalText').textContent = `共 ${state.filtered.length} 条`;
  bindRowEvents();
  renderStats();
  renderActivity();
}

function accountRow(account) {
  return `
    <tr>
      <td><div class="email-main">${escapeHtml(account.gmail_email)}</div><div class="muted">ID: ${account.id}</div></td>
      <td>${escapeHtml(account.display_name || '-')}</td>
      <td>${readonlySecret(account.gmail_password)}</td>
      <td>${readonlySecret(account.gmail_2fa)}</td>
      <td>${readonlySecret(account.gmail_app_password)}</td>
      <td><span class="status ${statusClass(account.status)}">${escapeHtml(account.status)}</span></td>
      <td>${escapeHtml(formatDate(account.last_fetch_at))}<div class="muted">${escapeHtml(account.last_fetch_status || 'idle')}</div></td>
      <td><button class="link-button error-summary" type="button" data-action="detail" data-id="${account.id}">${escapeHtml(formatErrorSummary(account.last_error))}</button></td>
      <td>
        <select class="inline-select" data-read-location="${account.id}" aria-label="读取位置">
          <option value="inbox">收件箱</option>
          <option value="all">全部邮件</option>
          <option value="trash">垃圾箱</option>
        </select>
        <input class="inline-limit" data-fetch-limit="${account.id}" type="number" min="1" max="50" value="5" aria-label="获取数量">
        <button class="primary" type="button" data-action="fetch" data-id="${account.id}">获取邮件</button>
        <button type="button" data-action="test" data-id="${account.id}">测试连接</button>
        <button type="button" data-action="edit" data-id="${account.id}">编辑</button>
        <button class="danger" type="button" data-action="delete" data-id="${account.id}">删除</button>
      </td>
    </tr>
  `;
}

function bindRowEvents() {
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => handleAction(button.dataset.action, Number(button.dataset.id)));
  });
}

function handleAction(action, id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;
  state.selectedId = id;
  if (action === 'fetch') return fetchMessages(account);
  if (action === 'test') return testConnection(account);
  if (action === 'edit') return openAccountDialog(account);
  if (action === 'delete') return deleteAccount(account);
  if (action === 'detail') return openDetailDialog(account);
}

function openAccountDialog(account = null) {
  const form = $('#accountForm');
  form.reset();
  $('#dialogTitle').textContent = account ? '编辑邮箱' : '新增邮箱';
  for (const field of ['id', 'display_name', 'gmail_email', 'gmail_password', 'gmail_2fa', 'gmail_app_password']) {
    form.elements[field].value = account?.[field] || '';
  }
  $('#accountDialog').showModal();
}

async function saveAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const id = data.id;
  delete data.id;
  try {
    const body = await api(id ? `/api/accounts/${id}` : '/api/accounts', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    $('#accountDialog').close();
    addActivity(id ? '编辑邮箱' : '新增邮箱', body.account.gmail_email);
    await loadAccounts();
  } catch (error) {
    toast(error.message);
  }
}

async function testConnection(account) {
  const button = actionButton(account.id, 'test');
  setBusy(button, true, '正在测试连接');
  toast(`正在测试连接：${account.gmail_email}`);
  try {
    const body = await api(`/api/accounts/${account.id}/test`, { method: 'POST' });
    addActivity('测试连接', `${body.account.gmail_email} 连接成功`);
    toast('连接成功');
    await loadAccounts();
  } catch (error) {
    addActivity('测试连接失败', account.gmail_email);
    toast(error.message);
    await loadAccounts();
  } finally {
    setBusy(button, false, '测试连接');
  }
}

async function fetchMessages(account) {
  const button = actionButton(account.id, 'fetch');
  const readLocation = document.querySelector(`[data-read-location="${account.id}"]`)?.value || 'inbox';
  const limit = Number(document.querySelector(`[data-fetch-limit="${account.id}"]`)?.value || 5);
  setBusy(button, true, '正在获取邮件');
  toast(`正在获取邮件：${account.gmail_email}`);
  try {
    const body = await api(`/api/accounts/${account.id}/fetch`, {
      method: 'POST',
      body: JSON.stringify({ readLocation, limit }),
    });
    addActivity('获取邮件', account.gmail_email);
    const result = body.result || { title: `${account.gmail_email} 获取结果`, messages: body.messages || [] };
    state.fetchedMessages = result.messages || [];
    renderMailResult(result);
    await loadAccounts();
  } catch (error) {
    addActivity('获取邮件失败', account.gmail_email);
    state.fetchedMessages = [];
    renderMailResult({
      title: `${account.gmail_email} 获取失败`,
      messages: [],
      error: error.message,
    });
    toast(error.message);
    await loadAccounts();
  } finally {
    setBusy(button, false, '获取邮件');
  }
}

async function deleteAccount(account) {
  if (!confirm(`确认删除 ${account.gmail_email}？`)) return;
  try {
    await api(`/api/accounts/${account.id}`, { method: 'DELETE' });
    addActivity('删除邮箱', account.gmail_email);
    await loadAccounts();
  } catch (error) {
    toast(error.message);
  }
}

function renderMailResult(result) {
  $('#mailResult').hidden = false;
  $('#mailResultTitle').textContent = result.title || '邮件结果';
  const messages = result.messages || [];
  const content = result.error
    ? `<p class="error">${escapeHtml(result.error)}</p>`
    : messages.length
    ? messages.map((message, index) => renderMailRow(message, index)).join('')
    : '<p class="muted">没有获取到邮件。</p>';
  $('#mailResultList').innerHTML = `<div class="mail-result-scroll">${content}</div>`;

  // Bind click event to each mail summary to show the modal!
  $('#mailResultList').querySelectorAll('.gmail-mail-summary').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = Number(el.closest('.gmail-mail-row').dataset.index);
      const message = state.fetchedMessages[idx];
      if (message) {
        openMailDetailDialog(message);
      }
    });
  });

  document.getElementById('mailResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderMailRow(message, index) {
  return `
    <div class="gmail-mail-row" data-index="${index}">
      <div class="gmail-mail-summary mail-row-summary">
        <span class="gmail-sender">${escapeHtml(senderName(message.from))}</span>
        <span class="gmail-main-line">
          <span class="gmail-subject">${escapeHtml(message.subject || '')}</span>
          <span class="gmail-separator">-</span>
          <span class="gmail-snippet">${escapeHtml(formatSnippet(message.preview || message.bodyText || ''))}</span>
        </span>
        <span class="gmail-source">${escapeHtml(message.sourceMailbox || '')}</span>
        <span class="gmail-time">${escapeHtml(formatTime(message.date))}</span>
      </div>
    </div>
  `;
}

function openMailDetailDialog(message) {
  $('#mailDetailSubject').textContent = message.subject || '(无主题)';
  $('#mailDetailSenderName').textContent = senderName(message.from);
  $('#mailDetailSenderEmail').textContent = message.from || '';
  $('#mailDetailDate').textContent = formatDate(message.date) || '';
  $('#mailDetailSource').textContent = message.sourceMailbox || '';
  
  const bodyEl = $('#mailDetailBody');
  if (message.bodyHtml) {
    bodyEl.innerHTML = message.bodyHtml;
    bodyEl.className = 'gmail-body gmail-body-html';
  } else {
    bodyEl.textContent = message.bodyText || message.preview || '';
    bodyEl.className = 'gmail-body';
  }
  
  $('#mailDetailDialog').showModal();
}

function clearMailResult() {
  $('#mailResult').hidden = true;
  $('#mailResultList').innerHTML = '';
}

function runQuickAction(action) {
  if (action === 'new') return openAccountDialog();
  if (action === 'activity') return document.getElementById('activity').scrollIntoView({ behavior: 'smooth' });
  const account = state.accounts.find((item) => item.id === state.selectedId) || state.filtered[0];
  if (!account) {
    toast('请先添加邮箱账号');
    return;
  }
  if (action === 'fetch') return fetchMessages(account);
  if (action === 'test') return testConnection(account);
}

function renderStats() {
  const total = state.accounts.length;
  const active = state.accounts.filter((account) => account.status === 'active').length;
  const fetched = state.accounts.filter((account) => account.last_fetch_status === 'success').length;
  const errors = state.accounts.filter((account) => ['auth_failed', 'error'].includes(account.status)).length;
  const idle = state.accounts.filter((account) => account.last_fetch_status === 'idle').length;
  $('#statTotal').textContent = total;
  $('#statActive').textContent = active;
  $('#statFetched').textContent = fetched;
  $('#statError').textContent = errors;
  $('#statIdle').textContent = idle;
  renderStatusLegend({ active, fetched, errors, idle });
}

function renderStatusLegend({ active, fetched, errors, idle }) {
  $('#statusLegend').innerHTML = [
    ['active', active],
    ['fetched', fetched],
    ['error', errors],
    ['idle', idle],
  ].map(([label, count]) => `<li><span>${label}</span><strong>${count}</strong></li>`).join('');
}

function renderActivity() {
  $('#activityList').innerHTML = (state.activity.slice(0, 5).map((item) => `
    <li><span>${escapeHtml(item.title)}<br><small>${escapeHtml(item.detail)}</small></span><small>${item.time}</small></li>
  `).join('')) || '<li><span>暂无操作</span><small>-</small></li>';
}

function addActivity(title, detail) {
  state.activity.unshift({
    title,
    detail,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  });
  renderActivity();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.message || body.error || `请求失败：${response.status}`);
  }
  return body;
}

function statusClass(status) {
  if (status === 'active') return 'active';
  if (status === 'auth_failed' || status === 'error') return 'failed';
  return 'pending';
}

function readonlySecret(value) {
  return `<div class="readonly-cell ${value ? '' : 'empty'}">${escapeHtml(value || '-')}</div>`;
}

function formatErrorSummary(value) {
  const text = String(value || '').trim();
  if (!text) return '-';
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

function formatSnippet(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function openDetailDialog(account) {
  $('#detailContent').textContent = JSON.stringify(account, null, 2);
  $('#detailDialog').showModal();
}

function senderName(from) {
  const value = String(from || '').trim();
  const match = value.match(/^"?([^"<]+)"?\s*</);
  return (match?.[1] || value || 'Unknown').trim();
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove('show'), 4200);
}

function actionButton(accountId, action) {
  return document.querySelector(`[data-action="${action}"][data-id="${accountId}"]`);
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = label;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
