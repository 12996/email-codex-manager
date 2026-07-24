# Registered Account Healthcheck Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `registered` 状态的补号账号纳入一键验活封禁邮件检查。

**Architecture:** 保持现有 `POST /replacement-accounts/healthcheck-banned`、邮件 API 和封禁判定不变，仅扩展仓储候选状态集合。前端确认文案与项目文档同步更新；“查询 Plus 状态”仍只处理 `registered` 账号。

**Tech Stack:** Node.js、Express、SQLite、node:test。

---

### Task 1: 覆盖已注册账号的候选筛选

**Files:**
- Modify: `test/replacementAccountsApi.test.js:386-450`
- Modify: `src/replacementAccounts.js:102-110`

**Step 1: Write the failing test**

在现有一键验活 API 测试中，为 `registered` 账号配置 `email_code_api` 和匹配的封禁邮件；断言批量结果包含该账号，并且其状态更新为 `banned`。

**Step 2: Run test to verify it fails**

Run: `npm test -- test\\replacementAccountsApi.test.js`

Expected: FAIL，因为仓储候选筛选忽略 `registered` 状态。

**Step 3: Write minimal implementation**

在 `listBannedHealthcheckCandidates()` 的 SQL 和归一化状态白名单中加入 `registered`，不修改邮件匹配、失败处理或状态写回逻辑。

**Step 4: Run test to verify it passes**

Run: `npm test -- test\\replacementAccountsApi.test.js`

Expected: PASS。

### Task 2: 更新前端确认信息与项目文档

**Files:**
- Modify: `web/app.js:759-766`
- Modify: `test/replacementAccountsWeb.test.js`
- Modify: `docs/changes/CHG-076-banned-email-healthcheck-button.md`
- Modify: `docs/project/api.md:819,1171-1182`

**Step 1: Write the failing test**

断言一键验活确认文案包含 `registered`，避免前后端候选范围不一致。

**Step 2: Run test to verify it fails**

Run: `npm test -- test\\replacementAccountsWeb.test.js`

Expected: FAIL，因为当前文案未列出 `registered`。

**Step 3: Write minimal implementation**

将确认文案加入 `registered`，并更新 change 记录和 API 说明中的候选状态及验收标准。

**Step 4: Run test to verify it passes**

Run: `npm test -- test\\replacementAccountsWeb.test.js`

Expected: PASS。

### Task 3: 回归验证与工作记录

**Files:**
- Create: `docs/work/2026-07-24-registered-account-healthcheck.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Step 1: Run focused regression suite**

Run: `npm test -- test\\replacementAccountsApi.test.js test\\replacementAccountsWeb.test.js`

Expected: PASS，且 Plus 状态查询仍仅针对 `registered` 账号。

**Step 2: Record completed work**

记录需求范围、测试结果和“不改变 Plus 查询范围”的约束。
