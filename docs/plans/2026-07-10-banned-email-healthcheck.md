# Banned Email Healthcheck Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a manual "一键验活" button that checks eligible Plus-related replacement accounts for ChatGPT deactivation emails and marks matched accounts as `banned`.

**Architecture:** Add a small service module for deactivation email matching and batch orchestration. Expose it through a new authenticated API route and wire a front-end toolbar button to call it and show the batch summary.

**Tech Stack:** Node.js ESM, Express, better-sqlite3 repository pattern, IMAP service abstraction, vanilla browser JavaScript, `node --test`.

---

### Task 1: Core service tests

**Files:**
- Create: `test/accountHealthcheckService.test.js`
- Create: `src/accountHealthcheckService.js`
- Modify: `src/replacementAccounts.js`

**Steps:**
1. Write failing tests for:
   - eligible statuses are `plus_active`, `cpa_mounted`, `for_sale`, `sold`.
   - deactivation email matching requires target email and stable deactivation phrases.
   - matching account is marked `banned`.
   - IMAP errors are reported without status changes.
2. Run `node --test test/accountHealthcheckService.test.js` and verify failures are from missing exports.
3. Implement the service and repository helpers:
   - `listBannedHealthcheckCandidates()`
   - `markBannedByHealthcheck(id, note)`
   - `messageIndicatesChatGptDeactivation(message, email)`
   - `runBannedEmailHealthcheck({...})`
4. Re-run the test until green.

### Task 2: API route tests

**Files:**
- Modify: `test/replacementAccountsApi.test.js`
- Modify: `src/server.js`

**Steps:**
1. Write a failing API test for `POST /replacement-accounts/healthcheck-banned`.
2. Verify it fails with 404.
3. Add route wiring that calls the service and returns `{ ok: true, result }`.
4. Re-run the focused API test.

### Task 3: Front-end button tests and UI wiring

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `test/replacementAccountsWeb.test.js`

**Steps:**
1. Write a failing web test that asserts the button exists and the front-end script calls `/replacement-accounts/healthcheck-banned`.
2. Add toolbar button `一键验活`.
3. Add `healthcheckBannedAccounts()` handler with confirmation, POST call, activity log, toast summary, and list refresh.
4. Re-run focused web tests.

### Task 4: Docs and verification

**Files:**
- Create: `docs/changes/CHG-076-banned-email-healthcheck-button.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Create: `docs/work/2026-07-10-banned-email-healthcheck-button.md`

**Steps:**
1. Record the implemented behavior and rollback plan in the change file.
2. Add the registry row.
3. Add a concise work log.
4. Run focused tests, then `npm test` if focused tests pass.
