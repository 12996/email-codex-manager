# 2026-06-07 CPA 自动补号连续失败熔断与站内通知

## 背景

用户要求 CPA 守护进程自动补号时，如果同一个补号账号连续失败 5 次，就停止继续自动补号，账号进入 `banned`，并通知管理员。

## 变更

- 新增补号账号连续失败计数与熔断字段：
  - `consecutive_replace_failures`
  - `circuit_breaker_at`
  - `circuit_breaker_reason`
- `markReplacementFailure()` 失败计数 +1；达到 5 次时自动将账号状态改为 `banned`。
- `markReplacementSuccess()` 清零连续失败计数和熔断字段。
- 新增 `admin_notifications` 表和 `src/adminNotifications.js` 仓库。
- 新增通知 API：
  - `GET /admin-notifications`
  - `PATCH /admin-notifications/:id/read`
- `src/cpaRepairWorker.js` 在失败触发熔断时创建站内通知。
- 顶部铃铛 UI 改为真实通知入口，显示未读数量、最近通知和“已读”操作。
- 补号管理页新增“解除熔断”操作，仅对 `banned` 且有熔断时间的账号显示；操作后账号回到 `pending` 并清空连续失败和熔断字段。
- 新增 change：`docs/changes/CHG-041-cpa-repair-circuit-breaker-notifications.md`。
- 更新 `docs/prd/PRD-002-account-management-system.md` 和 `docs/project/api.md`。

## 验证

- RED：新增测试失败于通知模块不存在、熔断字段不存在、worker 未创建通知。
- GREEN：`npm test -- test/replacementAccounts.test.js test/adminNotifications.test.js test/adminNotificationsApi.test.js test/cpaRepairWorker.test.js` 通过，32/32 pass。
- fallback RED/GREEN：新增 direct replacement API 第 5 次失败通知测试，旧逻辑失败于未创建通知；修复后 `npm test -- test/replacementAccountsApi.test.js` 通过，13/13 pass。
- 解除熔断 RED/GREEN：新增仓库/API 测试，旧逻辑失败于 `resetCircuitBreaker is not a function` 和路由不存在；修复后 `npm test -- test/replacementAccounts.test.js test/replacementAccountsApi.test.js` 通过，41/41 pass。
- 回归：`npm test` 通过，211/211 pass。
- 语法检查：`node --check .\src\server.js`、`node --check .\src\replacementAccounts.js`、`node --check .\src\cpaRepairWorker.js`、`node --check .\src\adminNotifications.js`、`node --check .\web\notifications.js` 均通过。

## 未完成 / 风险

- 当前只实现站内通知，未实现邮件通知。
- 尚未执行真实 CPA 守护进程实机熔断链路。
