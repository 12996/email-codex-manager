# Replacement Accounts Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the backend data layer, JSON APIs, tests, and API documentation for replacement accounts.

**Architecture:** Add a separate `replacement_accounts` SQLite table and repository so replacement-account state does not mix with existing Gmail IMAP accounts. Expose authenticated Express JSON routes under `/replacement-accounts`, with external SMS/JSON/automation calls injected as services for testability. Because the real automation replacement interface is not ready, `/replacement-accounts/:id/replace` will call a placeholder adapter module now and keep the public API stable for the future JS automation implementation.

**Tech Stack:** Node.js ESM, Express, better-sqlite3, `node:test`, built-in `fetch`.

---

## Current Context

Existing backend files:

- `F:\work\email\gmail_IMAP\src\db.js` initializes SQLite schema.
- `F:\work\email\gmail_IMAP\src\accounts.js` contains the current Gmail account repository pattern.
- `F:\work\email\gmail_IMAP\src\server.js` creates the Express app and protects routes with `requireAuth`.
- `F:\work\email\gmail_IMAP\test\*.test.js` uses `node:test`, temporary SQLite DBs, and local HTTP servers.
- Design source: `F:\work\email\gmail_IMAP\docs\plans\2026-06-01-replacement-accounts-backend-design.md`.

Key implementation rules:

- `email` is required, trimmed before save, unique case-insensitively and whitespace-insensitively.
- Delete is soft delete via `deleted_at`.
- SMS code is returned to caller but never stored.
- `replacement_count` only increments after successful replacement.
- Replacement failure does not increment `replacement_count`.
- `replacing` is system-managed; manual status changes cannot set it.
- Real automation replacement URL/call style is not ready; keep a placeholder service boundary.

## API Contract

### Status values

System states:

- `pending`
- `active`
- `banned`
- `replacing`
- `replaced`
- `failed`

Manual status endpoint accepts only:

- `pending`
- `active`
- `banned`
- `replaced`
- `failed`

### Common response shape

Use plain JSON. For success:

```json
{
  "ok": true,
  "account": {}
}
```

For list:

```json
{
  "ok": true,
  "accounts": []
}
```

For errors:

```json
{
  "ok": false,
  "error": "EMAIL_REQUIRED",
  "message": "email is required"
}
```

### Error code mapping

- `EMAIL_REQUIRED` -> HTTP 400
- `EMAIL_DUPLICATE` -> HTTP 409
- `ACCOUNT_NOT_FOUND` -> HTTP 404
- `STATUS_INVALID` -> HTTP 400
- `SMS_API_REQUIRED` -> HTTP 400
- `SMS_FETCH_FAILED` -> HTTP 502
- `JSON_URL_REQUIRED` -> HTTP 400
- `JSON_FETCH_FAILED` -> HTTP 502
- `REPLACE_FAILED` -> HTTP 502
- Unknown validation errors -> HTTP 400

### Request fields

Create and update endpoints accept:

```json
{
  "email": "user@example.com",
  "phone": "optional",
  "sms_api": "https://example.invalid/sms",
  "activation_method": "manual",
  "activated_at": "2026-06-01T00:00:00.000Z",
  "status": "pending",
  "status_note": "optional",
  "remark": "optional"
}
```

Notes:

- `status` on create/update is optional; default is `pending`.
- `replacing` must not be accepted from create/update input.
- `json_payload`, `replacement_count`, `last_replace_at`, `last_error`, `sms_last_error`, `deleted_at`, `created_at`, and `updated_at` are system-managed.

### Endpoint details

#### `GET /replacement-accounts`

- Auth required.
- Returns non-deleted accounts ordered by `id DESC`.
- Response: `{ ok: true, accounts: [...] }`.

#### `GET /replacement-accounts/:id`

- Auth required.
- Returns one non-deleted account.
- Missing account: 404 `ACCOUNT_NOT_FOUND`.

#### `POST /replacement-accounts`

