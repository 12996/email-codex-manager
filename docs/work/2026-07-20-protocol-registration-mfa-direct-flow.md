# 2026-07-20 协议注册 2FA 回调 401 排查与直接 MFA 修复

## 目标

定位账号 `162`（`seal-heir.3h@icloud.com`）协议注册日志中的 2FA 失败，
并对照 `src/auto/roxy_register_openai.js` 修复 Roxy 协议注册的 MFA 阶段。

## 运行证据

- 日志：`data/automation-logs/protocol-registration-162-2026-07-20T09-49-56-554Z.log`
- 已取得注册后的 `accessToken`。
- 失败接口：`POST /api/accounts/email-otp/validate`，HTTP 401。
- 失败发生在 `mfa/enroll` 之前，`registrationMfa` 因此为空。

## 代码对比

- 协议注册旧实现：注册后再次 `signin/openai`，使用 `reauth=password`，再等待邮箱 OTP 和 OAuth callback。
- `roxy_register_openai.js`：直接使用注册后的 `accessToken`，在 ChatGPT 页面上下文执行
  `mfa_info -> mfa/enroll -> activate_enrollment -> mfa_info`。
- 结论：协议注册在 Roxy 下应复用已有登录态，不应再触发 password re-auth。

## 修复与验证

- `setup_2fa()` 统一改为直接 MFA，不再保留 password re-auth 和邮箱 OTP 分支。
- `main.py` 将注册阶段的 `access_token` 显式传入 `setup_2fa()`。
- 2FA 未激活时不再提前把 replacement 账号同步为 `registered`，避免子进程状态与父服务 MFA 守卫冲突。
- 新增 `test_registration_mfa.py`，先在旧代码上确认失败，再在修复后通过。
- 使用 tilian Python 环境运行协议注册测试：47/47 通过。
- Python 语法检查通过。

## 边界

账号 162 的已失败流程不重放，避免重复消耗验证码。修复后的端到端验证应使用新的
`unregistered` 账号，并继续使用 Roxy `617-3 / test`；注册状态机没有接入 CPA 补号协议。
