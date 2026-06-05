# 2026-06-05 自动化运行日志最大保留数量

- 目标：让补号/注册自动化日志支持最大保留条数，默认 30，避免数据库记录和本地日志文件长期堆积。
- 关联 change：`docs/changes/CHG-036-automation-log-retention-limit.md`
- 修改文件：`src/config.js`、`src/replacementAutomationRuns.js`、`src/server.js`、`.env.example`、`test/`、`docs/project/api.md`、`docs/prd/PRD-002-account-management-system.md`
- 结果：
  - 新增 `.env` 配置 `REPLACEMENT_AUTOMATION_LOG_MAX_RUNS=30`。
  - `replacement_automation_runs` 创建新运行记录后，会按配置保留最近记录。
  - 超出范围的非 `running` 旧记录会删除数据库行，并同步删除日志文件。
  - `running` 记录不会自动清理。
- 验证：
  - RED：新增测试在旧逻辑下失败，证明旧仓库不会清理旧运行记录，配置解析函数不存在。
  - GREEN：`npm test -- test\replacementAccounts.test.js` 通过，21/21 pass。
  - GREEN：`npm test -- test\cpaConfig.test.js` 通过，3/3 pass。
