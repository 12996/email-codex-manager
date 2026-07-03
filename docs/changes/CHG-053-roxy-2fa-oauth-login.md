# CHG-053 Roxy 2FA OAuth 登录自动化脚本

状态：implemented

创建日期：2026-07-02

关联 PRD：PRD-003

## 背景

真实 Roxy OAuth 登录流程从 OpenAI password 页进入 MFA challenge，而现有 `src/auto/roxy_oauth_login.js` 在 password 页默认点击 one-time code，无法覆盖“密码 + 2FA”登录路径。

## 目标

- 新增独立脚本 `src/auto/roxy_2fa_auth_login.js`，用于密码 + 2FA MFA OAuth 登录。
- 继续复用现有 Roxy 连接、手机号补号、手机验证码、Codex consent、callback 捕获、token exchange、失败截图和 CLI runner 能力。
- 默认 OAuth authorize URL 增加 `prompt=login`，但 CLI 第一个参数仍可覆盖目标 URL。

## 验收标准

- [x] 新模块导出密码登录、MFA 识别/提交、TOTP 生成、2FA 状态机、`run` 和 `runCli`。
- [x] password 页填写密码并点击 Continue，不点击 one-time-code。
- [x] MFA 页可通过 URL `/mfa-challenge/` 或 `Verify your identity / Code` 文案识别，并填写 2FA code。
- [x] 2FA code 可由显式配置读取，也可由 TOTP secret 本地生成，不新增外部依赖。
- [x] 状态机支持从 email 页进入 `password -> mfa -> phone-add -> phone-verify -> phone-code -> codex -> callback`，后续阶段复用原 OAuth 状态机。
- [x] 默认 auth URL 带 `prompt=login`，且 CLI 第一个参数仍可覆盖 target URL。

## 实现记录

实现日期：2026-07-02

- 新增 `src/auto/roxy_2fa_auth_login.js`。
- `src/auto/roxy_oauth_login.js` 增加 `buildOAuthAuthorizeUrl` 导出，并允许 `run()` 注入 `buildAuthUrl` 与 `processOAuthLoginFlow`，用于新脚本复用原 runner。
- 新脚本在 password/MFA 阶段完成后，将后续页面交回原 `processOAuthLoginFlow()` 处理 add-phone、phone-verification、Codex consent、callback 和 token exchange。
- 新增最小 HOTP/TOTP 实现，避免新增依赖。

验证：

```powershell
node --test test\roxy2FAAuthLogin.test.js
node --test test\roxyOauthLogin.test.js
node --test test\roxy2FAAuthLogin.test.js test\roxyOauthLogin.test.js
node --check src\auto\roxy_2fa_auth_login.js
node --check src\auto\roxy_oauth_login.js
```

结果：新增测试 7/7 pass；合并 OAuth 回归 76/76 pass；两个自动化脚本语法检查通过。

## 回滚

可删除 `src/auto/roxy_2fa_auth_login.js` 与 `test/roxy2FAAuthLogin.test.js`，并回滚 `src/auto/roxy_oauth_login.js` 中的 `buildAuthUrl` / `processOAuthLoginFlow` 注入钩子，恢复到仅 one-time-code OAuth 自动化。
