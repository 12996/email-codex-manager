# 补号状态检查使用账号邮箱 API 设计

- 状态：approved
- 创建日期：2026-07-14
- 关联功能：补号 Plus 状态查询、一键验活

## 背景

补号账号表中的 `email_code_api` 实际可以返回完整邮件内容，而不是只有 6 位验证码。当前 Plus 状态查询和一键验活仍通过 IMAP 读取共享 Gmail 收件箱，导致 iCloud 账号都显示读取同一个 `ICLOUD_CODE_GMAIL_ACCOUNT`。

## 决策

1. Plus 状态查询和一键验活都优先、且仅使用账号行自己的 `email_code_api`。
2. `email_code_api` 为空或只有空白的账号直接跳过，不读取 IMAP、不读取默认 Gmail、不改变账号状态。
3. `email_code_api` 通过 GET 请求读取，支持 JSON 完整邮件对象、JSON 数组和 HTML/text 响应；至少需要能解析出主题或正文。
4. API 请求失败或返回不完整邮件时，将该账号记为失败，不回退到 IMAP，避免回到共享收件箱造成串号。
5. Plus 命中后仍只把 `registered` 改为 `plus_active`；验活命中后仍把允许验活的状态改为 `banned`。

## 进度与结果

- `checked`：实际请求邮箱 API 的账号数。
- `skipped`：因未配置 `email_code_api` 而跳过的账号数。
- `plus`、`registered`、`banned`、`clean`、`failed` 只统计实际查询的账号。
- 进度窗口明确显示 API 查询、跳过和失败原因。

## 兼容与回滚

注册、普通补号和 2FA 补号原有的验证码 API 逻辑不变。删除共享邮箱 API 读取逻辑、恢复原状态检查服务即可回滚；本次不修改已有账号状态迁移规则。

