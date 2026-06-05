# 2026-06-04 Roxy OAuth 添加手机号页处理

- 目标：根据 Playwright codegen 录制结果，补齐 OpenAI OAuth `Add your phone number` 页面处理，避免邮箱验证码后状态机超时。
- 修改文件：`src/auto/roxy_oauth_login.js`、`src/auto/roxy_oauth_steps_manual_test.js`、`src/replacementServices.js`、`test/roxyOauthLogin.test.js`、`test/replacementServices.test.js`、`docs/changes/CHG-031-roxy-add-phone-page.md`。
- 结果：
  - 新增 `is_phone_add_page(page, options)` 判断添加手机号页。
  - 新增 `openAi_phone_add(page, options)`，从 `options.phone`、`options.env.ROXY_OAUTH_PHONE` 或 `process.env.ROXY_OAUTH_PHONE` 读取手机号，填写 `Phone number` 并点击 `Continue`。
  - `processOAuthLoginFlow` 已接入添加手机号页分支。
  - `replacementServices.replaceAccount()` 会把补号表 `phone` 注入子进程环境变量 `ROXY_OAUTH_PHONE`。
  - `roxy_oauth_steps_manual_test.js` 新增 `phone-add-page` 和 `phone-add-submit` 手动验证 step。
  - `openAi_email_code()` 在验证码填写/点击前后增加下一阶段检测；当页面已经进入 add phone、phone code、phone verify、Codex 或 callback 时，返回 `next-stage` 交回外层状态机，避免继续操作旧验证码输入框。
- 验证：
  - `npm test -- test/roxyOauthLogin.test.js` 通过。
  - `npm test -- test/replacementServices.test.js` 通过。
  - `node --test src\auto\roxy_oauth_steps_manual_test.js` 通过。
  - 实机连接 Roxy 当前页面：`phone-add-page` 返回 `true`；`phone-add-submit --phone +13523282595` 返回 `{"status":"phone-add-submitted","phone":"+13523282595"}`；随后 `phone-code-page` 返回 `true`。
- 未完成 / 风险：需要再次执行完整 `/replace` 实机验证，确认邮箱验证码后自动进入 add phone、短信验证码和 Codex 后续链路。
