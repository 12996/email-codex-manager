# 2026-06-29 补号账号密码字段与列表压缩展示

## 目标

为补号账号新增可复制的密码字段，并压缩补号管理主表的长字段展示，避免字段过多时操作列被挤出可视区域。

## 变更

- 新增 change：`docs/changes/CHG-051-replacement-password-and-compact-fields.md`，状态 `implemented`。
- `replacement_accounts` 新增 `password` 字段，启动时通过 `ensureColumn` 自动补列。
- 新增补号账号时，未提交密码则自动生成 12-16 位随机密码；字符集包含大小写字母、数字和 `!@#$%^&*_-`。
- 编辑补号账号时，密码为空则保留原值，提交非空密码则更新。
- 补号管理页新增“密码”输入框和主表列。
- 主表除邮箱外的长字段统一压缩为前 6 位 + 复制按钮；复制按钮仍复制完整原始值。
- 邮箱、备注和开通时间完整显示，并按约 12 个字符宽度换行，避免被压成几字符一行。
- 主表隐藏“状态更新时间”“最后操作”“更新时间”三列，减少宽表干扰。
- 表格宽度按内容收缩，避免固定最小宽度导致列间距异常变大。
- `docs/project/api.md` 已同步补充字段、接口行为和前端展示规则。

## 验证

```powershell
npm test -- test/replacementAccounts.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js
```

结果：54/54 pass。

```powershell
node --check .\src\db.js
node --check .\src\replacementAccounts.js
node --check .\web\app.js
```

结果：均通过。

## 注意

- 当前未合并 PRD 的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`，未达到 5 个提醒阈值。
- 运行中的 `node src/server.js` 需要重启后，数据库补列和前端新页面才会在当前服务上生效。
