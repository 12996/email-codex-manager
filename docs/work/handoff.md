# handoff.md

状态：active

## 2026-06-25 CPA 上传凭证文件名 codex 前缀

- 来源工作日志：`docs/work/2026-06-25-cpa-upload-file-name-codex-prefix.md`
- change：`docs/changes/CHG-047-cpa-upload-file-name-codex-prefix.md`，状态 `implemented`，尚未合并 PRD。
- 当前进展：CPA repair worker 读取本地 CPA JSON 时仍使用 `src/auto/product_files/cpa/<email>.json`；上传到 CPA 的 auth file 名称改为 `codex-<email>-plus.json`，例如 `codex-slide.emoji.2w+rv4okxgrtg9hc7cvf@icloud.com-plus.json`。上传后健康复查仍按邮箱判断。
- 验证：`npm test -- test/cpaRepairWorker.test.js` 通过，5/5 pass。
- 待办：需要重启当前 `node src/server.js` 服务后，新 CPA 上传命名才会在运行中的服务生效；当前未合并的 `implemented` change 数量为 4。

## 2026-06-25 注册 token 保存与列表空态

- 来源工作日志：`docs/work/2026-06-25-registration-token-output-and-list-empty-state.md`
- change：`docs/changes/CHG-046-registration-token-output-and-list-empty-state.md`，状态 `implemented`，尚未合并 PRD。
- 当前进展：OpenAI 注册自动化在成功读取 `chatgpt.com/api/auth/session` 的 `accessToken` 后，会保存 `src/auto/product_files/registration/<email>.json`；文件名默认使用补号邮箱号，仅替换 Windows 不允许的文件名字符。注册日志只输出 token 文件路径，不输出 token 明文。`/accounts` 页面改为复用统一 sidebar，补号日志入口在邮箱账号页可见；邮箱账号列表和补号日志列表在无数据或筛选无结果时显示空态行。
- 验证：`node --test test\roxyRegisterOpenai.test.js` 通过，4/4 pass；`node --test test\replacementAccountsWeb.test.js` 通过，10/10 pass。
- 待办：重启当前 `node src/server.js` 服务后，前端页面和注册子进程新逻辑才会在 13100 端口生效；当前未合并的 `implemented` change 数量为 3。

## 2026-06-21 CPA 自动补号触发原因日志

- 来源工作日志：`docs/work/2026-06-21-cpa-repair-trigger-log.md`
- change：`docs/changes/CHG-045-cpa-repair-trigger-log.md`，状态 `implemented`，尚未合并 PRD。
- 当前进展：CPA 自动补号运行日志已新增 `step=cpa-trigger`，记录触发补号的 CPA provider、email、status、unavailable、disabled、reasons 和截断后的 `status_message`。真实 Roxy OAuth 子进程日志会在自动化启动前写入该信息，即使后续 OAuth 自动化失败也能从 run log 判断为什么执行了补号。
- 验证：`node --test test\cpaRepairWorker.test.js` 通过，5/5 pass；`node --test test\replacementServices.test.js` 通过，15/15 pass。
- 待办：需要重启当前 `node src/server.js` 服务让新日志逻辑在定时 CPA monitor 中生效；当前未合并的 `implemented` change 数量为 2。

## 2026-06-11 CPA 同邮箱多凭证任一健康判断

- 来源工作日志：`docs/work/2026-06-11-cpa-email-any-healthy.md`
- change：`docs/changes/CHG-044-cpa-email-any-healthy.md`，状态 `implemented`，尚未合并 PRD。
- 当前进展：CPA 健康巡检和补号后复查已改为按邮箱归并判断；同一邮箱存在多个 CPA auth file 时，只要任一凭证为健康状态，邮箱整体视为健康，不再因为其他旧异常凭证触发补号或导致 repair worker 复查失败。若同邮箱没有任何健康凭证，仍按原逻辑报告异常或触发补号。
- 验证：`node --test test\cpaRepairWorker.test.js test\cpaCredentialMonitor.test.js` 通过，8/8 pass。
- 待办：尚未执行真实 CPA `/cpa/auth-health` 实机复查；当前未合并的 `implemented` change 数量为 1。

## 2026-06-08 PRD-002 change 基线合并

