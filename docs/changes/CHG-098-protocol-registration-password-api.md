# CHG-098 协议注册提交补号账号密码

状态：merged
创建日期：2026-07-24
关联 PRD：PRD-003
合并日期：2026-07-25
合并目标：PRD-003

协议注册从原先的 OTP-only 路径切换为密码优先：在 Auth 已确认进入密码阶段后，使用 Sentinel `username_password_create`，向 `/api/accounts/user/register` 提交补号账号的 `ROXY_REGISTER_PASSWORD`，再完成邮箱 OTP。

接口路径、字段和 Sentinel flow 已从当前 `auth.openai.com` 前端资源和 Roxy 实机链路确认。`authorize/continue` 使用对象形态 username（`kind=email`、`value`）并先进入邮箱验证页；同一 Auth 会话导航到密码页后，`user/register` 返回 `page.type=email_otp_send`。验证码验证返回 `about_you`，资料提交必须同时带 `oauth_create_account` Sentinel token、SO token 与 invocation id，随后必须跟随返回的 OAuth `continue_url` 并从 ChatGPT session 取得 access token。最后直接用该 access token 激活 TOTP，并以 `mfa_info` 确认结果。

2026-07-25 已用一枚全新补号邮箱跑通以上完整链路：密码提交、邮箱 OTP、资料提交、OAuth 回调、access token、TOTP 激活和补号状态回写均成功。Roxy 的 IP 元数据接口短暂 502 不再中断既有 CDP 会话；只有实际读到不同出口 IP 时才终止 OAuth。
