# CHG-041 CPA 自动补号连续失败熔断与站内通知

状态：merged
创建日期：2026-06-07
关联 PRD：PRD-002
影响范围：`src/db.js`, `src/replacementAccounts.js`, `src/cpaRepairWorker.js`, `src/adminNotifications.js`, `src/server.js`, `web/`, `test/`, `docs/project/api.md`, `docs/prd/PRD-002-account-management-system.md`

## 背景

CPA 健康监控发现 `auth_expired` 后会自动补号。部分账号长期无法补号成功，如果持续进入自动补号队列，会重复消耗 Roxy、Playwright、验证码和 CPA 上传资源。

## 变更内容

- 补号账号新增连续失败计数：`consecutive_replace_failures`。
- 补号失败时连续失败次数递增；补号成功时清零。
- 同一补号账号连续失败达到 5 次时，自动将账号状态改为 `banned`。
- 熔断时写入 `circuit_breaker_at` 与 `circuit_breaker_reason`。
- 新增 `admin_notifications` 站内通知表。
- CPA repair worker 在触发熔断时创建未读通知，提醒管理员该账号已连续补号失败并自动停止自动补号。
- 顶部铃铛 UI 改为真实通知入口，显示未读数量，可查看最近通知并标记已读。
- 新增“解除熔断”专用操作：管理员可将已熔断账号恢复到 `pending`，并清零连续失败次数和熔断字段。

## 验收标准

- [x] 连续失败 1-4 次时，账号状态为 `failed`，失败计数递增，不触发熔断。
- [x] 第 5 次连续失败时，账号状态变为 `banned`，写入熔断时间和原因。
- [x] 补号成功时清零连续失败计数和熔断字段。
- [x] CPA repair worker 熔断账号时创建未读站内通知。
- [x] 管理员可通过顶部铃铛看到未读通知数量和最近通知，并可标记已读。
- [x] 管理员可在补号管理页通过独立按钮解除熔断，解除后账号回到 `pending`。

## 验证

- RED：新增测试失败于通知模块不存在、熔断字段不存在、worker 未创建通知。
- GREEN：`npm test -- test/replacementAccounts.test.js test/adminNotifications.test.js test/adminNotificationsApi.test.js test/cpaRepairWorker.test.js` 通过，32/32 pass。
- 回归：`npm test` 通过，211/211 pass。
- 语法检查：`node --check .\src\server.js`、`node --check .\src\replacementAccounts.js`、`node --check .\src\cpaRepairWorker.js`、`node --check .\src\adminNotifications.js`、`node --check .\web\notifications.js` 均通过。

## 未完成 / 风险

- 邮件通知未实现；当前仅做站内通知。
- 尚未执行真实 CPA 守护进程实机熔断链路，只完成单元/API 回归。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-07
- 备注：已合并到 PRD-002 的补号账号数据模型、CPA 自动补号规则、站内通知能力和验收标准。
