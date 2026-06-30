# CHG-048 补号账号增加 Codex 2FA 字段

状态：merged

日期：2026-06-25

关联 PRD：PRD-003

影响范围：`src/db.js`, `src/replacementAccounts.js`, `web/index.html`, `web/app.js`, `test/`, `docs/project/api.md`, `docs/work/`

## 背景

补号账号需要记录 Codex/OpenAI 登录使用的 2FA 密钥。此前补号管理页没有 `2fa-codex` 列，新增/编辑账号也无法把该字段保存到数据库。

## 变更

- `replacement_accounts` 新增 `codex_2fa` 数据库字段，并通过 `ensureColumn` 兼容既有 SQLite 数据库迁移。
- `POST /replacement-accounts` 和 `PUT /replacement-accounts/:id` 支持保存 Codex 2FA 字段。
- API 统一返回字段名 `codex_2fa`，同时兼容请求体字段名 `codex_2fa`、`2fa-codex` 和 `2fa_codex`。
- 补号管理页新增表单输入 `2fa-codex`，保存时随账号基础信息提交。
- 补号管理列表新增 `2fa-codex` 列，并支持长字段截断与复制完整值。

## 验收

- [x] 新增补号账号时填写 `2fa-codex`，后端保存到 `replacement_accounts.codex_2fa`。
- [x] 编辑补号账号时修改 `2fa-codex`，后端更新数据库字段。
- [x] 补号管理列表展示 `2fa-codex` 列。
- [x] 旧请求体字段名 `2fa-codex` 可被后端兼容并归一化为 `codex_2fa`。

## 验证

```powershell
npm test -- test/replacementAccounts.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js
```

通过，53/53 pass。

## 合并记录

- 合并目标：PRD-003
- 合并日期：2026-06-25
