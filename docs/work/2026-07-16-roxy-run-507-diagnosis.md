# 2026-07-16 Roxy run 507 失败诊断

- 状态：done
- 目标：检查用户保留的 Roxy 页面和 run `507` 的失败原因。

## 结论

- run `507` 实际是 `registration-105`，不是 `src/auto/roxy_2fa_login.js`。
- 根因是 `src/auto/roxy_register_openai.js:653` 的 `humanClick()` 使用旧 `ElementHandle`。密码页提交期间页面已导航到 `email-verification`，旧按钮句柄 detached，最终报 `elementHandle.click: Element is not attached to the DOM`。
- 当前 Roxy 页面已通过手动重新发送并提交新验证码进入 `https://auth.openai.com/about-you`，证明邮箱验证码服务和 OpenAI 页面链路可用。

## 证据

- 数据库：run `507`，`account_id=105`，状态 `failed`，日志 `data/automation-logs/registration-105-2026-07-16T02-41-02-701Z.log`。
- 日志调用链：`humanClick` -> `submitRegistrationPassword` -> `handlePasswordPageDuringOtp` -> `waitForOtpInputReady`。
- 浏览器网络：`POST https://auth.openai.com/api/accounts/email-otp/validate` 使用过期/旧验证码返回 `401`；点击 `Resend email` 获取新码后提交成功，页面进入 `/about-you`。

## 后续

- 已修复注册密码提交的 detached/disabled 点击竞态，并补回归测试。
- 真实 Roxy 页面保持打开在 `/about-you`，未重复触发注册流程。
