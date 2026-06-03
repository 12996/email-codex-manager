# 2026-06-02-Roxy OpenAI 登录页邮箱处理与超时判断

- 状态：done
- 目标：在 Roxy OAuth 自动化脚本中加入可复用的 OpenAI 登录页邮箱处理函数，并保留 codegen 录制/调试入口。
- 修改文件：`scripts/roxy-codegen.cjs`、`src/auto/roxy_oauth_login.js`、`src/auto/roxy_oauth_steps_manual_test.js`、`test/roxyCodegenFlow.test.js`、`test/roxyOauthLogin.test.js`、`docs/changes/CHG-008-roxy-openai-login-email-timeout.md`、`docs/changes/CHG-010-roxy-openai-email-code-and-codex-consent.md`、`docs/changes/CHG-012-roxy-openai-phone-verification.md`、`docs/changes/CHG-013-roxy-oauth-failure-screenshots.md`、`docs/work/`
- 实现内容：
  - 新增 `openAi_login(page, email, options)`：等待邮箱输入框、填入传入邮箱、点击 `Continue`。
  - 根据 Playwright codegen 录制结果调整 `openAi_login(page, email, options)`：提交邮箱后等待进入 `/email-verification` 或出现 `Code` 输入框。
  - 新增 `waitForOpenAiEmailVerification(page, options)`：封装邮箱提交后的验证码页等待逻辑。
  - 保留 `session_check(page, email, options)`：作为旧登录页邮箱展示区域校验工具，不作为本次录制确认的主路径。
  - 新增 `is_openai_login_page(page, options)`：判断当前页面是否为 OpenAI 邮箱输入页。
  - 将可复用登录页函数补入 `src/auto/roxy_oauth_login.js` 并导出，`scripts/roxy-codegen.cjs` 保留录制/调试职责。
  - `src/auto/roxy_oauth_steps_manual_test.js` 新增 `openai-page` 和 `openai-login` 手动验证步骤。
  - 新增 `OPENAI_EMAIL_VERIFICATION_TIMEOUT` 和 `OPENAI_LOGIN_EMAIL_MISMATCH` 两类可识别错误。
  - 为 `scripts/roxy-codegen.cjs` 增加 `require.main === module` 保护，使其可被测试导入而不启动真实 CDP。
  - 第二步在 `src/auto/roxy_oauth_login.js` 新增 `is_email_code_page(page, options)`：基于英文关键词和 `Code` 输入框判断邮箱验证码页。
  - 第二步在 `src/auto/roxy_oauth_login.js` 新增 `openAi_email_code(page, email, options)`：通过验证码 API 获取 6 位验证码，填入 `Code` 输入框并点击 `Continue`。
  - 第二步在 `src/auto/roxy_oauth_login.js` 新增 `is_codex_login_page(page, options)`：基于 Codex/ChatGPT 英文关键词和 `Continue` 按钮判断 Codex 登录确认页。
  - 第二步在 `src/auto/roxy_oauth_login.js` 新增 `codex_login(page, options)`：在 Codex 登录确认页点击 `Continue`。
  - 新增 `src/auto/roxy_oauth_steps_manual_test.js`：手动连接 Roxy CDP，按传入参数调用验证码页和 Codex 页函数，便于实机验证。
  - 第三步根据 Playwright codegen 手机页录制结果新增 `is_phone_verify_page(page, options)` 和 `openAi_phone_verify(page, options)`：判断 `Verify your phone number` 页面并选择 `Text Message` 后继续。
  - 第三步新增 `is_phone_code_page(page, options)`、`fetchPhoneVerificationCode(options)` 和 `openAi_phone_code(page, options)`：判断 `Check your phone` / `Enter the verification code` 页面，从 SMS API 文本中提取连续 6 位验证码并提交。
  - `src/auto/roxy_oauth_steps_manual_test.js` 新增 `phone-verify-page`、`phone-verify-submit`、`phone-code-page`、`phone-code-submit` 手动验证步骤。
  - 第四步新增 `captureFailureScreenshot(page, error, step, options)`：页面操作函数失败时默认将截图保存到 `debug_image/`，文件名使用时间戳和步骤名。
  - 第四步在 `openAi_login`、`openAi_email_code`、`openAi_phone_code_request`、`openAi_phone_verify`、`openAi_phone_code`、`codex_login` 外层接入失败截图；截图成功时将路径写入 `error.debugScreenshotPath`，截图失败不覆盖原始错误。
  - 第五步将各阶段页面判断/操作函数组装为 `processOAuthLoginFlow(page, email, options)` 状态机：按页面实际状态执行 OpenAI 邮箱输入、邮箱验证码、手机验证方式选择、手机验证码、Codex 授权确认，并监听 OAuth callback。
  - 新增 `exchangeToken(callbackUrlOrParams, options)`：从 OAuth callback 中的 `code/state` 交换 token bundle，并优先在浏览器页面上下文发起 token 请求以复用真实 Roxy 环境。
  - 新增 CPA JSON 生成与保存逻辑：`buildCpaAuthFile`、`saveIndividualAccountJson`、`formatUtc8Timestamp`，token 交换成功后保存到本地认证文件目录。
  - 邮箱验证码 API 调用支持携带 `admin_auth` cookie；当文件内预置 cookie 不可用时，可通过登录 `/login` 获取后传入。
  - 修复实机串接中的恢复路径：失效 `ROXY_CDP_ENDPOINT` 回退到 Roxy 开窗、OAuth callback 跳转到本地 1455 失败时从网络请求捕获 callback、Codex Continue 点击后页面异常但已发出 callback 时视为成功。
