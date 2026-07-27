# 2026-07-28 协议注册 CDP 超时诊断

## 结论

账号 `211` 的失败发生在 Auth 邮箱验证码发送页导航，不是验证码、密码或
OpenAI HTTP 业务错误。Roxy bridge 的单次导航和 Python 外层等待都设置为
60 秒，bridge 开始重试时外层已经超时退出，导致已配置的 3 次导航重试无法完成。

## 证据

- run `691`：`data/automation-logs/protocol-registration-211-2026-07-27T15-44-44-120Z.log`
- 账号 `211` 仍为 `unregistered`，且本次未走到 `user/register`。
- 问题记录：`docs/issues/issue-020-protocol-registration-cdp-navigate-timeout-budget.md`。

## 后续

先修复 bridge 内外层超时预算并补回归测试，再重试账号 `211`。
该修复需覆盖所有 `session.navigate()` 和跨 origin warm-up，不只覆盖
`email-otp/send`。

## 00:58 阶段错配补充

账号 `210`（`billows_whine_4y@icloud.com`）的 run `692` 在步骤 7 收到
`HTTP 400 invalid_auth_step`，不是导航超时。步骤 5 返回的服务端阶段为
`email_otp_verification`，但当前代码只因页面 URL 到达
`/create-account/password` 就调用 `user/register`；服务端拒绝表明该 URL 不能作为
密码阶段已经生效的证据。账号仍为 `unregistered`。

## 已实施修复，待实机验收

- 新增 `CHG-100`：后台导航只等待 HTTP `commit`，返回脱敏重定向链；Python 等待预算覆盖 bridge 重试。
- 密码流程不再在 `user/register` 之前跟随步骤 5 返回的 `email-otp/send` continuation；该请求会把 Auth 会话提前推进到 OTP 阶段并导致 `invalid_auth_step`。
- 自动化验证：Node bridge 12/12、Python 协议相关 33/33 通过。
- 待办：从协议注册入口重新执行账号 `210`，以运行日志确认 `user/register` 不再返回 `invalid_auth_step`。
