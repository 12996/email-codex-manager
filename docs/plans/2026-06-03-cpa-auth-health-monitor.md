# CPA Auth Health Monitor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local monitor that polls CPA credential status every 10 minutes, detects expired/unavailable credentials by account email, queues matched replacement accounts, runs at most one replacement at a time, uploads the generated CPA auth file, and verifies the credential returns to a healthy state.

**Architecture:** Add a small CPA management client, a pure health classifier, and a monitor/queue service that can run once or on an interval. The monitor reads `/v0/management/auth-files`, groups credentials by `provider + email`, conservatively marks unhealthy credentials, enqueues matching replacement accounts, then drains the queue with a single-flight worker because RoxyBrowser/OAuth automation can only replace one account at a time. After replacement succeeds locally, upload `src/auto/product_files/cpa/<email>.json` to CPA and re-check `/auth-files` before considering the credential repaired.

**Tech Stack:** Node.js ESM, Express, built-in `node:test`, existing SQLite repositories, CPA management API (`GET /auth-files`, later optional `POST /auth-files`).

---

## Assumptions

- `.env` contains a valid CPA management URL and plaintext management key:
  - `CPA_URL`
  - `CPA_MANAGEMENT_KEY`
- CPA returns `GET /v0/management/auth-files` records with `email`, `provider`, `status`, `status_message`, `disabled`, `unavailable`, `success`, `failed`, and `recent_requests`.
- Replacement accounts are keyed by email in `replacement_accounts.email`.
- The OAuth subprocess currently only generates local CPA JSON under `src/auto/product_files/cpa/<email>.json`; the monitor must add CPA upload as part of the repair flow.
- The replacement subprocess is single-resource automation. The daemon must never run multiple replacements concurrently.

## Desired Behavior

- Manual health check endpoint returns CPA auth status without exposing secrets.
- Optional daemon runs every 10 minutes when enabled.
- Monitor classifies CPA credentials into explicit categories by email:
  - `healthy`: credential can stay untouched.
  - `disabled`: credential is manually/runtime disabled; report it but do not auto-replace unless later explicitly enabled by config.
  - `auth_expired`: OAuth/token/authentication is invalid and can trigger replacement.
  - `quota_limited`: usage quota is exhausted; do not trigger replacement.
  - `unknown_error`: error is not classified; report it and skip automatic replacement by default.
- Monitor detects replacement-worthy credentials only when the category is `auth_expired`.
- Raw signals:
  - `disabled === true`
  - `unavailable === true`
  - `status !== "ready"`
  - `status_message` contains `authentication_error`, `auth_unavailable`, `expired`, `invalidated`, `invalid token`, `unauthorized`, `refresh`, `login`, or `token`
  - `status_message` contains `usage_limit_reached` or field `next_retry_after` exists -> classify as `quota_limited`, not `auth_expired`.
  - optional future rule: last N request buckets are all failed and have no success
- Monitor only enqueues replacement when category is `auth_expired`, a matching replacement account exists, and the account is not already `replacing`.
- `quota_limited`, `disabled`, and `unknown_error` are returned in API/daemon logs but skipped by the queue.
- A single queue worker drains one account at a time; new monitor ticks only add missing pending jobs and do not start parallel subprocesses.
- Replacement success means three steps succeed: OAuth subprocess exits `0`, generated CPA JSON is uploaded to CPA, and a follow-up `/auth-files` check no longer reports that email as unhealthy.
- Monitor records enough result data for debugging: email, provider, reason, matched account id, queue status, upload status, replacement result.
- Do not log or return `CPA_MANAGEMENT_KEY`.

---

### Task 1: Add CPA runtime configuration

**Files:**
- Modify: `src/config.js`
- Test: `test/cpaConfig.test.js`

**Step 1: Write the failing test**

