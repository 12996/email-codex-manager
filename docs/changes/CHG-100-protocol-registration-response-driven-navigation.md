# CHG-100 协议注册响应驱动导航与密码阶段顺序

状态：implemented
创建日期：2026-07-28
关联 PRD：PRD-003

## 变更

- Roxy CDP 的后台页初始化和文档导航从等待 `domcontentloaded`/`load` 改为等待
  HTTP response `commit`；导航结果提供脱敏重定向状态链。
- Python bridge 等待时间覆盖页面命令的 bridge 重试与首次 origin 初始化，避免
  bridge 正在重试时 Python 先以 60 秒超时退出。
- OAuth callback 先校验导航 HTTP 响应，最终仍以 `/api/auth/session` 的
  `accessToken` 为成功依据。
- 协议注册恢复真实前端的 OAuth 初始参数：`screen_hint=login_or_signup`、
  `prompt=login`、`login_hint=<email>`。
- 协议注册在初始 `/email-verification` 页面过渡后进入密码页，先请求
  `username_password_create` Sentinel token 并调用 `user/register`；仅在其返回
  `email_otp_send` 后才调用 `POST /api/accounts/email-otp/validate`。

## 原因

页面加载完成不是协议状态成功的证据。账号 `210` 和历史账号 `214` 均出现：步骤 5
返回 `email_otp_verification` 后，旧代码直接跳到密码页并提交 `user/register`，被服务端以
`invalid_auth_step` 拒绝；移除邮箱绑定动作后又变为 `invalid_state`。

2026-07-28 的两次真实前端手动录制确认：前端 OAuth 初始 URL 使用上述默认参数，页面顺序为
`authorize -> email-verification -> create-account/password`。当前在线 bundle 明确将验证码提交实现为
`POST /api/accounts/email-otp/validate`，请求体为 `{code}`。因此，服务端 Auth 状态的唯一可靠
推进顺序是“邮箱验证成功响应 -> password continuation -> `user/register`”，而不是访问密码页 URL。

## 验证

- `npm test -- test/roxyCdpBridge.test.js`：12/12 通过。
- `python -m unittest tests.test_roxy_bridge tests.test_password_registration`：33/33 通过。
- 新增回归测试覆盖“邮箱验证码验证必须先于密码提交”的顺序。
- 实机协议注册尚待使用新的未注册邮箱执行；完成后更新本 change 和 issue-020。

## 2026-07-30 恢复记录

误将 `src/auto/protocol_registration/` 恢复到 `ab37db5` 后，未提交的 CHG-100
状态机实现被覆盖，导致 `user/register` 在前置 OTP 验证前提交并返回 HTTP 409
`invalid_state`。Git 历史中不存在完整的“OTP validate -> password continuation ->
user/register”版本；已依据本 change 与 issue-020 重建该顺序，并以回归测试验证。

2026-07-30 已在 Roxy `617-3` 手动完成新账号端到端验收：前置 OTP、密码、密码后 OTP、
资料提交、OAuth callback 和 TOTP 2FA 均成功。自动流程尚有独立的外部邮箱 API 旧码问题。
接口参数与双 OTP 旧码防护的实施指导见 `docs/project/protocol-registration-flow.md`。

2026-07-30 已实现自动 OTP 错码恢复：`wrong_email_otp_code` 被分类为可恢复错误，
自动流程记录新的时间下界并继续等待后续邮件；补号邮箱轮询默认间隔改为 5 秒，最大等待保持 120 秒。
已提交验证码同时在当前 OTP 阶段排除，避免接口重复返回同一码时再次提交并耗尽服务端尝试次数。
