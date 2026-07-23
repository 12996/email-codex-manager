# Issue-018 协议注册 2FA 重认证回调返回 401

状态：active

## 现象

2026-07-20 账号 `162`（`seal-heir.3h@icloud.com`）协议注册已取得注册后的
`accessToken`，随后 2FA 设置在以下接口返回 HTTP 401：

```text
POST https://auth.openai.com/api/accounts/email-otp/validate
```

流程没有进入 `mfa/enroll` 或 `activate_enrollment`，最终子进程只输出
`registrationMfa: null`。

## 根因

`protocol_registration/core/account_export.py` 的旧 2FA 分支在已有注册登录态上再次发起：

```text
chatgpt.com/api/auth/signin/openai?connection=password&reauth=password&max_age=0
→ Auth email OTP
→ email-otp/validate
→ OAuth callback
→ mfa/enroll
```

这与当前 OTP-only 注册账号的实际登录态不一致，而且额外引入了第二次邮箱验证码和回调状态。
对比 `src/auto/roxy_register_openai.js`，Roxy 注册流程在取得注册后的 `accessToken` 后直接执行：

```text
mfa_info → mfa/enroll → activate_enrollment → mfa_info
```

因此 401 是旧重认证分支的失败，不是 TOTP 激活接口的失败。

## 修复

- 协议注册统一直接复用注册后的 `accessToken`。
- 直接执行与 `roxy_register_openai.js` 同形态的 ChatGPT MFA 请求并校验最终 `mfa_info`。
- 删除旧的 password re-auth、邮箱 OTP 和二次 OAuth callback 分支。
- 只有直接 MFA 成功并确认启用后才返回 TOTP secret。

## 验证边界

- 新增回归测试证明协议注册不会调用 `signin/openai` 或 `email-otp/validate`。
- 注册协议 Python 测试当前通过 47/47，语法检查通过。
- 账号 162 的失败运行不重复重放；修复后的真实验证需要新的 `unregistered` 测试账号。