- 来源工作日志：`docs/work/2026-06-08-prd-002-change-merge.md`
- 合并范围：`CHG-042`、`CHG-043`。
- 当前进展：`docs/prd/PRD-002-account-management-system.md` 最近基线合并日期已更新为 `2026-06-08`，并吸收账号级 `email_code_api`、注册/OAuth 外部邮箱验证码接口、外部 HTML/text/JSON 验证码提取、本地 POST 回退、补号主表 `email_code_api` 展示、长字段截断和复制完整原始值等要求。
- 状态更新：`docs/changes/CHANGE_REGISTRY.md` 及对应 change 文件中 `CHG-042`、`CHG-043` 已更新为 `merged`，并补充合并目标 PRD 和合并日期。
- 当前提醒：`CHANGE_REGISTRY.md` 中当前未发现未合并的 `implemented` change。

## 2026-06-08 补号 OAuth 外部邮箱验证码接口

- 来源工作日志：`docs/work/2026-06-08-email-code-api-extraction-service.md`
- change：`docs/changes/CHG-042-email-code-api-extraction-service.md`，状态 `merged`，已合并 PRD。
- 当前进展：`CHG-042` 已从“补号注册支持账号级外部邮箱验证码接口”扩展为“补号注册与 OAuth 支持账号级外部邮箱验证码接口”。`replacementServices.replaceAccount()` 现在读取补号账号 `email_code_api`，有值时向 `src/auto/roxy_oauth_login.js` 子进程注入 `VERIFICATION_CODE_API_URL`；无值时移除该 env，让脚本按 `PORT` 继续走本地 `POST /api/verification-code/latest`。`roxy_oauth_login.js` 对本地验证码接口保持 POST JSON，对外部 `VERIFICATION_CODE_API_URL` 使用 GET，并复用通用验证码提取核心处理 HTML/text/JSON，避免 CSS 色值误匹配。`roxy_register_openai.js` 也已直接兼容 `email_code_api` / `emailCodeApiUrl` 参数和 `EMAIL_CODE_API` / `email_code_api` 环境变量，均优先于本地 POST。
- 验证：RED 阶段测试先失败于 `replaceAccount` 未注入外部邮箱验证码 URL、`openAi_email_code` 对外部 URL 仍走旧 POST/JSON 解析，以及注册脚本传入 `email_code_api` 选项时仍调用本地 POST；修复后 `node --test test\replacementServices.test.js` 通过，15/15 pass；`node --test test\roxyOauthLogin.test.js` 通过，69/69 pass；`node --test test\roxyRegisterOpenai.test.js` 通过，3/3 pass；`node --check src\auto\roxy_oauth_login.js` 和 `node --check src\auto\roxy_register_openai.js` 通过。
- 当前提醒：`CHG-042` 已在 2026-06-08 PRD 基线合并中更新为 `merged`。

## 2026-06-08 补号列表长字段截断与复制

- 来源工作日志：`docs/work/2026-06-08-replacement-table-limited-field-copy.md`
- change：`docs/changes/CHG-043-replacement-table-limited-field-copy.md`，状态 `merged`，已合并 PRD。
- 当前进展：补号管理主表已对邮箱、手机号、SMS API、邮箱验证码 API、备注、开通信息、状态时间、公开验证码 Key、更新时间等字段使用 `tableFieldLimits` 做最大显示长度控制；超长字段旁新增“复制”按钮，点击复制该字段完整原始值，剪贴板不可用时回退 `prompt`。详情弹窗和后端接口未改变。
- 验证：`node --check .\web\app.js` 通过；`node --test .\test\replacementAccountsWeb.test.js` 通过，9/9 pass。
- 当前提醒：`CHG-043` 已在 2026-06-08 PRD 基线合并中更新为 `merged`。

## 2026-06-08 补号注册外部邮箱验证码接口

- 来源工作日志：`docs/work/2026-06-08-email-code-api-extraction-service.md`
- change：`docs/changes/CHG-042-email-code-api-extraction-service.md`，状态 `merged`，已合并 PRD。
- 当前进展：新增通用验证码提取核心，ESM 与 `src/auto` CommonJS 脚本共用同一份 `.cjs` 核心；HTML 提取会先移除 `script/style` 和标签，再匹配独立 6 位数字，避免 CSS 色值误匹配。`imapService.extractSixDigitCode()` 已复用该逻辑，本地 `POST /api/verification-code/latest` 保持原接口行为。补号账号新增 `email_code_api` 字段，数据库、仓储、前端表单和列表已做最小支持。`POST /replacement-accounts/:id/register` 启动注册子进程时，若账号配置该字段，会注入 `REGISTRATION_EMAIL_CODE_API_URL`；注册脚本优先 GET 外部接口提取验证码，未配置时继续 POST 本地验证码接口。日志只记录 `code=received/empty`，不记录验证码明文。
- 验证：RED 阶段测试先失败于服务缺失、env 未注入、注册脚本仍 POST、仓储字段未持久化；修复后 `npm test -- test/verificationCodeService.test.js test/replacementAccounts.test.js test/replacementServices.test.js test/roxyRegisterOpenai.test.js test/verificationCodeApi.test.js test/imapService.test.js` 通过，65/65 pass。
- 待办：尚未执行真实外部邮箱验证码页面端到端注册实机验证。`CHG-042` 已在 2026-06-08 PRD 基线合并中更新为 `merged`。

