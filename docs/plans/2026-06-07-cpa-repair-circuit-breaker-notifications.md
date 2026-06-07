# CPA Repair Circuit Breaker Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 自动补号连续失败 5 次后熔断账号，标记为 `banned`，并在后台铃铛 UI 中通知管理员。

**Architecture:** 失败计数与熔断状态落在 `replacement_accounts`，站内通知落在新表 `admin_notifications`。`cpaRepairWorker` 在补号失败时调用仓库方法完成失败计数、熔断和通知创建；前端顶部铃铛通过通知 API 展示未读数量与最近通知。

**Tech Stack:** Node.js ESM、better-sqlite3、Express、静态 HTML/CSS/JS、Node test runner。

---

### Task 1: Add failing repository tests

**Files:**
- Modify: `test/replacementAccounts.test.js`
- Test: `test/replacementAccounts.test.js`

**Steps:**
1. 写测试：前 4 次失败只递增 `consecutive_replace_failures` 并保持 `failed`。
2. 写测试：第 5 次失败将账号改为 `banned`，写入 `circuit_breaker_at` 和原因。
3. 写测试：补号成功清零连续失败计数。
4. 运行 `npm test -- test/replacementAccounts.test.js`，预期失败，原因是字段或方法不存在。

### Task 2: Implement account failure counter and breaker

**Files:**
- Modify: `src/db.js`
- Modify: `src/replacementAccounts.js`
- Test: `test/replacementAccounts.test.js`

**Steps:**
1. 给 `replacement_accounts` 增加 `consecutive_replace_failures`、`circuit_breaker_at`、`circuit_breaker_reason`。
2. 更新 `markReplacementFailure()`，失败计数 +1；达到 5 次时状态改为 `banned`。
3. 更新 `markReplacementSuccess()` 清零失败计数和熔断字段。
4. 运行 `npm test -- test/replacementAccounts.test.js`，预期通过。

### Task 3: Add failing notification tests

**Files:**
- Create: `test/adminNotifications.test.js`
- Create: `test/adminNotificationsApi.test.js`
- Test: notification tests

**Steps:**
1. 写仓库测试：创建通知、统计未读、标记已读。
2. 写 API 测试：`GET /admin-notifications` 返回通知和未读数，`PATCH /admin-notifications/:id/read` 可标记已读。
3. 运行通知测试，预期失败，原因是模块/API 不存在。

### Task 4: Implement notifications

**Files:**
- Modify: `src/db.js`
- Create: `src/adminNotifications.js`
- Modify: `src/server.js`
- Test: notification tests

**Steps:**
1. 新增 `admin_notifications` 表。
2. 新增通知仓库。
3. 在 `cpaRepairWorker` 注入可选 `adminNotifications`，仅当失败触发熔断时创建通知。
4. 增加通知 API。
5. 运行通知测试和 `test/cpaRepairWorker.test.js`。

### Task 5: Wire notification UI

**Files:**
- Modify: `web/index.html`
- Modify: `web/accounts.html`
- Modify: `web/app.js`
- Modify: `web/accounts.js`
- Modify: `web/styles.css`

**Steps:**
1. 将静态铃铛数量改为可点击按钮和空弹层容器。
2. 页面加载时请求 `/admin-notifications?limit=5`。
3. 渲染未读数量、最近通知和标记已读操作。
4. 运行现有前端/视图测试。

### Task 6: Update docs

**Files:**
- Create: `docs/changes/CHG-041-cpa-repair-circuit-breaker-notifications.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Modify: `docs/prd/PRD-002-account-management-system.md`
- Modify: `docs/project/api.md`
- Modify: `docs/work/2026-06-07-cpa-repair-circuit-breaker-notifications.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Steps:**
1. 记录 change。
2. 更新 PRD 与 API 文档中的熔断、通知和验收标准。
3. 更新工作日志和交接。
