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