## 2026-06-07 CPA 自动补号连续失败熔断与站内通知

- 来源工作日志：`docs/work/2026-06-07-cpa-repair-circuit-breaker-notifications.md`
- change：`docs/changes/CHG-041-cpa-repair-circuit-breaker-notifications.md`，状态 `merged`，已合并 PRD。
- 当前进展：补号账号新增连续失败计数与熔断字段；补号失败会递增 `consecutive_replace_failures`，连续失败达到 5 次会自动标记为 `banned` 并写入 `circuit_breaker_at` / `circuit_breaker_reason`；补号成功会清零失败计数和熔断字段。新增 `admin_notifications` 表与通知 API，CPA repair worker 触发熔断时会创建未读通知。顶部铃铛 UI 已改为真实通知入口，显示未读数量并支持查看最近通知、标记已读。补号管理页已新增“解除熔断”独立操作，解除后账号回到 `pending` 并清空连续失败和熔断字段。
- 验证：`npm test -- test/replacementAccounts.test.js test/adminNotifications.test.js test/adminNotificationsApi.test.js test/cpaRepairWorker.test.js` 通过，32/32 pass；`npm test -- test/replacementAccountsApi.test.js` 通过，13/13 pass；全量 `npm test` 通过，211/211 pass；关键 JS 文件 `node --check` 均通过。
- 待办：尚未执行真实 CPA 守护进程实机熔断链路；邮件通知未实现。当前未合并的 `implemented` change 数量为 0。

## 2026-06-07 PRD-002 change 基线合并

- 来源工作日志：`docs/work/2026-06-07-prd-002-change-merge.md`
- 合并范围：`CHG-038`、`CHG-039`、`CHG-040`。
- 当前进展：`docs/prd/PRD-002-account-management-system.md` 最近基线合并日期已更新为 `2026-06-07`，并吸收列表无内部纵向滚动、补号主表显示备注、默认端口 3100、验证码 API 随 `PORT` 推导、Roxy OAuth 密码页 one-time code 和邮箱后未知页重试等要求。
- 状态更新：`docs/changes/CHANGE_REGISTRY.md` 及对应 change 文件中 `CHG-038`、`CHG-039`、`CHG-040` 已更新为 `merged`，并补充合并目标 PRD 和合并日期。
- 当前提醒：`CHANGE_REGISTRY.md` 中当前未发现未合并的 `implemented` change。

## 2026-06-06 Roxy OAuth 密码页 one-time code 与邮箱后异常重试

- 来源工作日志：`docs/work/2026-06-06-roxy-openai-password-one-time-code.md`
- 新增 issue：`docs/issues/issue-008-roxy-openai-password-email-code-misclassification.md`，状态 `resolved`。
- change：`docs/changes/CHG-040-roxy-openai-password-one-time-code.md`，状态 `merged`，已合并 PRD。
- 当前进展：已用当前 Roxy CDP 启动 Playwright recorder，录制确认 OpenAI 密码页需要点击 `Log in with a one-time code`。`roxy_oauth_login.js` 已新增密码页判断和 one-time code 操作；邮箱提交后会识别 `openai-password`、`email-code`、`codex-login`、`callback` 或 `unknown`。进入密码页时点击 one-time code 并继续状态机；进入未知页时会回到本次 OAuth target URL 重试，默认最多 3 次，耗尽后抛出 `OPENAI_POST_EMAIL_STAGE_RETRY_EXHAUSTED`。
- 二次修复：密码页 readonly `Email address` 输入框不再被误判为邮箱登录页；one-time code 后等待阶段会忽略当前 password 页，避免页面短暂停留时记录 `next=openai-password` 并回到邮箱登录分支。
- 复盘：`issue-002` / `issue-004` 已经记录过“提交后不能把当前阶段当下一阶段”的问题；本次新增 password 阶段时没有沿用该通用规则，导致同类问题复发。后续新增 Roxy OAuth 阶段必须同步补“忽略当前阶段”和“相邻页误判负例”测试。
- 新增日志：邮箱提交后 next stage、密码页识别、one-time code 后 next stage、异常页面重试次数和重试耗尽。
- 验证：`node --check .\src\auto\roxy_oauth_login.js` 通过；`node --test .\test\roxyOauthLogin.test.js` 通过，68/68 pass。当前 Roxy 页 `https://auth.openai.com/email-verification` 下，手动验证 `openai-page=false`、`email-code-page=true`。
- 当前提醒：`CHG-040` 已在 2026-06-07 PRD 基线合并中更新为 `merged`。

