# CHG-010 新增 Roxy OpenAI 邮箱验证码与 Codex 登录确认处理

状态：merged
创建日期：2026-06-02
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

补号自动化在完成 OpenAI 邮箱提交后，需要继续处理邮箱验证码页和 Codex 授权确认页。页面判断需要基于英文关键词和可见控件，不依赖易变 class。

## 变更内容

- 新增：`is_email_code_page(page, options)`，通过 `Code` 输入框和英文关键词判断邮箱验证码页。
- 新增：`openAi_email_code(page, email, options)`，通过验证码 API 获取 6 位验证码，填入 `Code` 输入框并点击 `Continue`。
- 新增：`is_codex_login_page(page, options)`，通过 Codex/ChatGPT 相关英文关键词和 `Continue` 按钮判断 Codex 登录确认页。
- 新增：`codex_login(page, options)`，在 Codex 登录确认页点击 `Continue`。
- 新增：`OPENAI_EMAIL_CODE_PAGE_NOT_FOUND`、`OPENAI_EMAIL_CODE_FETCH_FAILED`、`OPENAI_EMAIL_CODE_INVALID`、`CODEX_LOGIN_PAGE_NOT_FOUND` 等可识别错误。
- 新增：`test/roxyOauthLogin.test.js` 覆盖四个函数的判断、取码、填码和点击行为。

## 验收标准

- [x] 验证码页判断不依赖 class，只使用英文关键词和 `Code` 输入框。
- [x] 能调用 `/api/verification-code/latest` 获取目标邮箱最新 6 位验证码。
- [x] 能填入验证码并点击 `Continue`。
- [x] Codex 登录确认页判断不依赖 class，只使用英文关键词和 `Continue` 按钮。
- [x] 能在 Codex 登录确认页点击 `Continue`。
- [x] 单元测试通过。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-02
- 备注：已合入邮箱验证码页和 Codex 授权确认页处理要求。
