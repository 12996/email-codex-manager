# handoff.md

状态：active

- 来源工作日志：`docs/work/2026-06-01-邮箱账号页面合并到web.md`
- 当前任务：邮箱账号页面合并到 `web/`。
- 当前进展：已新增 `web/accounts.html` 和 `web/accounts.js`，`GET /accounts` 改为返回新版 web 页面；已新增 `/api/accounts*` JSON API 支持新增、编辑、删除、测试连接和获取邮件；页面风格与补号管理页面保持一致。邮箱账号列表和邮件结果区域已改为固定 5 条可视内容并内部滚动，获取邮件默认数量改为 5，邮件内容默认折叠为摘要行。
- 关键文件：`web/accounts.html`、`web/accounts.js`、`web/styles.css`、`src/server.js`、`test/accountsWebApi.test.js`、`docs/project/api.md`、`docs/changes/CHG-005-merge-accounts-page-into-web.md`
- 下一步建议：当前 `implemented` 且未合并的 change 数量为 5，已达到阈值，应执行 PRD 基线合并；后续可继续将登录页也迁移到 `web/`。
