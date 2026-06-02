# CHG-012 Roxy OpenAI 手机验证页处理

状态：implemented

创建日期：2026-06-02

关联 PRD：PRD-002

影响范围：`src/auto/roxy_oauth_login.js`, `src/auto/roxy_oauth_steps_manual_test.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

Playwright codegen 录制确认 OpenAI 登录流程中还存在两个手机验证页面：

- `Verify your phone number`：选择 `Text Message` 后点击 `Continue`。
- `Check your phone` / `Enter the verification code`：填写短信验证码后点击 `Continue`。

需要将这两个页面补入 Roxy OAuth 自动化的可复用运行时函数，并提供手动验证入口。

## 变更内容

- 新增 `is_phone_verify_page(page, options)`：判断手机验证方式选择页。
- 新增 `openAi_phone_verify(page, options)`：选择 `Text Message` 并点击 `Continue`。
- 新增 `is_phone_code_page(page, options)`：判断短信验证码输入页。
- 新增 `fetchPhoneVerificationCode(options)`：从 SMS API 文本返回中提取连续 6 位验证码。
- 新增 `openAi_phone_code(page, options)`：获取或使用直接传入的验证码，填写 `Code` 并点击 `Continue`。
- 手动验证脚本新增 `phone-verify-page`、`phone-verify-submit`、`phone-code-page`、`phone-code-submit` steps。

## 验收标准

- [x] 页面判断先于页面自动化操作。
- [x] 手机验证码 API 返回 `yes|Your OpenAI verification code is: 798824` 时可提取 `798824`。
- [x] 手动验证入口可指定 `--sms-api` 或 `--code`。
- [x] 相关单元测试覆盖新增判断和操作函数。

## 验证

- `node --test test\roxyOauthLogin.test.js` 通过，24/24 pass。
- `node --test src\auto\roxy_oauth_steps_manual_test.js` 通过，1/1 pass。
- `node src\auto\roxy_oauth_steps_manual_test.js --help` 通过，help 包含新增 phone steps、`--sms-api`、`--code`。
- `npm test` 未全量通过：失败仍在既有 `accountsWebApi.test.js` 的 `/系统设置/` 断言和 `test/test-verification-code.mjs` 本地服务连接。