Create `test/cpaConfig.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCpaConfig } from '../src/config.js';

test('normalizeCpaConfig builds auth-files URL and interval defaults', () => {
  const result = normalizeCpaConfig({
    CPA_URL: 'http://localhost:8317',
    CPA_MANAGEMENT_KEY: 'secret',
  });

  assert.equal(result.baseUrl, 'http://localhost:8317');
  assert.equal(result.authFilesUrl, 'http://localhost:8317/v0/management/auth-files');
  assert.equal(result.managementKey, 'secret');
  assert.equal(result.monitorEnabled, false);
  assert.equal(result.monitorIntervalMs, 10 * 60 * 1000);
});

test('normalizeCpaConfig accepts CPA_URL that already points at management base', () => {
  const result = normalizeCpaConfig({
    CPA_URL: 'http://localhost:8317/v0/management/',
    CPA_MANAGEMENT_KEY: 'secret',
    CPA_HEALTH_MONITOR_ENABLED: 'true',
    CPA_HEALTH_MONITOR_INTERVAL_MS: '60000',
  });

  assert.equal(result.authFilesUrl, 'http://localhost:8317/v0/management/auth-files');
  assert.equal(result.monitorEnabled, true);
  assert.equal(result.monitorIntervalMs, 60000);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/cpaConfig.test.js
```

Expected: FAIL because `normalizeCpaConfig` is not exported.

**Step 3: Implement minimal config**

In `src/config.js`, export `normalizeCpaConfig(env = process.env)` and add `cpa` to `config`:

```js
export function normalizeCpaConfig(env = process.env) {
  const baseUrl = String(env.CPA_URL || '').trim().replace(/\/+$/, '');
  const managementKey = String(env.CPA_MANAGEMENT_KEY || '').trim();
  const managementBase = baseUrl.endsWith('/v0/management') ? baseUrl : `${baseUrl}/v0/management`;
  return {
    baseUrl,
    managementKey,
    authFilesUrl: baseUrl ? `${managementBase}/auth-files` : '',
    monitorEnabled: String(env.CPA_HEALTH_MONITOR_ENABLED || 'false') === 'true',
    monitorIntervalMs: Number(env.CPA_HEALTH_MONITOR_INTERVAL_MS || 10 * 60 * 1000),
  };
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- test/cpaConfig.test.js
```

Expected: PASS.

---

### Task 2: Add CPA management client

**Files:**
- Create: `src/cpaClient.js`
- Test: `test/cpaClient.test.js`

**Step 1: Write the failing test**

Create `test/cpaClient.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCpaClient } from '../src/cpaClient.js';

test('listAuthFiles calls CPA auth-files endpoint with bearer key', async () => {
  const calls = [];
  const client = createCpaClient({
    authFilesUrl: 'http://cpa.local/v0/management/auth-files',
    managementKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { files: [{ email: 'user@example.com', status: 'ready' }] };
        },
      };
    },
  });

  const files = await client.listAuthFiles();

  assert.deepEqual(files, [{ email: 'user@example.com', status: 'ready' }]);
  assert.equal(calls[0].url, 'http://cpa.local/v0/management/auth-files');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
});

test('listAuthFiles throws non-secret error on CPA failure', async () => {
  const client = createCpaClient({
    authFilesUrl: 'http://cpa.local/v0/management/auth-files',
    managementKey: 'secret',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() {
        return '{"error":"invalid management key"}';
      },
    }),
  });

  await assert.rejects(() => client.listAuthFiles(), /CPA_AUTH_FILES_FAILED/);
});

test('uploadAuthFile posts generated CPA JSON with file name', async () => {
  const calls = [];
  const client = createCpaClient({
    authFilesUrl: 'http://cpa.local/v0/management/auth-files',
    managementKey: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: 'ok' };
        },
      };
    },
  });

  const result = await client.uploadAuthFile({
    name: 'user@example.com.json',
    payload: '{"type":"openai"}',
  });

  assert.deepEqual(result, { status: 'ok' });
  assert.equal(calls[0].url, 'http://cpa.local/v0/management/auth-files?name=user%40example.com.json');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].options.body, '{"type":"openai"}');
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/cpaClient.test.js
```

