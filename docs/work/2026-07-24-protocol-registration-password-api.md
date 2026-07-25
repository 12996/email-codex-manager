# 2026-07-24 协议注册密码接口

## 完成内容

- 确认 Python 协议注册接收 `ROXY_REGISTER_PASSWORD` 但旧 OTP-only 流程未消费该值。
- 从当前 Auth 前端资源确认创建密码接口为 `POST /api/accounts/user/register`，请求字段为 `username` 与 `password`，Sentinel flow 为 `username_password_create`。
- 协议流程已改为 signup -> 密码提交 -> 邮箱 OTP；新增密码请求、OTP 触发及主流程顺序回归测试。

## 验证

- Python 协议注册测试：52/52。
- Node 相关专项：49/49。

## 实机验证（2026-07-25）

- 账号 214 的验证码 API 已传入，`POST /authorize/continue` 已实测到达服务端。
- 服务端要求 `username` 为 `{ "kind": "email", "value": "..." }`；字符串形态会被拒绝。
- 完整顺序确认为：signup `authorize/continue` → 邮箱验证页 → 密码页 → `user/register` → 邮箱 OTP → `about_you` → OAuth 回调 → session access token → 直接 TOTP enroll/activate。
- `user/register` 返回 `email_otp_send`；OTP 验证返回 `about_you`。`create_account` 必须同时携带 Sentinel token、SO token 和 `x-access-flow-invocation-id`。
- 已用全新补号邮箱完成端到端实测：密码已提交、OTP 与资料已完成、OAuth session 已取得 access token、TOTP 已激活并验证，账号状态已回写 `registered`。
- Roxy `/browser/list` 一度返回 502。IP 元数据读取失败改为告警并继续当前 CDP 会话；如果读取到的新 IP 与已有 IP 不一致，仍会终止 OAuth。
