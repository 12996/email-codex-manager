# 补号邮箱 API 邮件数量设计

## 目标

Plus 状态查询请求每个补号账号的邮箱 API 时，显式读取最近 5 封邮件，避免仅返回最新邮件而遗漏订阅确认邮件。

## 设计

- 在 `fetchReplacementEmailMessages()` 中解析账号已保存的完整 `email_code_api` URL。
- 保留 URL 中的原有参数（包括 `email` 和鉴权参数），将 `limit` 设置为 `5`；已有 `limit` 也统一覆盖为 `5`。
- 其余请求、响应归一化、Plus 匹配及状态更新逻辑保持不变。
- API 文档明确 Plus 状态查询以 `limit=5` 请求邮箱 API。

## 验收

- 实际账号 API 在带 `limit=5` 时返回 5 封邮件，其中含 Plus 订阅确认邮件。
- 单元测试验证原有参数保留且请求 URL 含 `limit=5`。
- Plus 状态查询能在多封响应中命中非最新的订阅确认邮件。
