# 补号邮箱 API 状态查询实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Plus 状态查询和一键验活只读取每个补号账号配置的 `email_code_api`，未配置账号跳过且不访问 IMAP。

**Architecture:** 新增共享邮箱 API 读取/响应归一化模块。两个状态检查服务筛选可查询账号、调用该模块并保留现有邮件匹配和状态写回逻辑；服务器继续复用 SSE，前端在摘要中增加跳过数量。

**Tech Stack:** Node.js ESM、原生 `fetch`、SQLite repository、Node test runner、SSE。

---

### Task 1: Add failing tests for the API source contract

**Files:**
- Create: `test/replacementEmailApiService.test.js`
- Modify: `test/replacementPlusStatusService.test.js`
- Modify: `test/accountHealthcheckService.test.js`

**Steps:**
1. Test a JSON full-mail response is normalized to subject/body/date/recipient fields.
2. Test Plus status calls the injected email API, skips a registered account without `email_code_api`, and never calls IMAP.
3. Test banned healthcheck follows the same source and skip rule.
4. Run `node --test test/replacementEmailApiService.test.js test/replacementPlusStatusService.test.js test/accountHealthcheckService.test.js`; confirm failures describe the missing API source and skip behavior.

### Task 2: Implement shared account email API reading

**Files:**
- Create: `src/replacementEmailApiService.js`

**Steps:**
1. Validate the configured URL and issue a GET with a bounded timeout.
2. Parse JSON, HTML, or text responses without exposing message bodies in errors.
3. Normalize common wrapper fields and full-mail fields into the existing message shape.
4. Throw a clear error for HTTP failures or responses without usable mail content.
5. Run the API service test and confirm it passes.

### Task 3: Switch Plus and banned checks to the account API

**Files:**
- Modify: `src/replacementPlusStatusService.js`
- Modify: `src/accountHealthcheckService.js`

**Steps:**
1. Partition eligible accounts into queryable and skipped sets using non-empty `email_code_api`.
2. Emit skip progress events and add `skipped`/`skippedAccounts` to results.
3. Call the shared API reader for queryable accounts only.
4. Keep existing matching rules and status transitions unchanged.
5. Run both service tests and confirm all pass.

### Task 4: Update progress summaries and documentation

**Files:**
- Modify: `web/app.js`
- Modify: `docs/project/api.md`
- Create: `docs/changes/CHG-080-replacement-status-email-api-source.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Create: `docs/work/2026-07-14-replacement-status-email-api-source.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Steps:**
1. Add skipped counts to both progress summaries.
2. Document that no API means no query and no IMAP fallback.
3. Record the actual API response contract and error behavior in the change/work docs.
4. Run documentation diff checks.

### Task 5: Verify and commit

**Steps:**
1. Run focused tests for the new service and both status checks.
2. Run `node --test test/*.test.js`.
3. Run `node --check` on modified JavaScript files and `git diff --check`.
4. Restart the local `13100` service and verify the real API source appears in progress output.
5. Commit with `feat: use account email api for status checks`.

