# CHG-042 补号注册与 OAuth 支持账号级外部邮箱验证码接口

状态：merged
创建日期：2026-06-08
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/verificationCodeCore.cjs`, `src/verificationCodeService.js`, `src/imapService.js`, `src/db.js`, `src/replacementAccounts.js`, `src/replacementServices.js`, `src/auto/`, `web/`, `test/`, `docs/project/api.md`

## 背景

补号注册和 OAuth 补号都需要从每个补号账号配置的外部邮箱验证码页面获取验证码。该页面返回 HTML/text/JSON，其中 HTML 可能包含 CSS 色值形式的 6 位数字，直接对原 HTML 执行正则会误匹配。

## 变更内容

- 新增：通用验证码提取核心，支持邮件对象、常见 JSON code 字段、HTML/text payload。
- 新增：`replacement_accounts.email_code_api`，前端账号表单和列表最小支持该字段。
- 修改：本地 `/api/verification-code/latest` 继续保持原接口行为，但复用通用提取逻辑。
- 修改：`POST /replacement-accounts/:id/register` 启动注册子进程时，若账号配置 `email_code_api`，注入 `REGISTRATION_EMAIL_CODE_API_URL`。
- 修改：`src/auto/roxy_register_openai.js` 获取邮箱验证码时，优先通过 `registrationEmailCodeApiUrl` / `email_code_api` / `emailCodeApiUrl` 参数或 `REGISTRATION_EMAIL_CODE_API_URL` / `EMAIL_CODE_API` / `email_code_api` 环境变量发起 GET 并用通用逻辑提取验证码；未配置时保持原本 POST 本地接口行为。
- 修改：`POST /replacement-accounts/:id/replace` 启动 OAuth 补号子进程时，若账号配置 `email_code_api`，注入 `VERIFICATION_CODE_API_URL`；未配置时移除该 env，使脚本按 `PORT` 走本地 `POST /api/verification-code/latest`。
- 修改：`src/auto/roxy_oauth_login.js` 获取邮箱验证码时，本地 `/api/verification-code/latest` 保持 POST JSON；外部 `VERIFICATION_CODE_API_URL` 改为 GET 并复用通用验证码提取逻辑处理 HTML/text/JSON。

## 验收标准

- [x] HTML 中存在 CSS 6 位色值和正文验证码时，只提取正文验证码。
- [x] 补号注册子进程可接收账号级 `REGISTRATION_EMAIL_CODE_API_URL`。
- [x] 注册脚本优先 GET 外部邮箱验证码接口，且日志不记录验证码明文。
- [x] 注册脚本可直接识别 `email_code_api` / `EMAIL_CODE_API` 别名，且优先于本地 POST。
- [x] 未配置 `email_code_api` 时，注册脚本保持原本 `POST /api/verification-code/latest` 行为。
- [x] OAuth 补号子进程可接收账号级 `VERIFICATION_CODE_API_URL`。
- [x] OAuth 登录脚本对外部验证码接口使用 GET 并提取 HTML/text/JSON 中的 6 位码。
- [x] OAuth 补号账号未配置 `email_code_api` 时，继续使用本地 POST 验证码接口。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-08
- 备注：已合并账号级 `email_code_api` 数据字段、注册与 OAuth 外部邮箱验证码接口优先级、本地 POST 回退、HTML/text/JSON 验证码提取和相关验收标准。
