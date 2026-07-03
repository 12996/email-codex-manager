# CHG-054 补号管理页新增 2FA 补号操作

状态：implemented

创建日期：2026-07-02

关联 PRD：PRD-003

## 背景

补号管理页已有普通 OAuth 补号入口，但该入口运行 `src/auto/roxy_oauth_login.js`，适配 one-time-code 登录路径。真实 Roxy 2FA 流程需要使用补号账号里的密码与 `codex_2fa` 字段，并运行新的 `src/auto/roxy_2fa_auth_login.js`。

## 目标

- 在补号管理页新增“2FA补号”操作。
- 新增后端接口 `POST /replacement-accounts/:id/replace-2fa`。
- 复用补号账号现有字段向 2FA 自动化子进程传值，不要求管理员手工拼命令行参数。

## 验收标准

- [x] 补号管理页行操作和快捷操作中出现“2FA补号”入口。
- [x] 点击“2FA补号”调用 `POST /replacement-accounts/:id/replace-2fa`。
- [x] 后端接口读取补号账号，并按普通补号一致的状态流转：开始置为 `replacing`，成功置为 `cpa_mounted` 并增加 `replacement_count`，失败置为 `failed` 并记录错误。
- [x] 默认子进程运行 `src/auto/roxy_2fa_auth_login.js`。
- [x] 子进程 env 复用 `email`、`phone`、`sms_api`、`email_code_api`、`password` 和 `codex_2fa`；`codex_2fa` 为 6-8 位数字时作为一次性 `ROXY_OAUTH_2FA_CODE`，否则作为 `ROXY_OAUTH_TOTP_SECRET`。

## 实现记录

实现日期：2026-07-02

- `src/replacementServices.js` 新增 `replaceAccountWith2FA()` 和默认 2FA 子进程适配器。
- `src/server.js` 新增 `POST /replacement-accounts/:id/replace-2fa`。
- `web/app.js` 与 `web/index.html` 新增“2FA补号”行操作和快捷操作。
- 新增/更新回归测试覆盖服务层 env 注入、API 路由和前端入口。

验证：

```powershell
node --test test\replacementServices.test.js
node --test test\replacementAccountsApi.test.js
node --test test\replacementAccountsWeb.test.js
node --check src\replacementServices.js
node --check src\server.js
node --check web\app.js
```

结果：相关定向测试通过，语法检查通过。

## 回滚

回滚 `src/replacementServices.js`、`src/server.js`、`web/app.js`、`web/index.html` 和相关测试中的 `replace-2fa` 改动，并删除本 change 记录即可恢复到仅普通补号入口。
