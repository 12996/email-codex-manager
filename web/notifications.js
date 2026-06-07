(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const bell = document.getElementById('notificationBell');
    const panel = document.getElementById('notificationPanel');
    if (!bell || !panel) return;

    bell.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) loadNotifications();
    });
    document.addEventListener('click', (event) => {
      if (panel.hidden || bell.contains(event.target) || panel.contains(event.target)) return;
      panel.hidden = true;
    });
    panel.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-notification-read]');
      if (!button) return;
      await markNotificationRead(button.dataset.notificationRead);
      await loadNotifications();
    });

    loadNotifications();
  });

  async function loadNotifications() {
    const badge = document.getElementById('notificationCount');
    const list = document.getElementById('notificationList');
    if (!badge || !list) return;
    try {
      const body = await notificationApi('/admin-notifications?limit=5');
      const count = Number(body.unreadCount || 0);
      badge.textContent = String(count);
      badge.hidden = count <= 0;
      list.innerHTML = renderNotifications(body.notifications || []);
    } catch {
      badge.hidden = true;
      list.innerHTML = '<li><span>通知加载失败</span></li>';
    }
  }

  async function markNotificationRead(id) {
    await notificationApi(`/admin-notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
  }

  async function notificationApi(path, options = {}) {
    const response = await fetch(path, {
      headers: { 'content-type': 'application/json' },
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.message || 'notification request failed');
    return body;
  }

  function renderNotifications(notifications) {
    if (!notifications.length) return '<li><span>暂无通知</span></li>';
    return notifications.map((item) => `
      <li class="${item.read_at ? '' : 'unread'}">
        <span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.message)}</small>
        </span>
        ${item.read_at ? '' : `<button type="button" data-notification-read="${item.id}">已读</button>`}
      </li>
    `).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}());
