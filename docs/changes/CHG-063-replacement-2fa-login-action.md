# CHG-063 补号操作菜单新增 2FA 登录入口

状态：implemented

创建日期：2026-07-03

关联 PRD：PRD-003

## 背景

已新增 `src/auto/roxy_2fa_login.js` 用于 ChatGPT session 2FA 登录并生成凭证文件。补号管理页需要提供独立操作入口，避免与现有“2FA补号”（Codex OAuth 补号链路）混淆。

## 变更内容

- 补号管理页“操作⌄”菜单新增 `2FA登录`。
- 前端点击后调用 `POST /replacement-accounts/:id/login-2fa`。
- 后端新增 `login-2fa` 路由，读取当前补号账号并调用 `replacementServices.loginAccountWith2FA(account)`。
- `replacementServices` 新增 `loginAccountWith2FA()`，子进程运行 `src/auto/roxy_2fa_login.js`。
- 注入账号字段：
  - `email` -> `ROXY_2FA_EMAIL` 和 `ROXY_OAUTH_EMAIL`
  - `password` -> `ROXY_OAUTH_PASSWORD`
  - `codex_2fa` 数字码 -> `ROXY_OAUTH_2FA_CODE`
  - `codex_2fa` 非数字码 -> `ROXY_OAUTH_TOTP_SECRET`
- `2FA登录` 不修改补号状态、不增加补号次数；仅返回当前账号和自动化 run。

## 验收标准

- [x] 操作菜单出现 `2FA登录`。
- [x] 前端调用 `/replacement-accounts/:id/login-2fa`。
- [x] 后端启动 `src/auto/roxy_2fa_login.js`。
- [x] 密码和 2FA secret/code 从当前账号记录注入。
- [x] 原 `2FA补号` 行为不变。

## 实现记录

实现日期：2026-07-03

- 修改 `web/app.js` 增加菜单项、action 分发和 `loginAccountWith2FA()`。
- 修改 `src/server.js` 增加 `POST /replacement-accounts/:id/login-2fa`。
- 修改 `src/replacementServices.js` 增加 `twoFaLoginScriptPath` 与子进程自动化。
- 补充 `test/replacementServices.test.js`、`test/replacementAccountsApi.test.js`、`test/replacementAccountsWeb.test.js`。

## 回滚

移除 `web/app.js` 中 `login-2fa` 菜单和函数，删除 `src/server.js` 的 `login-2fa` 路由，并删除 `src/replacementServices.js` 的 `loginAccountWith2FA()` 及相关测试即可回滚。
