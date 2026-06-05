const state = {
  accounts: [],
  filtered: [],
  selectedIds: new Set(),
  activity: [],
  pagination: {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  },
};

const statusLabels = {
  pending: 'pending',
  active: 'active',
  banned: 'banned',
  replacing: 'replacing',
  replaced: 'replaced',
  failed: 'failed',
};

const $ = (selector) => document.querySelector(selector);

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadAccounts();
});

function bindEvents() {
  $('#statusFilter').addEventListener('change', resetAndLoadAccounts);
  $('#searchInput').addEventListener('input', resetAndLoadAccounts);
  $('#filterButton').addEventListener('click', resetAndLoadAccounts);
  $('#selectAll').addEventListener('change', toggleAll);
  $('#pageSizeSelect').addEventListener('change', () => {
    state.pagination.page = 1;
    state.pagination.pageSize = Number($('#pageSizeSelect').value || 10);
    loadAccounts();
  });
  $('#prevPageButton').addEventListener('click', () => {
    if (state.pagination.page <= 1) return;
    state.pagination.page -= 1;
    loadAccounts();
  });
  $('#nextPageButton').addEventListener('click', () => {
    if (state.pagination.page >= state.pagination.totalPages) return;
    state.pagination.page += 1;
    loadAccounts();
  });
  $('#batchReplaceButton').addEventListener('click', batchReplace);
  $('#newAccountButton').addEventListener('click', () => openAccountDialog());
  $('#newAccountTopButton').addEventListener('click', () => openAccountDialog());
  $('#accountForm').addEventListener('submit', saveAccount);
  $('#statusForm').addEventListener('submit', saveStatus);
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
  document.addEventListener('click', closeOpenMenus);
}

async function loadAccounts() {
  try {
    const body = await api(`/replacement-accounts?${accountListQuery()}`);
    state.accounts = body.accounts || [];
    state.pagination = {
      ...state.pagination,
      ...(body.pagination || {}),
    };
    renderAccounts();
    toast('列表已刷新');
  } catch (error) {
    toast(error.message);
  }
}

function resetAndLoadAccounts() {
  state.pagination.page = 1;
  loadAccounts();
}

function accountListQuery() {
  const params = new URLSearchParams({
    page: String(state.pagination.page),
    pageSize: String(state.pagination.pageSize),
  });
  const status = $('#statusFilter').value;
  const keyword = $('#searchInput').value.trim();
  if (status) params.set('status', status);
  if (keyword) params.set('keyword', keyword);
  return params.toString();
}

function renderAccounts() {
  state.filtered = state.accounts;

  $('#accountsBody').innerHTML = state.filtered.map(accountRow).join('');
  $('#totalText').textContent = `共 ${state.pagination.total} 条`;
  renderPager();
  bindRowEvents();
  renderStats();
  renderActivity();
}

function renderPager() {
  $('#pageSizeSelect').value = String(state.pagination.pageSize);
  $('#pageText').textContent = `第 ${state.pagination.page} / ${state.pagination.totalPages} 页`;
  $('#prevPageButton').disabled = state.pagination.page <= 1;
  $('#nextPageButton').disabled = state.pagination.page >= state.pagination.totalPages;
}

function accountRow(account) {
  const checked = state.selectedIds.has(account.id) ? 'checked' : '';
  const lastText = lastOperationText(account);
  return `
    <tr>
      <td><input class="row-check" type="checkbox" data-id="${account.id}" ${checked}></td>
      <td><div class="email-main field-raw">${escapeHtml(account.email)}</div><div class="muted">ID: ${account.id}</div></td>
      <td><span class="field-raw">${escapeHtml(account.phone || '-')}</span></td>
      <td><span class="field-raw">${escapeHtml(account.sms_api || '-')}</span></td>
      <td><div class="remark-cell">${escapeHtml(account.remark || '-')}</div></td>
      <td>${escapeHtml(account.activation_method || '-')}</td>
      <td><span class="field-raw">${escapeHtml(account.activated_at || '-')}</span></td>
      <td><span class="status ${account.status}">${statusLabels[account.status] || account.status}</span></td>
      <td><span class="field-raw">${escapeHtml(account.status_updated_at || '-')}</span></td>
      <td><span class="field-raw">${escapeHtml(account.public_code_key || '-')}</span><div class="muted">${account.public_code_enabled ? '公开验证码已启用' : '公开验证码未启用'}</div></td>
      <td>${account.replacement_count || 0}</td>
      <td><span class="dot ${lastText.type}"></span>${escapeHtml(lastText.label)}<div class="muted">${escapeHtml(formatDate(account.last_replace_at || account.json_fetched_at || account.status_updated_at))}</div></td>
      <td>${escapeHtml(formatDate(account.updated_at))}</td>
      <td>
        <div class="actions">
          <button class="primary action-toggle" type="button" data-id="${account.id}">操作⌄</button>
          <div class="action-menu" hidden>
            <button type="button" data-action="edit" data-id="${account.id}">✎ 编辑账号</button>
            <button type="button" data-action="toggle-public-code" data-id="${account.id}">${account.public_code_enabled ? '停用公开验证码' : '启用公开验证码'}</button>
            <button type="button" data-action="sms" data-id="${account.id}">▣ 获取验证码</button>
            <button type="button" data-action="json" data-id="${account.id}">▣ 获取 JSON</button>
            <button type="button" data-action="register" data-id="${account.id}">✚ 注册</button>
            <button type="button" data-action="replace" data-id="${account.id}">⟳ 执行补号</button>
            <button type="button" data-action="copy-public-code-url" data-id="${account.id}">⧉ 复制公开验证码 URL</button>
            <button type="button" data-action="status" data-id="${account.id}">⊙ 状态设置</button>
            <button class="danger" type="button" data-action="delete" data-id="${account.id}">🗑 删除账号</button>
          </div>
        </div>
        <button type="button" data-action="detail" data-id="${account.id}">详情</button>
      </td>
    </tr>
  `;
}

