# 2026-07-16 Roxy run 508 OTP/资料页误判诊断与修复

- 状态：done
- 目标：检查 run `508` 失败并修复继续把 `/about-you` Age 输入框当成 OTP 的问题。

## 结论

- run `508` 已经通过密码和邮箱验证码阶段，失败页面是 `https://auth.openai.com/about-you`。
- 原因是 `input[inputmode="numeric"]` 同时匹配资料页的 Age 输入框；OTP 状态机没有优先识别 profile。
- 这次不是 run `507` 的 detached `ElementHandle` 问题。

## 修复

- 收紧 OTP 输入语义判断。
- `/about-you` 优先判定为 profile。
- OTP 等待和填码前遇到 profile/session 立即停止，避免对 Age 字段执行 `clearAndType()`。
- 新增相邻页面误判回归测试。

## 验证

- Roxy 实时页面确认 URL/title/body/input 属性与日志一致。
- `node --test test/roxyRegisterOpenai.test.js`：31/31 通过。
