# CHG-030 补号账号默认开通时间

状态：merged

创建日期：2026-06-04

合并日期：2026-06-04

合并目标：`docs/prd/PRD-002-account-management-system.md`

关联 PRD：PRD-002

影响范围：`src/replacementAccounts.js`, `test/replacementAccounts.test.js`, `test/replacementAccountsApi.test.js`, `docs/project/api.md`

## 背景

管理员新增补号账号时，可能不会填写“开通时间”。为了避免列表中时间为空，系统应在创建账号时自动补齐当前时间。

## 变更

- 新增补号账号时，如果 `activated_at` 为空字符串、空白或未提交，后端写入当前 ISO 时间。
- 如果管理员显式提交 `activated_at`，后端保留原值，不覆盖。
- 该默认值只作用于创建补号账号，不改变编辑账号的现有语义。

## 验收标准

- [x] `POST /replacement-accounts` 未传 `activated_at` 时，返回账号包含当前时间。
- [x] 显式传入 `activated_at` 时，保存传入值。
- [x] 现有补号账号 CRUD 行为不受影响。

## 验证

- `node --test test\replacementAccounts.test.js test\replacementAccountsApi.test.js`
- `node --check src\replacementAccounts.js`
