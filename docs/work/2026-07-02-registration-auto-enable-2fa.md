# 2026-07-02 注册后自动启用 2FA

## 背景

用户确认 ChatGPT MFA 开启协议可以在当前 Roxy 浏览器登录态中完成，并要求把 2FA 开启步骤接到注册自动化后面。目标是注册完成后自动生成并保存 TOTP secret，供后续“2FA补号”流程使用。

## 实现

- `src/auto/roxy_register_openai.js`
  - 新增 `enableChatGptTotpMfa(page, accessToken)`。
  - 注册获取 `/api/auth/session` 的 `accessToken` 后，默认在页面上下文中执行：
    1. `GET /backend-api/accounts/mfa_info`
    2. `POST /backend-api/accounts/mfa/enroll`
    3. 本地生成 TOTP code
    4. `POST /backend-api/accounts/mfa/user/activate_enrollment`
    5. `GET /backend-api/accounts/mfa_info` 校验启用成功
  - CLI 成功退出前输出 `ROXY_REGISTER_RESULT_JSON=...`，用于父进程解析。
  - 支持 `ROXY_REGISTER_ENABLE_MFA=0` 关闭该步骤。
- `src/replacementServices.js`
  - 子进程成功后解析 stdout 中的 `ROXY_REGISTER_RESULT_JSON`。
  - 日志脱敏新增 TOTP secret 规则。
- `src/server.js`
  - `POST /replacement-accounts/:id/register` 成功后读取 `registrationMfa.secret`，写回补号账号 `codex_2fa`。

## 验证

RED：

```powershell
node --test test\roxyRegisterOpenai.test.js test\replacementServices.test.js test\replacementAccountsApi.test.js
```

结果：失败于 `enableChatGptTotpMfa` 未导出、服务层未解析 `childResult`、注册接口未保存 `codex_2fa`。

GREEN：

```powershell
node --test test\roxyRegisterOpenai.test.js test\replacementServices.test.js test\replacementAccountsApi.test.js
```

结果：41/41 pass。

最终完成前还需跑语法检查和相关定向回归。

## 待办

- 重启当前服务后新注册流程生效。
- 用真实 Roxy 注册账号再跑一次端到端验证，确认 `codex_2fa` 自动写入补号账号。
