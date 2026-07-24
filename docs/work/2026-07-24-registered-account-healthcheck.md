# 2026-07-24 已注册账号纳入一键验活

- 一键验活候选状态新增 `registered`，仍仅处理配置了 `email_code_api` 的账号。
- 已注册账号命中 ChatGPT deactivation 邮件后，与其他候选状态一致，更新为 `banned`。
- “查询 Plus 状态”继续只查询 `registered` 账号，不受本次变更影响。
- 验证：API、前端专项测试通过；已补回归用例覆盖已注册账号命中封禁邮件。
