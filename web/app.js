const state = {
  accounts: [],
  activationMethods: [],
  filtered: [],
  selectedIds: new Set(),
  activity: [],
  protocolRegistrationQueue: { current: null, waiting: [], recent: [] },
  seenProtocolRegistrationTerminalJobs: new Set(),
  pagination: {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  },
};

const statusLabels = {
  unregistered: '未注册',
  registered: '已注册',
  pending_activation: '待开通',
  plus_active: '开通 plus',
  cpa_mounted: 'CPA 挂载',
  for_sale: '待出售',
  sold: '已售出',
  banned: '账号封禁',
  replacing: '处理中',
};

const statusOptions = [
  'unregistered',
  'registered',
  'pending_activation',
  'plus_active',
  'cpa_mounted',
  'for_sale',
  'sold',
  'banned',
];

const compactFieldPreviewLength = 6;
const compactFields = [
  'phone',
  'sms_api',
  'email_code_api',
  'codex_2fa',
  'password',
  'activation_method',
  'public_code_key',
];
const tableFieldLimits = Object.fromEntries(
  compactFields.map((field) => [field, compactFieldPreviewLength]),
);

const $ = (selector) => document.querySelector(selector);
let progressActionRunning = false;
let protocolRegistrationQueueTimer = null;
let protocolReplacementRunning = false;

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadInitialData();
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
  $('#healthcheckBannedButton').addEventListener('click', healthcheckBannedAccounts);
  $('#checkPlusStatusButton').addEventListener('click', checkPlusStatusAccounts);
  $('#batchReplaceButton').addEventListener('click', batchReplace);
  $('#manageActivationMethodsButton').addEventListener('click', openActivationMethodDialog);
  $('#newAccountButton').addEventListener('click', () => openAccountDialog());
  $('#newAccountTopButton').addEventListener('click', () => openAccountDialog());
  $('#accountForm').addEventListener('submit', saveAccount);
  $('#activationMethodForm').addEventListener('submit', saveActivationMethod);
  $('#statusForm').addEventListener('submit', saveStatus);
  $('#clearActivity').addEventListener('click', () => {
    state.activity = [];
    renderActivity();
  });
  $('#clearProtocolLiveLog').addEventListener('click', clearProtocolLiveLog);
  $('#clearProtocolRegistrationQueue').addEventListener('click', clearProtocolRegistrationQueue);
  $('#clearProtocolReplacementLiveLog').addEventListener('click', clearProtocolReplacementLiveLog);
  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  document.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', () => runQuickAction(button.dataset.quick));
  });
  document.addEventListener('click', closeOpenMenus);
}

async function loadInitialData() {
  await loadActivationMethods();
  await loadAccounts();
  await loadProtocolRegistrationQueue();
}