- 验证结果：
  - `npm test -- test/roxyCodegenFlow.test.js` 通过。
  - `npm test -- test/roxyOauthLogin.test.js` 通过。
  - `node src\auto\roxy_oauth_steps_manual_test.js --help` 通过。
  - `node src\auto\roxy_oauth_login.js` 复用当前 Roxy CDP 成功导航到 OpenAI 登录页。
  - `node src\auto\roxy_oauth_steps_manual_test.js --email jregkolpig+s4@gmail.com --step openai-login --timeout 60000` 实机通过，返回 `email-submitted` 和 `/email-verification`。
  - `node src\auto\roxy_oauth_steps_manual_test.js --step email-code-page --timeout 10000` 实机通过，返回 `is_email_code_page=true`。
  - `node --test test\roxyOauthLogin.test.js` 通过，24/24 pass。
  - `node --test src\auto\roxy_oauth_steps_manual_test.js` 通过，1/1 pass。
  - `node src\auto\roxy_oauth_steps_manual_test.js --help` 通过。
  - 失败截图补充后 `npm test -- test\roxyOauthLogin.test.js` 通过，27/27 pass。
  - 失败截图补充后 `node --check src\auto\roxy_oauth_login.js` 和 `node --check test\roxyOauthLogin.test.js` 通过。
  - CPA JSON 串接后 `node --test test\roxyOauthLogin.test.js` 通过，42/42 pass。
  - `node .\src\auto\roxy_oauth_login.js` 实机通过，成功完成 OAuth callback、token exchange 和本地认证 JSON 保存。
  - 已生成本地文件：`src/auto/product_files/cpa/jregkolpig+s4@gmail.com.json` 和 `src/auto/product_files/sub2api/jregkolpig+s4@gmail.com.json`。
  - `npm test` 未全量通过：本次新增的 Roxy codegen 测试通过；失败项在既有 `accountsWebApi.test.js` 侧边栏断言和 `test/test-verification-code.mjs` 本地服务连接上。
- 未完成 / 风险：
  - `src/auto/product_files/` 内生成的是敏感认证文件，不能提交到仓库或公开日志。
  - CPA 后端上传接口已确认，但当前缺少 `MANAGEMENT_KEY`，所以本次只保存本地 JSON，未自动上传。
  - `html/email_code.html` 当前为空文件；验证码页判断主要依据录制结果中的 `Code` 输入框和英文关键词。
- 下一步：
  - 如提供 `MANAGEMENT_KEY`，可把生成后的 CPA JSON 通过 `POST /v0/management/auth-files?name=<account>.json` 上传到 CPA 后端。
  - 将正式补号入口接入 `processOAuthLoginFlow`，并按账号批量调用。

## 追加：公开验证码 key 与本机免登录验证码接口

- 状态：done
- 修改文件：`src/db.js`、`src/replacementAccounts.js`、`src/server.js`、`test/verificationCodeApi.test.js`、`test/replacementAccounts.test.js`、`docs/project/api.md`、`docs/changes/CHG-015-public-verification-code-key.md`
- 实现内容：
  - `replacement_accounts` 新增 `public_code_enabled` 和 `public_code_key` 字段，并保留 `remark` 作为人工备注。
  - `public_code_key` 在创建补号账号时自动生成；更新时如显式提交空 key，则重新生成随机 key。
  - 新增 `GET /api/verification-code/public/latest?key=...`，通过补号账号公开 key 定位邮箱，不在 URL 暴露邮箱明文。
  - 公开验证码接口只允许未软删除且 `public_code_enabled = 1` 的补号账号。
  - `POST /api/verification-code/latest` 支持本机请求免 `admin_auth`，非本机请求仍保留后台登录态校验。
  - 抽取验证码响应复用逻辑，公开 GET 与原 POST 共用主账号路由、IMAP 拉取、别名匹配和验证码提取。
- 验证结果：
  - `npm test -- test/verificationCodeApi.test.js` 通过。
  - `npm test -- test/replacementAccounts.test.js` 通过，覆盖 key 自动生成。
  - `npm test -- test/replacementAccountsApi.test.js` 通过。

## 追加：补号接口接入 Roxy OAuth 子进程自动化

