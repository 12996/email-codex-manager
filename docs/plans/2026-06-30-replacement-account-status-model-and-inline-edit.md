# Replacement Account Status Model and Inline Edit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the old replacement-account status semantics with the approved Chinese business status model, keep circuit breaker separate from `status`, and make table status editable inline.

**Architecture:** Keep a single `replacement_accounts.status` business field, but normalize old status values at repository boundaries. Use existing circuit breaker fields (`consecutive_replace_failures`, `circuit_breaker_at`, `circuit_breaker_reason`) as the system protection state. Frontend renders shared status metadata for table labels, filters, and inline select controls.

**Tech Stack:** Node.js ESM, Express, better-sqlite3, browser static JS/CSS, Node built-in test runner.

---

### Task 1: Repository status model and circuit breaker semantics

**Files:**
- Modify: `src/replacementAccounts.js`
- Modify: `src/db.js`
- Test: `test/replacementAccounts.test.js`

**Steps:**
1. Write failing tests:
   - replacement account schema status default is `for_sale`;
   - default created account status is `for_sale`;
   - old input `pending` normalizes to `for_sale`;
   - old input `active` normalizes to `plus_active`;
   - old input `replaced` normalizes to `cpa_mounted`;
   - manual update accepts `unregistered`, `pending_activation`, `plus_active`, `cpa_mounted`, `for_sale`, `sold`, `banned`, `failed`;
   - manual update rejects `replacing`;
   - `markReplacementSuccess()` writes `cpa_mounted`;
   - fifth `markReplacementFailure()` writes `failed` and sets circuit breaker fields;
   - `resetCircuitBreaker()` clears breaker fields without changing `status`.
2. Run: `node --test test\replacementAccounts.test.js`
   - Expected RED failures around old `pending`, `active`, `replaced`, and `banned` behavior.
3. Implement minimal repository changes:
   - Define manual statuses as `unregistered`, `pending_activation`, `plus_active`, `cpa_mounted`, `for_sale`, `sold`, `banned`, `failed`.
   - Keep system-only `replacing`.
   - Add old-to-new normalization helper for incoming status values.
   - Default empty status to `for_sale`.
   - Update new database schema default to `for_sale`.
   - Update success to `cpa_mounted`.
   - Update fifth failure to `failed` with circuit breaker fields.
   - Make reset circuit breaker preserve the current `status`.
4. Run: `node --test test\replacementAccounts.test.js`
   - Expected GREEN.

### Task 2: API status filtering and automatic repair guards

**Files:**
- Modify: `src/replacementAccounts.js`
- Modify: `src/cpaCredentialMonitor.js`
- Modify: `src/cpaRepairWorker.js`
- Modify: `src/server.js`
- Test: `test/replacementAccountsApi.test.js`
- Test: `test/cpaCredentialMonitor.test.js`
- Test: `test/cpaRepairWorker.test.js`

**Steps:**
1. Write failing tests:
   - API create/update/status endpoints return normalized new statuses.
   - `GET /replacement-accounts?status=plus_active` filters new status.
   - `GET /replacement-accounts?circuit_breaker=1` returns only accounts with `circuit_breaker_at`.
   - repeated failed replace response contains account `status=failed` at circuit breaker threshold.
   - CPA monitor skips `status=banned`.
   - CPA monitor also skips accounts with `circuit_breaker_at` and reports/records `account_circuit_breaker`.
   - repair worker notification says account was automatically熔断, not automatically marked `banned`.
2. Run targeted tests and confirm RED:
   - `node --test test\replacementAccountsApi.test.js test\cpaCredentialMonitor.test.js test\cpaRepairWorker.test.js`
3. Implement minimal code:
   - Extend list query to accept `circuit_breaker=1`.
   - Update server list route to pass `circuit_breaker`.
   - Update CPA monitor skip condition for circuit breaker.
   - Update notification message text to remove “标记为 banned”.
   - Keep banned skip behavior unchanged.
4. Run targeted tests and confirm GREEN.

### Task 3: Frontend inline status select and filters

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `web/styles.css`
- Test: `test/replacementAccountsWeb.test.js`

**Steps:**
1. Write failing tests:
   - HTML status filter contains Chinese new states and “已熔断”.
   - app JS has status metadata mapping to Chinese labels.
   - account row renders a `select` in the status column.
   - inline select calls `/replacement-accounts/${id}/status`.
   - circuit breaker reset action is shown based on `circuit_breaker_at`, not `status === 'banned'`.
   - status legend uses Chinese labels.
2. Run: `node --test test\replacementAccountsWeb.test.js`
   - Expected RED.
3. Implement minimal frontend changes:
   - Replace filter options with new values and Chinese labels; use `value="circuit_breaker"` for the special filter.
   - Update `accountListQuery()` to send `circuit_breaker=1` for the special filter, otherwise `status`.
   - Add `statusOptions`/`statusLabels` metadata.
   - Render status column as inline select; show `已熔断` badge when `account.circuit_breaker_at`.
   - Add change handler that PATCHes status and reloads.
   - Remove old status dialog action from row menu if no longer needed.
   - Update batch replacement candidates to relevant new statuses, at minimum `banned`, `failed`, `for_sale`, `pending_activation`, `plus_active`.
4. Run: `node --test test\replacementAccountsWeb.test.js`
   - Expected GREEN.

### Task 4: Project API docs and work docs

**Files:**
- Modify: `docs/project/api.md`
- Modify: `docs/changes/CHG-052-replacement-account-status-model-and-inline-edit.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Modify/Create: `docs/work/2026-06-30-replacement-account-status-model.md`
- Modify: `docs/work/work-log.md`
- Optional final-day update: `docs/work/handoff.md`

**Steps:**
1. Update `docs/project/api.md` status enum and circuit breaker behavior.
2. Mark `CHG-052` as `implemented` after code and tests pass.
3. Add work log with commands run and files changed.
4. Update `docs/work/work-log.md`.
5. Only update `docs/work/handoff.md` if this is the final handoff for the day.

### Final verification

Run:

```powershell
node --test test\replacementAccounts.test.js test\replacementAccountsApi.test.js test\replacementAccountsWeb.test.js test\cpaCredentialMonitor.test.js test\cpaRepairWorker.test.js
node --check .\src\replacementAccounts.js
node --check .\src\db.js
node --check .\src\server.js
node --check .\src\cpaCredentialMonitor.js
node --check .\src\cpaRepairWorker.js
node --check .\web\app.js
```

Expected: all selected tests pass and all syntax checks exit 0.