async function loadActivationMethods() {
  try {
    const body = await api('/replacement-activation-methods');
    state.activationMethods = body.methods || [];
    renderActivationMethodOptions();
    renderActivationMethodList();
  } catch (error) {
    state.activationMethods = [];
    renderActivationMethodOptions();
    renderActivationMethodList();
    toast(error.message);
  }
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
  if (status === 'circuit_breaker') params.set('circuit_breaker', '1');
  else if (status) params.set('status', status);
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
  return `
    <tr>
      <td><input class="row-check" type="checkbox" data-id="${account.id}" ${checked}></td>
      <td>${renderEmailField(account)}<div class="muted">ID: ${account.id}</div>${renderProtocolQueueState(account.id)}</td>
      <td>${renderLimitedField(account, 'phone', account.phone, { className: 'field-raw' })}</td>
      <td>${renderLimitedField(account, 'sms_api', account.sms_api, { className: 'field-raw' })}</td>
      <td>${renderLimitedField(account, 'email_code_api', account.email_code_api, { className: 'field-raw' })}</td>
      <td>${renderLimitedField(account, 'codex_2fa', account.codex_2fa, { className: 'field-raw' })}</td>
      <td>${renderLimitedField(account, 'password', account.password, { className: 'field-raw' })}</td>
      <td>${renderWrappedField(account.remark)}</td>
      <td>${renderActivationMethodSelect(account)}</td>
      <td>${renderWrappedField(account.activated_at, { className: 'field-raw' })}</td>
      <td>${renderStatusSelect(account)}</td>
      <td>${renderLimitedField(account, 'public_code_key', account.public_code_key, { className: 'field-raw' })}<div class="muted">${account.public_code_enabled ? '公开验证码已启用' : '公开验证码未启用'}</div></td>
      <td>${account.replacement_count || 0}</td>
      <td>
        <div class="actions">
          <button class="primary action-toggle" type="button" data-id="${account.id}">操作⌄</button>
          <div class="action-menu" hidden>
            <button type="button" data-action="register-protocol" data-id="${account.id}">⇄ 协议注册</button>
            <button type="button" data-action="replace-2fa-protocol" data-id="${account.id}">⟳ 协议补号</button>
            <button type="button" data-action="edit" data-id="${account.id}">✎ 编辑账号</button>
            <button type="button" data-action="toggle-public-code" data-id="${account.id}">${account.public_code_enabled ? '停用公开验证码' : '启用公开验证码'}</button>
            <button type="button" data-action="sms" data-id="${account.id}">▣ 获取验证码</button>
            <button type="button" data-action="json" data-id="${account.id}">▣ 获取 JSON</button>
            <button type="button" data-action="register" data-id="${account.id}">✚ 注册</button>
            <button type="button" data-action="replace" data-id="${account.id}">⟳ 执行补号</button>
            <button type="button" data-action="replace-2fa" data-id="${account.id}">⟳ 2FA补号</button>
            <button type="button" data-action="login-2fa" data-id="${account.id}">🔑 2FA登录</button>
            ${account.circuit_breaker_at ? `<button type="button" data-action="reset-circuit-breaker" data-id="${account.id}">解除熔断</button>` : ''}
            <button type="button" data-action="copy-public-code-url" data-id="${account.id}">⧉ 复制公开验证码 URL</button>
            <button class="danger" type="button" data-action="delete" data-id="${account.id}">🗑 删除账号</button>
          </div>
        </div>
        <button type="button" data-action="detail" data-id="${account.id}">详情</button>
      </td>
    </tr>
  `;
}

function renderStatusSelect(account) {
  const status = statusOptions.includes(account.status) ? account.status : 'unregistered';
  const options = statusOptions.map((value) => `
    <option class="${escapeHtml(value)}" value="${value}" ${value === status ? 'selected' : ''}>${statusLabels[value]}</option>
  `).join('');
  const breakerBadge = account.circuit_breaker_at ? '<span class="breaker-badge">已熔断</span>' : '';
  return `
    <div class="status-cell">
      <select class="status-select ${escapeHtml(status)}" data-id="${account.id}" aria-label="修改账号状态">
        ${options}
      </select>
      ${renderOperationFailure(account)}
      ${breakerBadge}
    </div>
  `;
}

function operationFailureLabel(account) {
  const lastError = String(account?.last_error || '');
  if (/2FA补号失败|2FA.*REPLACE_FAILED/i.test(lastError)) return '2FA补号失败';
  if (/协议补号失败|PROTOCOL_REPLACE_FAILED/i.test(lastError)) return '协议补号失败';
  if (/补号失败|REPLACE_FAILED/i.test(lastError)) return '补号失败';
  if (/查询 Plus失败|Plus 状态查询失败/i.test(lastError)) return '查询 Plus 失败';
  if (/一键验活失败/i.test(lastError)) return '一键验活失败';
  if (/协议注册失败|PROTOCOL_REGISTER_FAILED/i.test(lastError)) return '协议注册失败';
  if (/注册失败|REGISTER_FAILED/i.test(lastError)) return '注册失败';
  if (/2FA登录失败|LOGIN_2FA_FAILED/i.test(lastError)) return '2FA登录失败';
  if (/获取 JSON失败|JSON_FETCH_FAILED/i.test(lastError)) return '获取 JSON失败';
  if (String(account?.sms_last_error || '').trim()) return '获取验证码失败';
  return lastError.trim() ? '操作失败' : '';
}

function renderOperationFailure(account) {
  const label = operationFailureLabel(account);
  return label ? `<div class="operation-failure">${escapeHtml(label)}</div>` : '';
}

