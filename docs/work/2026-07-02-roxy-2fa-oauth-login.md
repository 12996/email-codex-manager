# 2026-07-02 Roxy 2FA OAuth 登录自动化脚本

## 目标

新增独立 `src/auto/roxy_2fa_auth_login.js`，覆盖用户实测的 OpenAI OAuth 密码 + MFA 流程：

`/choose-an-account -> /log-in-or-create-account -> /log-in/password -> /mfa-challenge/<id> -> /add-phone -> /phone-verification -> /sign-in-with-chatgpt/codex/consent -> localhost:1455/auth/callback`

## 实现

- 新增 `src/auto/roxy_2fa_auth_login.js`。
- 新脚本处理：
  - email 页识别和邮箱提交，进入 password 页后继续留在 2FA 状态机；
  - password 页识别、密码填写和 Continue；
  - `/mfa-challenge/` 或 `Verify your identity / Code` MFA 页识别；
  - 显式 2FA code 或 TOTP secret 生成 code；
  - MFA code 填写和 Continue；
  - 后续 add-phone、phone-verification、phone-code、Codex consent、callback、token exchange 复用原 `roxy_oauth_login.js` 状态机。
- `src/auto/roxy_oauth_login.js` 增加两个复用钩子：
  - `buildAuthUrl`：允许新脚本默认 auth URL 加 `prompt=login`；
  - `processOAuthLoginFlow`：允许新脚本替换前置登录状态机，同时复用原 runner。
- 新增 `test/roxy2FAAuthLogin.test.js`，先 RED 后实现。

## 验证

RED：

```powershell
node --test test\roxy2FAAuthLogin.test.js
```

结果：失败于 `Cannot find module '../src/auto/roxy_2fa_auth_login.js'`，符合预期。

GREEN / 回归：

```powershell
node --test test\roxy2FAAuthLogin.test.js
node --test test\roxyOauthLogin.test.js
node --test test\roxy2FAAuthLogin.test.js test\roxyOauthLogin.test.js
node --check src\auto\roxy_2fa_auth_login.js
node --check src\auto\roxy_oauth_login.js
```

结果：

- `test\roxy2FAAuthLogin.test.js`：7/7 pass。
- `test\roxyOauthLogin.test.js`：69/69 pass。
- 合并运行：76/76 pass。
- 两个 `node --check` 均通过。

## 关联 change

- `docs/changes/CHG-053-roxy-2fa-oauth-login.md`

## 后续

- 可用真实 Roxy 窗口执行 `node src\auto\roxy_2fa_auth_login.js` 做实机验证。
- 运行前需通过环境变量或 options 提供 OpenAI 密码和 2FA 信息，例如 `ROXY_OAUTH_PASSWORD` + `ROXY_OAUTH_2FA_CODE` 或 `ROXY_OAUTH_TOTP_SECRET`。
