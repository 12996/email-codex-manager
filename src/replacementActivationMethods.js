export const DEFAULT_ACTIVATION_METHODS = Object.freeze([
  '越南直卡',
  'upi',
  'ideal',
  '波兰',
  '瑞士',
  'pix 直卡',
]);

export function createReplacementActivationMethodRepository(db) {
  return {
    listMethods() {
      return db.prepare(`
        SELECT id, name, created_at, updated_at
        FROM replacement_activation_methods
        ORDER BY id ASC
      `).all();
    },

    createMethod(input) {
      const name = normalizeRequired(input?.name);
      if (this.hasMethod(name)) {
        throw codedError('ACTIVATION_METHOD_DUPLICATE', 'activation method already exists');
      }

      const now = new Date().toISOString();
      const result = db.prepare(`
        INSERT INTO replacement_activation_methods (name, created_at, updated_at)
        VALUES (?, ?, ?)
      `).run(name, now, now);
      return db.prepare(`
        SELECT id, name, created_at, updated_at
        FROM replacement_activation_methods
        WHERE id = ?
      `).get(result.lastInsertRowid);
    },

    hasMethod(value) {
      const name = normalizeOptional(value);
      if (!name) return true;
      return Boolean(db.prepare(`
        SELECT id
        FROM replacement_activation_methods
        WHERE lower(trim(name)) = lower(trim(?))
        LIMIT 1
      `).get(name));
    },
  };
}

export function activationMethodError(code, message) {
  return codedError(code, message);
}

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function normalizeRequired(value) {
  const name = normalizeOptional(value);
  if (!name) {
    throw codedError('ACTIVATION_METHOD_REQUIRED', 'activation method name is required');
  }
  return name;
}

function normalizeOptional(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}