function renderActivationMethodSelect(account) {
  const current = String(account.activation_method || '').trim();
  const matchedMethod = state.activationMethods.find((method) => method.name.toLowerCase() === current.toLowerCase());
  const selectedValue = matchedMethod?.name || current;
  const options = [
    '<option value="">未设置</option>',
    ...(current && !matchedMethod
      ? [`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}（历史值）</option>`]
      : []),
    ...state.activationMethods.map((method) => `
      <option value="${escapeHtml(method.name)}" ${method.name === selectedValue ? 'selected' : ''}>${escapeHtml(method.name)}</option>
    `),
  ].join('');
  return `
    <select class="activation-method-select" data-id="${account.id}" aria-label="修改开通方式">
      ${options}
    </select>
  `;
}

function renderEmailField(account) {
  return `
    ${renderWrappedField(account?.email, { className: 'email-main field-raw' })}
    <div><button class="copy-field-button registration-token-button" type="button" data-action="copy-registration-token" data-id="${account.id}">复制 AT</button></div>
  `;
}

function renderWrappedField(value, options = {}) {
  const rawText = String(value || '-');
  const className = ['wrapped-field-text', options.className].filter(Boolean).join(' ');
  return `
    <span class="wrapped-field" title="${escapeHtml(rawText)}">
      <span class="${escapeHtml(className)}">${escapeHtml(rawText)}</span>
    </span>
  `;
}

function renderLimitedField(account, field, value, options = {}) {
  const rawText = String(value || '-');
  const maxLength = tableFieldLimits[field] || compactFieldPreviewLength;
  const isEmpty = rawText === '-';
  const isLong = !isEmpty && rawText.length > maxLength;
  const text = isLong ? `${rawText.slice(0, maxLength)}...` : rawText;
  const className = ['limited-field-text', options.className].filter(Boolean).join(' ');
  const copyButton = isLong
    ? `<button class="copy-field-button" type="button" data-action="copy-field" data-id="${account.id}" data-field="${escapeHtml(field)}">复制</button>`
    : '';

  return `
    <span class="limited-field" title="${escapeHtml(rawText)}">
      <span class="${escapeHtml(className)}">${escapeHtml(text)}</span>
      ${copyButton}
    </span>
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
  document.querySelectorAll('.status-select').forEach((select) => {
    select.addEventListener('change', () => changeStatus(Number(select.dataset.id), select.value, select));
  });
  document.querySelectorAll('.activation-method-select').forEach((select) => {
    select.addEventListener('change', () => changeActivationMethod(Number(select.dataset.id), select.value, select));
  });
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handleAction(button.dataset.action, Number(button.dataset.id), button.dataset);
      closeOpenMenus();
    });
  });
}

async function handleAction(action, id, dataset = {}) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;
  if (action === 'edit') return openAccountDialog(account);
  if (action === 'detail') return openDetail(account);
  if (action === 'status') return openStatusDialog(account);
  if (action === 'delete') return deleteAccount(account);
  if (action === 'sms') return fetchSmsCode(account);
  if (action === 'json') return fetchJson(account);
  if (action === 'register') return registerAccount(account);
  if (action === 'register-protocol') return registerProtocolAccount(account);
  if (action === 'replace-2fa-protocol') return replaceAccountWith2FAProtocol(account);
  if (action === 'replace') return replaceAccount(account);
  if (action === 'replace-2fa') return replaceAccountWith2FA(account);
  if (action === 'login-2fa') return loginAccountWith2FA(account);
  if (action === 'reset-circuit-breaker') return resetCircuitBreaker(account);
  if (action === 'toggle-public-code') return togglePublicCode(account);
  if (action === 'copy-public-code-url') return copyPublicCodeUrl(account);
  if (action === 'copy-field') return copyAccountField(account, dataset.field);
  if (action === 'copy-registration-token') return copyRegistrationToken(account);
}

function openAccountDialog(account = null) {
  const form = $('#accountForm');
  form.reset();
  $('#dialogTitle').textContent = account ? '编辑账号' : '新增账号';
  renderActivationMethodOptions(account?.activation_method || '');
  for (const field of ['id', 'email', 'phone', 'sms_api', 'email_code_api', 'codex_2fa', 'password', 'activation_method', 'activated_at', 'status', 'remark']) {
    form.elements[field].value = account?.[field] || (field === 'status' ? 'unregistered' : '');
  }
  form.elements.public_code_enabled.checked = Boolean(Number(account?.public_code_enabled || 0));
  form.elements.public_code_key.value = account?.public_code_key || '';
  $('#accountDialog').showModal();
}

function renderActivationMethodOptions(selectedValue = '') {
  const select = document.querySelector('#accountForm select[name="activation_method"]');
  if (!select) return;
  const current = String(selectedValue || '').trim();
  const matchedMethod = state.activationMethods.find((method) => method.name.toLowerCase() === current.toLowerCase());
  const options = [
    '<option value="">未设置</option>',
    ...(current && !matchedMethod
      ? [`<option value="${escapeHtml(current)}">${escapeHtml(current)}（历史值）</option>`]
      : []),
    ...state.activationMethods.map((method) => `<option value="${escapeHtml(method.name)}">${escapeHtml(method.name)}</option>`),
  ];
  select.innerHTML = options.join('');
  select.value = matchedMethod?.name || current;
}

function openActivationMethodDialog() {
  renderActivationMethodList();
  $('#activationMethodDialog').showModal();
}

function renderActivationMethodList() {
  const list = $('#activationMethodList');
  if (!list) return;
  list.innerHTML = state.activationMethods.length
    ? state.activationMethods.map((method) => `<li>${escapeHtml(method.name)}</li>`).join('')
    : '<li class="muted">暂无开通方式</li>';
}

async function saveActivationMethod(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  try {
    await api('/replacement-activation-methods', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    form.reset();
    await loadActivationMethods();
    renderAccounts();
    addActivity('新增开通方式', name);
    toast('开通方式已新增');
  } catch (error) {
    toast(error.message);
  }
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

async function copyAccountField(account, field) {
  const value = account?.[field];
  const text = String(value || '');
  if (!text) {
    toast('该字段为空，无法复制');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    addActivity('复制列表字段', `${account.email}: ${field}`);
    toast('字段完整内容已复制');
  } catch (error) {
    prompt('复制字段完整内容', text);
  }
}

async function copyRegistrationToken(account) {
  try {
    const result = await api(`/replacement-accounts/${account.id}/registration-token`);
    const token = String(result.token || '').trim();
    if (!token) {
      toast('AT 未找到');
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      addActivity('复制 AT', account.email);
      toast('AT 已复制');
    } catch {
      prompt('复制 AT', token);
    }
  } catch (error) {
    toast(/AT 未找到/.test(error.message) ? 'AT 未找到' : error.message);
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
  form.elements.status.value = account.status === 'replacing' ? 'registered' : account.status;
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

function applyStatusSelectClass(select, status) {
  if (!select) return;
  statusOptions.forEach((value) => select.classList.remove(value));
  select.classList.add(statusOptions.includes(status) ? status : 'unregistered');
}

async function changeStatus(id, status, select = null) {
  const account = state.accounts.find((item) => item.id === id);
  const previousStatus = account?.status || 'unregistered';
  applyStatusSelectClass(select, status);
  if (account) account.status = status;
  try {
    await api(`/replacement-accounts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    addActivity('状态已更新', `ID ${id} -> ${statusLabels[status] || status}`);
    await loadAccounts();
  } catch (error) {
    toast(error.message);
    if (account) account.status = previousStatus;
    renderAccounts();
  }
}

