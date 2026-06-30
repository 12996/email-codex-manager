# 2026-06-25 补号账号 Codex 2FA 字段

## 目标

在补号管理页 `/replacement-ui` 增加 `2fa-codex` 字段，支持前端填写、保存到后端数据库，并在列表中展示。

## 变更

- 数据库：`replacement_accounts` 新增 `codex_2fa` 字段，既有数据库通过 `ensureColumn` 自动补列。
- 后端：`createAccount` / `updateAccount` 持久化 `codex_2fa`，并兼容请求体字段名 `2fa-codex`、`2fa_codex`。
- 前端：账号弹窗新增 `2fa-codex` 输入框；补号列表新增 `2fa-codex` 列，复用长字段截断和复制逻辑。
- 文档：新增 `CHG-048`，并更新补号账号 JSON API 字段说明。

## 验证

```powershell
npm test -- test/replacementAccounts.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js
```

结果：通过，53/53 pass。

## 后续

- 需要重启当前 `node src/server.js` 服务后，`http://localhost:13100/replacement-ui` 才会加载新页面与新 API 逻辑。
- `CHANGE_REGISTRY.md` 中未合并的 `implemented` change 已达到 5 个，建议下一步执行 PRD-002 基线合并。
