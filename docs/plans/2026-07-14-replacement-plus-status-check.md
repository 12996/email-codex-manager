# 补号账号 Plus 状态查询 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为补号管理页增加只查询 `registered` 账号的 Plus 邮件状态查询，并在命中后更新为 `plus_active`。

**Architecture:** 新增独立状态查询服务，复用 `mailService.fetchMessages` 和现有 Gmail/iCloud 收件箱映射。仓储提供候选账号和结果写回方法，服务按账号隔离错误；Express 增加认证批量接口，前端增加手动按钮并刷新列表。

**Tech Stack:** Node.js ESM、Express、SQLite/better-sqlite3、ImapFlow、原生 HTML/CSS/JavaScript、Node test runner。

---

### Task 1: Add failing Plus matcher and service tests

**Files:**
- Create: `test/replacementPlusStatusService.test.js`

**Step 1: Write the failing tests**

Cover:

- Exact Plus subscription markers are recognized, including curly apostrophe.
- An unrelated email or non-target recipient is rejected.
- Only `registered` accounts are queried.
- A matching email changes the account to `plus_active`.
- A miss leaves `registered` unchanged.
- An IMAP/mailbox failure leaves `registered` unchanged and appears in failures.

**Step 2: Run the focused test**

Run: `node --test test/replacementPlusStatusService.test.js`

Expected: FAIL because the service and repository methods do not exist yet.

---

### Task 2: Implement repository state-check methods

**Files:**
- Modify: `src/replacementAccounts.js`
- Test: `test/replacementAccounts.test.js`

**Step 1: Add repository tests**

Verify a candidate query returns only non-deleted `registered` accounts and that the positive result writes `plus_active`, `status_updated_at`, status note, and clears `last_error. Verify a failure method records an error without changing status.

**Step 2: Run the focused repository tests**

Run: `node --test test/replacementAccounts.test.js`

Expected: FAIL until the repository methods exist.

**Step 3: Implement minimal methods**

Add methods for listing registered status-check candidates, marking Plus success, and recording a status-check failure. Keep all other account fields unchanged.

**Step 4: Run the focused repository tests**

Run: `node --test test/replacementAccounts.test.js`

Expected: PASS.

---

### Task 3: Implement Plus status service

**Files:**
- Create: `src/replacementPlusStatusService.js`
- Test: `test/replacementPlusStatusService.test.js`

**Step 1: Implement the matcher**

Normalize subject/preview/body text and require the three approved OpenAI Plus markers. Use recipient headers when present to prevent shared iCloud mailbox cross-account matches.

**Step 2: Implement the batch runner**

Use the existing `deriveMainGmailAccount`, `accounts.getAccountByGmailEmail`, `icloudCodeDefaultGmailAccount`, and `mailService.fetchMessages`. Read the recent inbox messages with `targetEmail` and isolate errors per account.

**Step 3: Run the focused service tests**

Run: `node --test test/replacementPlusStatusService.test.js`

Expected: PASS.

---

### Task 4: Add authenticated API and API regression tests

**Files:**
- Modify: `src/server.js`
- Test: `test/replacementAccountsApi.test.js`

**Step 1: Add the failing API test**

Test `POST /replacement-accounts/check-plus-status` with one matching registered account, one clean registered account, one non-registered account, and one failure. Assert the summary and persisted statuses.

**Step 2: Run the API test**

Run: `node --test test/replacementAccountsApi.test.js`

Expected: FAIL until the route exists.

**Step 3: Add the route**

Inject the service dependencies through `createApp`, require admin authentication, return `{ ok: true, result }`, and use existing API error handling for service-level failures.

**Step 4: Run the API test**

Run: `node --test test/replacementAccountsApi.test.js`

Expected: PASS.

---

### Task 5: Add frontend action and regression checks

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Test: `test/replacementAccountsWeb.test.js`

**Step 1: Add frontend assertions**

Assert the toolbar button, API path, confirmation text, result summary, activity log, toast, and list reload are present.

**Step 2: Run the frontend test**

Run: `node --test test/replacementAccountsWeb.test.js`

Expected: FAIL until the controls and handler exist.

**Step 3: Implement the button handler**

Add the button near the existing healthcheck action. Confirm that only registered accounts are queried, call the API, display counts, log the action, and reload accounts on success or failure.

**Step 4: Run the frontend test**

Run: `node --test test/replacementAccountsWeb.test.js`

Expected: PASS.

---

### Task 6: Update project documentation and verify the whole change

**Files:**
- Modify: `docs/project/api.md`
- Create: `docs/work/2026-07-14-replacement-plus-status-check.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`
- Modify: `docs/changes/CHG-078-replacement-plus-status-check.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`

**Step 1: Document the endpoint and matching behavior**

Record candidate scope, status transitions, failure behavior, and the fact that `email_code_api` is not used as a full-mail source.

**Step 2: Mark the change implemented**

Update CHG-078 and the daily work/handoff entries after verification.

**Step 3: Run syntax, focused, and full tests**

Run:

```powershell
node --check src/replacementPlusStatusService.js
node --test test/replacementPlusStatusService.test.js test/replacementAccounts.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js
node --test test/*.test.js
git diff --check
```

Expected: all relevant tests pass; any unrelated `npm test` environment failure is recorded rather than hidden.

**Step 4: Commit the implementation**

```powershell
git add src/replacementPlusStatusService.js src/replacementAccounts.js src/server.js web test docs
git commit -m "feat: add replacement plus status check"
```