- Auth required.
- Creates account.
- Requires unique `email`.
- Response status: 201.
- Duplicate email, including different case or surrounding whitespace: 409 `EMAIL_DUPLICATE`.

#### `PUT /replacement-accounts/:id`

- Auth required.
- Updates editable account fields.
- Requires existing non-deleted account.
- Keeps unique email rule, excluding the current row.
- Duplicate email: 409 `EMAIL_DUPLICATE`.

#### `DELETE /replacement-accounts/:id`

- Auth required.
- Soft deletes by setting `deleted_at` and `updated_at`.
- Missing account: 404 `ACCOUNT_NOT_FOUND`.
- Success response: `{ ok: true }`.

#### `PATCH /replacement-accounts/:id/status`

- Auth required.
- Body:

```json
{
  "status": "banned",
  "status_note": "管理员手动标记封禁"
}
```

- Updates `status`, `status_note`, `status_updated_at`, `updated_at`.
- Rejects `replacing` with `STATUS_INVALID`.

#### `POST /replacement-accounts/:id/fetch-sms-code`

- Auth required.
- Reads `sms_api` from account.
- Calls SMS API in real time.
- Returns extracted verification code.
- Does not store code, SMS payload, or code timestamp.
- On failure, writes only `sms_last_error` and `updated_at`.

Response:

```json
{
  "ok": true,
  "code": "123456"
}
```

Initial extractor rule:

- If response JSON has `code`, use it.
- Else if response JSON has `data.code`, use it.
- Else scan response text for the first 6-digit code.
- If no code is found, treat as `SMS_FETCH_FAILED`.

#### `POST /replacement-accounts/:id/fetch-json`

- Auth required.
- Body:

```json
{
  "url": "https://example.invalid/account.json"
}
```

- Fetches JSON from the provided URL.
- Stores raw JSON string in `json_payload`.
- Sets `json_fetched_at`, clears `last_error`, updates `updated_at`.
- On failure, stores `last_error`, updates `updated_at`.

#### `POST /replacement-accounts/:id/replace`

- Auth required.
- Calls placeholder automation service.
- The future real automation implementation should live behind the same service function.

State flow:

1. Before call:
   - `status = 'replacing'`
   - `status_updated_at = now`
   - `updated_at = now`
2. Success:
   - `status = 'replaced'`
   - `replacement_count = replacement_count + 1`
   - `last_replace_at = now`
   - `last_error = NULL`
   - `status_updated_at = now`
   - `updated_at = now`
3. Failure:
   - `status = 'failed'`
   - `last_error = error message`
   - `replacement_count` unchanged
   - `status_updated_at = now`
   - `updated_at = now`

---

## Task 1: Add Database Schema

**Files:**

- Modify: `F:\work\email\gmail_IMAP\src\db.js`
- Test: `F:\work\email\gmail_IMAP\test\replacementAccounts.test.js`

**Step 1: Write failing schema test**

Create `test/replacementAccounts.test.js` with a test that opens a temporary DB and verifies the table and unique index exist.

```js
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDatabase } from '../src/db.js';

function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'gmail-imap-service-'));
  return createDatabase(join(dir, 'test.db'));
}

test('initializeSchema creates replacement_accounts table and email unique index', () => {
  const db = createTestDb();

  const table = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'replacement_accounts'
  `).get();
  const index = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_replacement_accounts_email_unique'
  `).get();

  assert.equal(table.name, 'replacement_accounts');
  assert.equal(index.name, 'idx_replacement_accounts_email_unique');
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- test/replacementAccounts.test.js
```

Expected: FAIL because `replacement_accounts` does not exist.

**Step 3: Implement schema**

In `src/db.js`, extend `initializeSchema(db)` with:

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS replacement_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      phone TEXT,
      sms_api TEXT,
      sms_last_error TEXT,
      activation_method TEXT,
      activated_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      status_updated_at TEXT,
      status_note TEXT,
      replacement_count INTEGER NOT NULL DEFAULT 0,
      json_payload TEXT,
      json_fetched_at TEXT,
      last_replace_at TEXT,
      last_error TEXT,
      remark TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_replacement_accounts_email_unique
    ON replacement_accounts (lower(trim(email)));
  `);
```

**Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- test/replacementAccounts.test.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/db.js test/replacementAccounts.test.js
git commit -m "feat: add replacement accounts schema"
```

---

## Task 2: Implement Repository Validation and CRUD

**Files:**

- Create: `F:\work\email\gmail_IMAP\src\replacementAccounts.js`
- Modify: `F:\work\email\gmail_IMAP\test\replacementAccounts.test.js`

**Step 1: Write failing repository tests**

Add tests for:

- Creating an account trims email and defaults status to `pending`.
- Duplicate email is rejected case-insensitively.
- List excludes soft-deleted rows.
- Get excludes soft-deleted rows.
- Update enforces unique email excluding current row.
- Delete sets `deleted_at`.

Core test shape:

```js
import { createReplacementAccountRepository } from '../src/replacementAccounts.js';

function createTestRepository() {
  const db = createTestDb();
  return createReplacementAccountRepository(db);
}

test('createAccount trims email and defaults status to pending', () => {
  const repo = createTestRepository();

  const account = repo.createAccount({ email: ' User@Example.COM ', phone: '123' });

  assert.equal(account.email, 'User@Example.COM');
  assert.equal(account.phone, '123');
  assert.equal(account.status, 'pending');
  assert.equal(account.replacement_count, 0);
  assert.equal(account.deleted_at, null);
  assert.ok(account.created_at);
  assert.ok(account.updated_at);
});

test('createAccount rejects duplicate email case-insensitively', () => {
  const repo = createTestRepository();

  repo.createAccount({ email: 'user@example.com' });

  assert.throws(
    () => repo.createAccount({ email: ' USER@example.com ' }),
    /EMAIL_DUPLICATE/,
  );
});
```

**Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- test/replacementAccounts.test.js
```

Expected: FAIL because `src/replacementAccounts.js` does not exist.

**Step 3: Implement repository**

Create `src/replacementAccounts.js` with:

- `createReplacementAccountRepository(db)`
- `createAccount(input)`
- `listAccounts()`
- `getAccount(id)`
- `updateAccount(id, input)`
- `deleteAccount(id)`
- helper `normalizeAccountInput(input, { requireEmail })`
- helper `validateStatus(status, { allowReplacing })`
- custom errors with `code` property.

Required implementation behavior:

```js
const SYSTEM_STATUSES = new Set(['pending', 'active', 'banned', 'replacing', 'replaced', 'failed']);
const MANUAL_STATUSES = new Set(['pending', 'active', 'banned', 'replaced', 'failed']);

export function createReplacementAccountRepository(db) {
  return {
    createAccount(input) {
      const data = normalizeAccountInput(input, { requireEmail: true });
      validateStatus(data.status || 'pending', { allowReplacing: false });
      assertEmailAvailable(db, data.email);
      const now = new Date().toISOString();
      const result = db.prepare(`INSERT INTO replacement_accounts (...) VALUES (...)`).run(...);
      return this.getAccount(result.lastInsertRowid);
    },

    listAccounts() {
      return db.prepare(`
        SELECT * FROM replacement_accounts
        WHERE deleted_at IS NULL
        ORDER BY id DESC
      `).all();
    },

    getAccount(id) {
      return db.prepare(`
        SELECT * FROM replacement_accounts
        WHERE id = ? AND deleted_at IS NULL
      `).get(Number(id));
    },

    updateAccount(id, input) {
      const existing = this.getAccount(id);
      if (!existing) throw codedError('ACCOUNT_NOT_FOUND', 'replacement account not found');
      const data = normalizeAccountInput(input, { requireEmail: true });
      validateStatus(data.status || existing.status, { allowReplacing: false });
      assertEmailAvailable(db, data.email, Number(id));
      const now = new Date().toISOString();
      db.prepare(`UPDATE replacement_accounts SET ... WHERE id = ?`).run(...);
      return this.getAccount(id);
    },

    deleteAccount(id) {
      const existing = this.getAccount(id);
      if (!existing) throw codedError('ACCOUNT_NOT_FOUND', 'replacement account not found');
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE replacement_accounts
        SET deleted_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, Number(id));
    },
  };
}
```