Expected: FAIL because `src/cpaClient.js` does not exist.

**Step 3: Implement minimal client**

Create `src/cpaClient.js` with:

```js
import { codedError } from './replacementAccounts.js';

export function createCpaClient({ authFilesUrl, managementKey, fetchImpl = fetch } = {}) {
  return {
    async listAuthFiles() {
      if (!authFilesUrl || !managementKey) {
        throw codedError('CPA_NOT_CONFIGURED', 'CPA_URL and CPA_MANAGEMENT_KEY are required');
      }
      const response = await fetchImpl(authFilesUrl, {
        headers: {
          Authorization: `Bearer ${managementKey}`,
        },
      });
      if (!response.ok) {
        const body = await safeText(response);
        throw codedError('CPA_AUTH_FILES_FAILED', `CPA auth-files returned ${response.status}: ${body}`);
      }
      const payload = await response.json();
      return Array.isArray(payload?.files) ? payload.files : [];
    },

    async uploadAuthFile({ name, payload }) {
      if (!authFilesUrl || !managementKey) {
        throw codedError('CPA_NOT_CONFIGURED', 'CPA_URL and CPA_MANAGEMENT_KEY are required');
      }
      const url = `${authFilesUrl}?name=${encodeURIComponent(name)}`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managementKey}`,
          'Content-Type': 'application/json',
        },
        body: String(payload || ''),
      });
      if (!response.ok) {
        const body = await safeText(response);
        throw codedError('CPA_AUTH_UPLOAD_FAILED', `CPA auth upload returned ${response.status}: ${body}`);
      }
      return response.json();
    },
  };
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- test/cpaClient.test.js
```

Expected: PASS.

---

### Task 3: Add credential health classifier

**Files:**
- Create: `src/cpaCredentialHealth.js`
- Test: `test/cpaCredentialHealth.test.js`

**Step 1: Write the failing test**

Create `test/cpaCredentialHealth.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCpaAuthFile, buildCredentialKey } from '../src/cpaCredentialHealth.js';

test('buildCredentialKey uses provider and normalized email', () => {
  assert.equal(buildCredentialKey({ provider: 'Claude', email: ' User@Example.COM ' }), 'claude:user@example.com');
});

test('classifyCpaAuthFile marks ready credential healthy', () => {
  assert.deepEqual(classifyCpaAuthFile({
    provider: 'claude',
    email: 'user@example.com',
    status: 'ready',
    status_message: 'ok',
    disabled: false,
    unavailable: false,
  }), {
    healthy: true,
    category: 'healthy',
    reasons: [],
  });
});

test('classifyCpaAuthFile detects auth-expired token errors', () => {
  const result = classifyCpaAuthFile({
    status: 'error',
    status_message: '{"error":{"message":"Your authentication token has been invalidated","type":"authentication_error","code":"auth_unavailable"}}',
    disabled: false,
    unavailable: true,
  });

  assert.equal(result.healthy, false);
  assert.equal(result.category, 'auth_expired');
  assert.deepEqual(result.reasons, ['unavailable', 'status:error', 'message:auth_expired']);
});

test('classifyCpaAuthFile detects quota limited without replacement', () => {
  const result = classifyCpaAuthFile({
    status: 'error',
    status_message: '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached"}}',
    next_retry_after: '2026-06-08T16:09:37+08:00',
    unavailable: true,
  });

  assert.equal(result.healthy, false);
  assert.equal(result.category, 'quota_limited');
  assert.deepEqual(result.reasons, ['quota_limited', 'unavailable', 'status:error']);
});

