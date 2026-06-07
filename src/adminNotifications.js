export function createAdminNotificationRepository(db) {
  return {
    createNotification(input = {}) {
      const now = new Date().toISOString();
      const result = db.prepare(`
        INSERT INTO admin_notifications (
          type,
          severity,
          title,
          message,
          account_id,
          email,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        normalizeOptional(input.type) || 'info',
        normalizeOptional(input.severity) || 'warning',
        normalizeRequired(input.title, 'title is required'),
        normalizeRequired(input.message, 'message is required'),
        normalizeInteger(input.account_id),
        normalizeOptional(input.email),
        now,
      );

      return this.getNotification(result.lastInsertRowid);
    },

    getNotification(id) {
      return db.prepare(`
        SELECT * FROM admin_notifications
        WHERE id = ?
      `).get(Number(id));
    },

    listNotifications(options = {}) {
      const limit = normalizePositiveInteger(options.limit, 10, 50);
      return db.prepare(`
        SELECT * FROM admin_notifications
        ORDER BY id DESC
        LIMIT ?
      `).all(limit);
    },

    countUnread() {
      return db.prepare(`
        SELECT COUNT(*) AS total FROM admin_notifications
        WHERE read_at IS NULL
      `).get().total;
    },

    markRead(id) {
      const existing = this.getNotification(id);
      if (!existing) {
        const error = new Error('notification not found');
        error.code = 'NOTIFICATION_NOT_FOUND';
        throw error;
      }
      const now = existing.read_at || new Date().toISOString();
      db.prepare(`
        UPDATE admin_notifications
        SET read_at = ?
        WHERE id = ?
      `).run(now, existing.id);
      return this.getNotification(existing.id);
    },
  };
}

function normalizeRequired(value, message) {
  const normalized = normalizeOptional(value);
  if (!normalized) throw new Error(message);
  return normalized;
}

function normalizeOptional(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizePositiveInteger(value, defaultValue, maxValue) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return defaultValue;
  return Math.min(number, maxValue);
}
