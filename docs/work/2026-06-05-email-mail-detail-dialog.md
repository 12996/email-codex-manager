# 2026-06-05 邮箱邮件详情弹窗修复

- 目标：修复邮箱账号页面“获取邮件”结果中点击邮件摘要行无详情弹窗的问题。
- 关联 issue：`docs/issues/issue-006-email-mail-detail-dialog-missing.md`
- 修改文件：
  - `web/accounts.html`
  - `.gitignore`
  - `test/accountsWebApi.test.js`
  - `docs/issues/README.md`
  - `docs/issues/issue-006-email-mail-detail-dialog-missing.md`
  - `docs/work/work-log.md`
  - `docs/work/handoff.md`

## 结果

- 根因：`web/accounts.js` 已绑定邮件摘要点击并调用 `openMailDetailDialog()`，但 `web/accounts.html` 缺少 `#mailDetailDialog` 及其子节点，点击后无法填充并弹出邮件详情。
- 修复：补回邮件详情 dialog DOM，字段 ID 与 `web/accounts.js` 保持一致。
- 版本控制：`web/accounts.html` 原本被全局 `*.html` 忽略规则覆盖，已在 `.gitignore` 增加例外。
- 回归：新增测试锁定邮件详情 dialog 结构，避免后续模板调整再次遗漏。

## 验证

- RED：`npm test -- test\accountsWebApi.test.js` 失败，提示缺少 `id="mailDetailDialog"`。
- GREEN：`npm test -- test\accountsWebApi.test.js` 通过，5/5 pass。
- 全量：`npm test` 通过，186/186 pass。
- 语法：`node --check .\web\accounts.js` 通过；`node --check .\src\server.js` 通过。
