# 2026-06-08 补号注册外部邮箱验证码接口

## 背景

补号注册需要支持每个补号账号配置外部邮箱验证码接口。该接口返回 HTML/text/JSON，其中 HTML 可能包含 CSS 色值形式的 6 位数字，不能直接对原 HTML 做验证码正则匹配。

## 本次变更

- 新增通用验证码提取核心：
  - ESM 入口：`src/verificationCodeService.js`
  - CJS 复用入口：`src/auto/verification-code-adapter.js`
  - 共享核心：`src/verificationCodeCore.cjs`
- `src/imapService.js` 的 `extractSixDigitCode()` 改为复用通用提取逻辑，保持 `/api/verification-code/latest` 原行为。
- `replacement_accounts` 新增 `email_code_api` 字段，仓储 create/update 读写该字段。
- 补号账号前端表单和列表新增“邮箱验证码 API”最小展示/编辑能力。
- `replacementServices.registerAccount()` 在账号配置 `email_code_api` 时向注册子进程注入 `REGISTRATION_EMAIL_CODE_API_URL`；未配置时移除该 env，避免父环境串号。
- `src/auto/roxy_register_openai.js` 获取邮箱验证码时优先 GET `REGISTRATION_EMAIL_CODE_API_URL`，用通用提取逻辑处理 HTML/text/JSON；未配置时保持原本 POST `VERIFICATION_CODE_API_URL`。
- `src/auto/roxy_register_openai.js` 同时兼容直接传入 `email_code_api` / `emailCodeApiUrl` 参数，或设置 `EMAIL_CODE_API` / `email_code_api` 环境变量；这些外部接口配置都会优先于本地 POST。
- `replacementServices.replaceAccount()` 在账号配置 `email_code_api` 时向 OAuth 补号子进程注入 `VERIFICATION_CODE_API_URL`；未配置时移除该 env，让 `src/auto/roxy_oauth_login.js` 按 `PORT` 继续走本地 `POST /api/verification-code/latest`。
- `src/auto/roxy_oauth_login.js` 对本地 `/api/verification-code/latest` 保持 POST JSON，对外部 `VERIFICATION_CODE_API_URL` 改用 GET，并复用通用提取逻辑处理 HTML/text/JSON。
- 新增 change：`docs/changes/CHG-042-email-code-api-extraction-service.md`。
- 更新 API 文档：`docs/project/api.md`。

## 验证

- RED：新增测试先失败于缺少 `src/verificationCodeService.js`、注册子进程未注入账号级 URL、注册脚本仍调用 POST、仓储未持久化 `email_code_api`。
- GREEN：`npm test -- test/verificationCodeService.test.js test/replacementAccounts.test.js test/replacementServices.test.js test/roxyRegisterOpenai.test.js test/verificationCodeApi.test.js test/imapService.test.js` 通过，65/65 pass。
- OAuth 补充 RED：`replaceAccount` 未注入外部邮箱验证码 URL，`openAi_email_code` 对外部 URL 仍走旧 POST/JSON 解析。
- OAuth 补充 GREEN：`node --test test\replacementServices.test.js` 通过，15/15 pass；`node --test test\roxyOauthLogin.test.js` 通过，69/69 pass；`node --check src\auto\roxy_oauth_login.js` 通过。
- 注册别名补充 RED：传入 `email_code_api` 选项时仍调用本地 POST。
- 注册别名补充 GREEN：`node --test test\roxyRegisterOpenai.test.js` 通过，3/3 pass；`node --check src\auto\roxy_register_openai.js` 通过。

## 风险与待办

- 尚未执行真实外部邮箱验证码页面的端到端注册实机验证。
- 当前 `CHG-042` 状态为 `implemented`，未合并 PRD。当前未合并 implemented change 数量为 2（`CHG-042`、`CHG-043`），未达到 5 个提醒阈值。