Use SQL duplicate check:

```sql
SELECT id FROM replacement_accounts
WHERE deleted_at IS NULL
  AND lower(trim(email)) = lower(trim(?))
  AND (? IS NULL OR id != ?)
LIMIT 1
```

**Step 4: Run tests**

Run:

```powershell
npm test -- test/replacementAccounts.test.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/replacementAccounts.js test/replacementAccounts.test.js
git commit -m "feat: add replacement account repository"
```

---

## Task 3: Add Repository State Mutation Methods

**Files:**

- Modify: `F:\work\email\gmail_IMAP\src\replacementAccounts.js`
- Modify: `F:\work\email\gmail_IMAP\test\replacementAccounts.test.js`

**Step 1: Write failing tests**

Add tests for:

- `updateStatus(id, { status, status_note })` updates status and rejects `replacing`.
- `recordSmsFailure(id, message)` stores `sms_last_error`.
- `recordJsonFetchSuccess(id, payload)` stores JSON and clears `last_error`.
- `recordJsonFetchFailure(id, message)` stores `last_error`.
- `markReplacementStarted(id)` sets `replacing`.
- `markReplacementSuccess(id)` increments `replacement_count`.
- `markReplacementFailure(id, message)` does not increment `replacement_count`.

Example:

```js
test('markReplacementSuccess increments replacement_count', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  repo.markReplacementStarted(account.id);
  const replaced = repo.markReplacementSuccess(account.id);

  assert.equal(replaced.status, 'replaced');
  assert.equal(replaced.replacement_count, 1);
  assert.equal(replaced.last_error, null);
  assert.ok(replaced.last_replace_at);
});

test('markReplacementFailure does not increment replacement_count', () => {
  const repo = createTestRepository();
  const account = repo.createAccount({ email: 'user@example.com' });

  repo.markReplacementStarted(account.id);
  const failed = repo.markReplacementFailure(account.id, 'automation failed');

  assert.equal(failed.status, 'failed');
  assert.equal(failed.replacement_count, 0);
  assert.equal(failed.last_error, 'automation failed');
});
```

**Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- test/replacementAccounts.test.js
```

Expected: FAIL because methods are missing.

**Step 3: Implement methods**

Add methods to repository:

- `updateStatus(id, input)`
- `recordSmsFailure(id, errorMessage)`
- `recordJsonFetchSuccess(id, payload)`
- `recordJsonFetchFailure(id, errorMessage)`
- `markReplacementStarted(id)`
- `markReplacementSuccess(id)`
- `markReplacementFailure(id, errorMessage)`

Implementation notes:

- Each method must first verify `getAccount(id)` exists.
- Use `new Date().toISOString()` per mutation.
- `markReplacementSuccess` must use SQL increment:

```sql
replacement_count = replacement_count + 1
```

- Never write SMS verification code to any column.

**Step 4: Run tests**

Run:

```powershell
npm test -- test/replacementAccounts.test.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/replacementAccounts.js test/replacementAccounts.test.js
git commit -m "feat: add replacement account state transitions"
```

---

## Task 4: Add External Service Adapters

**Files:**

- Create: `F:\work\email\gmail_IMAP\src\replacementServices.js`
- Test: `F:\work\email\gmail_IMAP\test\replacementServices.test.js`

**Step 1: Write failing service tests**

Test SMS extraction:

- JSON `{ "code": "123456" }`
- JSON `{ "data": { "code": "123456" } }`
- Text containing `123456`
- No code throws `SMS_FETCH_FAILED`

Test JSON fetch:

- Returns stringified raw JSON.
- Non-2xx throws `JSON_FETCH_FAILED`.

Test replacement placeholder:

- `replaceAccount(account)` throws `REPLACE_NOT_CONFIGURED` until real automation is injected/configured.

**Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- test/replacementServices.test.js
```