async function changeActivationMethod(id, activationMethod, select = null) {
  const account = state.accounts.find((item) => item.id === id);
  const previousMethod = account?.activation_method || '';
  if (account) account.activation_method = activationMethod || null;
  try {
    await api(`/replacement-accounts/${id}/activation-method`, {
      method: 'PATCH',
      body: JSON.stringify({ activation_method: activationMethod }),
    });
    addActivity('开通方式已更新', `ID ${id} -> ${activationMethod || '未设置'}`);
    await loadAccounts();
  } catch (error) {
    toast(error.message);
    if (account) account.activation_method = previousMethod || null;
    if (select) select.value = previousMethod;
    renderAccounts();
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

async function replaceAccountWith2FA(account) {
  try {
    await api(`/replacement-accounts/${account.id}/replace-2fa`, { method: 'POST' });
    addActivity('2FA补号成功', account.email);
    await loadAccounts();
  } catch (error) {
    addActivity('2FA补号失败', account.email);
    toast(error.message);
    await loadAccounts();
  }
}

async function replaceAccountWith2FAProtocol(account) {
  if (protocolReplacementRunning) {
    toast('已有协议补号正在执行');
    return;
  }

  protocolReplacementRunning = true;
  addActivity('协议补号已启动', account.email);
  resetProtocolReplacementLiveLog(account);
  toast('协议补号已启动，等待 CPA 生成和上传');
  try {
    await streamProtocolReplacement(account);
    addActivity('协议补号成功', account.email);
    toast('协议补号完成，CPA 已上传并通过健康复查');
    await loadAccounts();
  } catch (error) {
    addActivity('协议补号失败', account.email);
    toast(error.message);
    await loadAccounts();
  } finally {
    protocolReplacementRunning = false;
  }
}

async function loginAccountWith2FA(account) {
  try {
    await api(`/replacement-accounts/${account.id}/login-2fa`, { method: 'POST' });
    addActivity('2FA登录成功', account.email);
    toast('已完成 2FA 登录，凭证文件已生成');
    await loadAccounts();
  } catch (error) {
    addActivity('2FA登录失败', account.email);
    toast(error.message);
    await loadAccounts();
  }
}

async function resetCircuitBreaker(account) {
  if (!confirm(`确认解除 ${account.email} 的补号熔断？将清零连续失败次数，账号状态保持不变。`)) return;
  try {
    await api(`/replacement-accounts/${account.id}/circuit-breaker/reset`, { method: 'PATCH' });
    addActivity('解除熔断', account.email);
    toast('已解除熔断');
    await loadAccounts();
  } catch (error) {
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

async function registerProtocolAccount(account) {
  try {
    await api(`/replacement-accounts/${account.id}/register-protocol`, { method: 'POST' });
    toast('协议注册已加入队列');
    await loadProtocolRegistrationQueue();
  } catch (error) {
    toast(error.message);
  }
}

function renderProtocolQueueState(accountId) {
  const current = state.protocolRegistrationQueue.current;
  if (current?.account?.id === accountId) return '<div class="muted">协议注册：注册中</div>';
  if (state.protocolRegistrationQueue.waiting.some((job) => job.account?.id === accountId)) return '<div class="muted">协议注册：排队中</div>';
  return '';
}

async function loadProtocolRegistrationQueue() {
  try {
    const queue = await api('/protocol-registration-queue');
    const completedJobs = (queue.recent || []).filter((job) => (
      (job.state === 'succeeded' || job.state === 'failed')
      && !state.seenProtocolRegistrationTerminalJobs.has(job.id)
    ));
    completedJobs.forEach((job) => state.seenProtocolRegistrationTerminalJobs.add(job.id));
    state.protocolRegistrationQueue = queue;
    renderProtocolRegistrationQueue();
    renderCurrentProtocolRegistrationLog();
    if (completedJobs.length) await loadAccounts();
    else renderAccounts();
    const hasJobs = queue.current || queue.waiting?.length;
    if (hasJobs && !protocolRegistrationQueueTimer) {
      protocolRegistrationQueueTimer = setInterval(loadProtocolRegistrationQueue, 2000);
    } else if (!hasJobs && protocolRegistrationQueueTimer) {
      clearInterval(protocolRegistrationQueueTimer);
      protocolRegistrationQueueTimer = null;
    }
  } catch (error) {
    console.error('加载协议注册队列失败', error);
  }
}

function renderProtocolRegistrationQueue() {
  const queue = state.protocolRegistrationQueue;
  $('#protocolRegistrationQueueSummary').textContent = `执行中 ${queue.current ? 1 : 0} · 等待 ${queue.waiting?.length || 0} · 最近 ${queue.recent?.length || 0}`;
  const items = [
    ...(queue.current ? [{ ...queue.current, label: '注册中' }] : []),
    ...(queue.waiting || []).map((job, index) => ({ ...job, label: `排队中（${index + 1}）` })),
    ...(queue.recent || []).map((job) => ({ ...job, label: job.state === 'succeeded' ? '完成' : '失败' })),
  ];
  $('#protocolRegistrationQueueList').innerHTML = items.length
    ? items.map((job) => `<div class="progress-log-entry ${job.state === 'failed' ? 'error' : ''}">${escapeHtml(job.label)} · ${escapeHtml(job.account.email)}（ID: ${job.account.id}）</div>`).join('')
    : '<div class="muted">暂无协议注册任务</div>';
}

function renderCurrentProtocolRegistrationLog() {
  const queue = state.protocolRegistrationQueue;
  const job = queue.current || queue.recent?.[0];
  if (!job) {
    clearProtocolLiveLog();
    return;
  }

  const isCurrent = job === queue.current;
  const outcome = job.state === 'failed' ? '失败' : job.state === 'succeeded' ? '完成' : '注册中';
  $('#protocolLiveAccount').textContent = `${isCurrent ? '当前账号' : '最近账号'}：${job.account.email}（ID: ${job.account.id}）`;
  setProtocolLiveSummary(`协议注册${outcome}`, job.state === 'failed' ? 'error' : job.state === 'succeeded' ? 'success' : 'muted');
  $('#protocolLiveLog').innerHTML = (job.logs || []).map((log) => (
    `<div class="progress-log-entry ${escapeHtml(log.level)}">${escapeHtml(log.message)}</div>`
  )).join('') || '<div class="muted">暂无日志输出</div>';
}

async function clearProtocolRegistrationQueue() {
  await api('/protocol-registration-queue', { method: 'DELETE' });
  await loadProtocolRegistrationQueue();
}

async function healthcheckBannedAccounts() {
  const selectedStatus = $('#statusFilter').value;
  const healthcheckStatuses = new Set(['registered', 'plus_active', 'cpa_mounted', 'for_sale', 'sold']);
  const hasEligibleSelection = healthcheckStatuses.has(selectedStatus);
  const targetDescription = hasEligibleSelection
    ? `当前筛选的“${statusLabels[selectedStatus]}”状态`
    : 'registered、plus_active、cpa_mounted、for_sale、sold 状态';
  if (!confirm(`确认对${targetDescription}账号执行一键验活？只查询已配置 email_code_api 的账号，未配置的账号会跳过。`)) return;
  await runProgressAction({
    title: '一键验活进度',
    endpoint: hasEligibleSelection
      ? `/replacement-accounts/healthcheck-banned?status=${encodeURIComponent(selectedStatus)}`
      : '/replacement-accounts/healthcheck-banned',
    activityTitle: '一键验活',
    formatSummary: (result) => `检测 ${result.checked || 0} 个，新封禁 ${result.banned || 0} 个，未命中 ${result.clean || 0} 个，跳过 ${result.skipped || 0} 个，失败 ${result.failed || 0} 个`,
  });
}

async function checkPlusStatusAccounts() {
  if (!confirm('确认只查询当前“已注册”且配置 email_code_api 的账号 Plus 状态吗？未配置的账号会跳过。')) return;
  await runProgressAction({
    title: '查询 Plus 状态进度',
    endpoint: '/replacement-accounts/check-plus-status',
    activityTitle: '查询 Plus 状态',
    formatSummary: (result) => `查询 ${result.checked || 0} 个，Plus ${result.plus || 0} 个，仍为已注册 ${result.registered || 0} 个，跳过 ${result.skipped || 0} 个，失败 ${result.failed || 0} 个`,
  });
}

async function runProgressAction({ title, endpoint, activityTitle, formatSummary }) {
  if (progressActionRunning) {
    toast('已有批量查询正在执行');
    return;
  }
  progressActionRunning = true;
  showProgressDialog(title);
  try {
    const result = await streamProgress(endpoint);
    const detail = formatSummary(result);
    $('#progressSummary').textContent = detail;
    appendProgressLog(detail, 'success');
    addActivity(activityTitle, detail);
    toast(detail);
    await loadAccounts();
  } catch (error) {
    $('#progressSummary').textContent = '执行失败';
    appendProgressLog(`执行失败：${error.message}`, 'error');
    addActivity(`${activityTitle}失败`, error.message);
    toast(error.message);
    await loadAccounts();
  } finally {
    progressActionRunning = false;
  }
}

function showProgressDialog(title) {
  $('#progressTitle').textContent = title;
  $('#progressSummary').textContent = '正在连接服务...';
  $('#progressLog').innerHTML = '';
  const dialog = $('#progressDialog');
  if (!dialog.open) dialog.showModal();
}

async function streamProgress(endpoint) {
  return streamEventStream(endpoint, handleProgressEvent);
}

async function streamProtocolRegistration(account) {
  return streamEventStream(
    `/replacement-accounts/${account.id}/register-protocol`,
    handleProtocolLiveEvent,
  );
}

async function streamProtocolReplacement(account) {
  return streamEventStream(
    `/replacement-accounts/${account.id}/replace-2fa-protocol`,
    handleProtocolReplacementLiveEvent,
  );
}

async function streamEventStream(endpoint, handleEvent) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || `请求失败：${response.status}`);
  }
  if (!response.body) throw new Error('浏览器不支持实时进度流');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const event = parseProgressFrame(frame);
      if (!event) continue;
      handleEvent(event);
      if (event.type === 'complete') result = event.result;
    }
    if (done) break;
  }
  const lastEvent = parseProgressFrame(buffer);
  if (lastEvent) {
    handleEvent(lastEvent);
    if (lastEvent.type === 'complete') result = lastEvent.result;
  }
  if (!result) throw new Error('进度流未正常完成');
  return result;
}

