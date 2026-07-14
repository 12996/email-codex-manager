# 2026-07-03 注册流程先设置数据库密码再提交邮箱验证码

## 背景

用户通过 Roxy 窗口手动演示了 OpenAI 注册流程。真实流程要求：即使页面先进入 `auth.openai.com/email-verification`，也不能直接提交邮箱验证码；必须先点击页面主按钮进入 `create-account/password`，使用补号账号数据库里的 `password` 设置密码，然后再回到真正的邮箱验证码输入页。

## 实现

- `src/replacementServices.js`
  - `registerAccount()` 读取补号账号 `password` 并注入子进程环境变量 `ROXY_REGISTER_PASSWORD`。
  - 未配置账号密码时清理旧环境中的 `ROXY_REGISTER_PASSWORD`，避免复用脏值。
- `src/auto/roxy_register_openai.js`
  - 新增 `resolveRegistrationPassword()`，注册创建密码必须来自 `ROXY_REGISTER_PASSWORD` 或兼容的 `ROXY_OAUTH_PASSWORD`。
  - 新增 `detectNextRegistrationStep()`，用 `registrationPasswordSubmitted` 区分 password 前后的 `email-verification`。
  - password 未提交前遇到 `email-verification`，即使有 OTP 输入框，也返回 `email-verification-before-password`，先执行 `advanceEmailVerificationToPassword()`。
  - 二次修正后，password 未提交前即使 URL 不是 `/email-verification`，只要 OTP 输入框可见，也返回 `email-verification-before-password`，禁止直接进入接码。
  - 创建密码页填写数据库密码，不再随机生成密码。
  - OTP 重试每轮固定 24 次轮询、每次 5 秒，并继续排除上次失败验证码。
  - 注册完成后的自动启用 2FA 和结果输出保持不变。

## 验证

RED：

```powershell
node --test test\replacementServices.test.js
node --test test\roxyRegisterOpenai.test.js
```

结果：失败于 `ROXY_REGISTER_PASSWORD` 未注入，以及 `detectNextRegistrationStep` / `resolveRegistrationPassword` 尚不存在。

GREEN：

```powershell
node --test test\replacementServices.test.js test\roxyRegisterOpenai.test.js
node --check src\auto\roxy_register_openai.js
```

结果：31/31 pass；语法检查通过。

补充验证：

```powershell
node --test test\replacementAccountsApi.test.js
node --check src\server.js
node --check src\replacementServices.js
```

结果：18/18 pass；服务端与 replacement service 语法检查通过。`replacementAccountsApi` 覆盖注册完成后 `registrationMfa.secret` 写入补号账号 `codex_2fa` 的链路。

二次修正：

```powershell
node --test test\replacementServices.test.js test\roxyRegisterOpenai.test.js test\replacementAccountsApi.test.js
node --check src\auto\roxy_register_openai.js
git diff --check
```

结果：51/51 pass；语法检查和 diff 空白检查通过。修复 run `350` 暴露的“URL 未命中 `/email-verification` 但 OTP 输入框已出现，导致直接接码”的误判。

## 待办

- 当前 `node src/server.js` 已于 2026-07-03 20:19:25 重启，新子进程环境注入和二次状态机修正已生效。
- 用真实 Roxy 注册账号端到端验证：password 前 `email-verification` 不填码、数据库密码设置成功、第二次邮箱验证码提交成功、`codex_2fa` 自动写库。
