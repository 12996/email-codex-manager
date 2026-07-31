# 2026-07-31 补号邮箱 API 查询数量限制

- 状态：done
- 目标：Plus 状态查询显式读取最近 5 封邮件，避免仅返回最新邮件遗漏订阅确认邮件。
- 修改文件：`src/replacementEmailApiService.js`、`src/replacementPlusStatusService.js`、`test/replacementEmailApiService.test.js`、`test/replacementPlusStatusService.test.js`、`docs/project/api.md`、`docs/changes/CHG-101-replacement-email-api-query-limit.md`。
- 验证结果：`node --test test/replacementEmailApiService.test.js test/replacementPlusStatusService.test.js test/replacementAccountsApi.test.js` 57/57 通过；实际账号 `10-buff-tactile@icloud.com` 的 API 在 `limit=5` 下返回 5 封邮件，第 2 封 `ChatGPT - Your new plan` 命中，账号 `209` 已回写 `plus_active`。全量 `npm test` 的本次代码相关用例通过，但既有 `test/test-verification-code.mjs` 因未启动 `localhost:3100` 而失败。
- 未完成 / 风险：仅使用该邮箱 API 支持的 `limit` 参数；若后续接入不支持该参数的提供方，应记录接口失败或兼容策略。
- 下一步：重启运行中的服务后，从补号管理页再次执行批量“查询 Plus 状态”即可使用新逻辑。
- 日终交接：已更新 `handoff.md`。
