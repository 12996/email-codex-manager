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
- 协议注册在 `authorize/continue` 返回邮箱 OTP continuation 后，不再提前跟随
  `email-otp/send`；先进入密码阶段并提交 `user/register`，仅在其成功返回后才跟随
  OTP continuation。

## 原因

页面加载完成不是协议状态成功的证据。账号 `210` 和历史账号 `214` 均出现：步骤 5
返回 `email_otp_verification` 后，旧代码提前请求 `email-otp/send`，再提交
`user/register` 被服务端以 `invalid_auth_step` 拒绝。

## 验证

- `npm test -- test/roxyCdpBridge.test.js`：12/12 通过。
- `python -m unittest tests.test_roxy_bridge tests.test_password_registration`：33/33 通过。
- 实机账号 `210` 尚待使用更新后的子进程重新执行；完成后更新本 change 和 issue-020。