function parseProgressFrame(frame) {
  const data = frame.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!data) return null;
  return JSON.parse(data);
}

function handleProgressEvent(event) {
  if (event.type === 'start') {
    $('#progressSummary').textContent = event.message;
    appendProgressLog(event.message);
    return;
  }
  if (event.type === 'account-start' || event.type === 'account-step') {
    appendProgressLog(`${event.email}：${event.message}`);
    return;
  }
  if (event.type === 'account-result') {
    const level = ['plus', 'banned'].includes(event.outcome)
      ? 'success'
      : event.outcome === 'failed' ? 'error' : 'muted';
    appendProgressLog(`${event.email}：${event.message}`, level);
    return;
  }
  if (event.type === 'complete') {
    appendProgressLog(event.message || '执行完成', 'success');
    return;
  }
  if (event.type === 'error') {
    throw new Error(event.message || '执行失败');
  }
}

function handleProtocolLiveEvent(event) {
  if (event.type === 'start') {
    $('#protocolLiveAccount').textContent = `当前账号：${event.email}（ID: ${event.accountId}）`;
    setProtocolLiveSummary(event.message || '协议注册已开始');
    appendProtocolLiveLog(event.message || '协议注册已开始');
    return;
  }
  if (event.type === 'protocol-step') {
    setProtocolLiveSummary(event.message || '协议注册处理中');
    appendProtocolLiveLog(event.message || '协议注册步骤更新');
    return;
  }
  if (event.type === 'protocol-log') {
    const level = event.stream === 'stderr' ? 'error' : 'muted';
    appendProtocolLiveLog(event.text || '', level);
    return;
  }
  if (event.type === 'account-result') {
    const level = event.outcome === 'failed' ? 'error' : 'success';
    setProtocolLiveSummary(event.message || '协议注册完成', level);
    appendProtocolLiveLog(event.message || '协议注册完成', level);
    return;
  }
  if (event.type === 'complete') {
    setProtocolLiveSummary(event.message || '协议注册完成', 'success');
    appendProtocolLiveLog(event.message || '协议注册完成', 'success');
    return;
  }
  if (event.type === 'error') {
    setProtocolLiveSummary('协议注册失败', 'error');
    appendProtocolLiveLog(event.message || '协议注册失败', 'error');
    throw new Error(event.message || '协议注册失败');
  }
}

