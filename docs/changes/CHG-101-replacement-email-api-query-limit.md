# CHG-101 补号邮箱 API 查询数量限制

状态：implemented
创建日期：2026-07-31
关联 PRD：PRD-003
关联 Issue：
影响范围：Plus 状态查询、补号邮箱 API、接口文档、测试

## 背景

部分邮箱 API 默认只返回最新一封邮件。Plus 订阅确认邮件不是最新邮件时，Plus 状态查询无法命中。

## 变更内容

- Plus 状态查询通过账号保存的 `email_code_api` 请求邮件时，显式追加或覆盖 `limit=5`。
- 保留账号 URL 中既有 query 参数，不修改数据库内保存的 URL。
- 接口文档和回归测试记录固定读取最近 5 封邮件的约定。

## 验收标准

- [x] 实际请求 URL 包含 `limit=5` 且保留原有参数。
- [x] 邮箱 API 返回多封邮件时，Plus 查询可命中非最新的订阅确认邮件。
- [x] 原有邮件响应归一化和失败处理不变。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：2026-07-31 实测 `10-buff-tactile@icloud.com` 的邮箱 API 返回 5 封邮件，并命中第 2 封 `ChatGPT - Your new plan`，账号状态已回写为 `plus_active`。
