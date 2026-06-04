# CHG-029 管理员手动触发 OpenAI 注册自动化

状态：implemented

创建日期：2026-06-04

关联 PRD：PRD-002

影响范围：`src/replacementServices.js`, `src/server.js`, `src/auto/roxy_register_openai.js`, `web/app.js`, `test/`, `docs/project/api.md`

## 背景

补号账号管理需要把“注册”和“OAuth 补号”拆成两个阶段。管理员先在后台手动触发 OpenAI 注册自动化；后续仍通过现有 `/replace` 语义执行 OAuth 补号。

## 变更

- 新增 `POST /replacement-accounts/:id/register`，需要后台登录态。
- 新增 `replacementServices.registerAccount(account)`，默认通过子进程运行 `src/auto/roxy_register_openai.js`。
- 注册脚本复用 `roxy_oauth_login.js` 的 RoxyBrowser 开窗/CDP 接管流程，不再由主流程裸启动普通 Chromium。
- 注册子进程使用 `replacement_accounts.email` 覆盖 `ROXY_REGISTER_EMAIL` 和 `ROXY_OAUTH_EMAIL`。
- 注册阶段不使用 `replacement_accounts.sms_api`，也不向子进程注入 `PHONE_VERIFICATION_SMS_API_URL`。
- 注册验证码统一通过 `POST /api/verification-code/latest` 请求，body 为 `{ "account": email }`。
- 注册脚本从 `https://chatgpt.com/` 进入注册流程，不再以 `https://auth.openai.com/log-in/password` 作为首跳入口。
- 注册运行复用 `replacement_automation_runs` 和 `data/automation-logs/`，日志以 `registration` 和 `[roxy-register-openai]` 区分，并记录 `step=...`。
- 补号管理页操作菜单新增“注册”入口。
- 敏感信息约束：日志不得输出验证码、Cookie、token、代理密码等明文。

## 验收标准

- [x] 管理员可通过 `POST /replacement-accounts/:id/register` 触发注册自动化。
- [x] 账号不存在返回 `ACCOUNT_NOT_FOUND`。
- [x] 注册失败返回 `REGISTER_FAILED` 并附带账号信息。
- [x] 子进程 env 不包含 `PHONE_VERIFICATION_SMS_API_URL`。
- [x] 注册脚本通过 RoxyBrowser 接管页面，遵守项目自动化浏览器运行边界。
- [x] 注册脚本用 `POST /api/verification-code/latest` 获取邮箱验证码，不使用公开 GET 接口或 SMS API。
- [x] 日志记录阶段和运行记录，但不输出验证码明文。

## 验证

- `node --test test\replacementServices.test.js test\replacementAccountsApi.test.js test\roxyRegisterOpenai.test.js` 通过。
- `node --check src\replacementServices.js`
- `node --check src\server.js`
- `node --check web\app.js`
- `node --check src\auto\roxy_register_openai.js`
