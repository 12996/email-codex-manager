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
| CHG-017 | 补号子进程日志页面 | merged | 2026-06-02 | PRD-002 | `.gitignore`, `src/db.js`, `src/replacementAutomationRuns.js`, `src/replacementServices.js`, `src/server.js`, `web/`, `test/`, `docs/project/api.md` | `CHG-017-replacement-automation-log-page.md` |
| CHG-018 | 公开验证码 key 前端配置与复制入口 | merged | 2026-06-03 | PRD-002 | `web/index.html`, `web/app.js`, `test/replacementAccountsWeb.test.js`, `docs/project/api.md`, `docs/work/` | `CHG-018-public-verification-code-ui.md` |
| CHG-019 | CPA 凭证健康检测与自动补号 | merged | 2026-06-03 | PRD-002 | `src/config.js`, `src/cpaClient.js`, `src/cpaCredentialHealth.js`, `src/cpaCredentialMonitor.js`, `src/cpaRepairQueue.js`, `src/cpaRepairWorker.js`, `src/server.js`, `test/`, `.env.example`, `docs/project/api.md` | `CHG-019-cpa-auth-health-monitor.md` |
| CHG-020 | 补号列表完整显示关键字段 | merged | 2026-06-03 | PRD-002 | `web/index.html`, `web/app.js`, `web/styles.css`, `test/replacementAccountsWeb.test.js`, `docs/work/` | `CHG-020-replacement-table-full-fields.md` |
| CHG-021 | 公开验证码启用/停用专用操作 | merged | 2026-06-03 | PRD-002 | `src/replacementAccounts.js`, `src/server.js`, `web/app.js`, `test/replacementAccountsApi.test.js`, `test/replacementAccountsWeb.test.js`, `docs/project/api.md`, `docs/work/` | `CHG-021-public-code-toggle-api.md` |
| CHG-022 | Roxy 手机验证码阶段状态守卫 | merged | 2026-06-03 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-022-roxy-phone-code-state-guard.md` |
| CHG-023 | Roxy 邮箱验证码阶段状态守卫 | merged | 2026-06-03 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-023-roxy-email-code-state-guard.md` |
| CHG-024 | 手动补号统一 CPA 上传链路与 Roxy 有头/无头策略 | merged | 2026-06-03 | PRD-002 | `src/server.js`, `src/auto/roxy_oauth_login.js`, `.env.example`, `test/` | `CHG-024-unified-cpa-repair-and-roxy-headless.md` |
| CHG-025 | banned 账号不触发自动补号 | merged | 2026-06-03 | PRD-002 | `src/cpaCredentialHealth.js`, `src/cpaCredentialMonitor.js`, `test/`, `docs/project/api.md` | `CHG-025-banned-accounts-skip-auto-repair.md` |
| CHG-026 | Roxy Codex 授权 callback 竞态守卫 | merged | 2026-06-03 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-026-roxy-codex-callback-click-guard.md` |
| CHG-027 | Roxy token 交换优先使用 request context | superseded | 2026-06-03 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-027-roxy-token-exchange-request-context-first.md` |
| CHG-028 | Roxy token 交换页面上下文优先与短超时 | merged | 2026-06-03 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-028-roxy-token-exchange-page-context-short-timeout.md` |
| CHG-029 | 管理员手动触发 OpenAI 注册自动化 | merged | 2026-06-04 | PRD-002 | `src/replacementServices.js`, `src/server.js`, `src/auto/roxy_register_openai.js`, `web/app.js`, `test/`, `docs/project/api.md` | `CHG-029-manual-openai-registration.md` |
| CHG-030 | 补号账号默认开通时间 | merged | 2026-06-04 | PRD-002 | `src/replacementAccounts.js`, `test/`, `docs/project/api.md` | `CHG-030-default-replacement-activated-at.md` |
| CHG-031 | Roxy OAuth 添加手机号页处理 | merged | 2026-06-04 | PRD-002 | `src/auto/roxy_oauth_login.js`, `src/replacementServices.js`, `test/` | `CHG-031-roxy-add-phone-page.md` |
| CHG-032 | Roxy 添加手机号后跳转竞态守卫 | merged | 2026-06-05 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/issues/`, `docs/work/` | `CHG-032-roxy-add-phone-transition-guard.md` |
| CHG-033 | Roxy OAuth callback CDP fallback | merged | 2026-06-05 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/issues/`, `docs/work/` | `CHG-033-roxy-callback-cdp-fallback.md` |
| CHG-034 | Roxy 手机验证码后跳转竞态守卫 | merged | 2026-06-05 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/issues/`, `docs/work/` | `CHG-034-roxy-phone-code-transition-guard.md` |
| CHG-035 | Roxy token exchange 浏览器上下文重试 | merged | 2026-06-05 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/issues/`, `docs/work/` | `CHG-035-roxy-token-page-context-retry.md` |
| CHG-036 | 自动化运行日志最大保留数量 | merged | 2026-06-05 | PRD-002 | `src/config.js`, `src/replacementAutomationRuns.js`, `src/server.js`, `.env.example`, `test/`, `docs/project/api.md`, `docs/prd/PRD-002-account-management-system.md`, `docs/work/` | `CHG-036-automation-log-retention-limit.md` |
| CHG-037 | 账号列表服务端分页 | merged | 2026-06-05 | PRD-002 | `src/accounts.js`, `src/replacementAccounts.js`, `src/server.js`, `web/`, `.gitignore`, `test/`, `docs/project/api.md`, `docs/work/` | `CHG-037-account-list-pagination.md` |
| CHG-038 | 前端列表取消局部竖向滚动并显示补号备注 | merged | 2026-06-05 | PRD-002 | `web/index.html`, `web/app.js`, `web/styles.css`, `test/replacementAccountsWeb.test.js`, `test/accountsWebApi.test.js`, `docs/work/` | `CHG-038-frontend-list-remark-no-inner-scroll.md` |
| CHG-039 | 避免 Windows 保留 3000 端口导致启动失败 | merged | 2026-06-06 | PRD-002 | `.env.example`, `README.md`, `docs/project/api.md`, `docs/project/deployment.md`, `src/auto/`, `test/` | `CHG-039-avoid-windows-port-3000-eacces.md` |
| CHG-040 | Roxy OAuth 密码页 one-time code 与邮箱后异常重试 | merged | 2026-06-06 | PRD-002 | `src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/` | `CHG-040-roxy-openai-password-one-time-code.md` |
| CHG-041 | CPA 自动补号连续失败熔断与站内通知 | merged | 2026-06-07 | PRD-002 | `src/db.js`, `src/replacementAccounts.js`, `src/cpaRepairWorker.js`, `src/adminNotifications.js`, `src/server.js`, `web/`, `test/`, `docs/project/api.md` | `CHG-041-cpa-repair-circuit-breaker-notifications.md` |
| CHG-042 | 补号注册与 OAuth 支持账号级外部邮箱验证码接口 | merged | 2026-06-08 | PRD-002 | `src/verificationCodeCore.cjs`, `src/verificationCodeService.js`, `src/imapService.js`, `src/db.js`, `src/replacementAccounts.js`, `src/replacementServices.js`, `src/auto/`, `web/`, `test/`, `docs/project/api.md` | `CHG-042-email-code-api-extraction-service.md` |
| CHG-043 | 补号列表长字段截断与复制 | merged | 2026-06-08 | PRD-002 | `web/app.js`, `web/styles.css`, `test/replacementAccountsWeb.test.js`, `docs/work/` | `CHG-043-replacement-table-limited-field-copy.md` |
| CHG-044 | CPA 同邮箱多凭证任一健康即视为正常 | merged | 2026-06-11 | PRD-003 | `src/cpaCredentialMonitor.js`, `src/cpaRepairWorker.js`, `test/cpaCredentialMonitor.test.js`, `test/cpaRepairWorker.test.js`, `docs/project/api.md`, `docs/work/` | `CHG-044-cpa-email-any-healthy.md` |
| CHG-045 | CPA 自动补号触发原因写入运行日志 | merged | 2026-06-21 | PRD-003 | `src/cpaRepairWorker.js`, `src/replacementServices.js`, `test/cpaRepairWorker.test.js`, `docs/project/api.md`, `docs/work/` | `CHG-045-cpa-repair-trigger-log.md` |
| CHG-046 | 注册 access token 产物与列表空态显示 | merged | 2026-06-25 | PRD-003 | `src/auto/roxy_register_openai.js`, `web/accounts.html`, `web/accounts.js`, `web/automation-logs.js`, `web/styles.css`, `.env.example`, `test/`, `docs/project/api.md` | `CHG-046-registration-token-output-and-list-empty-state.md` |
| CHG-047 | CPA 上传凭证文件名增加 codex 前缀 | merged | 2026-06-25 | PRD-003 | `src/cpaRepairWorker.js`, `test/cpaRepairWorker.test.js`, `docs/project/api.md`, `docs/work/` | `CHG-047-cpa-upload-file-name-codex-prefix.md` |
| CHG-048 | 补号账号增加 Codex 2FA 字段 | merged | 2026-06-25 | PRD-003 | `src/db.js`, `src/replacementAccounts.js`, `web/index.html`, `web/app.js`, `test/`, `docs/project/api.md`, `docs/work/` | `CHG-048-replacement-codex-2fa-field.md` |
| CHG-049 | IMAP 绑定 SSH 代理启动 | implemented | 2026-06-26 | PRD-003 | `src/config.js`, `src/imapService.js`, `scripts/start-with-imap-proxy.cjs`, `package.json`, `.env.example`, `docs/project/deployment.md`, `test/` | `CHG-049-imap-bound-ssh-proxy-start.md` |
| CHG-050 | IMAP 家宽代理启动 | implemented | 2026-06-27 | PRD-003 | `scripts/start-with-home-imap-proxy.cjs`, `package.json`, `.env.example`, `docs/project/deployment.md`, `test/startWithHomeImapProxy.test.js` | `CHG-050-home-imap-proxy-start.md` |
| CHG-051 | 补号账号密码字段与列表压缩展示 | implemented | 2026-06-29 | PRD-003 | `src/db.js`, `src/replacementAccounts.js`, `web/index.html`, `web/app.js`, `web/styles.css`, `test/`, `docs/project/api.md`, `docs/work/` | `CHG-051-replacement-password-and-compact-fields.md` |
