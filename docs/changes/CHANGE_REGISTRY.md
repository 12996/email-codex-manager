# CHANGE_REGISTRY.md

Change 索引。日常需求、规则、结构或长期行为变化先记录为 change，不要直接把 PRD 变成工作流水。

状态：`draft` 草案，`accepted` 已确认，`implemented` 已实现但未合并 PRD，`merged` 已合并 PRD，`rejected` 不采纳，`superseded` 被取代。

PRD 合并提醒规则：未合并的 `implemented` change 达到 5 个时，AI 应提醒用户合并到 PRD。不按日期或工作日自动触发。

| 编号 | 标题 | 状态 | 创建日期 | 关联 PRD | 影响范围 | 入口 |
|---|---|---|---|---|---|---|
| CHG-001 | 增加 change 管理机制 | implemented | 2026-05-24 | PRD-001 | `AGENTS.md`, `docs/changes/`, `docs/templates/`, `docs/work/` | `CHG-001-add-change-management.md` |
| CHG-002 | 新增补号账号后端能力 | implemented | 2026-06-01 |  | `src/db.js`, `src/replacementAccounts.js`, `src/replacementServices.js`, `src/server.js`, `test/`, `docs/project/api.md` | `CHG-002-replacement-accounts-backend.md` |
| CHG-003 | 新增 RoxyBrowser 自动化连接工具 | implemented | 2026-06-01 |  | `src/auto/roxy-browser-client.cjs`, `src/auto/roxy_oauth_login.js`, `test/`, `.env.example`, `package.json` | `CHG-003-roxy-browser-automation-client.md` |
| CHG-004 | 新增补号账号前端页面 | implemented | 2026-06-01 |  | `web/`, `src/server.js`, `test/replacementAccountsWeb.test.js`, `docs/project/api.md`, `docs/work/` | `CHG-004-replacement-accounts-web-ui.md` |
| CHG-005 | 合并邮箱账号页面到 web 前端 | implemented | 2026-06-01 |  | `web/accounts.html`, `web/accounts.js`, `src/server.js`, `test/accountsWebApi.test.js`, `docs/project/api.md`, `docs/work/` | `CHG-005-merge-accounts-page-into-web.md` |
