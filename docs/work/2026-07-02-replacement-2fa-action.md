# 2026-07-02 补号管理页新增 2FA 补号操作

## 目标

把 Roxy 2FA OAuth 登录脚本接入补号管理页，允许管理员像普通补号一样直接从补号账号记录传值启动“2FA补号”。

## 改动

- 新增 change：`docs/changes/CHG-054-replacement-2fa-ui-action.md`。
- `src/replacementServices.js`
  - 新增默认 `twoFaScriptPath = src/auto/roxy_2fa_auth_login.js`。
  - 新增 `replaceAccountWith2FA(account, options)`。
  - 子进程 env 复用补号账号字段：`email`、`phone`、`sms_api`、`email_code_api`、`password`、`codex_2fa`。
  - `codex_2fa` 为 6-8 位数字时注入 `ROXY_OAUTH_2FA_CODE`，否则注入 `ROXY_OAUTH_TOTP_SECRET`。
- `src/server.js`
  - 新增 `POST /replacement-accounts/:id/replace-2fa`。
  - 状态流转与普通补号保持一致：开始 `replacing`，成功 `cpa_mounted`，失败 `failed`。
- `web/index.html` / `web/app.js`
  - 快捷操作和行操作新增“2FA补号”。
  - 前端调用 `/replacement-accounts/:id/replace-2fa` 并记录成功/失败活动。
- 测试
  - `test/replacementServices.test.js` 覆盖 2FA 子进程脚本路径和 env 注入。
  - `test/replacementAccountsApi.test.js` 覆盖新 API。
  - `test/replacementAccountsWeb.test.js` 覆盖前端入口。

## 验证

```powershell
node --test test\replacementServices.test.js
node --test test\replacementAccountsApi.test.js
node --test test\replacementAccountsWeb.test.js
node --check src\replacementServices.js
node --check src\server.js
node --check web\app.js
```

上述定向测试和语法检查通过。

## 待办

- 重启当前 `node src/server.js` 服务后，补号管理页才会加载新增“2FA补号”入口。
- 可选择一个真实补号账号实机点击“2FA补号”，验证 password + MFA + phone + Codex callback 到 CPA JSON 生成的完整链路。