test('classifyCpaAuthFile detects disabled without replacement', () => {
  const result = classifyCpaAuthFile({
    status: 'disabled',
    disabled: true,
  });

  assert.equal(result.healthy, false);
  assert.equal(result.category, 'disabled');
  assert.deepEqual(result.reasons, ['disabled', 'status:disabled']);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/cpaCredentialHealth.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement classifier**

Create `src/cpaCredentialHealth.js`:

```js
const AUTH_EXPIRED_PATTERN = /authentication_error|auth_unavailable|expired|invalidated|invalid token|unauthorized|refresh|login|token/i;
const QUOTA_LIMIT_PATTERN = /usage_limit_reached|usage limit|quota/i;

export function buildCredentialKey(file) {
  const provider = String(file?.provider || '').trim().toLowerCase();
  const email = String(file?.email || '').trim().toLowerCase();
  return `${provider}:${email}`;
}

export function classifyCpaAuthFile(file) {
  const reasons = [];
  const message = String(file?.status_message || '').trim();
  const isQuotaLimited = Boolean(file?.next_retry_after) || QUOTA_LIMIT_PATTERN.test(message);
  const isAuthExpired = AUTH_EXPIRED_PATTERN.test(message) && !isQuotaLimited;

  if (isQuotaLimited) reasons.push('quota_limited');
  if (file?.disabled === true) reasons.push('disabled');
  if (file?.unavailable === true) reasons.push('unavailable');

  const status = String(file?.status || '').trim();
  if (status && status !== 'ready') {
    reasons.push(`status:${status}`);
  }

  if (isAuthExpired) {
    reasons.push('message:auth_expired');
  }

  const category = determineCategory({ file, reasons, isQuotaLimited, isAuthExpired });
  return {
    healthy: reasons.length === 0,
    category,
    reasons,
  };
}

function determineCategory({ file, reasons, isQuotaLimited, isAuthExpired }) {
  if (reasons.length === 0) return 'healthy';
  if (isQuotaLimited) return 'quota_limited';
  if (file?.disabled === true || String(file?.status || '').trim() === 'disabled') return 'disabled';
  if (isAuthExpired) return 'auth_expired';
  return 'unknown_error';
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- test/cpaCredentialHealth.test.js
```

Expected: PASS.

---

### Task 4: Add repository lookup by email

**Files:**
- Modify: `src/replacementAccounts.js`
- Test: `test/replacementAccounts.test.js`

**Step 1: Write the failing test**

Append to `test/replacementAccounts.test.js`:

```js
test('getAccountByEmail finds non-deleted account case-insensitively', () => {
  const { repo } = createTestContext();
  const created = repo.createAccount({ email: 'User@Example.COM' });

  assert.equal(repo.getAccountByEmail(' user@example.com ').id, created.id);
  repo.deleteAccount(created.id);
  assert.equal(repo.getAccountByEmail('user@example.com'), undefined);
});
```

Adjust helper names to match existing `test/replacementAccounts.test.js`.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/replacementAccounts.test.js
```

Expected: FAIL because `getAccountByEmail` does not exist.

**Step 3: Implement lookup**

Add to the repository object in `src/replacementAccounts.js`:

```js
getAccountByEmail(email) {
  const normalized = normalizeOptional(email);
  if (!normalized) return undefined;
  return db.prepare(`
    SELECT * FROM replacement_accounts
    WHERE lower(trim(email)) = lower(trim(?))
      AND deleted_at IS NULL
    LIMIT 1
  `).get(normalized);
},
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- test/replacementAccounts.test.js
```

Expected: PASS.

---

### Task 5: Add single-flight repair queue

**Files:**
- Create: `src/cpaRepairQueue.js`
- Test: `test/cpaRepairQueue.test.js`

**Step 1: Write the failing test**

Create `test/cpaRepairQueue.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCpaRepairQueue } from '../src/cpaRepairQueue.js';

test('queue deduplicates accounts by id and drains one at a time', async () => {
  const events = [];
  const queue = createCpaRepairQueue({
    async worker(job) {
      events.push(`start:${job.account.id}`);
      await Promise.resolve();
      events.push(`end:${job.account.id}`);
    },
  });

  queue.enqueue({ account: { id: 1, email: 'a@example.com' }, reason: 'expired' });
  queue.enqueue({ account: { id: 1, email: 'a@example.com' }, reason: 'expired' });
  queue.enqueue({ account: { id: 2, email: 'b@example.com' }, reason: 'expired' });

  await queue.drain();

  assert.deepEqual(events, ['start:1', 'end:1', 'start:2', 'end:2']);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/cpaRepairQueue.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement single-flight queue**

Create `src/cpaRepairQueue.js`:

```js
export function createCpaRepairQueue({ worker } = {}) {
  const jobs = [];
  const queuedIds = new Set();
  let running = false;

  return {
    enqueue(job) {
      const id = Number(job?.account?.id);
      if (!id || queuedIds.has(id)) return false;
      queuedIds.add(id);
      jobs.push(job);
      return true;
    },

    async drain() {
      if (running) return { running: true };
      running = true;
      try {
        while (jobs.length > 0) {
          const job = jobs.shift();
          queuedIds.delete(Number(job.account.id));
          await worker(job);
        }
        return { running: false };
      } finally {
        running = false;
      }
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- test/cpaRepairQueue.test.js
```

Expected: PASS.

---

### Task 6: Add repair worker with local JSON upload and post-check

**Files:**
- Create: `src/cpaRepairWorker.js`
- Test: `test/cpaRepairWorker.test.js`

**Step 1: Write the failing test**

Create `test/cpaRepairWorker.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCpaRepairWorker } from '../src/cpaRepairWorker.js';

test('repair worker replaces account, uploads CPA JSON, and verifies health', async () => {
  const events = [];
  const worker = createCpaRepairWorker({
    cpaOutputDir: 'src/auto/product_files/cpa',
    readFileImpl(path, encoding) {
      assert.equal(path, 'src/auto/product_files/cpa/user@example.com.json');
      assert.equal(encoding, 'utf8');
      return '{"type":"openai"}';
    },
    cpaClient: {
      async uploadAuthFile(input) {
        events.push(['upload', input.name, input.payload]);
        return { status: 'ok' };
      },
      async listAuthFiles() {
        return [{ provider: 'codex', email: 'user@example.com', status: 'ready', status_message: 'ok' }];
      },
    },
    replacementAccounts: {
      markReplacementStarted(id) { events.push(['started', id]); },
      markReplacementSuccess(id) { events.push(['success', id]); return { id, status: 'replaced' }; },
      markReplacementFailure() { throw new Error('not expected'); },
    },
    replacementServices: {
      async replaceAccount(account) {
        events.push(['replace', account.id]);
        return { ok: true };
      },
    },
  });

  const result = await worker.repair({ account: { id: 7, email: 'user@example.com' } });

  assert.equal(result.ok, true);
  assert.deepEqual(events, [
    ['started', 7],
    ['replace', 7],
    ['upload', 'user@example.com.json', '{"type":"openai"}'],
    ['success', 7],
  ]);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/cpaRepairWorker.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement worker**

Create `src/cpaRepairWorker.js`:

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyCpaAuthFile } from './cpaCredentialHealth.js';

export function createCpaRepairWorker({
  cpaClient,
  replacementAccounts,
  replacementServices,
  cpaOutputDir,
  readFileImpl = readFileSync,
} = {}) {
  return {
    async repair({ account }) {
      replacementAccounts.markReplacementStarted(account.id);
      try {
        await replacementServices.replaceAccount(account);
        const fileName = `${String(account.email).trim().toLowerCase()}.json`;
        const payload = readFileImpl(join(cpaOutputDir, fileName), 'utf8');
        await cpaClient.uploadAuthFile({ name: fileName, payload });
        await assertCredentialHealthy(cpaClient, account.email);
        const updated = replacementAccounts.markReplacementSuccess(account.id);
        return { ok: true, account: updated };
      } catch (error) {
        const updated = replacementAccounts.markReplacementFailure(account.id, error.message);
        return { ok: false, account: updated, error: error.message };
      }
    },
  };
}

async function assertCredentialHealthy(cpaClient, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const files = await cpaClient.listAuthFiles();
  const matching = files.filter((file) => String(file?.email || '').trim().toLowerCase() === normalizedEmail);
  if (matching.length === 0) {
    throw new Error(`uploaded CPA credential not found for ${normalizedEmail}`);
  }
  const unhealthy = matching.find((file) => !classifyCpaAuthFile(file).healthy);
  if (unhealthy) {
    throw new Error(`uploaded CPA credential is still unhealthy: ${unhealthy.status || ''} ${unhealthy.status_message || ''}`.trim());
  }
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- test/cpaRepairWorker.test.js
```

Expected: PASS.

---

### Task 7: Add monitor run-once service

**Files:**
- Create: `src/cpaCredentialMonitor.js`
- Test: `test/cpaCredentialMonitor.test.js`

**Step 1: Write the failing test**

Create `test/cpaCredentialMonitor.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCpaCredentialMonitor } from '../src/cpaCredentialMonitor.js';

test('runOnce triggers replacement for unhealthy matching account', async () => {
  const enqueued = [];
  const monitor = createCpaCredentialMonitor({
    cpaClient: {
      async listAuthFiles() {
        return [{
          provider: 'claude',
          email: 'user@example.com',
          status: 'error',
          status_message: 'refresh token expired',
          unavailable: true,
          disabled: false,
        }];
      },
    },
    replacementAccounts: {
      getAccountByEmail(email) {
        assert.equal(email, 'user@example.com');
        return { id: 7, email, status: 'active' };
      },
    },
    repairQueue: {
      enqueue(job) {
        enqueued.push(job.account.id);
        return true;
      },
    },
  });

  const result = await monitor.runOnce();

  assert.deepEqual(enqueued, [7]);
  assert.equal(result.checked, 1);
  assert.equal(result.unhealthy.length, 1);
  assert.equal(result.enqueued.length, 1);
});

test('runOnce skips healthy and already replacing credentials', async () => {
  const monitor = createCpaCredentialMonitor({
    cpaClient: {
      async listAuthFiles() {
        return [
          { provider: 'claude', email: 'ok@example.com', status: 'ready', status_message: 'ok' },
          { provider: 'claude', email: 'busy@example.com', status: 'error', unavailable: true },
        ];
      },
    },
    replacementAccounts: {
      getAccountByEmail(email) {
        if (email === 'busy@example.com') return { id: 8, email, status: 'replacing' };
        return undefined;
      },
    },
    repairQueue: {
      enqueue() {
        throw new Error('not expected');
      },
    },
  });

  const result = await monitor.runOnce();

  assert.equal(result.checked, 2);
  assert.equal(result.unhealthy.length, 1);
  assert.equal(result.enqueued.length, 0);
  assert.equal(result.skipped.length, 1);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/cpaCredentialMonitor.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement monitor**

Create `src/cpaCredentialMonitor.js`:

```js
import { classifyCpaAuthFile, buildCredentialKey } from './cpaCredentialHealth.js';

export function createCpaCredentialMonitor({
  cpaClient,
  replacementAccounts,
  replacementServices,
} = {}) {
  return {
    async runOnce() {
      const files = await cpaClient.listAuthFiles();
      const result = {
        checked: files.length,
        unhealthy: [],
        enqueued: [],
        skipped: [],
      };

      for (const file of files) {
        const health = classifyCpaAuthFile(file);
        if (health.healthy) continue;

        const email = String(file?.email || '').trim().toLowerCase();
        const item = {
          key: buildCredentialKey(file),
          provider: file?.provider || '',
          email,
          category: health.category,
          reasons: health.reasons,
        };
        result.unhealthy.push(item);

        if (health.category !== 'auth_expired') {
          result.skipped.push({ ...item, reason: `category_${health.category}` });
          continue;
        }

        const account = replacementAccounts.getAccountByEmail(email);
        if (!account) {
          result.skipped.push({ ...item, reason: 'replacement_account_not_found' });
          continue;
        }
        if (account.status === 'replacing') {
          result.skipped.push({ ...item, account_id: account.id, reason: 'already_replacing' });
          continue;
        }

        const queued = repairQueue.enqueue({ account, credential: file, reasons: health.reasons });
        if (queued) {
          result.enqueued.push({ ...item, account_id: account.id });
        } else {
          result.skipped.push({ ...item, account_id: account.id, reason: 'already_queued' });
        }
      }

      return result;
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- test/cpaCredentialMonitor.test.js
```

Expected: PASS.

---

### Task 8: Add manual API endpoint for health check

**Files:**
- Modify: `src/server.js`
- Test: `test/cpaCredentialMonitorApi.test.js`

**Step 1: Write the failing API test**

Create `test/cpaCredentialMonitorApi.test.js` using the existing authenticated test server pattern from `test/replacementAccountsApi.test.js`.

Test cases:

```js
test('GET /cpa/auth-health returns sanitized monitor status', async () => {
  // create app with injected cpaCredentialMonitor.runOnce returning a fixed result
  // request with auth cookie
  // assert status 200
  // assert body.ok === true
  // assert body.result.checked === 1
  // assert body.result.enqueued is an array
  // assert response does not contain management key
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/cpaCredentialMonitorApi.test.js
```

Expected: FAIL because route does not exist.

**Step 3: Implement route injection**

In `src/server.js`:

- Add `cpaCredentialMonitor = null` to `createApp` options.
- Add route:

```js
app.get('/cpa/auth-health', requireAuth, async (req, res) => {
  if (!cpaCredentialMonitor?.runOnce) {
    res.status(503).json(errorBody('CPA_MONITOR_NOT_CONFIGURED', 'CPA credential monitor is not configured'));
    return;
  }
  try {
    const result = await cpaCredentialMonitor.runOnce();
    res.json({ ok: true, result });
  } catch (error) {
    sendApiError(res, error);
  }
});
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- test/cpaCredentialMonitorApi.test.js
```

Expected: PASS.

---

### Task 9: Add optional interval daemon

**Files:**
- Create: `src/cpaCredentialMonitorRunner.js`
- Modify: `src/server.js`
- Test: `test/cpaCredentialMonitorRunner.test.js`

**Step 1: Write runner tests**

Create `test/cpaCredentialMonitorRunner.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { startCpaCredentialMonitor } from '../src/cpaCredentialMonitorRunner.js';

test('startCpaCredentialMonitor does nothing when disabled', () => {
  let scheduled = false;
  const handle = startCpaCredentialMonitor({
    enabled: false,
    setIntervalImpl() {
      scheduled = true;
    },
  });

  assert.equal(handle, null);
  assert.equal(scheduled, false);
});

test('startCpaCredentialMonitor schedules runOnce when enabled', () => {
  const calls = [];
  const handle = startCpaCredentialMonitor({
    enabled: true,
    intervalMs: 60000,
    monitor: { async runOnce() { calls.push('run'); } },
    setIntervalImpl(fn, ms) {
      assert.equal(ms, 60000);
      fn();
      return 123;
    },
  });

  assert.equal(handle, 123);
  assert.deepEqual(calls, ['run']);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/cpaCredentialMonitorRunner.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement runner**

Create `src/cpaCredentialMonitorRunner.js`:

```js
export function startCpaCredentialMonitor({
  enabled,
  intervalMs,
  monitor,
  setIntervalImpl = setInterval,
  logger = console,
} = {}) {
  if (!enabled || !monitor?.runOnce) return null;

  const runSafely = async () => {
    try {
      const result = await monitor.runOnce();
      logger.info?.('[cpa-monitor] run completed', result);
    } catch (error) {
      logger.error?.('[cpa-monitor] run failed', error.message);
    }
  };

  return setIntervalImpl(runSafely, intervalMs);
}
```

**Step 4: Wire into app startup**

In the executable bottom of `src/server.js`, create:

- `createCpaClient(config.cpa)`
- `createCpaCredentialMonitor(...)`
- `startCpaCredentialMonitor({ enabled: config.cpa.monitorEnabled, intervalMs: config.cpa.monitorIntervalMs, monitor })`

Keep `createApp` testable by injecting `cpaCredentialMonitor`.

**Step 5: Run test to verify it passes**

Run:

```bash
npm test -- test/cpaCredentialMonitorRunner.test.js
```

Expected: PASS.

---

### Task 10: Add documentation and change record

**Files:**
- Create: `docs/changes/CHG-019-cpa-auth-health-monitor.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Modify: `docs/project/api.md`
- Modify: `.env.example` if present
- Modify: `docs/work/2026-06-03-cpa-auth-health-monitor.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Step 1: Create change record**

Create `docs/changes/CHG-019-cpa-auth-health-monitor.md` with:

```markdown
# CHG-019 CPA 凭证健康检测与自动补号

- 状态：draft
- 日期：2026-06-03
- 关联 PRD：PRD-002

## 背景

CPA 已提供 `/v0/management/auth-files` 运行时凭证状态接口，可用于识别失效凭证。

## 变更

- 新增 CPA 凭证健康检测客户端。
- 新增按 `provider + email` 分类的凭证健康判断。
- 新增手动健康检查接口。
- 新增可选 10 分钟轮询守护进程。
- 检测到失效凭证且存在匹配补号账号时，触发现有补号流程。

## 验收

- CPA 管理密钥不出现在日志或接口响应中。
- 健康凭证不会触发补号。
- 失效凭证会按邮箱匹配补号账号并触发补号。
- 已处于 `replacing` 的账号不会重复触发。
```

**Step 2: Update API docs**

In `docs/project/api.md`, add:

- `GET /cpa/auth-health`
- Required auth: backend admin cookie.
- Response example with `checked`, `unhealthy`, `triggered`, `skipped`.
- Note that `CPA_MANAGEMENT_KEY` is never returned.

**Step 3: Update env docs**

If `.env.example` exists, add:

```env
CPA_URL=http://localhost:8317
CPA_MANAGEMENT_KEY=
CPA_HEALTH_MONITOR_ENABLED=false
CPA_HEALTH_MONITOR_INTERVAL_MS=600000
```

**Step 4: Update work docs**

Add work log and handoff notes describing:

- CPA management key still needs to be fixed before live verification.
- Once fixed, run manual `/cpa/auth-health` first.
- Then enable interval daemon.

---

### Task 11: Full verification

**Files:**
- All files above

**Step 1: Run targeted tests**

Run:

```bash
npm test -- test/cpaConfig.test.js
npm test -- test/cpaClient.test.js
npm test -- test/cpaCredentialHealth.test.js
npm test -- test/cpaCredentialMonitor.test.js
npm test -- test/cpaCredentialMonitorApi.test.js
npm test -- test/cpaCredentialMonitorRunner.test.js
npm test -- test/replacementAccounts.test.js
```

Expected: all PASS.

**Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: all PASS.

**Step 3: Manual live check after CPA key is fixed**

Run the server:

```bash
npm start
```

Login to backend, then request:

```bash
curl -b "<admin_auth_cookie>" http://localhost:<APP_PORT>/cpa/auth-health
```

Expected:

- `ok: true`
- CPA auth files are summarized.
- No management key appears.
- For unhealthy CPA credentials, matching replacement accounts are moved through the replacement flow.

---

## Follow-up: Retry Policy and Queue UI

After the first live version is stable, consider adding:

- retry backoff for CPA upload/post-check failures;
- a queue status page showing pending/running/failed repair jobs;
- manual "retry upload only" action for cases where OAuth succeeded but CPA upload failed.
