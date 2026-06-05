# issue-006 邮箱邮件详情弹窗 DOM 缺失

状态：resolved

## 现象

- 邮箱账号页面执行“获取邮件”后，邮件列表可正常显示。
- 点击邮件摘要行没有弹出邮件详情模态框，用户观察为点击无反应。

## 复现

1. 进入 `/accounts` 邮箱账号页面。
2. 对一个邮箱账号点击“获取邮件”。
3. 点击获取结果中的任意邮件摘要行。

## 期望 / 实际

- 期望：点击邮件摘要行后弹出 `#mailDetailDialog`，展示主题、发件人、时间、文件夹和正文。
- 实际：`web/accounts.js` 调用 `#mailDetailDialog` 及其子元素，但 `web/accounts.html` 中缺少这些 DOM 节点，点击时无法弹出详情。

## 排查

- `web/accounts.js` 的 `openMailDetailDialog()` 会写入 `#mailDetailSubject`、`#mailDetailSenderName`、`#mailDetailSenderEmail`、`#mailDetailDate`、`#mailDetailSource`、`#mailDetailBody`，最后调用 `#mailDetailDialog.showModal()`。
- `web/accounts.html` 只存在账号详情弹窗 `#detailDialog`，不存在邮件详情弹窗及上述子节点。
- 新增回归测试先失败，失败点为 `id="mailDetailDialog"` 不存在。

## 修复

- 在 `web/accounts.html` 补回邮件详情 `<dialog id="mailDetailDialog">` 及 `web/accounts.js` 需要的全部子节点。
- 新增 `test/accountsWebApi.test.js` 回归测试，确保页面模板包含邮件详情弹窗 DOM。
- 在 `.gitignore` 增加 `!web/accounts.html` 例外，确保实际页面模板可被版本控制跟踪。

## 验证

- RED：`npm test -- test\accountsWebApi.test.js` 失败，提示缺少 `id="mailDetailDialog"`。
- GREEN：`npm test -- test\accountsWebApi.test.js` 通过，5/5 pass。
- 全量：`npm test` 通过，186/186 pass。
- 语法：`node --check .\web\accounts.js` 通过；`node --check .\src\server.js` 通过。