function bindRowEvents() {
  document.querySelectorAll('.row-check').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const id = Number(checkbox.dataset.id);
      if (checkbox.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
    });
  });
  document.querySelectorAll('.action-toggle').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = button.nextElementSibling;
      const willOpen = menu.hidden;
      closeOpenMenus();
      menu.hidden = !willOpen;
    });
  });
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handleAction(button.dataset.action, Number(button.dataset.id));
      closeOpenMenus();
    });
  });
}

async function handleAction(action, id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;
  if (action === 'edit') return openAccountDialog(account);
  if (action === 'detail') return openDetail(account);
  if (action === 'status') return openStatusDialog(account);
  if (action === 'delete') return deleteAccount(account);
  if (action === 'sms') return fetchSmsCode(account);
  if (action === 'json') return fetchJson(account);
  if (action === 'register') return registerAccount(account);
  if (action === 'replace') return replaceAccount(account);
  if (action === 'toggle-public-code') return togglePublicCode(account);
  if (action === 'copy-public-code-url') return copyPublicCodeUrl(account);
}

function openAccountDialog(account = null) {
  const form = $('#accountForm');
  form.reset();
  $('#dialogTitle').textContent = account ? '编辑账号' : '新增账号';
  for (const field of ['id', 'email', 'phone', 'sms_api', 'activation_method', 'activated_at', 'status', 'remark']) {
    form.elements[field].value = account?.[field] || (field === 'status' ? 'pending' : '');
  }
  form.elements.public_code_enabled.checked = Boolean(Number(account?.public_code_enabled || 0));
  form.elements.public_code_key.value = account?.public_code_key || '';
  $('#accountDialog').showModal();
}

async function saveAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const id = data.id;
  delete data.id;
  data.public_code_enabled = form.elements.public_code_enabled.checked ? 1 : 0;
  try {
    await api(id ? `/replacement-accounts/${id}` : '/replacement-accounts', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    $('#accountDialog').close();
    addActivity(id ? '修改账号' : '新增账号', data.email);
    await loadAccounts();
  } catch (error) {
    toast(error.message);
  }
}

async function copyPublicCodeUrl(account) {
  if (!account.public_code_enabled || !account.public_code_key) {
    toast('请先启用公开验证码接口并保存账号');
    return;
  }
  const url = `${location.origin}/api/verification-code/public/latest?key=${encodeURIComponent(account.public_code_key)}`;
  try {
    await navigator.clipboard.writeText(url);
    addActivity('复制公开验证码 URL', account.email);
    toast('公开验证码 URL 已复制');
  } catch (error) {
    prompt('复制公开验证码 URL', url);
  }
}

