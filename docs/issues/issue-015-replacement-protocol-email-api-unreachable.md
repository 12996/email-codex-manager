# issue-015 补号协议注册外部邮箱验证码 API 不可达

状态：active

## 现象

协议注册账号 `178` 已按当前行启动并完成 Roxy 指纹刷新，流程进入 OpenAI 邮箱验证码阶段，但数据库中的外部接口
`http://5.253.38.136:8080/code?email=...` 无法在超时时间内返回。

## 证据

- Windows 直连该接口超时。
- 使用刷新后的 Roxy profile，在页面上下文 `fetch` 请求该接口 15 秒后触发 `AbortError`。
- 使用页面导航请求该接口 30 秒后仍超时。
- 最近运行日志：`data/automation-logs/protocol-registration-178-2026-07-17T07-48-18-539Z.log`。

## 影响

协议注册主流程已进入 OTP 阶段，但无法取得验证码；账号 `178` 保持 `unregistered`，仅更新 `last_error`。

## 下一步

确认外部邮箱 API 服务和端口可用，或为该账号配置可达的 `email_code_api`。恢复后再使用同一个 Roxy profile 做一次单线程端到端验证。