- 状态：done
- 修改文件：`src/replacementServices.js`、`test/replacementServices.test.js`、`.env.example`、`docs/project/api.md`、`docs/changes/CHG-016-replacement-child-process-automation.md`
- 实现内容：
  - `createReplacementServices()` 默认创建 Roxy OAuth 子进程适配器。
  - `replaceAccount(account)` 默认使用 `child_process` 执行 `src/auto/roxy_oauth_login.js`，避免长时间 Playwright/Roxy 自动化直接占用主 Express 进程运行态。
  - 子进程继承 `.env` / `process.env` 中的 Roxy 配置。
  - 使用补号账号行覆盖子进程 env：`email` -> `ROXY_OAUTH_EMAIL`，`sms_api` -> `PHONE_VERIFICATION_SMS_API_URL`。
  - 子进程退出码为 `0` 时沿用现有补号成功逻辑；非 `0` 或启动失败时转为 `REPLACE_FAILED`。
  - 保留注入式 `replacementAutomation` 覆盖能力，便于测试或后续替换适配器。
- 验证结果：
  - `node --test test\replacementServices.test.js` 通过。

## 追加：PRD-002 基线合并

- 状态：done
- 修改文件：`docs/prd/PRD-002-account-management-system.md`、`docs/changes/CHANGE_REGISTRY.md`、`docs/changes/CHG-007-roxy-oauth-cdp-output-and-close-config.md` 至 `docs/changes/CHG-016-replacement-child-process-automation.md`
- 实现内容：
  - 将 `CHG-007` 到 `CHG-016` 的已实现需求合并到 `PRD-002` 基线。
  - `PRD-002` 补充 RoxyBrowser/OAuth 自动化、验证码公开 key、本机免登录验证码接口、失败截图、认证 JSON 导出和补号子进程接入等长期需求。
  - 将相关 change 状态从 `implemented` 更新为 `merged`。
  - 在每个 change 文件中记录合并目标 PRD 与合并日期。
- 后续建议：
  - 新增“子进程补号状态日志页面”应作为新的 change 单独设计和实现。

## 追加：补号子进程日志页面

- 状态：done
- 修改文件：`.gitignore`、`src/db.js`、`src/replacementAutomationRuns.js`、`src/replacementServices.js`、`src/server.js`、`web/sidebar.html`、`web/automation-logs.html`、`web/automation-logs.js`、`web/styles.css`、`test/replacementServices.test.js`、`test/replacementAccountsApi.test.js`、`test/replacementAccountsWeb.test.js`、`test/replacementAccounts.test.js`、`docs/project/api.md`、`docs/changes/CHG-017-replacement-automation-log-page.md`
- 实现内容：
  - 新增 `replacement_automation_runs` 表，用于记录补号自动化 run、账号、状态、PID、日志路径、开始/结束时间、退出码和错误摘要。
  - 新增 `src/replacementAutomationRuns.js` 运行记录仓库。
  - `replacementServices` 子进程适配器在执行时创建 run 记录，并将 stdout/stderr 实时追加到 `data/automation-logs/`。
  - 追加补充：日志文件新增服务侧编排步骤记录，覆盖账号校验、环境准备、启动子进程、创建 run、绑定 stdout/stderr、等待结束和成功/失败/停止状态标记，避免子进程暂无输出时页面显示信息不足。
  - 追加补充：`src/auto/roxy_oauth_login.js` 页面动作新增日志，覆盖填写邮箱、请求/填写邮箱验证码、选择短信验证、请求/填写手机验证码和 Codex 授权继续；日志不输出验证码、Cookie 或 token 明文。
  - 追加补充：邮箱验证码和手机短信验证码获取改为轮询，默认每 5 秒请求一次，最多 12 次；日志记录 attempt 进度但不记录验证码明文。
  - 服务进程内通过 run id 追踪 active child，新增 `stopReplacementRun(runId)`，只停止当前服务会话内仍活跃的 child，不按历史 PID 盲杀系统进程。
  - 新增 `/replacement-automation-logs` 页面，支持查看运行列表、日志详情、running 状态轮询和停止子进程。
  - 新增 `GET /replacement-automation-runs`、`GET /replacement-automation-runs/:id`、`POST /replacement-automation-runs/:id/stop`。
- 验证结果：
  - `node --test .\test\replacementServices.test.js` 通过，11/11 pass。
  - `node --test .\test\roxyOauthLogin.test.js` 通过，45/45 pass。
  - `node --test .\test\replacementAccountsApi.test.js` 通过，5/5 pass。
  - `node --test .\test\replacementAccountsWeb.test.js` 通过，4/4 pass。
  - `node --test .\test\replacementAccounts.test.js` 通过，16/16 pass。
  - `node --check .\src\replacementServices.js` 通过。
  - `node --check .\src\auto\roxy_oauth_login.js` 通过。
  - `node --check .\src\server.js` 通过。
  - `node --test` 全量运行仍有 2 个既有失败项：`test/accountsWebApi.test.js` 的旧侧边栏断言仍匹配到 `系统设置`，`test/test-verification-code.mjs` 依赖本地 3000 服务导致 `ECONNREFUSED`。