async function togglePublicCode(account) {
  const enabled = !account.public_code_enabled;
  try {
    await api(`/replacement-accounts/${account.id}/public-code`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    addActivity(enabled ? '启用公开验证码' : '停用公开验证码', account.email);
    toast(enabled ? '公开验证码已启用' : '公开验证码已停用');
    await loadAccounts();
  } catch (error) {
    toast(error.message);
    await loadAccounts();
  }
}

function openStatusDialog(account) {
  const form = $('#statusForm');
  form.elements.id.value = account.id;
  form.elements.status.value = account.status === 'replacing' ? 'pending' : account.status;
  form.elements.status_note.value = account.status_note || '';
  $('#statusDialog').showModal();
}

async function saveStatus(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.id.value;
  const data = {
    status: form.elements.status.value,
    status_note: form.elements.status_note.value,
  };
  try {
    await api(`/replacement-accounts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    $('#statusDialog').close();
    addActivity('状态设置', `ID ${id} -> ${data.status}`);
    await loadAccounts();
  } catch (error) {
    toast(error.message);
  }
}

async function fetchSmsCode(account) {
  try {
    const body = await api(`/replacement-accounts/${account.id}/fetch-sms-code`, { method: 'POST' });
    addActivity('获取验证码', `${account.email}: ${body.code}`);
    toast(`验证码：${body.code}`);
  } catch (error) {
    addActivity('验证码失败', account.email);
    toast(error.message);
    await loadAccounts();
  }
}

async function fetchJson(account) {
  const url = prompt('请输入 JSON URL', account.json_url || '');
  if (!url) return;
  try {
    await api(`/replacement-accounts/${account.id}/fetch-json`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    addActivity('获取 JSON', account.email);
    await loadAccounts();
  } catch (error) {
    addActivity('获取 JSON 失败', account.email);
    toast(error.message);
    await loadAccounts();
  }
}

async function replaceAccount(account) {
  try {
    await api(`/replacement-accounts/${account.id}/replace`, { method: 'POST' });
    addActivity('补号成功', account.email);
    await loadAccounts();
  } catch (error) {
    addActivity('补号失败', account.email);
    toast(error.message);
    await loadAccounts();
  }
}

async function registerAccount(account) {
  try {
    await api(`/replacement-accounts/${account.id}/register`, { method: 'POST' });
    addActivity('注册自动化已启动', account.email);
    toast('已启动注册自动化，可在日志页面查看进度');
    await loadAccounts();
  } catch (error) {
    addActivity('注册自动化失败', account.email);
    toast(error.message);
    await loadAccounts();
  }
}

async function batchReplace() {
  const candidates = selectedAccounts().length
    ? selectedAccounts()
    : state.accounts.filter((account) => ['banned', 'failed', 'pending'].includes(account.status));
  if (!candidates.length) {
    toast('没有可补号账号');
    return;
  }
  if (!confirm(`确认执行一键补号？共 ${candidates.length} 个账号`)) return;
  for (const account of candidates) {
    await replaceAccount(account);
  }
}

async function deleteAccount(account) {
  if (!confirm(`确认删除 ${account.email}？`)) return;
  try {
    await api(`/replacement-accounts/${account.id}`, { method: 'DELETE' });
    state.selectedIds.delete(account.id);
    addActivity('删除账号', account.email);
    await loadAccounts();
  } catch (error) {
    toast(error.message);
  }
}

function openDetail(account) {
  $('#detailContent').textContent = JSON.stringify(account, null, 2);
  $('#detailDialog').showModal();
}

function runQuickAction(action) {
  const account = selectedAccounts()[0] || state.filtered[0];
  if (action === 'activity') {
    document.getElementById('activity').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (!account) {
    toast('请先选择账号');
    return;
  }
  handleAction(action, account.id);
}

function selectedAccounts() {
  return state.accounts.filter((account) => state.selectedIds.has(account.id));
}

function toggleAll(event) {
  if (event.target.checked) {
    state.filtered.forEach((account) => state.selectedIds.add(account.id));
  } else {
    state.filtered.forEach((account) => state.selectedIds.delete(account.id));
  }
  renderAccounts();
}

function renderStats() {
  const counts = countByStatus(state.accounts);
  $('#statTotal').textContent = state.pagination.total;
  $('#statActive').textContent = counts.active || 0;
  $('#statBanned').textContent = counts.banned || 0;
  $('#statReplaced').textContent = state.accounts.reduce((sum, account) => sum + Number(account.replacement_count || 0), 0);
  $('#statFailed').textContent = counts.failed || 0;
  renderStatusLegend(counts);
}

function renderStatusLegend(counts) {
  const total = state.accounts.length || 1;
  const colors = {
    active: '#21bf73',
    banned: '#f24e5c',
    replaced: '#26aebd',
    pending: '#2273f5',
    failed: '#b8c1ce',
  };
  const statuses = ['active', 'banned', 'replaced', 'pending', 'failed'];
  $('#statusLegend').innerHTML = statuses.map((status) => {
    const count = counts[status] || 0;
    const percent = Math.round((count / total) * 1000) / 10;
    return `<li><span><i style="background:${colors[status]}"></i> ${status}</span><strong>${count} (${percent}%)</strong></li>`;
  }).join('');
}

function countByStatus(accounts) {
  return accounts.reduce((counts, account) => {
    counts[account.status] = (counts[account.status] || 0) + 1;
    return counts;
  }, {});
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

function lastOperationText(account) {
  if (account.status === 'failed') return { type: 'failed', label: '补号失败' };
  if (account.status === 'replacing') return { type: 'replacing', label: '补号中' };
  if (account.last_replace_at || account.status === 'replaced') return { type: '', label: '补号成功' };
  if (account.json_fetched_at) return { type: 'replacing', label: '获取 JSON' };
  return { type: 'empty', label: '-' };
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function closeOpenMenus() {
  document.querySelectorAll('.action-menu').forEach((menu) => {
    menu.hidden = true;
  });
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