## 2026-06-06 Windows 3000 端口 EACCES 修复

- 来源工作日志：`docs/work/2026-06-06-port-3100-eacces.md`
- 新增 issue：`docs/issues/issue-007-windows-port-3000-eacces.md`，状态 `resolved`。
- change：`docs/changes/CHG-039-avoid-windows-port-3000-eacces.md`，状态 `merged`，已合并 PRD。
- 当前进展：已确认 `3000` 未被占用，而是 Windows TCP 排除端口范围包含 `2987-3086` 导致监听 `0.0.0.0:3000` 报 `EACCES`。本机 `.env` 已改为 `PORT=3100`，`VERIFICATION_CODE_API_URL` 留空时自动化会按 `PORT` 推导验证码 API URL；示例配置、自动化默认值、测试和文档已同步。
- 验证：`npm start` 启动后 `GET http://127.0.0.1:3100/login` 返回 200；`node --test test\roxyOauthLogin.test.js test\roxyRegisterOpenai.test.js` 通过，60/60 pass。
- 当前提醒：`CHG-039` 已在 2026-06-07 PRD 基线合并中更新为 `merged`。

## 2026-06-05 前端列表取消局部竖向滚动并显示补号备注

- 来源工作日志：`docs/work/2026-06-05-frontend-list-remark-no-inner-scroll.md`
- change：`docs/changes/CHG-038-frontend-list-remark-no-inner-scroll.md`，状态 `merged`，已合并 PRD。
- 当前进展：补号管理主表已将 `SMS 错误` 列替换为 `备注` 列，直接展示 `replacement_accounts.remark`；`sms_last_error` 仍保留在详情 JSON 中。邮箱管理和补号管理表格容器已取消固定高度与内部纵向滚动，仅保留横向滚动；邮箱邮件结果列表也取消内部纵向滚动，内容自然撑开页面。
- 验证：`node --test test\replacementAccountsWeb.test.js` 通过，7/7 pass；`node --test test\accountsWebApi.test.js` 通过，7/7 pass；全量 `npm test` 通过，194/194 pass；`node --check .\web\app.js`、`node --check .\web\accounts.js` 通过。
- 待办：如需进一步优化宽表阅读体验，可继续压缩列宽或改成关键字段卡片式展示。

## 2026-06-05 PRD-002 change 基线合并

- 来源工作日志：`docs/work/2026-06-05-prd-002-change-merge.md`
- 当前进展：`CHG-031`、`CHG-032`、`CHG-033`、`CHG-034`、`CHG-035`、`CHG-037` 已合并到 `docs/prd/PRD-002-account-management-system.md`，状态均更新为 `merged`。
- 清理：已删除本次分页的临时计划文档 `docs/plans/2026-06-05-account-pagination-design.md` 和 `docs/plans/2026-06-05-account-pagination.md`；保留 change/work 记录作为审计链。
- 当前提醒：`CHANGE_REGISTRY.md` 中当前未发现 `CHG-031` 至 `CHG-037` 仍处于待合并 PRD 的状态。

## 2026-06-05 账号列表分页