function handleProtocolReplacementLiveEvent(event) {
  if (event.type === 'start') {
    $('#protocolReplacementLiveAccount').textContent = `当前账号：${event.email}（ID: ${event.accountId}）`;
    setProtocolReplacementLiveSummary(event.message || '协议补号已开始');
    appendProtocolReplacementLiveLog(event.message || '协议补号已开始');
    return;
  }
  if (event.type === 'protocol-step') {
    setProtocolReplacementLiveSummary(event.message || '协议补号处理中');
    appendProtocolReplacementLiveLog(event.message || '协议补号步骤更新');
    return;
  }
  if (event.type === 'protocol-log') {
    const level = event.stream === 'stderr' ? 'error' : 'muted';
    appendProtocolReplacementLiveLog(event.text || '', level);
    return;
  }
  if (event.type === 'account-result') {
    const level = event.outcome === 'failed' ? 'error' : 'success';
    setProtocolReplacementLiveSummary(event.message || '协议补号完成', level);
    appendProtocolReplacementLiveLog(event.message || '协议补号完成', level);
    return;
  }
  if (event.type === 'complete') {
    setProtocolReplacementLiveSummary(event.message || '协议补号完成', 'success');
    appendProtocolReplacementLiveLog(event.message || '协议补号完成', 'success');
    return;
  }
  if (event.type === 'error') {
    setProtocolReplacementLiveSummary('协议补号失败', 'error');
    appendProtocolReplacementLiveLog(event.message || '协议补号失败', 'error');
    throw new Error(event.message || '协议补号失败');
  }
}

