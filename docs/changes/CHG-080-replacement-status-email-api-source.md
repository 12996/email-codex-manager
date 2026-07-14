# CHG-080 补号状态检查使用账号邮箱 API

状态：implemented
创建日期：2026-07-14
关联 PRD：PRD-003
关联变更：CHG-078、CHG-079
影响范围：补号 Plus 状态查询、一键验活、进度窗口、接口文档和测试

## 背景

`replacement_accounts.email_code_api` 实际可以返回完整邮件内容。此前状态检查仍通过 IMAP 读取共享收件箱，iCloud 账号因此都读取 `.env` 中的 `ICLOUD_CODE_GMAIL_ACCOUNT`，无法保证按账号隔离。

## 变更内容

- Plus 状态查询和一键验活改为调用每个账号自己的 `email_code_api`，请求方式为 GET。
- `email_code_api` 为空或空白的账号直接跳过，不读取 IMAP、默认 Gmail 或共享收件箱。
- 邮箱 API 支持完整 JSON 邮件对象、JSON 数组以及 HTML/text 邮件响应。
- API 请求失败或没有返回完整邮件内容时，该账号计入失败，状态不改变，不回退 IMAP。
- 进度窗口和批量结果增加跳过数量及跳过账号记录，并显示邮箱 API 来源。
- Plus 命中仍更新为 `plus_active`，验活命中仍更新为 `banned`。

## 验收标准

- [x] 只有 `registered` 且配置 `email_code_api` 的账号参与 Plus 查询。
- [x] 只有允许验活状态且配置 `email_code_api` 的账号参与一键验活。
- [x] 没有 `email_code_api` 的账号不会调用 IMAP，状态保持不变，并出现在 `skippedAccounts`。
- [x] 账号 API 返回用户提供的完整 OpenAI 邮件时可以命中 Plus 文案。
- [x] 邮箱 API 失败或返回验证码-only 响应时不会误判 Plus，并记录失败原因。
- [x] SSE 和普通 JSON 结果包含 `checked`、`skipped`、`failed` 等汇总字段。
- [x] 注册、补号和 2FA 流程原有验证码 API 优先级不变。

## 实现记录

- 新增 `src/replacementEmailApiService.js`，统一请求和归一化账号邮箱 API 响应。
- `src/replacementPlusStatusService.js`、`src/accountHealthcheckService.js` 改用邮箱 API 服务。
- `src/server.js` 增加可注入的 `replacementEmailApiService`，便于 API 测试和后续替换实现。
- `web/app.js` 的进度摘要增加跳过数量。
- 增加共享 API、Plus 服务、验活服务和批量 API 回归测试。

## 回滚

恢复 CHG-078/CHG-079 中的 IMAP 数据源实现，并移除 `replacementEmailApiService` 注入即可；本变更不修改已有账号状态数据。