- 来源工作日志：`docs/work/2026-06-05-account-list-pagination.md`
- change：`docs/changes/CHG-037-account-list-pagination.md`，状态 `merged`，已合并 PRD。
- 当前进展：邮箱账号接口 `/api/accounts` 和补号账号接口 `/replacement-accounts` 已支持 `page`、`pageSize`、`status`、`keyword` 服务端分页查询，并返回 `pagination` 元数据。邮箱账号页和补号管理页已新增每页条数、上一页、下一页和当前页显示；筛选状态或输入关键词会重置到第 1 页并重新请求接口。
- 验证：RED 阶段新增测试分别失败于 `listAccountsPage is not a function`、分页控件缺失和接口未分页；修复后 `npm test -- test\accounts.test.js test\replacementAccounts.test.js` 通过，29/29 pass；`npm test -- test\accountsWebApi.test.js test\replacementAccountsApi.test.js test\replacementAccountsWeb.test.js` 通过，26/26 pass；全量 `npm test` 通过，194/194 pass；`node --check .\src\accounts.js`、`node --check .\src\replacementAccounts.js`、`node --check .\src\server.js`、`node --check .\web\accounts.js`、`node --check .\web\app.js` 通过。

## 2026-06-05 邮箱邮件详情弹窗修复

- 来源工作日志：`docs/work/2026-06-05-email-mail-detail-dialog.md`
- 新增 issue：`docs/issues/issue-006-email-mail-detail-dialog-missing.md`，状态 `resolved`。
- 当前进展：已定位邮箱账号页面点击邮件摘要无弹窗的根因：`web/accounts.js` 的 `openMailDetailDialog()` 引用了 `#mailDetailDialog` 和多个详情字段节点，但 `web/accounts.html` 缺少对应 DOM。已在页面中补回邮件详情弹窗结构，并新增回归测试覆盖。另补充 `.gitignore` 例外 `!web/accounts.html`，确保该页面模板不会继续被全局 `*.html` 规则忽略。
- 验证：RED 阶段 `npm test -- test\accountsWebApi.test.js` 失败于缺少 `id="mailDetailDialog"`；修复后同命令通过，5/5 pass。全量 `npm test` 通过，186/186 pass；`node --check .\web\accounts.js`、`node --check .\src\server.js` 通过。

## 2026-06-05 更新

- 来源工作日志：`docs/work/2026-06-05-roxy-add-phone-transition-race.md`
- 新增 issue：`docs/issues/issue-002-roxy-add-phone-transition-race.md`
- change：`docs/changes/CHG-032-roxy-add-phone-transition-guard.md`，状态 `merged`，已合并 PRD。
- 当前进展：已修复 `phone-add` 提交后的跳转竞态；`waitForStageTransition()` 支持忽略当前阶段，`phone-add` 提交后不会再把同阶段 `phone-add` 当作有效跳转，避免重复填写手机号并命中 disabled/detached 旧组件。新增回归测试覆盖 add-phone 短暂停留后进入 phone-code 的场景。
- 验证：`npm test -- test/roxyOauthLogin.test.js` 通过，56/56 pass；`node --check .\src\auto\roxy_oauth_login.js` 通过。
- 待办：重新执行完整 `/replace` 实机链路，确认 `Add your phone number -> Check your phone -> Codex/callback` 通过；通过后关闭 `issue-002`。

## 2026-06-05 callback CDP fallback 更新

- 来源工作日志：`docs/work/2026-06-05-roxy-callback-cdp-fallback.md`
- 新增 issue：`docs/issues/issue-003-roxy-callback-chrome-error-url.md`
- change：`docs/changes/CHG-033-roxy-callback-cdp-fallback.md`，状态 `merged`，已合并 PRD。
- 当前进展：已修复 Codex callback 在 Chrome error 页下漏识别的问题；当 `page.url()` 为 `chrome-error://chromewebdata/` 时，会通过 CDP `Page.getNavigationHistory()` / `Target.getTargets()` 提取匹配本次 `state` 的 callback URL，并继续 token exchange。
- 新增日志：检测到 Chrome error 页时记录 CDP fallback 尝试；从 navigation history 或 target URL 捕获 callback 时记录来源。
- 验证：`npm test -- test/roxyOauthLogin.test.js` 通过，57/57 pass；`node --check .\src\auto\roxy_oauth_login.js` 通过。
- 待办：重新执行完整 `/replace` 实机链路，确认 callback 后 token exchange 和 CPA JSON 生成成功；通过后关闭 `issue-003`。

## 2026-06-05 phone-code transition race 更新

