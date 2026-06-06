# 2026-06-06 Roxy OAuth 密码页 one-time code 与邮箱后异常重试

- 状态：done
- 关联 change：`docs/changes/CHG-040-roxy-openai-password-one-time-code.md`
- 关联 issue：`docs/issues/issue-008-roxy-openai-password-email-code-misclassification.md`
- 目标：修复 Roxy OAuth 在 OpenAI `Enter your password` 页面卡住的问题，并在邮箱提交后进入异常页面时回到本次 OAuth target URL 重试。

## 实现内容

- 通过 Roxy 当前 CDP 启动 Playwright recorder，录制到密码页操作：点击 `Log in with a one-time code`。
- `src/auto/roxy_oauth_login.js` 新增密码页判断和 one-time code 操作函数。
- 邮箱提交后新增阶段判断，支持 `openai-password`、`email-code`、`codex-login`、`callback` 和 `unknown`。
- `processOAuthLoginFlow()` 在邮箱提交后进入密码页时执行 one-time code，再继续状态机。
- 邮箱提交后进入未知页面时，重新导航本次 OAuth target URL 并重试；默认最多 3 次，耗尽后抛出 `OPENAI_POST_EMAIL_STAGE_RETRY_EXHAUSTED`。
- 日志新增邮箱后 next stage、密码页识别、one-time code 后 next stage、异常重试次数和重试耗尽信息。
- 二次修复：密码页上的 readonly `Email address` 输入框不再被 `is_openai_login_page()` 误判为邮箱登录页；one-time code 点击后等待后续阶段时会忽略当前 `openai-password`，避免页面未跳转完成时立即返回 `next=openai-password`。
- 复盘：`issue-002` 和 `issue-004` 已记录过同阶段跳转竞态，本次复发是因为新增 password 阶段时没有把“提交后必须忽略当前阶段”的规则泛化到新阶段。

## 验证

- RED：新增测试在旧逻辑下失败，失败点为密码页仍触发 `OPENAI_EMAIL_VERIFICATION_TIMEOUT`，以及未知页面未进入 OAuth target 重试。
- GREEN：`node --test .\test\roxyOauthLogin.test.js` 通过，68/68 pass。
- 语法检查：`node --check .\src\auto\roxy_oauth_login.js` 通过。
- 当前 Roxy 实机页面 `https://auth.openai.com/email-verification` 验证：`openai-page` 返回 false，`email-code-page` 返回 true。

## 未完成 / 风险

- 尚未重新执行完整 `/replace` 实机链路；建议用刚才卡在密码页的补号账号再跑一次，确认 `email -> password -> one-time code -> email code / Codex -> callback` 通过。
