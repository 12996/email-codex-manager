# 2026-06-04 补号账号默认开通时间

## 背景

管理员在补号管理新增账号时可能不填写“开通时间”，列表中会显示为空。

## 已完成

- `src/replacementAccounts.js`：新增补号账号时，如果 `activated_at` 为空，后端写入当前 ISO 时间。
- 显式提交 `activated_at` 时保留原值，不覆盖。
- `docs/project/api.md`：补充 `activated_at` 创建默认值说明。
- `docs/changes/CHG-030-default-replacement-activated-at.md`：记录需求变更。

## 验证

- `node --check src\replacementAccounts.js`
- `node --test test\replacementAccounts.test.js test\replacementAccountsApi.test.js`
- `git diff --check`
