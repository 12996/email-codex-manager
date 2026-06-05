# 2026-06-05 账号列表分页

- 目标：为邮箱账号列表和补号账号列表增加真实服务端分页，并让前端分页控件调用分页接口。
- 关联 change：`docs/changes/CHG-037-account-list-pagination.md`
- 修改文件：
  - `.gitignore`
  - `src/accounts.js`
  - `src/replacementAccounts.js`
  - `src/server.js`
  - `web/accounts.html`
  - `web/accounts.js`
  - `web/index.html`
  - `web/app.js`
  - `test/accounts.test.js`
  - `test/replacementAccounts.test.js`
  - `test/accountsWebApi.test.js`
  - `test/replacementAccountsApi.test.js`
  - `test/replacementAccountsWeb.test.js`
  - `docs/project/api.md`

## 结果

- `/api/accounts` 新增 `page/pageSize/status/keyword` 查询参数，返回 `accounts` 和 `pagination`。
- `/replacement-accounts` 新增同样分页查询参数和响应结构。
- 两个列表页面新增每页条数、上一页、下一页和当前页显示。
- 筛选状态或输入关键词时重置到第 1 页并重新请求服务端。
- 旧的 `listAccounts()` 数组返回行为保留，避免影响旧表单页面兼容路径。
- 临时设计/实施计划文档已在 PRD 基线合并后清理，长期需求归入 `docs/prd/PRD-002-account-management-system.md`，实现记录保留在本工作日志和 change 文件中。

## 验证

- RED：
  - `npm test -- test\accounts.test.js test\replacementAccounts.test.js` 失败于 `listAccountsPage is not a function`。
  - `npm test -- test\accountsWebApi.test.js test\replacementAccountsApi.test.js test\replacementAccountsWeb.test.js` 失败于缺少分页控件和列表接口未分页。
- GREEN：
  - `npm test -- test\accounts.test.js test\replacementAccounts.test.js` 通过，29/29 pass。
  - `npm test -- test\accountsWebApi.test.js test\replacementAccountsApi.test.js test\replacementAccountsWeb.test.js` 通过，26/26 pass。
- 全量验证：
  - `npm test` 通过，194/194 pass。
  - `node --check .\src\accounts.js` 通过。
  - `node --check .\src\replacementAccounts.js` 通过。
  - `node --check .\src\server.js` 通过。
  - `node --check .\web\accounts.js` 通过。
  - `node --check .\web\app.js` 通过。
