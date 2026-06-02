# CHANGE_REGISTRY.md

Change 索引。日常需求、规则、结构或长期行为变化先记录为 change，不要直接把 PRD 变成工作流水。

状态：`draft` 草案，`accepted` 已确认，`implemented` 已实现但未合并 PRD，`merged` 已合并 PRD，`rejected` 不采纳，`superseded` 被取代。

PRD 合并提醒规则：未合并的 `implemented` change 达到 5 个时，AI 应提醒用户合并到 PRD。不按日期或工作日自动触发。

| 编号 | 标题 | 状态 | 创建日期 | 关联 PRD | 影响范围 | 入口 |
|---|---|---|---|---|---|---|
| CHG-001 | 增加 change 管理机制 | merged | 2026-05-24 | PRD-001 | `AGENTS.md`, `docs/changes/`, `docs/templates/`, `docs/work/` | `CHG-001-add-change-management.md` |
| CHG-002 | 新增补号账号后端能力 | merged | 2026-06-01 | PRD-002 | `src/db.js`, `src/replacementAccounts.js`, `src/replacementServices.js`, `src/server.js`, `test/`, `docs/project/api.md` | `CHG-002-replacement-accounts-backend.md` |
| CHG-003 | 新增 RoxyBrowser 自动化连接工具 | merged | 2026-06-01 | PRD-002 | `src/auto/roxy-browser-client.cjs`, `src/auto/roxy_oauth_login.js`, `test/`, `.env.example`, `package.json` | `CHG-003-roxy-browser-automation-client.md` |
| CHG-004 | 新增补号账号前端页面 | merged | 2026-06-01 | PRD-002 | `web/`, `src/server.js`, `test/replacementAccountsWeb.test.js`, `docs/project/api.md`, `docs/work/` | `CHG-004-replacement-accounts-web-ui.md` |
| CHG-005 | 合并邮箱账号页面到 web 前端 | merged | 2026-06-01 | PRD-002 | `web/accounts.html`, `web/accounts.js`, `src/server.js`, `test/accountsWebApi.test.js`, `docs/project/api.md`, `docs/work/` | `CHG-005-merge-accounts-page-into-web.md` |
| CHG-006 | 导航栏复用与邮箱详情弹窗优化 | merged | 2026-06-01 | PRD-002 | `web/sidebar.html`, `web/accounts.html`, `web/accounts.js`, `web/index.html`, `web/styles.css`, `src/server.js`, `test/accountsWebApi.test.js` | `CHG-006-reusable-sidebar-and-email-modal.md` |
| CHG-007 | 修复 Roxy OAuth 调试脚本 CDP 输出与关闭配置读取 | merged | 2026-06-01 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-007-roxy-oauth-cdp-output-and-close-config.md` |
| CHG-008 | 新增 Roxy OpenAI 登录页邮箱处理与超时判断 | merged | 2026-06-02 | PRD-002 | `scripts/roxy-codegen.cjs`, `test/roxyCodegenFlow.test.js`, `docs/work/` | `CHG-008-roxy-openai-login-email-timeout.md` |
| CHG-009 | Roxy API 连接失败诊断信息增强 | merged | 2026-06-02 | PRD-002 | `src/auto/roxy-browser-client.cjs`, `test/roxyBrowserClient.test.js`, `docs/work/` | `CHG-009-roxy-api-fetch-diagnostic.md` |
| CHG-010 | 新增 Roxy OpenAI 邮箱验证码与 Codex 登录确认处理 | merged | 2026-06-02 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-010-roxy-openai-email-code-and-codex-consent.md` |
| CHG-011 | Playwright codegen 录制优先规则 | merged | 2026-06-02 | PRD-002 | `AGENTS.md`, `docs/memories/known-issues.md` | `CHG-011-playwright-codegen-recording-first.md` |
| CHG-012 | Roxy OpenAI 手机验证页处理 | merged | 2026-06-02 | PRD-002 | `src/auto/roxy_oauth_login.js`, `src/auto/roxy_oauth_steps_manual_test.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-012-roxy-openai-phone-verification.md` |
| CHG-013 | Roxy OAuth 失败截图 | merged | 2026-06-02 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-013-roxy-oauth-failure-screenshots.md` |
| CHG-014 | Roxy OAuth 自动生成 CPA JSON | merged | 2026-06-02 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-014-roxy-oauth-cpa-json-flow.md` |
| CHG-015 | 公开验证码 key 与本机免登录验证码接口 | merged | 2026-06-02 | PRD-002 | `src/db.js`, `src/replacementAccounts.js`, `src/server.js`, `test/`, `docs/project/api.md` | `CHG-015-public-verification-code-key.md` |
| CHG-016 | 补号接口接入 Roxy OAuth 子进程自动化 | merged | 2026-06-02 | PRD-002 | `src/replacementServices.js`, `test/replacementServices.test.js`, `.env.example`, `docs/project/api.md`, `docs/work/` | `CHG-016-replacement-child-process-automation.md` |
| CHG-017 | 补号子进程日志页面 | implemented | 2026-06-02 | PRD-002 | `.gitignore`, `src/db.js`, `src/replacementAutomationRuns.js`, `src/replacementServices.js`, `src/server.js`, `web/`, `test/`, `docs/project/api.md` | `CHG-017-replacement-automation-log-page.md` |
