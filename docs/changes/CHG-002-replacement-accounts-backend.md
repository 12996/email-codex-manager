# CHG-002 新增补号账号后端能力

状态：merged
创建日期：2026-06-01
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/db.js`、`src/replacementAccounts.js`、`src/replacementServices.js`、`src/server.js`、`test/`、`docs/project/api.md`

## 背景

需要在现有 Gmail IMAP 后台外，新增独立的补号账号管理能力，用于保存补号邮箱、SMS API、状态、JSON 原文和成功补号次数，并为后续前端页面和真实自动化补号 JS 适配器提供稳定接口。

## 变更内容

- 新增：`replacement_accounts` SQLite 表和邮箱大小写不敏感唯一索引。
- 新增：补号账号 Repository，支持新增、列表、详情、修改、软删除、状态修改、JSON/SMS 错误记录和补号状态流转。
- 新增：补号账号 JSON API，包括 CRUD、手动改状态、获取 SMS 验证码、获取 JSON、自动补号。
- 新增：外部服务适配边界 `replacementServices`，真实自动化补号接口后续接入。
- 新增：后端测试覆盖邮箱唯一性、软删除、手动改状态、SMS 验证码不入库、补号成功/失败计数规则。
- 修改：API 文档新增补号账号接口说明。

## 验收标准

- [x] 邮箱唯一性按 `lower(trim(email))` 校验。
- [x] 新增、修改、软删除接口可用。
- [x] 管理员可手动修改状态，但不能手动设为 `replacing`。
- [x] 补号成功后 `replacement_count + 1`。
- [x] 补号失败不增加次数。
- [x] SMS 验证码只返回给调用方，不入库。
- [x] `/replace` 已预留后续 JS 自动化适配边界。

## 合并记录

- 合并目标 PRD：PRD-002
- 合并日期：2026-06-01
- 备注：已成功合并入 PRD-002。