function resetProtocolLiveLog(account) {
  $('#protocolLiveAccount').textContent = `当前账号：${account.email}（ID: ${account.id}）`;
  $('#protocolLiveSummary').textContent = '正在连接服务...';
  $('#protocolLiveSummary').className = 'muted';
  $('#protocolLiveLog').innerHTML = '';
}

function clearProtocolLiveLog() {
  $('#protocolLiveAccount').textContent = '当前账号：-';
  $('#protocolLiveSummary').textContent = '暂无当前协议注册任务';
  $('#protocolLiveSummary').className = 'muted';
  $('#protocolLiveLog').innerHTML = '';
}

function resetProtocolReplacementLiveLog(account) {
  $('#protocolReplacementLiveAccount').textContent = `当前账号：${account.email}（ID: ${account.id}）`;
  $('#protocolReplacementLiveSummary').textContent = '正在连接服务...';
  $('#protocolReplacementLiveSummary').className = 'muted';
  $('#protocolReplacementLiveLog').innerHTML = '';
}

function clearProtocolReplacementLiveLog() {
  $('#protocolReplacementLiveAccount').textContent = '当前账号：-';
  $('#protocolReplacementLiveSummary').textContent = '暂无当前协议补号任务';
  $('#protocolReplacementLiveSummary').className = 'muted';
  $('#protocolReplacementLiveLog').innerHTML = '';
}

