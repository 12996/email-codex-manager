# CHG-086 Roxy OAuth 邮箱验证码协议提交

状态：implemented
创建日期：2026-07-17
关联 PRD：PRD-003
影响范围：`src/auto/roxy_oauth_login.js`、`test/roxyOauthLogin.test.js`、`.env.example`、`docs/project/`

## 背景

OAuth 邮箱验证码原流程依赖 DOM 填写和点击。为复用 Roxy 浏览器的 Cookie、指纹和出口 IP，增加可选的页面上下文协议提交模式。

## 变更内容

- `ROXY_EMAIL_OTP_PROTOCOL=1` 时，在 Roxy 页面上下文 POST `/api/accounts/email-otp/validate`。
- 请求自动生成 `x-access-flow-invocation-id`，使用浏览器 Cookie 和页面上下文发出请求。
- 成功响应按 `continue_url` 在同一 Roxy 页面导航。
- HTTP 4xx 直接抛出协议错误，不再使用 DOM 重复提交验证码。
- 页面不支持 `evaluate` 或协议网络异常时回退现有 DOM 流程；默认配置保持旧流程。

## 验收标准

- [x] 协议模式发送正确 POST、请求体和 invocation ID。
- [x] HTTP 401 不触发 DOM 二次提交。
- [x] 页面上下文不可用时回退 DOM。
- [x] `roxyOauthLogin`、`roxy2FAAuthLogin`、`roxy2FALogin` 合计 107/107 通过。
- [x] 源码语法检查和 `git diff --check` 通过。

## 回滚

回滚 `src/auto/roxy_oauth_login.js`、`test/roxyOauthLogin.test.js`、`.env.example` 和本 change 文档；不涉及数据库迁移。
