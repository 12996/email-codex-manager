# CHG-077 补号账号开通方式目录与行内下拉

状态：implemented
创建日期：2026-07-14
关联 PRD：PRD-003
影响范围：`src/db.js`、`src/replacementActivationMethods.js`、`src/replacementAccounts.js`、`src/server.js`、`web/`、`test/`、`docs/project/api.md`

## 背景

补号账号的 `activation_method` 原本是普通文本字段。用户希望它和账号状态一样，在 `/replacement-ui` 列表中通过下拉框直接修改，并且未来可以增加新的开通方式。

## 变更内容

- 新增 `replacement_activation_methods` SQLite 目录表。
- 初始化并保存 6 个方式：越南直卡、`upi`、`ideal`、波兰、瑞士、`pix 直卡`。
- 新增开通方式目录查询和新增 API。
- 新增账号开通方式独立 PATCH API。
- 补号列表开通方式改为行内下拉，保存失败会恢复原值。
- 新增“管理开通方式”弹窗，允许新增，不允许删除。
- 账号新增/编辑弹窗中的开通方式改为动态下拉。
- 旧账号不在目录中的开通方式显示为“历史值”，不覆盖历史数据。

## 验收标准

- [x] 六个初始方式出现在下拉选项中。
- [x] 列表下拉修改后刷新页面仍保持新值。
- [x] 页面可以新增方式并立即用于账号选择。
- [x] 空值和重复方式被拒绝。
- [x] 历史方式不丢失。
- [x] 状态下拉和其他补号功能回归测试通过。

## 设计与维护

- 设计文档：`docs/plans/2026-07-14-replacement-activation-method-design.md`
- 实施计划：`docs/plans/2026-07-14-replacement-activation-method.md`
- 后续新增方式优先通过页面“管理开通方式”添加；不需要修改代码或数据库结构。
- 方式只新增不删除，避免历史账号引用失效。

## 验证

```powershell
node --test test/replacementActivationMethods.test.js test/replacementAccounts.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js
```

