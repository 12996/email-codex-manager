# 2026-07-03 补号操作菜单新增 2FA 登录入口

## 目标

在补号管理页“操作⌄”菜单中新增 `2FA登录`，调用新脚本 `src/auto/roxy_2fa_login.js` 完成 ChatGPT session 登录并生成凭证文件。

## 实现

- `web/app.js`
  - 操作菜单新增 `🔑 2FA登录`。
  - `handleAction()` 新增 `login-2fa` 分支。
  - 新增 `loginAccountWith2FA()`，调用 `/replacement-accounts/:id/login-2fa`。
- `src/server.js`
  - 新增 `POST /replacement-accounts/:id/login-2fa`。
  - 成功返回当前账号和自动化 run，不写补号成功状态、不增加补号次数。
- `src/replacementServices.js`
  - 新增 `twoFaLoginScriptPath`，默认 `src/auto/roxy_2fa_login.js`。
  - 新增 `loginAccountWith2FA(account)`，注入邮箱、密码和 2FA code/secret 后启动子进程。

## 验证

- `node --test test\replacementServices.test.js`：24/24 pass。
- `node --test test\replacementAccountsApi.test.js`：19/19 pass。
- `node --test test\replacementAccountsWeb.test.js`：12/12 pass。
- `node --test test\roxy2FALogin.test.js`：3/3 pass。
- `node --check src\replacementServices.js`：通过。
- `node --check src\server.js`：通过。
- `node --check web\app.js`：通过。
- `git diff --check -- src\replacementServices.js src\server.js web\app.js test\replacementServices.test.js test\replacementAccountsApi.test.js test\replacementAccountsWeb.test.js src\auto\roxy_2fa_login.js test\roxy2FALogin.test.js`：通过。

## 待办

- 重启当前 `node src/server.js` 后，新菜单入口和新 API 才会在运行中服务生效。
- 可选：选择真实账号从 UI 点击 `2FA登录` 做端到端验证。
- 当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。
