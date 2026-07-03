# CHG-056 注册后自动启用 2FA

状态：implemented

创建日期：2026-07-02

关联 PRD：PRD-003

## 背景

补号账号已经具备 `codex_2fa` 字段和“2FA补号”流程。用户希望 OpenAI 注册自动化完成后，直接在同一个 Roxy 浏览器环境中开启 ChatGPT TOTP MFA，并把新生成的 TOTP secret 保存下来，避免后续再手动补 2FA。

## 目标

- 注册成功后自动启用 TOTP MFA。
- MFA 协议请求在 Roxy/ChatGPT 页面上下文中执行，复用当前浏览器 Cookie、Cloudflare 状态、设备指纹和登录态。
- 将成功启用后返回的 TOTP secret 写入补号账号 `codex_2fa`。
- 运行日志不泄露 TOTP secret、验证码、Cookie 或 access token。

## 验收标准

- [x] 注册脚本获取 `accessToken` 后，默认调用 ChatGPT MFA 接口完成 TOTP enrollment 和 activation。
- [x] 注册脚本返回结构化 `registrationMfa.secret`。
- [x] 后端 `POST /replacement-accounts/:id/register` 能解析子进程结果并保存 `codex_2fa`。
- [x] 日志只记录 secret 打码信息，不记录完整 TOTP secret。
- [x] 支持 `ROXY_REGISTER_ENABLE_MFA=0` 关闭注册后自动启用 MFA。

## 实现记录

实现日期：2026-07-02

- `src/auto/roxy_register_openai.js` 新增 `enableChatGptTotpMfa()`，在页面上下文中执行 `/backend-api/accounts/mfa/enroll`、本地 TOTP 生成、`/backend-api/accounts/mfa/user/activate_enrollment` 和最终 `/backend-api/accounts/mfa_info` 校验。
- 注册流程在获取 `https://chatgpt.com/api/auth/session` 的 `accessToken` 后默认执行 MFA 启用；成功后 CLI 输出 `ROXY_REGISTER_RESULT_JSON=...` 供后端解析。
- `src/replacementServices.js` 解析注册子进程 stdout 中的结构化结果，并继续对日志中的 `secret` 做脱敏。
- `src/server.js` 在注册接口成功后读取 `registrationMfa.secret` 并更新补号账号 `codex_2fa`。
- 更新测试覆盖注册脚本 helper、服务层子进程结果解析和 API 落库。

验证：

```powershell
node --test test\roxyRegisterOpenai.test.js test\replacementServices.test.js test\replacementAccountsApi.test.js
node --check src\auto\roxy_register_openai.js
node --check src\replacementServices.js
node --check src\server.js
```

结果：相关定向测试通过，语法检查通过。

## 回滚

回滚 `src/auto/roxy_register_openai.js` 中 MFA 后置步骤、`src/replacementServices.js` 中 `ROXY_REGISTER_RESULT_JSON` 解析、`src/server.js` 中注册后 `codex_2fa` 落库逻辑，并移除相关测试与文档即可。
