# 2026-07-03 iCloud 邮箱验证码 API 优先级对齐

## 背景

用户要求 iCloud 邮箱验证码逻辑与 Gmail 一致：补号账号行的 `email_code_api` 不为空时优先走该接口；为空时才走默认 iCloud 验证码 API。

## 实现

- `src/replacementServices.js`
  - 移除 iCloud 账号强制忽略 `email_code_api` 的特殊分支。
  - 注册、普通补号和 2FA 补号现在都会对 iCloud 账号保留账号级外部邮箱验证码 API。
- `src/auto/roxy_oauth_login.js`
  - `verificationApiUrl` / `VERIFICATION_CODE_API_URL` 优先于 iCloud 默认 API。
  - 未配置显式 API 时，`@icloud.com` 仍默认走 `/api/icloud-verification-code/latest`。
- `src/auto/roxy_register_openai.js`
  - 同步验证码 API 解析顺序，直接运行脚本时也支持显式 URL 覆盖。

## 验证

RED：

```powershell
node --test test\replacementServices.test.js
node --test test\roxyOauthLogin.test.js
```

结果：失败于 iCloud 账号未注入外部 API，以及 `openAi_email_code()` 对 iCloud 邮箱忽略显式 `verificationApiUrl`。

GREEN：

```powershell
node --test test\replacementServices.test.js
node --test test\roxyOauthLogin.test.js
node --test test\roxyRegisterOpenai.test.js
```

结果：相关定向测试通过。

最终验证：

```powershell
node --test test\replacementServices.test.js test\roxyOauthLogin.test.js test\roxyRegisterOpenai.test.js
node --check src\replacementServices.js
node --check src\auto\roxy_oauth_login.js
node --check src\auto\roxy_register_openai.js
git diff --check
```

结果：98/98 pass；语法检查和 diff 检查均通过。

## 待办

- 重启服务后新子进程环境注入逻辑生效。
- 用一个 iCloud 补号账号分别验证两种路径：
  1. `email_code_api` 有值时访问外部 API。
  2. `email_code_api` 为空时访问本地 `/api/icloud-verification-code/latest`。