function setProtocolLiveSummary(message, level = 'muted') {
  const summary = $('#protocolLiveSummary');
  summary.textContent = message;
  summary.className = level === 'muted' ? 'muted' : `protocol-live-summary ${level}`;
}

function appendProtocolLiveLog(message, level = 'info') {
  const log = $('#protocolLiveLog');
  const entry = document.createElement('div');
  entry.className = `progress-log-entry ${level}`;
  entry.textContent = `[${new Date().toLocaleTimeString('zh-CN')}] ${message}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function setProtocolReplacementLiveSummary(message, level = 'muted') {
  const summary = $('#protocolReplacementLiveSummary');
  summary.textContent = message;
  summary.className = level === 'muted' ? 'muted' : `protocol-live-summary ${level}`;
}

function appendProtocolReplacementLiveLog(message, level = 'info') {
  const log = $('#protocolReplacementLiveLog');
  const entry = document.createElement('div');
  entry.className = `progress-log-entry ${level}`;
  entry.textContent = `[${new Date().toLocaleTimeString('zh-CN')}] ${message}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function appendProgressLog(message, level = 'info') {
  const log = $('#progressLog');
  const entry = document.createElement('div');
  entry.className = `progress-log-entry ${level}`;
  entry.textContent = `[${new Date().toLocaleTimeString('zh-CN')}] ${message}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

async function batchReplace() {
  const candidates = selectedAccounts().length
    ? selectedAccounts()
    : state.accounts.filter((account) => ['banned', 'for_sale', 'registered', 'pending_activation', 'plus_active'].includes(account.status));
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
  $('#statActive').textContent = counts.plus_active || 0;
  $('#statBanned').textContent = counts.banned || 0;
  $('#statReplaced').textContent = state.accounts.reduce((sum, account) => sum + Number(account.replacement_count || 0), 0);
  renderStatusLegend(counts);
}

function renderStatusLegend(counts) {
  const total = state.accounts.length || 1;
  const colors = {
    plus_active: '#21bf73',
    banned: '#f24e5c',
    cpa_mounted: '#26aebd',
    for_sale: '#2273f5',
    registered: '#4d7cff',
    pending_activation: '#f2a23a',
    unregistered: '#8b9bb4',
    sold: '#7b55e7',
  };
  const statuses = ['unregistered', 'registered', 'pending_activation', 'plus_active', 'cpa_mounted', 'for_sale', 'sold', 'banned'];
  $('#statusLegend').innerHTML = statuses.map((status) => {
    const count = counts[status] || 0;
    const percent = Math.round((count / total) * 1000) / 10;
    return `<li><span><i style="background:${colors[status]}"></i> ${statusLabels[status]}</span><strong>${count} (${percent}%)</strong></li>`;
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
