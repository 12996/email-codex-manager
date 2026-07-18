# CHG-085 补号操作失败不占用账号状态

状态：implemented
创建日期：2026-07-16
关联 PRD：PRD-003
影响范围：`src/db.js`、`src/replacementAccounts.js`、`src/server.js`、`src/cpaRepairWorker.js`、`src/accountHealthcheckService.js`、`web/`、`test/`

## 背景

`failed` 同时被用作自动化执行失败和账号业务状态，导致邮箱 API 超时、补号失败等中间态把账号误显示为“失败”。用户要求历史 `failed` 账号统一按账号封禁处理，后续操作失败只显示操作失败，不改变账号本身状态。

## 变更内容

- 删除 `failed` 在补号账号业务状态中的使用；历史数据库行和旧输入 `failed` 统一映射为 `banned`。
- 启动时将现存原始 `status='failed'` 行迁移为 `banned`，不新增数据库字段。
- 补号、2FA 补号和 CPA repair 失败时恢复操作前业务状态，仅递增熔断计数并记录错误。
- 注册、2FA 登录、JSON 获取、Plus 查询、一键验活和 SMS 操作失败复用现有错误字段，并增加简短操作前缀。
- 状态下方仅显示一行简短红字，例如“补号失败”“查询 Plus 失败”；详细原因仍保存在现有错误字段和运行日志中。

## 验收标准

- [x] 历史原始 `failed` 账号统一为 `banned`。
- [x] 新的操作失败不再写入账号状态 `failed`。
- [x] 补号失败恢复操作前业务状态，`replacement_count` 不增加。
- [x] 状态旁显示简短红色操作失败提示，不增加数据库字段。
- [x] 专项测试 81/81 通过；全量 JavaScript 测试通过。

## 回滚

回滚本 change 对应的代码、测试和文档；数据库迁移为可逆的状态值修正，若需恢复历史值应单独确认后执行，不自动回写 `failed`。
