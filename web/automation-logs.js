const state = {
  runs: [],
  selectedRunId: null,
  selectedRun: null,
  pollingTimer: null,
};

const $ = (selector) => document.querySelector(selector);

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadRuns();
  state.pollingTimer = window.setInterval(refreshSelectedRun, 3000);
});

function bindEvents() {
  $('#refreshButton').addEventListener('click', loadRuns);
  $('#statusFilter').addEventListener('change', renderRuns);
  $('#searchInput').addEventListener('input', renderRuns);
  $('#stopButton').addEventListener('click', stopSelectedRun);
}

async function loadRuns() {
  try {
    const body = await api('/replacement-automation-runs');
    state.runs = body.runs || [];
    renderRuns();
    if (state.selectedRunId) {
      await openRun(state.selectedRunId);
    }
  } catch (error) {
    toast(error.message);
  }
}

function renderRuns() {
  const status = $('#statusFilter').value;
  const keyword = $('#searchInput').value.trim().toLowerCase();
  const filtered = state.runs.filter((run) => {
    const haystack = [run.id, run.email, run.pid, run.status].join(' ').toLowerCase();
    return (!status || run.status === status) && (!keyword || haystack.includes(keyword));
  });

  $('#runsBody').innerHTML = filtered.length
    ? filtered.map(runRow).join('')
    : emptyRunRow();
  $('#totalText').textContent = `共 ${filtered.length} 条`;
  document.querySelectorAll('[data-run-action="open"]').forEach((button) => {
    button.addEventListener('click', () => openRun(Number(button.dataset.id)));
  });
}

function runRow(run) {
  return `
    <tr>
      <td>${run.id}</td>
      <td><div class="email-main">${escapeHtml(run.email)}</div><div class="muted">account_id: ${run.account_id}</div></td>
      <td><span class="status ${statusClass(run.status)}">${escapeHtml(run.status)}</span></td>
      <td>${escapeHtml(run.pid || '-')}</td>
      <td>${escapeHtml(formatDate(run.started_at))}</td>
      <td>${escapeHtml(formatDate(run.finished_at))}</td>
      <td>${escapeHtml(run.exit_code ?? '-')}</td>
      <td><button type="button" data-run-action="open" data-id="${run.id}">查看日志</button></td>
    </tr>
  `;
}

function emptyRunRow() {
  return `
    <tr>
      <td colspan="8" class="empty-table-cell">暂无补号运行日志。触发注册或补号后，这里会显示子进程运行记录。</td>
    </tr>
  `;
}

async function openRun(runId) {
  try {
    const body = await api(`/replacement-automation-runs/${runId}`);
    state.selectedRunId = runId;
    state.selectedRun = body.run;
    $('#detailTitle').textContent = `Run #${body.run.id} - ${body.run.email}`;
    $('#detailMeta').textContent = [
      `状态：${body.run.status}`,
      `PID：${body.run.pid || '-'}`,
      `开始：${formatDate(body.run.started_at)}`,
      `结束：${formatDate(body.run.finished_at)}`,
    ].join(' / ');
    $('#logContent').textContent = body.log || '暂无日志内容';
    $('#stopButton').hidden = body.run.status !== 'running';
  } catch (error) {
    toast(error.message);
  }
}

async function refreshSelectedRun() {
  const hasRunning = state.runs.some((run) => run.status === 'running')
    || state.selectedRun?.status === 'running';
  if (!hasRunning) return;
  await loadRuns();
}

async function stopSelectedRun() {
  if (!state.selectedRunId) return;
  if (!confirm(`确认停止 Run #${state.selectedRunId} 的子进程？`)) return;

  try {
    await api(`/replacement-automation-runs/${state.selectedRunId}/stop`, { method: 'POST' });
    toast('已发送停止请求');
    await loadRuns();
  } catch (error) {
    toast(error.message);
  }
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
  if (status === 'succeeded') return 'replaced';
  if (status === 'failed' || status === 'stopped') return 'failed';
  if (status === 'running') return 'replacing';
  return 'pending';
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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
