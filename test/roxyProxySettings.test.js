import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDatabase } from '../src/db.js';
import { createRoxyProxySettingsRepository } from '../src/roxyProxySettings.js';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-roxy-proxy-settings-'));
  return createDatabase(join(dir, 'test.db'));
}

function createRepository(options = {}) {
  return createRoxyProxySettingsRepository(createTestDb(), {
    env: { ROXY_PROXY_SETTINGS_KEY: TEST_KEY },
    ...options,
  });
}

const templateInput = {
  workspaceId: 1,
  host: 'us.arxlabs.io',
  port: '3010',
  accountPrefix: 'sttj1150537',
  password: 'proxy-password',
  country: 'JP',
  ttlMinutes: 5,
  protocol: 'SOCKS5',
  ipType: 'IPV4',
  checkChannel: 'default',
  refreshUrl: 'https://proxy.example.invalid/refresh',
  remark: 'Japan rotation',
};

test('database initializes Roxy proxy template and binding tables', () => {
  const db = createTestDb();
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('roxy_proxy_templates', 'roxy_browser_proxy_bindings')
    ORDER BY name
  `).all();

  assert.deepEqual(tables.map((table) => table.name), [
    'roxy_browser_proxy_bindings',
    'roxy_proxy_templates',
  ]);
});

test('template settings store an encrypted password but public reads never expose it', () => {
  const db = createTestDb();
  const repo = createRoxyProxySettingsRepository(db, {
    env: { ROXY_PROXY_SETTINGS_KEY: TEST_KEY },
  });

  const saved = repo.saveRoxyProxyTemplate(templateInput);
  const stored = db.prepare('SELECT encrypted_password FROM roxy_proxy_templates WHERE id = 1').get();
  const publicTemplate = repo.getRoxyProxyTemplate();

  assert.equal(saved.passwordConfigured, true);
  assert.equal(publicTemplate.passwordConfigured, true);
  assert.equal(Object.hasOwn(publicTemplate, 'password'), false);
  assert.equal(Object.hasOwn(publicTemplate, 'encrypted_password'), false);
  assert.equal(JSON.stringify(publicTemplate).includes(templateInput.password), false);
  assert.notEqual(stored.encrypted_password, templateInput.password);
  assert.match(stored.encrypted_password, /^v1:/);
});

test('empty password preserves the existing encrypted password while other template fields update', () => {
  const repo = createRepository();
  repo.saveRoxyProxyTemplate(templateInput);

  const updated = repo.saveRoxyProxyTemplate({
    ...templateInput,
    host: 'new.arxlabs.io',
    password: '',
  });
  const credentials = repo.getRoxyProxyTemplateCredentials();

  assert.equal(updated.host, 'new.arxlabs.io');
  assert.equal(updated.passwordConfigured, true);
  assert.equal(credentials.password, 'proxy-password');
});

test('saving a non-empty password requires a valid dedicated encryption key', () => {
  const repo = createRepository({ env: {} });

  assert.throws(
    () => repo.saveRoxyProxyTemplate(templateInput),
    /ROXY_PROXY_SETTINGS_KEY_INVALID/,
  );
});

test('saving a password rejects malformed Base64 encryption keys without writing a template', () => {
  for (const invalidKey of [
    `${TEST_KEY}!`,
    `${TEST_KEY} `,
    TEST_KEY.slice(0, -1),
    Buffer.alloc(31, 7).toString('base64'),
  ]) {
    const db = createTestDb();
    const repo = createRoxyProxySettingsRepository(db, {
      env: { ROXY_PROXY_SETTINGS_KEY: invalidKey },
    });

    assert.throws(
      () => repo.saveRoxyProxyTemplate(templateInput),
      /ROXY_PROXY_SETTINGS_KEY_INVALID/,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM roxy_proxy_templates').get().count,
      0,
    );
  }
});

test('template validation requires Roxy workspace and proxy check channel', () => {
  const repo = createRepository();

  assert.throws(
    () => repo.saveRoxyProxyTemplate({ ...templateInput, workspaceId: 0 }),
    /WORKSPACE_ID_INVALID/,
  );
  assert.throws(
    () => repo.saveRoxyProxyTemplate({ ...templateInput, checkChannel: '' }),
    /CHECK_CHANNEL_REQUIRED/,
  );
});

test('bindings are unique by dirId and refresh updates only the target binding', () => {
  const repo = createRepository();
  const first = repo.upsertRoxyProxyBinding({
    dirId: 'dir-first',
    proxyId: 12,
    sortNum: 1,
    windowName: 'first window',
    templateId: 1,
  });
  const second = repo.upsertRoxyProxyBinding({
    dirId: 'dir-second',
    proxyId: 13,
    sortNum: 2,
    windowName: 'second window',
    templateId: 1,
  });

  const updated = repo.upsertRoxyProxyBinding({
    dirId: 'dir-first',
    proxyId: 14,
    sortNum: 3,
    windowName: 'first renamed',
    templateId: 1,
  });
  repo.recordRoxyProxyRefresh('dir-first', {
    username: 'sttj1150537-region-JP-sid-Abc123Xy-t-5',
    ip: '203.0.113.10',
    refreshedAt: '2026-07-30T12:00:00.000Z',
  });

  const bindings = repo.listRoxyProxyBindings();
  const refreshed = bindings.find((binding) => binding.dirId === 'dir-first');
  const untouched = bindings.find((binding) => binding.dirId === 'dir-second');

  assert.equal(first.dirId, 'dir-first');
  assert.equal(second.dirId, 'dir-second');
  assert.equal(updated.proxyId, 14);
  assert.equal(refreshed.lastGeneratedUsername, 'sttj1150537-region-JP-sid-Abc123Xy-t-5');
  assert.equal(refreshed.lastRefreshIp, '203.0.113.10');
  assert.equal(refreshed.lastRefreshedAt, '2026-07-30T12:00:00.000Z');
  assert.equal(untouched.proxyId, 13);
  assert.equal(untouched.lastGeneratedUsername, null);
  assert.equal(bindings.length, 2);

  repo.deleteRoxyProxyBinding('dir-first');
  assert.deepEqual(repo.listRoxyProxyBindings().map((binding) => binding.dirId), ['dir-second']);
});
