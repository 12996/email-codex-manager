# 2026-06-03 Roxy 邮箱验证码阶段状态守卫

## 背景

实机失败日志显示 `openai-email-code` 已获取邮箱验证码，但随后等待 fallback 输入框超时。该问题与手机验证码阶段同类：验证码请求期间页面状态已变化，旧逻辑仍按邮箱验证码页继续填写。

## 完成内容

- 新增回归测试：邮箱验证码 API 返回验证码时页面已切到 Codex 授权页，不填写验证码、不点击提交。
- 新增 `fetchEmailVerificationCodeOnce`，支持邮箱验证码阶段做“取一次码 + 查一次页面状态”的短循环。
- `openAi_email_code` 在轮询前和填写前检查 callback / Codex 授权页 / 手机验证页。
- 验证码为空时只等待下一轮，不触发页面提交。

## 验证

- `npm test -- test/roxyOauthLogin.test.js`

