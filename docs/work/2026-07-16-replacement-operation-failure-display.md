# 2026-07-16 补号操作失败状态展示修正

- 目标：历史 `failed` 账号统一改为 `banned`；服务操作失败不再污染账号业务状态。
- 实现：移除 `failed` 账号状态，补号失败恢复原状态，错误复用 `last_error` 并由前端显示简短红字；未新增数据库字段。
- 兼容：旧状态输入和启动时数据库迁移均将 `failed` 映射为 `banned`。
- 关联 change：`docs/changes/CHG-085-replacement-operation-failure-not-status.md`
- 现存迁移账号：`replacement_accounts.id` 为 `4`、`17`、`22`、`46`、`64`、`65`、`66`、`76` 的历史 `failed` 行。
- 验证：专项测试、全量 JavaScript 测试、语法检查、`git diff --check` 通过；服务重启后数据库不再存在原始 `status='failed'`。