Expected: FAIL because service file does not exist.

**Step 3: Implement service module**

Create:

```js
export function createReplacementServices({ fetchImpl = fetch, replacementAutomation = null } = {}) {
  return {
    async fetchSmsCode(smsApi) {
      if (!String(smsApi || '').trim()) {
        throw codedError('SMS_API_REQUIRED', 'sms_api is required');
      }
      const response = await fetchImpl(String(smsApi).trim());
      const text = await response.text();
      if (!response.ok) {
        throw codedError('SMS_FETCH_FAILED', `SMS API returned ${response.status}`);
      }
      return extractSmsCode(text);
    },

    async fetchJson(url) {
      if (!String(url || '').trim()) {
        throw codedError('JSON_URL_REQUIRED', 'url is required');
      }
      const response = await fetchImpl(String(url).trim());
      const text = await response.text();
      if (!response.ok) {
        throw codedError('JSON_FETCH_FAILED', `JSON API returned ${response.status}`);
      }
      JSON.parse(text);
      return text;
    },

    async replaceAccount(account) {
      if (!replacementAutomation?.replaceAccount) {
        throw codedError('REPLACE_NOT_CONFIGURED', 'replacement automation is not configured');
      }
      return replacementAutomation.replaceAccount(account);
    },
  };
}
```

Add `extractSmsCode(text)`:

1. Try `JSON.parse(text)`.
2. Check `parsed.code`.
3. Check `parsed.data.code`.
4. Regex match `/\b\d{6}\b/`.
5. Throw `SMS_FETCH_FAILED`.

**Step 4: Run tests**

Run:

```powershell
npm test -- test/replacementServices.test.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/replacementServices.js test/replacementServices.test.js
git commit -m "feat: add replacement account service adapters"
```

---

## Task 5: Wire Repository and Services into Express App

**Files:**

- Modify: `F:\work\email\gmail_IMAP\src\server.js`
- Test: `F:\work\email\gmail_IMAP\test\replacementAccountsApi.test.js`

**Step 1: Write failing API auth and CRUD tests**

Create `test/replacementAccountsApi.test.js` using the server-helper pattern from `test/verificationCodeApi.test.js`.

Test cases:

- Unauthenticated `GET /replacement-accounts` redirects to `/login`.
- Authenticated `POST /replacement-accounts` creates an account and returns 201.
- Duplicate email returns 409 `EMAIL_DUPLICATE`.
- `GET /replacement-accounts` returns list.
- `GET /replacement-accounts/:id` returns one account.
- `PUT /replacement-accounts/:id` updates fields.
- `DELETE /replacement-accounts/:id` soft deletes row and list no longer includes it.

**Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- test/replacementAccountsApi.test.js
```

Expected: FAIL because routes do not exist.

**Step 3: Modify `createApp` dependencies**

In `src/server.js`, add imports:

```js
import { createReplacementAccountRepository } from './replacementAccounts.js';
import { createReplacementServices } from './replacementServices.js';
```

Change default `createApp` setup to create one DB instance:

```js
export function createApp({
  db = createDatabase(config.databasePath),
  accounts = createAccountRepository(db),
  replacementAccounts = createReplacementAccountRepository(db),
  replacementServices = createReplacementServices(),
  mailService = { fetchMessages, testConnection },
} = {}) {
```

This prevents separate default DB connections for `accounts` and `replacementAccounts`.

**Step 4: Add CRUD JSON routes**

Add routes after JSON middleware and before `return app`:

```js
app.get('/replacement-accounts', requireAuth, (req, res) => {
  res.json({ ok: true, accounts: replacementAccounts.listAccounts() });
});

app.get('/replacement-accounts/:id', requireAuth, (req, res) => {
  const account = replacementAccounts.getAccount(req.params.id);
  if (!account) {
    res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
    return;
  }
  res.json({ ok: true, account });
});
```

Implement `POST`, `PUT`, and `DELETE` similarly with `try/catch` and a shared `sendApiError(res, error)` helper.

**Step 5: Run CRUD API tests**

Run:

```powershell
npm test -- test/replacementAccountsApi.test.js
```

Expected: PASS for CRUD tests.

**Step 6: Commit**

```powershell
git add src/server.js test/replacementAccountsApi.test.js
git commit -m "feat: add replacement account CRUD API"
```

---

## Task 6: Add Status, SMS, JSON, and Replace API Routes

**Files:**

- Modify: `F:\work\email\gmail_IMAP\src\server.js`
- Modify: `F:\work\email\gmail_IMAP\test\replacementAccountsApi.test.js`

**Step 1: Write failing API behavior tests**

Add tests for:

- `PATCH /replacement-accounts/:id/status` updates manual status.
- `PATCH /replacement-accounts/:id/status` rejects `replacing`.
- `POST /replacement-accounts/:id/fetch-sms-code` returns code and does not persist code.
- SMS failure writes `sms_last_error`.
- `POST /replacement-accounts/:id/fetch-json` stores `json_payload`.
- JSON failure writes `last_error`.
- `POST /replacement-accounts/:id/replace` increments `replacement_count` on success.
- Replacement failure leaves `replacement_count` unchanged.

Use injected fake services:

```js
const replacementServices = {
  async fetchSmsCode() {
    return '123456';
  },
  async fetchJson() {
    return JSON.stringify({ ok: true });
  },
  async replaceAccount() {
    return { ok: true };
  },
};
```

**Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- test/replacementAccountsApi.test.js
```

Expected: FAIL because routes are missing.

**Step 3: Implement status route**

```js
app.patch('/replacement-accounts/:id/status', requireAuth, (req, res) => {
  try {
    const account = replacementAccounts.updateStatus(req.params.id, req.body);
    res.json({ ok: true, account });
  } catch (error) {
    sendApiError(res, error);
  }
});
```

**Step 4: Implement SMS route**

```js
app.post('/replacement-accounts/:id/fetch-sms-code', requireAuth, async (req, res) => {
  const account = replacementAccounts.getAccount(req.params.id);
  if (!account) {
    res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
    return;
  }

  try {
    const code = await replacementServices.fetchSmsCode(account.sms_api);
    res.json({ ok: true, code });
  } catch (error) {
    replacementAccounts.recordSmsFailure(account.id, error.message);
    sendApiError(res, error);
  }
});
```

**Step 5: Implement JSON route**

```js
app.post('/replacement-accounts/:id/fetch-json', requireAuth, async (req, res) => {
  const account = replacementAccounts.getAccount(req.params.id);
  if (!account) {
    res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
    return;
  }

  try {
    const payload = await replacementServices.fetchJson(req.body?.url);
    const updated = replacementAccounts.recordJsonFetchSuccess(account.id, payload);
    res.json({ ok: true, account: updated });
  } catch (error) {
    replacementAccounts.recordJsonFetchFailure(account.id, error.message);
    sendApiError(res, error);
  }
});
```

**Step 6: Implement replace route**

```js
app.post('/replacement-accounts/:id/replace', requireAuth, async (req, res) => {
  const account = replacementAccounts.getAccount(req.params.id);
  if (!account) {
    res.status(404).json(errorBody('ACCOUNT_NOT_FOUND', 'replacement account not found'));
    return;
  }

  replacementAccounts.markReplacementStarted(account.id);
  try {
    await replacementServices.replaceAccount(account);
    const updated = replacementAccounts.markReplacementSuccess(account.id);
    res.json({ ok: true, account: updated });
  } catch (error) {
    const updated = replacementAccounts.markReplacementFailure(account.id, error.message);
    sendApiError(res, error, { account: updated });
  }
});
```

**Step 7: Run tests**

Run:

```powershell
npm test -- test/replacementAccountsApi.test.js
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add src/server.js test/replacementAccountsApi.test.js
git commit -m "feat: add replacement account action APIs"
```

---

## Task 7: Run Full Test Suite and Fix Regressions

**Files:**

- Modify only files required by failing tests.

**Step 1: Run all tests**

```powershell
npm test
```

Expected: all tests pass.

**Step 2: If tests fail, fix narrowly**

Rules:

- Do not rewrite unrelated account routes.
- Do not change auth cookie behavior.
- Do not change existing IMAP verification-code API contract.
- Keep all new replacement APIs authenticated.

**Step 3: Commit fixes**

```powershell
git add src test
git commit -m "test: verify replacement account backend"
```

Only commit if there are actual fixes after Task 6.

---

## Task 8: Update API Documentation for Frontend and PRD

**Files:**

- Modify: `F:\work\email\gmail_IMAP\docs\project\api.md`
- Optional modify if the user requests PRD baseline updates: `F:\work\email\gmail_IMAP\docs\prd\*.md`

**Step 1: Add API documentation**

Document:

- Field table for `replacement_accounts`.
- Status enum and Chinese labels.
- Each user operation and endpoint mapping.
- Request and response examples.
- Error codes.
- Note that SMS verification code is not persisted.
- Note that `/replace` currently uses a backend service boundary and will be connected to the future JS automation file.

**Step 2: Verify documentation is readable**

Run:

```powershell
Get-Content -LiteralPath 'F:\work\email\gmail_IMAP\docs\project\api.md' -Encoding UTF8
```

Expected: replacement-account API section is present and complete.

**Step 3: Commit docs**

```powershell
git add docs/project/api.md
git commit -m "docs: document replacement account API"
```

---

## Task 9: Update Work Tracking

**Files:**

- Create or modify: `F:\work\email\gmail_IMAP\docs\work\2026-06-01-补号账号后端.md`
- Modify: `F:\work\email\gmail_IMAP\docs\work\work-log.md`
- Modify at end of day only: `F:\work\email\gmail_IMAP\docs\work\handoff.md`

**Step 1: Create daily work record**

Record:

- Implemented `replacement_accounts` schema.
- Implemented repository and APIs.
- Added tests.
- Documented API contract.
- Real automation replacement integration is pending and hidden behind `replacementServices.replaceAccount`.

**Step 2: Update work-log index**

Add the new daily work record to `docs/work/work-log.md`.

**Step 3: Update handoff only when the day/task is complete**

Set next step to frontend integration or real automation JS adapter, depending on current project direction.

**Step 4: Commit work docs**

```powershell
git add docs/work
git commit -m "docs: record replacement account backend work"
```

---

## Final Verification Checklist

Run:

```powershell
npm test
```

Expected:

- Existing tests still pass.
- New repository tests pass.
- New service tests pass.
- New API tests pass.

Manually verify:

- Duplicate `email` returns 409.
- Soft-deleted accounts do not appear in list/detail.
- Manual status cannot be set to `replacing`.
- SMS code appears only in HTTP response and no DB column stores it.
- Successful replacement increments `replacement_count`.
- Failed replacement does not increment `replacement_count`.
- `/replace` has a stable placeholder boundary for the future JS automation module.

## Execution Options

Plan complete and saved to `F:\work\email\gmail_IMAP\docs\plans\2026-06-01-replacement-accounts-backend.md`.

Two execution options:

1. **Subagent-Driven (this session)** - Dispatch a fresh subagent per task, review between tasks, faster iteration.
2. **Parallel Session (separate)** - Open a new session with `superpowers:executing-plans`, batch execution with checkpoints.

Recommended: option 1, because the repository/API/tests are tightly coupled and benefit from review after each task.
