# 2026-07-17 Roxy OAuth 邮箱验证码协议提交

## 目标

在保留旧 DOM 流程的前提下，增加可选的 Roxy 页面上下文邮箱验证码协议提交，避免验证码提交时脱离浏览器上下文。

## 实现

- 新增配置开关：`ROXY_EMAIL_OTP_PROTOCOL=1`。
- 通过 `page.evaluate()` 在当前 Roxy 页面 POST `/api/accounts/email-otp/validate`。
- 请求使用 `credentials: include` 和自动生成的 `x-access-flow-invocation-id`。
- 成功响应的 `continue_url` 通过同一页面继续导航。
- HTTP 4xx 直接失败；`evaluate` 不可用或网络异常时回退 DOM，默认仍是 DOM 流程。

## 验证

- RED：新增协议 POST、401 防重复提交、无 `evaluate` 回退测试，旧实现按预期失败。
- GREEN：实现协议分支后 `node --test test/roxyOauthLogin.test.js` 81/81 通过。
- 联动回归：`node --test test/roxyOauthLogin.test.js test/roxy2FAAuthLogin.test.js test/roxy2FALogin.test.js` 107/107 通过。
- `node --check src/auto/roxy_oauth_login.js` 和 `git diff --check` 通过。

## 使用

在服务 `.env` 中设置 `ROXY_EMAIL_OTP_PROTOCOL=1` 后，OAuth/2FA OAuth 邮箱验证码阶段启用协议模式；删除或设为 `0` 即恢复旧 DOM 流程。

本次只完成自动化回归验证，未触发真实注册或提交真实验证码。
