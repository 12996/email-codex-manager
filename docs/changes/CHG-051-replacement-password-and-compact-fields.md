# CHG-051 补号账号密码字段与列表压缩展示

状态：implemented

日期：2026-06-29

关联 PRD：PRD-003

影响范围：`src/db.js`, `src/replacementAccounts.js`, `web/index.html`, `web/app.js`, `web/styles.css`, `test/`, `docs/project/api.md`, `docs/work/`

## 背景

补号管理页字段逐步增多，长 URL、2FA、公开验证码 Key 等字段会撑宽主表，导致操作列查看困难。同时补号账号需要记录一个可复制的密码，避免人工另行维护。

## 变更

- `replacement_accounts` 新增 `password` 字段，并通过 `ensureColumn` 兼容既有 SQLite 数据库。
- 新增补号账号时，若未提交密码，后端自动生成 12-16 位随机密码。
- 自动密码字符集为大小写字母、数字和常见特殊字符 `!@#$%^&*_-`。
- 编辑补号账号时，若未提交密码或提交空值，保留原密码；提交非空密码则更新。
- 补号管理页新增“密码”表单字段和主表列。
- 补号管理页主表除邮箱外的长字段默认只显示前 6 位，并提供“复制”按钮复制完整原始值。
- 邮箱字段完整显示，按约 12 个字符宽度换行，避免被压成几字符一行，也避免列宽撑开后挤压操作列。
- 表格宽度按内容收缩，仅在内容超过容器时横向滚动，避免列间距被固定最小宽度摊大。
- 补号管理页主表不再显示“状态更新时间”“最后操作”“更新时间”三列。
- “备注”和“开通时间”改为和邮箱一致的完整换行展示，不再按前 6 位压缩。

## 验收

- [x] 新增补号账号时未填写密码，数据库自动保存 12-16 位随机密码。
- [x] 编辑补号账号时不填写密码不会清空原密码。
- [x] 编辑补号账号时填写新密码会更新数据库字段。
- [x] 补号管理页显示“密码”列和密码输入框。
- [x] 非邮箱长字段在主表压缩为前 6 位并可复制完整值。
- [x] 邮箱完整显示，长邮箱按约 12 个字符宽度换行。
- [x] 表格列按内容收缩，不再出现异常大列间距。
- [x] 主表不显示“状态更新时间”“最后操作”“更新时间”列。
- [x] “备注”和“开通时间”完整展示并按约 12 个字符宽度换行。

## 验证

```powershell
npm test -- test/replacementAccounts.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js
node --check .\src\db.js
node --check .\src\replacementAccounts.js
node --check .\web\app.js
```

通过。

## 合并记录

- 尚未合并到 PRD 基线。
