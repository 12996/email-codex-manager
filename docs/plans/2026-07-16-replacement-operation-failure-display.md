# Replacement Operation Failure Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep replacement account business statuses stable when an operation fails and show only a concise red operation-failure hint beside the status.

**Architecture:** Do not add database columns. Remove `failed` from the account status model, restore the pre-operation business status after replacement failures, and reuse existing error fields with an operation prefix. The frontend derives a short label such as `补号失败` or `查询 Plus 失败` from those existing error fields and renders it below the status selector.

**Tech Stack:** Node.js ESM, Express, better-sqlite3, vanilla browser JavaScript, `node --test`.

---

### Task 1: Add failing repository and UI regression tests

**Files:**
- Modify: `test/replacementAccounts.test.js`
- Modify: `test/replacementAccountsApi.test.js`
- Modify: `test/replacementAccountsWeb.test.js`

**Steps:**
1. Assert replacement failure restores the original business status and prefixes the existing error with the operation label.
2. Assert legacy `failed` status normalizes/migrates to `banned` and manual status updates cannot persist `failed`.
3. Assert API replacement failures return the original status, not `failed`.
4. Assert the frontend removes `failed` from status controls and renders a compact red operation-failure label.
5. Run the focused tests and verify they fail against the current implementation.

### Task 2: Change repository status and failure persistence

**Files:**
- Modify: `src/db.js`
- Modify: `src/replacementAccounts.js`

**Steps:**
1. Add the legacy `failed -> banned` status mapping and remove `failed` from accepted business statuses.
2. Migrate existing raw `failed` rows to `banned` during schema initialization.
3. Make replacement failure restore the caller-provided pre-operation status while preserving circuit-breaker counters.
4. Prefix existing error fields with concise operation names; do not add columns.
5. Keep successful operations clearing the relevant existing error field.

### Task 3: Update operation call sites and frontend display

**Files:**
- Modify: `src/server.js`
- Modify: `src/cpaRepairWorker.js`
- Modify: `src/accountHealthcheckService.js`
- Modify: `web/app.js`
- Modify: `web/index.html`
- Modify: `web/styles.css`

**Steps:**
1. Pass the pre-operation status and operation label into replacement failure handling.
2. Persist concise operation prefixes for registration, login, healthcheck, JSON, SMS, and Plus failures using existing fields.
3. Remove the `failed` status option/filter/statistic from the frontend.
4. Render one small red line under the status selector using only `XXX失败`; keep detailed errors in existing detail/error views.

### Task 4: Update documentation and migrate the current database

**Files:**
- Modify: `docs/project/api.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Create: `docs/changes/CHG-085-replacement-operation-failure-not-status.md`
- Create: `docs/work/2026-07-16-replacement-operation-failure-display.md`

**Steps:**
1. Document that `failed` is not an account status and that operation failures preserve business status.
2. Record the five existing raw `failed` rows as migrated to `banned`.
3. Update the daily work log and handoff after verification.

### Task 5: Verify

**Commands:**
- `node --test test/replacementAccounts.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js`
- `node --test test/*.test.js`
- `node --check src/replacementAccounts.js`
- `node --check src/server.js`
- `node --check web/app.js`
- `git diff --check`

**Expected:** All tests pass, no syntax or whitespace errors, and the live database has no raw `status='failed'` rows.
