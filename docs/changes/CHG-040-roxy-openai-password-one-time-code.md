# CHG-040 Roxy OAuth 密码页 one-time code 与邮箱后异常重试

状态：merged
创建日期：2026-06-06
关联 PRD：PRD-002
关联 Issue：`docs/issues/issue-008-roxy-openai-password-email-code-misclassification.md`
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

实机 Playwright codegen 录制显示，Roxy OAuth 在提交 OpenAI 邮箱后可能进入 `Enter your password` 页面。旧状态机的 `openAi_login()` 只等待邮箱验证码页，导致进入密码页时无法继续操作。

## 变更内容

- 新增 OpenAI 密码页判断：识别 `Enter your password`、`Password` 输入框和 `Log in with a one-time code` 按钮。
- 新增密码页操作：点击 `Log in with a one-time code`，并识别后续 `email-code`、`codex-login` 或 `callback` 阶段。
- 邮箱提交后新增后续阶段判断：`openai-password`、`email-code`、`codex-login`、`callback` 或 `unknown`。
- `processOAuthLoginFlow()` 接入密码页分支：邮箱提交后进入密码页时，先点击 one-time code，再继续后续验证码 / Codex / callback 状态机。
- 邮箱提交后进入未知页面时，重新导航本次 OAuth target URL 并重新提交邮箱；默认最多重试 3 次，耗尽后抛出 `OPENAI_POST_EMAIL_STAGE_RETRY_EXHAUSTED`。
- 日志补充邮箱提交后的 next stage、密码页识别、one-time code 后 next stage、异常页面重试次数和重试耗尽。
- 修复密码页只读 `Email address` 输入框被误判为邮箱登录页的问题；邮箱验证码页不再被邮箱登录页判断命中。
- 修复点击 one-time code 后页面短暂停留 password 时被立即返回 `openai-password` 的问题，等待阶段会忽略当前 password 页直到出现后续合法阶段。

## 验收标准

- [x] OpenAI 密码页可被识别。
- [x] 密码页点击 `Log in with a one-time code` 后进入邮箱验证码页时继续后续流程。
- [x] 密码页点击 one-time code 后直接进入 Codex consent 时不误报邮箱验证码超时。
- [x] 邮箱提交后进入密码页时，状态机能继续执行 one-time code、邮箱验证码、Codex 授权和 callback/token 交换。
- [x] 邮箱提交后进入未知页面时，会回到本次 OAuth target URL 重试 3 次；仍失败则抛出清晰错误。
- [x] 密码页 readonly 邮箱框不会被误判为邮箱登录页。
- [x] one-time code 点击后短暂停留密码页时不会返回 `next=openai-password`。
- [x] 现有 Roxy OAuth 回归测试保持通过。

## 验证

- RED：新增测试在旧逻辑下失败，关键失败包含 `OPENAI_EMAIL_VERIFICATION_TIMEOUT` 和未触发 `OPENAI_POST_EMAIL_STAGE_RETRY_EXHAUSTED`。
- GREEN：`node --test .\test\roxyOauthLogin.test.js` 通过，68/68 pass。
- 语法检查：`node --check .\src\auto\roxy_oauth_login.js` 通过。
- 实机页面识别：当前 Roxy 页 `https://auth.openai.com/email-verification` 下，`openai-page` 返回 false，`email-code-page` 返回 true。

## 未完成 / 风险

- 尚未重新执行完整 `/replace` 实机链路确认该密码页分支在真实 Roxy 环境下通过。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-07
- 备注：已合并到 PRD-002 最近基线，补充 OpenAI 密码页 one-time code、邮箱提交后阶段识别、未知页面重试和相关日志要求。完整 `/replace` 实机链路风险仍保留在本 change 记录中。