- 来源工作日志：`docs/work/2026-06-05-roxy-phone-code-transition-race.md`
- 新增 issue：`docs/issues/issue-004-roxy-phone-code-transition-race.md`
- change：`docs/changes/CHG-034-roxy-phone-code-transition-guard.md`，状态 `merged`，已合并 PRD。
- 当前进展：已修复 `phone-code` 提交后的跳转竞态；`processOAuthLoginFlow()` 在手机验证码提交后等待离开当前 `phone-code` 阶段，并记录/消费 `openAi_phone_code()` 返回的 `next-stage`。`openAi_phone_code()` 在验证码输入框 wait/click/fill 或 Continue click 失败时，会复检 Codex/callback 并返回下一阶段，避免重复操作 disabled/detached 旧 `Code` 输入框。
- 验证：`npm test -- test/roxyOauthLogin.test.js` 通过，58/58 pass；`node --check .\src\auto\roxy_oauth_login.js` 通过。
- 待办：重新执行完整 `/replace` 实机链路，确认 `Check your phone -> Codex/callback -> token exchange` 通过；通过后关闭 `issue-004`。

## 2026-06-05 token exchange 页面上下文重试更新

- 来源工作日志：`docs/work/2026-06-05-roxy-token-page-context-retry.md`
- 新增 issue：`docs/issues/issue-005-roxy-token-fallback-exit-ip.md`
- change：`docs/changes/CHG-035-roxy-token-page-context-retry.md`，状态 `merged`，已合并 PRD。
- 当前进展：已移除正式 token exchange 默认 Playwright `request` / Node `fetch` fallback；`exchangeToken()` 默认只走 Roxy 浏览器页面上下文，最多 3 次重试，单次默认 10000ms。页面上下文 `fetch` 使用浏览器内 `AbortController`，单次超时会 abort 当前 token 请求，避免上一轮迟到请求和后续 retry 重复兑换同一个 authorization code。当前页为 Chrome error、空白页或非 `auth.openai.com` origin 时，会在同一 Roxy browser context 中复用或新建 auth 页面，并通过同源 `fetch('/oauth/token', ...)` 换 token。
- 新增日志：每次 token exchange 尝试和失败均记录 attempt、maxAttempts、timeoutMs、当前 URL、origin、token URL 和诊断。
- 验证：`npm test -- test/roxyOauthLogin.test.js` 通过，59/59 pass；`node --check .\src\auto\roxy_oauth_login.js` 通过。
- 待办：重新执行完整 `/replace` 实机链路，确认 `Codex/callback -> auth.openai.com 页面上下文 token exchange -> CPA JSON` 通过；通过后关闭 `issue-005`。

## 2026-06-05 自动化运行日志保留数量更新

- 来源工作日志：`docs/work/2026-06-05-automation-log-retention-limit.md`
- 新增 change：`docs/changes/CHG-036-automation-log-retention-limit.md`，状态 `merged`，已合并到 `PRD-002`。
- 当前进展：新增 `.env` 配置 `REPLACEMENT_AUTOMATION_LOG_MAX_RUNS`，默认 30。每次创建新的补号或注册自动化运行记录后，会按配置保留最近记录；超过范围的非 `running` 旧记录会删除数据库行，并同步删除其 `log_path` 指向的日志文件。`running` 记录不会自动清理。
- 验证：`npm test -- test\replacementAccounts.test.js` 通过，21/21 pass；`npm test -- test\cpaConfig.test.js` 通过，3/3 pass。
- 备注：`CHG-031` 至 `CHG-035` 已在后续 PRD 基线合并中更新为 `merged`。

