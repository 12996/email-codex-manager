# 2026-06-03 Roxy 手机验证码阶段状态守卫

## 背景

实机失败截图显示，错误发生在 `openAi_phone_code`，但页面已经是 “Sign in to Codex with ChatGPT” 授权确认页。根因是短信验证码轮询期间页面状态变化，旧逻辑取到验证码后仍按手机验证码页继续查找 `Code` 输入框。

## 完成内容

- 新增回归测试：短信 API 返回验证码前页面已切到 Codex 授权页时，不填写验证码、不点击提交。
- 新增 `fetchPhoneVerificationCodeOnce`，支持手机验证码阶段做“取一次码 + 查一次页面状态”的短循环。
- `openAi_phone_code` 在轮询前和填写前检查 callback / Codex 授权页。
- 验证码为空时只等待下一轮，不触发页面提交。

## 验证

- `npm test -- test/roxyOauthLogin.test.js`