- 来源工作日志：`docs/work/2026-06-04-roxy-add-phone-page.md`
- 当前任务：Roxy OAuth 登录流程已串接到 OAuth callback、token exchange 和本地 CPA JSON 保存；验证码 API 已补充公开 key 与本机免登录调用能力；补号接口已通过子进程接入 Roxy OAuth 自动化；补号子进程日志页面和停止按钮已实现；补号管理页已增加公开验证码 key 展示、启用开关和复制公开验证码 URL 入口；CPA 凭证健康检测、失效分类、自动补号队列、CPA JSON 上传和复查已实现；补号列表现已完整显示关键运行字段；公开验证码已新增一键启用/停用专用操作；手机和邮箱验证码阶段均已增加状态守卫；Roxy OAuth 已新增添加手机号页处理，会从补号表手机号注入的 `ROXY_OAUTH_PHONE` 填写 `Phone number`；Codex 授权点击已增加 OAuth callback 竞态监听，并支持 URL 变化后用匹配 `state` 的 `code/state` 判定成功，避免长时间卡在 Playwright click 等待；token 交换现默认只使用 Roxy 浏览器页面上下文，最多 3 次重试，单次默认 10000ms，页面 fetch 超时会 abort；手动补号与自动补号现已统一走 CPA repair worker，补号后都会上传 CPA 并复查；Roxy 支持按 `ROXY_KEEP_OPEN` 推导有头/无头运行；`banned` 账号不会触发自动补号；管理员可手动触发 OpenAI 注册自动化，注册从 `https://chatgpt.com/` 进入且只用内部 POST 邮箱验证码接口；新增补号账号时 `activated_at` 为空会由后端自动写入当前时间；部署文档已补充 SQLite 数据库迁移、运行日志、自动化产物迁移说明，以及 RoxyBrowser 必填参数和 `/workspace/list`、`/browser/list` 获取方式。`CHG-017` 至 `CHG-026`、`CHG-028` 至 `CHG-037` 已合并进 `PRD-002` 基线，`CHG-027` 保持 `superseded`。
- 当前进展：已实现 `processOAuthLoginFlow` 状态机，覆盖 OpenAI 邮箱输入、邮箱验证码、添加手机号、手机验证方式选择、手机验证码、Codex 授权确认、OAuth callback 捕获、`exchangeToken` 和认证 JSON 保存；邮箱验证码阶段现在会在填写验证码前后、填写/点击失败时重新检测是否已进入添加手机号、短信验证码、手机验证方式、Codex 或 callback，命中则交回状态机，避免继续操作旧验证码输入框。Codex 授权点击前现在会监听 `localhost:1455/auth/callback` 请求并轮询当前 URL，点击过程若捕获 callback 会立即返回；如果 callback 请求未捕获但当前 URL相对点击前已变化，且 query/hash 中包含匹配本次 `state` 的 `code/state`，也会判定成功；未捕获则记录等待并交回状态机继续识别。`exchangeToken` 现在默认只走 Roxy 浏览器页面上下文换 token，最多 3 次重试，单次默认 10000ms；当前页为 Chrome error、空白页或非 `auth.openai.com` origin 时会复用/新建 auth 页面并执行同源 `fetch('/oauth/token')`；页面 fetch 超时会 abort，默认不回退 Playwright request/Node fetch。实机运行 `node .\src\auto\roxy_oauth_login.js` 已成功生成本地 CPA/sub2api JSON。验证码侧新增 `GET /api/verification-code/public/latest?key=...`，通过补号账号表放权 key 获取验证码；`POST /api/verification-code/latest` 本机请求免 `admin_auth`。`POST /replacement-accounts/:id/register` 已支持管理员手动触发注册自动化，注册脚本使用 RoxyBrowser 接管页面，从 `https://chatgpt.com/` 进入注册流程，只通过 `POST /api/verification-code/latest` 获取邮箱验证码，不使用 SMS API。`POST /replacement-accounts/:id/replace` 在生产注入 `cpaRepairWorker` 后会走统一 repair 链路：运行 Roxy OAuth、读取 `src/auto/product_files/cpa/<email>.json`、上传 CPA、复查 CPA 健康、落库成功或失败；子进程环境会注入 `ROXY_OAUTH_EMAIL`、`ROXY_OAUTH_PHONE` 和 `PHONE_VERIFICATION_SMS_API_URL`。CPA 返回 `status=active` 现在视为健康，repair worker 会把 CPA 读取、上传、复查和成功/失败步骤追加到同一个补号运行日志。新增 `GET /cpa/auth-health`，会读取 CPA auth-files，将凭证分类为 `healthy`、`banned`、`disabled`、`auth_expired`、`quota_limited` 或 `unknown_error`；只有 `auth_expired` 会按邮箱匹配补号账号并进入 single-flight 队列，本地补号账号 `status=banned` 时跳过入队并返回 `account_banned`。`ROXY_KEEP_OPEN=1` 默认有头并保留窗口，`ROXY_KEEP_OPEN=0` 默认无头并关闭窗口，`ROXY_HEADLESS` 可显式覆盖。补号列表主表新增 `phone` 原文、`sms_api`、`sms_last_error`、`activated_at`、`status_updated_at`、`public_code_key` 等列，表格使用水平滚动查看长字段；新增补号账号未提交 `activated_at` 时，`src/replacementAccounts.js` 会写入当前 ISO 时间。公开验证码现在可通过操作菜单直接“启用公开验证码”或“停用公开验证码”，对应 `PATCH /replacement-accounts/:id/public-code`。手机和邮箱验证码阶段现在以“取一次码 + 检查一次页面状态”的方式轮询，验证码为空不会点击提交，进入后续页则交回外层状态机继续。`docs/project/deployment.md` 已补充环境变量、启动方式、SQLite 数据库迁移步骤和部署检查项；迁移时至少复制 `data/app.db` 与 `.env`，完整补号上下文建议同时复制 `data/automation-logs/`、`src/auto/product_files/cpa/` 和 `src/auto/product_files/sub2api/`；RoxyBrowser 自动补号还需配置 `ROXY_API_BASE_URL` / `ROXY_API_PORT`、`ROXY_API_TOKEN`、`ROXY_WORKSPACE_ID` 和窗口定位参数，workspace ID 通过 `/workspace/list` 获取，窗口 `ROXY_BROWSER_SORT_NUM` 通过 `/browser/list?workspaceId=...` 返回的 `sortNum` / `windowSortNum` / `SN` 获取。`docs/prd/PRD-002-account-management-system.md` 最近基线合并日期已更新为 `2026-06-05`，并吸收 `CHG-017` 至 `CHG-026`、`CHG-028` 至 `CHG-037` 的需求内容。
- 关键文件：`src/auto/roxy_oauth_login.js`、`src/auto/roxy_register_openai.js`、`src/replacementServices.js`、`src/replacementAutomationRuns.js`、`src/server.js`、`src/replacementAccounts.js`、`src/db.js`、`src/config.js`、`src/cpaClient.js`、`src/cpaCredentialHealth.js`、`src/cpaCredentialMonitor.js`、`src/cpaRepairQueue.js`、`src/cpaRepairWorker.js`、`src/cpaCredentialMonitorRunner.js`、`web/index.html`、`web/app.js`、`web/styles.css`、`web/automation-logs.html`、`web/automation-logs.js`、`test/roxyOauthLogin.test.js`、`test/roxyRegisterOpenai.test.js`、`test/replacementServices.test.js`、`test/replacementAccountsApi.test.js`、`test/replacementAccountsWeb.test.js`、`test/verificationCodeApi.test.js`、`test/replacementAccounts.test.js`、`test/cpa*.test.js`、`docs/prd/PRD-002-account-management-system.md`、`docs/project/deployment.md`、`docs/changes/CHANGE_REGISTRY.md`、`docs/changes/CHG-017-replacement-automation-log-page.md`、`docs/changes/CHG-018-public-verification-code-ui.md`、`docs/changes/CHG-019-cpa-auth-health-monitor.md`、`docs/changes/CHG-020-replacement-table-full-fields.md`、`docs/changes/CHG-021-public-code-toggle-api.md`、`docs/changes/CHG-022-roxy-phone-code-state-guard.md`、`docs/changes/CHG-023-roxy-email-code-state-guard.md`、`docs/changes/CHG-024-unified-cpa-repair-and-roxy-headless.md`、`docs/changes/CHG-025-banned-accounts-skip-auto-repair.md`、`docs/changes/CHG-026-roxy-codex-callback-click-guard.md`、`docs/changes/CHG-028-roxy-token-exchange-page-context-short-timeout.md`、`docs/changes/CHG-029-manual-openai-registration.md`、`docs/changes/CHG-030-default-replacement-activated-at.md`、`docs/changes/CHG-031-roxy-add-phone-page.md`、`docs/work/2026-06-03-roxy-codex-callback-click-guard.md`、`docs/work/2026-06-03-deployment-database-migration.md`、`docs/work/2026-06-03-prd-002-change-merge.md`、`docs/work/2026-06-04-prd-002-register-and-time-merge.md`、`docs/work/2026-06-04-roxy-add-phone-page.md`
- 关键产物：`src/auto/product_files/cpa/jregkolpig+s4@gmail.com.json`、`src/auto/product_files/sub2api/jregkolpig+s4@gmail.com.json`。这些文件包含敏感 token，禁止提交或公开。
- 下一步建议：先用刚才卡在 add phone 的补号账号重新执行一次 `/replace`，确认 `Add your phone number` -> 手机验证码 -> Codex 授权链路实机通过；CPA 管理密钥修复后，再用后台登录态手动请求 `GET /cpa/auth-health`，确认 CPA auth-files 读取、分类、补号、上传和复查链路；手动验证稳定后再设置 `CPA_HEALTH_MONITOR_ENABLED=true` 启用 10 分钟轮询。
